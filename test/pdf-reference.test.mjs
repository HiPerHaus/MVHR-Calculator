import assert from "node:assert/strict";
import test from "node:test";

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  applyCommand,
  createProject,
  deserializeProject,
  identityQuaternion,
  knownMm,
  sourcePointToWorld,
  serializeProject,
  unknownMm,
} from "../src/domain/spatial.mjs";
import {
  closePdfReference,
  createPdfRenderPlan,
  inspectPdfPage,
  MAX_PDF_SOURCE_BYTES,
  normalizePdfImportError,
  openPdfForReference,
  PDF_IMPORTER,
  validatePdfSourceBytes,
} from "../src/import/pdf-reference.mjs";
import {
  bytesToDataUrl,
  exportPortableProject,
  importPortableProject,
  sha256Hex,
} from "../src/persistence/portable-project.mjs";
import {
  createCommandHistory,
  executeCommand,
  undoCommand,
} from "../src/domain/history.mjs";
import {
  createA3SheetModel,
  renderA3SheetSvg,
} from "../src/sheets/a3-sheet.mjs";

const FIXED_TIME = "2026-10-20T12:00:00.000Z";

test("PDF.js inspects a synthetic multi-page PDF and exposes bounded page choices", async () => {
  const bytes = syntheticPdfBytes();
  const opened = await openPdfForReference(pdfjs, bytes, { fileName: "two-floor-plans.pdf" });
  try {
    assert.equal(opened.pageCount, 2);
    assert.equal(opened.importer.id, PDF_IMPORTER.id);
    const first = await inspectPdfPage(opened, 1);
    const second = await inspectPdfPage(opened, 2);
    assert.deepEqual(
      { widthPt: first.widthPt, heightPt: first.heightPt, rotationDeg: first.rotationDeg },
      { widthPt: 612, heightPt: 792, rotationDeg: 0 },
    );
    assert.deepEqual(
      { widthPt: second.widthPt, heightPt: second.heightPt, rotationDeg: second.rotationDeg },
      { widthPt: 500, heightPt: 300, rotationDeg: 90 },
    );
    assert.ok(first.widthPx <= 4096);
    assert.ok(first.heightPx <= 4096);
    assert.ok(first.widthPx * first.heightPx <= 12_000_000);
    await assert.rejects(() => inspectPdfPage(opened, 3), /between 1 and 2/);
  } finally {
    await closePdfReference(opened);
  }
  assert.ok(bytes.byteLength > 0, "the original source remains available after PDF.js inspection");
});

test("render planning bounds unusually large PDF pages without changing their proportions", () => {
  const plan = createPdfRenderPlan({ widthPt: 20_000, heightPt: 10_000 });
  assert.ok(plan.widthPx <= 4096);
  assert.ok(plan.heightPx <= 4096);
  assert.ok(plan.widthPx * plan.heightPx <= 12_000_000);
  assert.ok(Math.abs(plan.widthPx / plan.heightPx - 2) < 0.01);
});

test("missing, invalid and over-limit PDF inputs fail before parsing or project mutation", () => {
  assert.throws(() => validatePdfSourceBytes(null, "missing.pdf"), /binary bytes/);
  assert.throws(
    () => validatePdfSourceBytes(new Uint8Array([0x25, 0x50, 0x44]), "short.pdf"),
    /too short to be a PDF/,
  );
  assert.throws(
    () => validatePdfSourceBytes(new TextEncoder().encode("not a PDF source"), "invalid.pdf"),
    /does not contain a PDF header/,
  );
  assert.throws(
    () => validatePdfSourceBytes(new Uint8Array(MAX_PDF_SOURCE_BYTES + 1), "large.pdf"),
    /exceeds the .* PDF source limit/,
  );
  const missing = normalizePdfImportError(Object.assign(new Error("source unavailable"), {
    name: "MissingPDFException",
  }));
  assert.equal(missing.code, "pdf-missing");
  assert.match(missing.message, /could not be read/);
});

test("a selected PDF page preserves original source and renderer provenance through named and portable data", async () => {
  const { project, bytes } = await projectWithPdfPage();
  const reopened = deserializeProject(serializeProject(project));
  assert.equal(reopened.pdfReferenceAssets.length, 1);
  assert.equal(reopened.referenceAssets[0].source.pageNumber, 2);
  assert.equal(reopened.referenceAssets[0].source.rendererVersion, PDF_IMPORTER.version);
  assert.equal(reopened.floorReferences[0].locked, true);
  assert.equal(reopened.floorReferences[0].transform.scaleMmPerPixel.state, "unknown");

  await assert.rejects(
    () => exportPortableProject(project, { now: () => new Date(FIXED_TIME) }),
    /PDF\.js is required/,
  );
  const encoded = await exportPortableProject(project, {
    now: () => new Date(FIXED_TIME),
    pdfjs,
  });
  const portable = await importPortableProject(encoded, { pdfjs });
  assert.equal(portable.project.pdfReferenceAssets[0].sha256, await sha256Hex(bytes));
  assert.equal(portable.project.referenceAssets[0].source.pageNumber, 2);
});

