import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const APP_URL = process.argv[2] ?? "http://127.0.0.1:4193/app/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = 9239;
const profileDirectory = await mkdtemp(join(tmpdir(), "hiper-studio-pdf-workflow-"));
const browser = spawn(CHROME, [
  "--headless=new",
  "--no-first-run",
  "--disable-gpu",
  "--disable-background-networking",
  "--disable-component-update",
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profileDirectory}`,
  "--window-size=1440,1000",
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let browserStderr = "";
const exceptions = [];
browser.stderr.setEncoding("utf8");
browser.stderr.on("data", (chunk) => { browserStderr += chunk; });

try {
  await waitForDevTools(DEBUG_PORT);
  const target = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(APP_URL)}`, { method: "PUT" }).then((response) => response.json());
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  cdp.on("Runtime.exceptionThrown", (params) => exceptions.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "Runtime exception"));
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await waitFor(cdp, `document.readyState === "complete" && document.querySelector("#project-nav")?.classList.contains("active")`);
  assert.equal(await value(cdp, `Boolean(document.querySelector("#add-pdf-reference") && document.querySelector("#pdf-page-choice") && document.querySelector("#pdf-page-preview"))`), true);

  const sourceBytes = syntheticPdfBytes();
  const seeded = await seedPdfProject(cdp, bytesToBase64(sourceBytes));
  assert.deepEqual(seeded, {
    pageCount: 2,
    pageNumber: 2,
    renderWidthPx: 1000,
    renderHeightPx: 600,
    saved: true,
  });
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, `document.readyState === "complete" && document.querySelector("#current-project-name")?.textContent === "PDF Workflow House"`);
  await waitFor(cdp, `document.querySelector("#mode-prompt")?.textContent.includes("Continued")`);
  await click(cdp, "#plan-nav");
  await waitFor(cdp, `!document.querySelector("#plan-workspace")?.hidden && document.querySelector("#reference-list")?.textContent.includes("page 2")`);
  const referenceText = await value(cdp, `document.querySelector("#reference-list").textContent`);
  assert.match(referenceText, /original 2-page source preserved/);
  assert.match(referenceText, /mozilla-pdfjs-reference-renderer/);

  await click(cdp, "#crop-reference");
  await waitFor(cdp, `document.querySelector("#cancel-reference-crop") && !document.querySelector("#cancel-reference-crop").hidden`);
  await click(cdp, "#cancel-reference-crop");
  assert.match(await value(cdp, `document.querySelector("#reference-list").textContent`), /Full PDF page visible/);

  await click(cdp, "#crop-reference");
  await click(cdp, "#zoom-in");
  await dragReferenceSourceRect(cdp, { x: 80, y: 70 }, { x: 950, y: 620 });
  await waitFor(cdp, `!document.querySelector("#reference-crop-dialog")?.open && document.querySelector("#mode-prompt")?.textContent.includes("inside the PDF page")`);
  await dragReferenceSourceRect(cdp, { x: 80, y: 70 }, { x: 920, y: 530 });
  await waitFor(cdp, `document.querySelector("#reference-crop-dialog")?.open`);
  await submit(cdp, "#reference-crop-form");
  await waitFor(cdp, `document.querySelector("#reference-list")?.textContent.includes("Cropped to 840 × 460 px")`);
  const cropRender = await value(cdp, `(() => ({
    image: document.querySelector('#reference-layer image')?.outerHTML ?? '',
    clipPathCount: document.querySelectorAll('#reference-layer clipPath').length,
    cropMode: document.querySelector('#plan-canvas')?.classList.contains('crop-mode') ?? false,
  }))()`);
  assert.match(cropRender.image, /clip-path=/);
  assert.equal(cropRender.clipPathCount, 1);
  assert.equal(cropRender.cropMode, false);

  await click(cdp, "#calibrate-reference");
  await clickReferenceSourcePoints(cdp, [{ x: 100, y: 100 }, { x: 900, y: 100 }]);
  await waitFor(cdp, `document.querySelector("#calibration-dialog")?.open`);
  await setValue(cdp, "#calibration-distance", "8");
  await setValue(cdp, "#calibration-unit", "m");
  await submit(cdp, "#calibration-form");
  await waitFor(cdp, `document.querySelector("#reference-list")?.textContent.includes("mm/px · two-point calibration")`);

  await click(cdp, "#floor-area-tool");
  await clickReferenceSourcePoints(cdp, [
    { x: 100, y: 100 },
    { x: 900, y: 100 },
    { x: 900, y: 500 },
    { x: 100, y: 500 },
  ]);
  await key(cdp, "Enter");
  await waitFor(cdp, `document.querySelector("#floor-area-dialog")?.open`);
  await setValue(cdp, "#floor-area-name", "External serviced perimeter");
  await submit(cdp, "#floor-area-form");
  await waitFor(cdp, `document.querySelector("#draft-status")?.textContent.includes("1 outline")`);

  await click(cdp, "#ventilation-nav");
  await waitFor(cdp, `!document.querySelector("#plan-workspace")?.hidden && !document.querySelector("#mechanical-tools-section")?.hidden`);
  await click(cdp, `[data-mvhr-mounting="vertical"]`);
  await clickReferenceSourcePoints(cdp, [{ x: 500, y: 300 }]);
  await waitFor(cdp, `document.querySelector("#mvhr-placement-dialog")?.open`);
  await setValue(cdp, "#mvhr-model", "generic");
  await submit(cdp, "#mvhr-placement-form");
  await waitFor(cdp, `document.querySelector("#draft-status")?.textContent.includes("1 parts")`);

  await click(cdp, "#plan-nav");
  await delay(250);
  const beforeRecrop = await inspectSavedCropGeometry(cdp);
  assert.deepEqual(beforeRecrop.crop, { x: 80, y: 70, width: 840, height: 460 });

  await click(cdp, "#crop-reference");
  await dragReferenceSourceRect(cdp, { x: 100, y: 90 }, { x: 900, y: 500 });
  await waitFor(cdp, `document.querySelector("#reference-crop-dialog")?.open`);
  await submit(cdp, "#reference-crop-form");
  await waitFor(cdp, `document.querySelector("#reference-list")?.textContent.includes("Cropped to 800 × 410 px")`);
  await delay(250);
  const afterRecrop = await inspectSavedCropGeometry(cdp);
  assert.deepEqual(afterRecrop.crop, { x: 100, y: 90, width: 800, height: 410 });
  assert.equal(afterRecrop.modelFingerprint, beforeRecrop.modelFingerprint, "recropping must not move calibration, perimeter, parts or routes");
  assert.equal(afterRecrop.pdfFingerprint, beforeRecrop.pdfFingerprint, "recropping must not change original PDF bytes or provenance");

  await click(cdp, "#undo");
  await waitFor(cdp, `document.querySelector("#reference-list")?.textContent.includes("Cropped to 840 × 460 px")`);
  await click(cdp, "#redo");
  await waitFor(cdp, `document.querySelector("#reference-list")?.textContent.includes("Cropped to 800 × 410 px")`);
  await click(cdp, "#reset-reference-crop");
  await waitFor(cdp, `document.querySelector("#reference-list")?.textContent.includes("Full PDF page visible")`);
  await click(cdp, "#undo");
  await waitFor(cdp, `document.querySelector("#reference-list")?.textContent.includes("Cropped to 800 × 410 px")`);
  await delay(250);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, `document.readyState === "complete" && document.querySelector("#current-project-name")?.textContent === "PDF Workflow House"`);
  await waitFor(cdp, `document.querySelector("#mode-prompt")?.textContent.includes("Continued")`);
  const reopened = await inspectActiveNamedProject(cdp);
  assert.deepEqual(reopened, {
    name: "PDF Workflow House",
    pdfSources: 1,
    renderedPages: 1,
    calibrated: true,
    crop: { x: 100, y: 90, width: 800, height: 410 },
    outlines: 1,
    components: 1,
    rooms: 0,
  });

  const detailedSeed = await addDetailedWorkflowStage(cdp);
  assert.deepEqual(detailedSeed, {
    pdfSources: 1,
    calibratedReferences: 1,
    outlines: 1,
    rooms: 2,
    components: 4,
    saved: true,
  });
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, `document.readyState === "complete" && document.querySelector("#current-project-name")?.textContent === "PDF Workflow House"`);
  await waitFor(cdp, `document.querySelector("#mode-prompt")?.textContent.includes("Continued")`);
  await click(cdp, "#checks-nav");
  await waitFor(cdp, `!document.querySelector("#checks-workspace")?.hidden`);
  const detailedChecks = await value(cdp, `(() => ({
    airflow: document.querySelector("#checks-airflow-summary")?.textContent ?? "",
    engineering: document.querySelector("#checks-engineering-summary")?.textContent ?? "",
    engineeringBoundary: document.querySelector("#checks-engineering-boundary")?.textContent ?? "",
    costing: document.querySelector("#checks-costing-summary")?.textContent ?? "",
    installer: document.querySelector("#checks-installer-summary")?.textContent ?? "",
    installerBoundary: document.querySelector("#checks-installer-boundary")?.textContent ?? "",
  }))()`);
  assert.match(detailedChecks.airflow, /assigned supply 97\.22 L\/s \(350 m³\/h\).*assigned extract 97\.22 L\/s \(350 m³\/h\)/);
  assert.match(detailedChecks.engineering, /manual assigned room-target total for screening/);
  assert.match(detailedChecks.engineering, /source statement alignment only — review required/);
  assert.match(detailedChecks.engineering, /Network pressure result: not calculated/);
  assert.match(detailedChecks.engineeringBoundary, /not measured flow.*not.*solved terminal allocation/i);
  assert.match(detailedChecks.engineeringBoundary, /cannot.*whole-network suitability/i);
  assert.match(detailedChecks.costing, /0 priced.*total unresolved/i);
  assert.match(detailedChecks.installer, /working draft only.*blank commissioning rows/i);
  assert.match(detailedChecks.installerBoundary, /not an issued installer document/i);

  await click(cdp, "#sheets-nav");
  await waitFor(cdp, `!document.querySelector("#sheet-preview-panel")?.hidden && Boolean(document.querySelector("#sheet-preview-host svg"))`);
  const draftSheet = await value(cdp, `(() => ({
    status: document.querySelector("#sheet-preview-status")?.textContent ?? "",
    note: document.querySelector(".sheet-preview-note")?.textContent ?? "",
    hasReference: Boolean(document.querySelector("#sheet-preview-host svg image")),
    hasCropClip: Boolean(document.querySelector('#sheet-preview-host svg [data-kind="cropped-reference"] clipPath')),
  }))()`);
  assert.match(draftSheet.status, /committed objects only/i);
  assert.match(draftSheet.note, /Schematic coordination output only.*not BIM.*no clash.*airflow.*pressure-loss.*fabrication.*installation certification/i);
  assert.equal(draftSheet.hasReference, true);
  assert.equal(draftSheet.hasCropClip, true);
  assert.deepEqual(exceptions, [], `Browser runtime exceptions: ${exceptions.join("; ")}`);
  cdp.close();
  process.stdout.write(`${JSON.stringify({ ok: true, seeded, reopened, detailedSeed, detailedChecks, draftSheet, referenceText }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  try {
    const pages = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((response) => response.json());
    const page = pages.find((candidate) => candidate.type === "page" && candidate.url.includes("127.0.0.1"));
    if (page) {
      const debug = await connectCdp(page.webSocketDebuggerUrl);
      const state = await value(debug, `(() => ({
        project: document.querySelector('#current-project-name')?.textContent,
        activeNavigation: document.querySelector('.nav-button.active')?.id,
        planHidden: document.querySelector('#plan-workspace')?.hidden,
        referenceSummary: document.querySelector('#reference-list')?.textContent,
        prompt: document.querySelector('#mode-prompt')?.textContent,
      }))()`);
      process.stderr.write(`Browser state: ${JSON.stringify(state)}\n`);
      debug.close();
    }
  } catch (diagnosticError) {
    process.stderr.write(`Browser state unavailable: ${diagnosticError.message}\n`);
  }
  if (exceptions.length) process.stderr.write(`Browser exceptions:\n${exceptions.join("\n")}\n`);
  if (browserStderr) process.stderr.write(`Chrome diagnostics:\n${browserStderr.slice(-4000)}\n`);
  process.exitCode = 1;
} finally {
  const exited = new Promise((resolve) => browser.once("exit", resolve));
  browser.kill("SIGTERM");
  await Promise.race([exited, delay(2000)]);
  await rm(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

async function seedPdfProject(cdp, sourceBase64) {
  return evaluate(cdp, `(async () => {
    const domain = await import("/src/domain/spatial.mjs");
    const portable = await import("/src/persistence/portable-project.mjs");
    const pdfTools = await import("/src/import/pdf-reference.mjs");
    const libraryTools = await import("/src/persistence/local-project-library.mjs");
    const compact = await import("/src/persistence/compact-storage.mjs");
    const working = await import("/src/persistence/working-session.mjs");
    const pdfjs = await import("/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs";
    const bytes = Uint8Array.from(atob(${JSON.stringify(sourceBase64)}), (character) => character.charCodeAt(0));
    const resources = {
      cMapUrl: "/node_modules/pdfjs-dist/cmaps/",
      standardFontDataUrl: "/node_modules/pdfjs-dist/standard_fonts/",
      wasmUrl: "/node_modules/pdfjs-dist/wasm/",
    };
    const opened = await pdfTools.openPdfForReference(pdfjs, bytes, { fileName: "synthetic-two-page-plan.pdf", ...resources });
    try {
      const canvas = document.createElement("canvas");
      const descriptor = await pdfTools.renderPdfPageToCanvas(opened, 2, canvas);
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed")), "image/png"));
      const png = new Uint8Array(await blob.arrayBuffer());
      const dimensions = portable.pngDimensions(png);
      let project = domain.applyCommand(domain.createProject("project-pdf-workflow-browser"), {
        type: "floor.add",
        floor: {
          id: "floor-ground",
          name: "Ground Floor",
          transform: {
            translationMm: { x: 0, y: 0, z: domain.knownMm(0, "synthetic browser datum") },
            orientation: domain.identityQuaternion(),
          },
        },
      });
      project = domain.applyCommand(project, {
        type: "reference.addPdfPage",
        pdfAsset: {
          id: "pdf-reference-source-1",
          kind: "pdf",
          fileName: "synthetic-two-page-plan.pdf",
          mediaType: "application/pdf",
          byteLength: bytes.byteLength,
          sha256: await portable.sha256Hex(bytes),
          pageCount: opened.pageCount,
          importerId: pdfTools.PDF_IMPORTER.id,
          importerVersion: pdfTools.PDF_IMPORTER.version,
          dataUrl: portable.bytesToDataUrl(bytes, "application/pdf"),
        },
        asset: {
          id: "reference-asset-1",
          kind: "image",
          fileName: "synthetic-two-page-plan.pdf · page 2",
          mediaType: "image/png",
          byteLength: png.byteLength,
          sha256: await portable.sha256Hex(png),
          widthPx: dimensions.widthPx,
          heightPx: dimensions.heightPx,
          dataUrl: portable.bytesToDataUrl(png, "image/png"),
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
            rendererId: pdfTools.PDF_IMPORTER.id,
            rendererVersion: pdfTools.PDF_IMPORTER.version,
          },
        },
        reference: {
          id: "floor-reference-1",
          floorId: "floor-ground",
          assetId: "reference-asset-1",
          visible: true,
          locked: true,
          opacity: 0.55,
          transform: {
            translationMm: { x: 0, y: 0 },
            rotationRad: 0,
            scaleMmPerPixel: domain.unknownMm("PDF reference not calibrated"),
          },
          calibration: null,
        },
      });
      const saved = libraryTools.createLocalProjectLibrary(
        compact.createCompactProjectStorage(localStorage),
      ).saveProject(project, "PDF Workflow House");
      const workingStore = working.createWorkingSessionStore(indexedDB, {
        tabId: working.workingTabId(sessionStorage),
      });
      await workingStore.write({ userId: null, workspaceId: null }, {
        projectJson: domain.serializeProject(project),
        name: "PDF Workflow House",
        dirty: false,
        cloudRecord: null,
        task: "project",
        camera: { x: 0, y: 0, width: 1200, height: 800 },
        catalogueGroup: "Units",
      });
      await workingStore.flush();
      return {
        pageCount: opened.pageCount,
        pageNumber: descriptor.pageNumber,
        renderWidthPx: dimensions.widthPx,
        renderHeightPx: dimensions.heightPx,
        saved: saved.ok,
      };
    } finally {
      await pdfTools.closePdfReference(opened);
    }
  })()`);
}

async function inspectActiveNamedProject(cdp) {
  return evaluate(cdp, `(async () => {
    const working = await import("/src/persistence/working-session.mjs");
    const store = working.createWorkingSessionStore(indexedDB, { tabId: working.workingTabId(sessionStorage) });
    const loaded = await store.read({ userId: null, workspaceId: null });
    return {
      name: loaded.name,
      pdfSources: loaded.project.pdfReferenceAssets.length,
      renderedPages: loaded.project.referenceAssets.filter((asset) => asset.source?.kind === "pdf-page").length,
      calibrated: loaded.project.floorReferences[0].calibration !== null,
      crop: loaded.project.floorReferences[0].cropSourceRectPx,
      outlines: loaded.project.floorAreaOutlines.length,
      components: loaded.project.components.length,
      rooms: loaded.project.rooms.length,
    };
  })()`);
}

async function inspectSavedCropGeometry(cdp) {
  return evaluate(cdp, `(async () => {
    const working = await import("/src/persistence/working-session.mjs");
    const store = working.createWorkingSessionStore(indexedDB, { tabId: working.workingTabId(sessionStorage) });
    const loaded = await store.read({ userId: null, workspaceId: null });
    const project = loaded.project;
    const reference = project.floorReferences[0];
    return {
      crop: reference.cropSourceRectPx,
      pdfFingerprint: JSON.stringify({
        pdfReferenceAssets: project.pdfReferenceAssets,
        referenceAssets: project.referenceAssets,
      }),
      modelFingerprint: JSON.stringify({
        transform: reference.transform,
        calibration: reference.calibration,
        walls: project.walls,
        wallNodes: project.wallNodes,
        floorAreaOutlines: project.floorAreaOutlines,
        rooms: project.rooms,
        zones: project.zones,
        components: project.components,
        routes: project.routes,
      }),
    };
  })()`);
}

async function addDetailedWorkflowStage(cdp) {
  return evaluate(cdp, `(async () => {
    const domain = await import("/src/domain/spatial.mjs");
    const rooms = await import("/src/domain/rooms.mjs");
    const catalogue = await import("/src/editor/component-catalogue.mjs");
    const synthetic = await import("/src/editor/synthetic-catalogue.mjs");
    const engineering = await import("/src/domain/engineering-inputs.mjs");
    const libraryTools = await import("/src/persistence/local-project-library.mjs");
    const compact = await import("/src/persistence/compact-storage.mjs");
    const working = await import("/src/persistence/working-session.mjs");
    const library = libraryTools.createLocalProjectLibrary(compact.createCompactProjectStorage(localStorage));
    const workingStore = working.createWorkingSessionStore(indexedDB, { tabId: working.workingTabId(sessionStorage) });
    const loaded = await workingStore.read({ userId: null, workspaceId: null });
    if (!loaded) throw new Error("PDF workflow recovery could not be reopened");
    const point = (x, y) => ({ x, y, z: domain.unknownMm("isolated browser workflow fixture") });
    const chain = (nodeIds, wallIds, points) => ({
      type: "wall.addChain", floorId: "floor-ground", nodeIds, wallIds, points, splits: [],
      thicknessMm: 140, heightMm: domain.unknownMm("isolated browser workflow fixture"),
      referenceLine: "centreline", classification: "physical",
    });
    let project = loaded.project;
    project = domain.applyCommand(project, chain(
      ["workflow-node-a", "workflow-node-b", "workflow-node-c", "workflow-node-d", "workflow-node-a"],
      ["workflow-wall-a-b", "workflow-wall-b-c", "workflow-wall-c-d", "workflow-wall-d-a"],
      [point(0, 0), point(4000, 0), point(4000, 4000), point(0, 4000), point(0, 0)],
    ));
    project = domain.applyCommand(project, chain(
      ["workflow-node-b", "workflow-node-e", "workflow-node-f", "workflow-node-c"],
      ["workflow-wall-b-e", "workflow-wall-e-f", "workflow-wall-f-c"],
      [point(4000, 0), point(8000, 0), point(8000, 4000), point(4000, 4000)],
    ));
    const faces = rooms.deriveRoomBoundaries(project, "floor-ground").candidates;
    const target = domain.airflowTargetFromInput(350, "m3/h", "Manual designer screening fixture", "Isolated workflow QA schedule");
    project = domain.applyCommand(project, {
      type: "room.createFromBoundary", roomId: "workflow-room-supply", floorId: "floor-ground",
      boundaryKey: faces.find((face) => face.centroidMm.x < 4000).key,
      name: "Bedroom", use: "bedroom", ventilationRole: "supply",
      airflowTargets: { normal: { required: target, assigned: target } },
    });
    project = domain.applyCommand(project, {
      type: "room.createFromBoundary", roomId: "workflow-room-extract", floorId: "floor-ground",
      boundaryKey: faces.find((face) => face.centroidMm.x > 4000).key,
      name: "Bathroom", use: "bathroom", ventilationRole: "extract",
      airflowTargets: { normal: { required: target, assigned: target } },
    });
    project = domain.applyCommand(project, { type: "component.add", component: catalogue.createCatalogueComponent(
      "zehnder-q350-hrv-left-drawing-profile",
      { id: "workflow-q350-unit", floorId: "floor-ground", xMm: 4000, yMm: 5200 },
    ) });
    for (const [id, catalogueId, xMm] of [
      ["workflow-supply-terminal", "synthetic-supply-terminal", 2000],
      ["workflow-extract-terminal", "synthetic-extract-terminal", 6000],
    ]) {
      project = domain.applyCommand(project, { type: "component.add", component: synthetic.createSyntheticComponent(
        catalogueId, { id, floorId: "floor-ground", xMm, yMm: 2000 },
      ), autoAssignTerminalSpace: true });
    }
    project = domain.applyCommand(project, {
      type: "engineering.setFloorDuty",
      duty: {
        floorId: "floor-ground", mode: "normal", unitComponentId: "workflow-q350-unit",
        externalStaticPressure: engineering.externalStaticPressureFromInput(
          200,
          "External design screening input supplied for isolated QA",
          "Isolated workflow QA schedule",
          "Clean filters",
        ),
      },
    });
    const saved = library.saveProject(project, loaded.name);
    await workingStore.write({ userId: null, workspaceId: null }, {
      ...loaded,
      projectJson: domain.serializeProject(project),
      dirty: false,
      cloudRecord: null,
      task: "project",
    });
    await workingStore.flush();
    return {
      pdfSources: project.pdfReferenceAssets.length,
      calibratedReferences: project.floorReferences.filter((reference) => reference.calibration !== null).length,
      outlines: project.floorAreaOutlines.length,
      rooms: project.rooms.length,
      components: project.components.length,
      saved: saved.ok,
    };
  })()`);
}

async function clickReferenceSourcePoints(cdp, points) {
  const ok = await evaluate(cdp, `(() => {
    const canvas = document.querySelector("#plan-canvas");
    const group = document.querySelector("#reference-layer [data-reference-id]");
    const matrix = group?.getScreenCTM();
    if (!canvas || !group || !matrix) return false;
    for (const source of ${JSON.stringify(points)}) {
      const point = new DOMPoint(source.x, source.y).matrixTransform(matrix);
      canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: point.x, clientY: point.y, button: 0 }));
    }
    return true;
  })()`);
  assert.equal(ok, true, "Reference source points could not be projected into the visible canvas");
  await delay(80);
}

async function dragReferenceSourceRect(cdp, start, end) {
  const coordinates = await evaluate(cdp, `(() => {
    const group = document.querySelector("#reference-layer [data-reference-id]");
    const matrix = group?.getScreenCTM();
    if (!group || !matrix) return null;
    const project = (source) => {
      const point = new DOMPoint(source.x, source.y).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    };
    return { start: project(${JSON.stringify(start)}), end: project(${JSON.stringify(end)}) };
  })()`);
  assert.ok(coordinates, "Reference crop points could not be projected into the visible canvas");
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: coordinates.start.x,
    y: coordinates.start.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: coordinates.end.x,
    y: coordinates.end.y,
    button: "left",
    buttons: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: coordinates.end.x,
    y: coordinates.end.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  await delay(100);
}

async function waitForDevTools(port) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome has not opened its local debugging endpoint yet.
    }
    await delay(50);
  }
  throw new Error("Chrome DevTools endpoint did not become available");
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const handlers = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    for (const handler of handlers.get(message.method) ?? []) handler(message.params ?? {});
  });
  return {
    send(method, params = {}) {
      sequence += 1;
      return new Promise((resolve, reject) => {
        pending.set(sequence, { resolve, reject });
        socket.send(JSON.stringify({ id: sequence, method, params }));
      });
    },
    on(method, handler) { handlers.set(method, [...(handlers.get(method) ?? []), handler]); },
    close() { socket.close(); },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function value(cdp, expression) {
  return evaluate(cdp, expression);
}

async function waitFor(cdp, expression, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(cdp, `Boolean(${expression})`)) return;
    await delay(40);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function click(cdp, selector) {
  const found = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`);
  assert.equal(found, true, `Missing clickable element: ${selector}`);
  await delay(40);
}

async function setValue(cdp, selector, text) {
  const found = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.value = ${JSON.stringify(text)}; element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  assert.equal(found, true, `Missing input: ${selector}`);
}

async function submit(cdp, selector) {
  const found = await evaluate(cdp, `(() => { const form = document.querySelector(${JSON.stringify(selector)}); if (!form) return false; form.requestSubmit(); return true; })()`);
  assert.equal(found, true, `Missing form: ${selector}`);
  await delay(60);
}

async function key(cdp, value) {
  await evaluate(cdp, `document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: ${JSON.stringify(value)}, code: ${JSON.stringify(value)} }))`);
  await delay(60);
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
  let source = "%PDF-1.4\n% synthetic multi-page browser fixture\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(encoder.encode(source).byteLength);
    source += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = encoder.encode(source).byteLength;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) source += `${String(offset).padStart(10, "0")} 00000 n \n`;
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(source);
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
