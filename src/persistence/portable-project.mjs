import {
  MAX_EMBEDDED_IMAGE_BYTES,
  MAX_TOTAL_REFERENCE_BYTES,
  SCHEMA_VERSION,
  deserializeProject,
  serializeProject,
  validateProject,
} from "../domain/spatial.mjs";
import {
  inspectAsciiDxf,
  MAX_TOTAL_DXF_REFERENCE_BYTES,
} from "../import/dxf-reference.mjs";
import {
  closePdfReference,
  inspectPdfPage,
  MAX_PDF_SOURCE_BYTES,
  openPdfForReference,
  validatePdfSourceBytes,
} from "../import/pdf-reference.mjs";
import {
  assertPortableEnvelopeText,
  encodePortableEnvelope,
  inspectPortableEnvelopeBudget,
  MAX_PORTABLE_TEXT_BYTES,
  PORTABLE_FORMAT,
  PORTABLE_PACKAGE_VERSION,
} from "./portable-envelope.mjs";

export {
  inspectPortableEnvelopeBudget,
  MAX_PORTABLE_TEXT_BYTES,
  PORTABLE_FORMAT,
  PORTABLE_PACKAGE_VERSION,
} from "./portable-envelope.mjs";
export const MAX_IMAGE_BYTES = MAX_EMBEDDED_IMAGE_BYTES;

const PACKAGE_FIELDS = Object.freeze([
  "exportedAtUtc",
  "format",
  "packageVersion",
  "projectJson",
]);

export async function exportPortableProject(project, options = {}) {
  const validated = structuredClone(validateProject(project));
  await verifyReferenceAssets(validated, options);
  const now = options.now ?? (() => new Date());
  const exportedAt = now();
  if (!(exportedAt instanceof Date) || !Number.isFinite(exportedAt.getTime())) {
    throw new TypeError("Portable export clock must return a valid Date");
  }
  const exportedAtUtc = exportedAt.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(exportedAtUtc)) {
    throw new RangeError("Portable export clock must use a four-digit ISO year");
  }
  const encoded = encodePortableEnvelope(serializeProject(validated), exportedAtUtc);
  assertPortableEnvelopeText(encoded, { maximumBytes: options.maximumBytes });
  return encoded;
}

export async function importPortableProject(encoded, options = {}) {
  if (typeof encoded !== "string") throw new TypeError("Portable project input must be text");
  assertPortableEnvelopeText(encoded, { maximumBytes: options.maximumBytes });
  const envelope = JSON.parse(encoded);
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new TypeError("Portable project package must be an object");
  }
  const actualFields = Object.keys(envelope).sort();
  const expectedFields = [...PACKAGE_FIELDS].sort();
  if (actualFields.join("\u0000") !== expectedFields.join("\u0000")) {
    throw new TypeError("Portable package contains unsupported or authority-bearing fields");
  }
  if (envelope.format !== PORTABLE_FORMAT) {
    throw new TypeError("Unsupported portable project format");
  }
  if (envelope.packageVersion !== PORTABLE_PACKAGE_VERSION) {
    throw new RangeError(`Unsupported portable package version: ${String(envelope.packageVersion)}`);
  }
  if (
    typeof envelope.exportedAtUtc !== "string" ||
    !Number.isFinite(Date.parse(envelope.exportedAtUtc))
  ) {
    throw new TypeError("Portable project export timestamp is invalid");
  }
  if (typeof envelope.projectJson !== "string") {
    throw new TypeError("Portable project data must be serialized JSON text");
  }
  const rawProject = JSON.parse(envelope.projectJson);
  const sourceSchemaVersion = rawProject?.schemaVersion;
  const project = structuredClone(deserializeProject(envelope.projectJson));
  await verifyReferenceAssets(project, options);
  const portableBudget = inspectPortableEnvelopeBudget(serializeProject(project), {
    maximumBytes: options.maximumBytes,
  });
  return {
    project,
    exportedAtUtc: envelope.exportedAtUtc,
    migration: {
      fromSchemaVersion: sourceSchemaVersion,
      toSchemaVersion: SCHEMA_VERSION,
      migrated: sourceSchemaVersion !== SCHEMA_VERSION,
    },
    authorityRestored: false,
    portableBudget,
  };
}