test("PDF crop is nondestructive, bounded, undoable, and portable without changing world alignment", async () => {
  const { project, bytes } = await projectWithPdfPage();
  const originalReference = structuredClone(project.floorReferences[0]);
  const originalPdf = structuredClone(project.pdfReferenceAssets[0]);
  const originalRender = structuredClone(project.referenceAssets[0]);
  const anchorBefore = sourcePointToWorld(originalReference.transform, { x: 250, y: 200 }, 10);
  const crop = { x: 80, y: 70, width: 820, height: 430 };

  const cropped = applyCommand(project, {
    type: "reference.setCrop",
    referenceId: originalReference.id,
    cropSourceRectPx: crop,
  });
  assert.deepEqual(cropped.floorReferences[0].cropSourceRectPx, crop);
  assert.deepEqual(cropped.floorReferences[0].transform, originalReference.transform);
  assert.deepEqual(cropped.floorReferences[0].calibration, originalReference.calibration);
  assert.deepEqual(cropped.pdfReferenceAssets[0], originalPdf);
  assert.deepEqual(cropped.referenceAssets[0], originalRender);
  assert.deepEqual(sourcePointToWorld(cropped.floorReferences[0].transform, { x: 250, y: 200 }, 10), anchorBefore);

  for (const invalidCrop of [
    { x: -1, y: 0, width: 10, height: 10 },
    { x: 0, y: 0, width: 0, height: 10 },
    { x: 900, y: 500, width: 101, height: 101 },
  ]) {
    assert.throws(() => applyCommand(project, {
      type: "reference.setCrop",
      referenceId: originalReference.id,
      cropSourceRectPx: invalidCrop,
    }), /crop/i);
  }

  let history = createCommandHistory(cropped);
  history = executeCommand(history, { type: "reference.resetCrop", referenceId: originalReference.id });
  assert.equal(history.present.floorReferences[0].cropSourceRectPx, null);
  history = undoCommand(history);
  assert.deepEqual(history.present.floorReferences[0].cropSourceRectPx, crop);

  const namedReopen = deserializeProject(serializeProject(history.present));
  assert.deepEqual(namedReopen.floorReferences[0].cropSourceRectPx, crop);
  const encoded = await exportPortableProject(history.present, { now: () => new Date(FIXED_TIME), pdfjs });
  const portable = await importPortableProject(encoded, { pdfjs });
  assert.deepEqual(portable.project.floorReferences[0].cropSourceRectPx, crop);
  assert.equal(portable.project.pdfReferenceAssets[0].sha256, await sha256Hex(bytes));
});

test("A3 PDF reference output clips to the saved crop without scaling the source image", async () => {
  const { project } = await projectWithPdfPage();
  const cropped = applyCommand(project, {
    type: "reference.setCrop",
    referenceId: project.floorReferences[0].id,
    cropSourceRectPx: { x: 100, y: 80, width: 700, height: 360 },
  });
  const sheet = createA3SheetModel(cropped, {
    floorId: "floor-ground",
    orientation: "landscape",
    projectName: "Synthetic PDF crop",
    siteName: "Test site",
    clientName: "Not set",
    drawingTitle: "Ground Floor Manual MVHR Plan",
    drawingId: "HS-CROP-001",
    issueDate: "2026-10-20",
    status: "Preliminary — not for construction",
    revision: "DRAFT",
    revisionText: "Crop verification",
    drawnBy: "",
    checkedBy: "",
  });
  const svg = renderA3SheetSvg(sheet);
  assert.deepEqual(sheet.printScene.references[0].cropSourceRectPx, { x: 100, y: 80, width: 700, height: 360 });
  assert.match(svg, /data-kind="cropped-reference"/);
  assert.match(svg, /<clipPath[^>]*clipPathUnits="userSpaceOnUse"><rect x="100" y="80" width="700" height="360"/);
  assert.match(svg, /<image data-kind="reference"[^>]*width="1000" height="600"[^>]*data-crop="100 80 700 360"[^>]*clip-path=/);
});

test("portable verification rejects tampered PDF source and forged page provenance", async () => {
  const { project } = await projectWithPdfPage();
  const tampered = structuredClone(project);
  tampered.pdfReferenceAssets[0].sha256 = "0".repeat(64);
  await assert.rejects(
    () => exportPortableProject(tampered, { pdfjs }),
    /PDF reference asset checksum mismatch/,
  );

  const forged = structuredClone(project);
  forged.referenceAssets[0].source.rotationDeg = 180;
  await assert.rejects(
    () => exportPortableProject(forged, { pdfjs }),
    /Rendered PDF page provenance mismatch/,
  );
});

test("malformed and password errors are explicit and preserve atomic project state", async () => {
  const malformed = new TextEncoder().encode("%PDF-1.4\nnot a document\n%%EOF\n");
  await assert.rejects(
    () => openPdfForReference(pdfjs, malformed, { fileName: "broken.pdf" }),
    (error) => error.code === "pdf-malformed" && /malformed|unsupported/i.test(error.message),
  );
  const passwordError = normalizePdfImportError(Object.assign(new Error("Password required"), {
    name: "PasswordException",
  }));
  assert.equal(passwordError.code, "pdf-password-protected");

  const base = projectWithFloor();
  const bytes = syntheticPdfBytes();
  const png = syntheticPngHeader(1000, 600);
  const command = await pdfPageCommand(base, bytes, png);
  command.asset.source.pdfAssetId = "wrong-source";
  assert.throws(() => applyCommand(base, command), /original PDF source/);
  assert.equal(base.pdfReferenceAssets.length, 0);
  assert.equal(base.referenceAssets.length, 0);
  assert.equal(base.floorReferences.length, 0);
});

async function projectWithPdfPage() {
  const project = projectWithFloor();
  const bytes = syntheticPdfBytes();
  const png = syntheticPngHeader(1000, 600);
  const command = await pdfPageCommand(project, bytes, png);
  return { project: applyCommand(project, command), bytes };
}

async function pdfPageCommand(project, bytes, png) {
  const opened = await openPdfForReference(pdfjs, bytes, { fileName: "two-floor-plans.pdf" });
  try {
    const descriptor = await inspectPdfPage(opened, 2);
    return {
      type: "reference.addPdfPage",
      pdfAsset: {
        id: "pdf-reference-source-1",
        kind: "pdf",
        fileName: "two-floor-plans.pdf",
        mediaType: "application/pdf",
        byteLength: bytes.byteLength,
        sha256: await sha256Hex(bytes),
        pageCount: opened.pageCount,
        importerId: PDF_IMPORTER.id,
        importerVersion: PDF_IMPORTER.version,
        dataUrl: bytesToDataUrl(bytes, "application/pdf"),
      },
      asset: {
        id: "reference-asset-1",
        kind: "image",
        fileName: "two-floor-plans.pdf · page 2",
        mediaType: "image/png",
        byteLength: png.byteLength,
        sha256: await sha256Hex(png),
        widthPx: 1000,
        heightPx: 600,
        dataUrl: bytesToDataUrl(png, "image/png"),
        source: {
          kind: "pdf-page",
          pdfAssetId: "pdf-reference-source-1",
          pageNumber: descriptor.pageNumber,
          pageCount: descriptor.pageCount,
          pageLabel: descriptor.pageLabel,
          widthPt: descriptor.widthPt,
          heightPt: descriptor.heightPt,
          rotationDeg: descriptor.rotationDeg,
          renderScale: descriptor.renderScale,
          rendererId: PDF_IMPORTER.id,
          rendererVersion: PDF_IMPORTER.version,
        },
      },
      reference: {
        id: "floor-reference-1",
        floorId: project.floors[0].id,
        assetId: "reference-asset-1",
        visible: true,
        locked: true,
        opacity: 0.55,
        transform: {
          translationMm: { x: 0, y: 0 },
          rotationRad: 0,
          scaleMmPerPixel: unknownMm("PDF reference not calibrated"),
        },
        calibration: null,
      },
    };
  } finally {
    await closePdfReference(opened);
  }
}

function projectWithFloor() {
  return applyCommand(createProject("project-pdf-reference"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "synthetic datum") },
        orientation: identityQuaternion(),
      },
    },
  });
}

function syntheticPdfBytes() {
  const encoder = new TextEncoder();
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 500] /Rotate 90 /Contents 6 0 R >>",
    "<< /Length 0 >>\nstream\nendstream",
    "<< /Length 0 >>\nstream\nendstream",
  ];
  let source = "%PDF-1.4\n% synthetic multi-page fixture\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(encoder.encode(source).byteLength);
    source += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = encoder.encode(source).byteLength;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    source += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(source);
}

function syntheticPngHeader(widthPx, heightPx) {
  const bytes = new Uint8Array(45);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, widthPx);
  view.setUint32(20, heightPx);
  bytes.set([8, 6, 0, 0, 0], 24);
  bytes.set([0x49, 0x45, 0x4e, 0x44], 37);
  return bytes;
}