export async function verifyReferenceAssets(project, options = {}) {
  validateProject(project);
  let totalBytes = 0;
  for (const asset of project.referenceAssets) {
    const bytes = dataUrlToBytes(asset.dataUrl, asset.mediaType);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_REFERENCE_BYTES) {
      throw new RangeError(`Project reference bytes exceed the ${MAX_TOTAL_REFERENCE_BYTES}-byte prototype limit`);
    }
    if (bytes.byteLength !== asset.byteLength) {
      throw new TypeError(`Reference asset byte length mismatch: ${asset.id}`);
    }
    validateImageBytes(bytes, asset.mediaType);
    const dimensions = pngDimensions(bytes);
    if (dimensions.widthPx !== asset.widthPx || dimensions.heightPx !== asset.heightPx) {
      throw new TypeError(`Reference asset dimensions mismatch: ${asset.id}`);
    }
    const digest = await sha256Hex(bytes);
    if (digest !== asset.sha256) {
      throw new TypeError(`Reference asset checksum mismatch: ${asset.id}`);
    }
  }
  for (const asset of project.pdfReferenceAssets) {
    const bytes = dataUrlToBytes(asset.dataUrl, asset.mediaType);
    validatePdfSourceBytes(bytes, asset.fileName);
    if (bytes.byteLength !== asset.byteLength) {
      throw new TypeError(`PDF reference asset byte length mismatch: ${asset.id}`);
    }
    const digest = await sha256Hex(bytes);
    if (digest !== asset.sha256) {
      throw new TypeError(`PDF reference asset checksum mismatch: ${asset.id}`);
    }
    const dependentPages = project.referenceAssets.filter((candidate) => candidate.source?.pdfAssetId === asset.id);
    if (dependentPages.length > 0) {
      if (!options.pdfjs) throw new TypeError("PDF.js is required to verify embedded PDF page provenance");
      const opened = await openPdfForReference(options.pdfjs, bytes, {
        fileName: asset.fileName,
        ...options.pdfResourceUrls,
      });
      try {
        if (opened.pageCount !== asset.pageCount) {
          throw new TypeError(`PDF reference page-count mismatch: ${asset.id}`);
        }
        for (const pageAsset of dependentPages) {
          const descriptor = await inspectPdfPage(opened, pageAsset.source.pageNumber);
          if (
            Math.abs(descriptor.widthPt - pageAsset.source.widthPt) > 1e-6 ||
            Math.abs(descriptor.heightPt - pageAsset.source.heightPt) > 1e-6 ||
            descriptor.rotationDeg !== pageAsset.source.rotationDeg
          ) {
            throw new TypeError(`Rendered PDF page provenance mismatch: ${pageAsset.id}`);
          }
        }
      } finally {
        await closePdfReference(opened);
      }
    }
  }
  let totalDxfBytes = 0;
  for (const asset of project.cadReferenceAssets) {
    const bytes = new TextEncoder().encode(asset.sourceText);
    totalDxfBytes += bytes.byteLength;
    if (totalDxfBytes > MAX_TOTAL_DXF_REFERENCE_BYTES) {
      throw new RangeError(`Project DXF reference bytes exceed the ${MAX_TOTAL_DXF_REFERENCE_BYTES}-byte prototype limit`);
    }
    if (bytes.byteLength !== asset.byteLength) {
      throw new TypeError(`CAD reference asset byte length mismatch: ${asset.id}`);
    }
    const digest = await sha256Hex(bytes);
    if (digest !== asset.sha256) {
      throw new TypeError(`CAD reference asset checksum mismatch: ${asset.id}`);
    }
    const reparsed = await inspectAsciiDxf(asset.sourceText, { fileName: asset.fileName });
    if (reparsed.blockingDiagnosticCount > 0) {
      throw new TypeError(`CAD reference source no longer passes bounded inspection: ${asset.id}`);
    }
    assertDxfDerivedDataMatchesSource(asset, reparsed);
  }
  return true;
}

function assertDxfDerivedDataMatchesSource(asset, reparsed) {
  const expected = {
    counts: reparsed.counts,
    declaredUnits: reparsed.declaredUnits,
    diagnostics: reparsed.diagnostics,
    dxfVersion: reparsed.dxfVersion,
    geometry: reparsed.geometry,
    importer: reparsed.importer,
    layers: reparsed.layers,
    partialImportAccepted: reparsed.partialAcceptanceRequired,
    sourceBoundsUnits: reparsed.sourceBoundsUnits,
  };
  const persisted = {
    counts: asset.counts,
    declaredUnits: asset.declaredUnits,
    diagnostics: asset.diagnostics,
    dxfVersion: asset.dxfVersion,
    geometry: asset.geometry,
    importer: asset.importer,
    layers: asset.layers,
    partialImportAccepted: asset.partialImportAccepted,
    sourceBoundsUnits: asset.sourceBoundsUnits,
  };
  if (stableStringify(persisted) !== stableStringify(expected)) {
    throw new TypeError(`CAD reference derived data does not match preserved source: ${asset.id}`);
  }
}

export function validateImageBytes(bytes, mediaType) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Image source must be bytes");
  if (bytes.byteLength < 12) throw new TypeError("Image source is too short");
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new RangeError(`Image source exceeds the ${MAX_IMAGE_BYTES}-byte prototype limit`);
  }
  const isPng =
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const matches = mediaType === "image/png" && isPng;
  if (!matches) throw new TypeError(`Image bytes do not match declared media type: ${mediaType}`);
  pngDimensions(bytes);
  return true;
}

export function pngDimensions(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 24) {
    throw new TypeError("PNG source is missing its IHDR dimensions");
  }
  if (ascii(bytes, 12, 16) !== "IHDR") {
    throw new TypeError("PNG source must begin with an IHDR chunk");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13) {
    throw new TypeError("PNG IHDR chunk must have the canonical 13-byte length");
  }
  const widthPx = view.getUint32(16);
  const heightPx = view.getUint32(20);
  if (widthPx < 1 || heightPx < 1) throw new TypeError("PNG dimensions must be positive");
  return { widthPx, heightPx };
}

export async function sha256Hex(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("SHA-256 input must be bytes");
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable in this environment");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function bytesToDataUrl(bytes, mediaType) {
  if (mediaType === "application/pdf") validatePdfSourceBytes(bytes);
  else validateImageBytes(bytes, mediaType);
  return `data:${mediaType};base64,${encodeBase64(bytes)}`;
}

export function dataUrlToBytes(dataUrl, expectedMediaType) {
  const prefix = `data:${expectedMediaType};base64,`;
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(prefix)) {
    throw new TypeError("Embedded source bytes do not match the declared media type");
  }
  const encoded = dataUrl.slice(prefix.length);
  const maximumBytes = expectedMediaType === "application/pdf" ? MAX_PDF_SOURCE_BYTES : MAX_IMAGE_BYTES;
  const maximumBase64Length = Math.ceil(maximumBytes / 3) * 4;
  if (encoded.length > maximumBase64Length) {
    throw new RangeError(`Embedded source exceeds the ${maximumBytes}-byte prototype limit`);
  }
  if (encoded.length < 4 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new TypeError("Embedded source bytes are not canonical base64");
  }
  return decodeBase64(encoded);
}

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function stableStringify(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}

function encodeBase64(bytes) {
  if (typeof globalThis.btoa === "function") {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return globalThis.btoa(binary);
  }
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  throw new Error("Base64 encoding is unavailable in this environment");
}

function decodeBase64(value) {
  try {
    if (typeof globalThis.atob === "function") {
      const binary = globalThis.atob(value);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
    if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(value, "base64"));
  } catch {
    throw new TypeError("Embedded source bytes are not valid base64");
  }
  throw new Error("Base64 decoding is unavailable in this environment");
}
