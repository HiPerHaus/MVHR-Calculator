export const PDF_IMPORTER = Object.freeze({
  id: "mozilla-pdfjs-reference-renderer",
  version: "6.4.299",
});

export const MAX_PDF_SOURCE_BYTES = 12 * 1024 * 1024;
export const MAX_PDF_REFERENCE_ASSETS = 4;
export const MAX_TOTAL_PDF_SOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGE_COUNT = 100;
export const MAX_PDF_RENDER_DIMENSION_PX = 4096;
export const MAX_PDF_RENDER_PIXELS = 12_000_000;
export const DEFAULT_PDF_RENDER_SCALE = 2;

export function validatePdfSourceBytes(bytes, fileName = "PDF") {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("PDF source must be binary bytes");
  if (bytes.byteLength < 8) throw new TypeError(`${fileName} is too short to be a PDF`);
  if (bytes.byteLength > MAX_PDF_SOURCE_BYTES) {
    throw new RangeError(`${fileName} exceeds the ${MAX_PDF_SOURCE_BYTES}-byte PDF source limit`);
  }
  const headerWindow = bytes.subarray(0, Math.min(bytes.byteLength, 1024));
  let headerFound = false;
  for (let index = 0; index <= headerWindow.length - 5; index += 1) {
    if (
      headerWindow[index] === 0x25 &&
      headerWindow[index + 1] === 0x50 &&
      headerWindow[index + 2] === 0x44 &&
      headerWindow[index + 3] === 0x46 &&
      headerWindow[index + 4] === 0x2d
    ) {
      headerFound = true;
      break;
    }
  }
  if (!headerFound) throw new TypeError(`${fileName} does not contain a PDF header`);
  return bytes;
}

export async function openPdfForReference(pdfjs, bytes, options = {}) {
  validatePdfJs(pdfjs);
  validatePdfSourceBytes(bytes, options.fileName);
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: options.cMapUrl,
    cMapPacked: true,
    standardFontDataUrl: options.standardFontDataUrl,
    wasmUrl: options.wasmUrl,
    enableXfa: false,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  });
  const passwordFailure = new Promise((resolve, reject) => {
    loadingTask.onPassword = (_updatePassword, reason) => {
      reject(pdfImportError(
        "password-protected",
        reason === 2
          ? "The PDF password was not accepted; password-protected PDFs are not supported."
          : "The PDF is password protected; remove the password before importing it.",
      ));
    };
  });
  try {
    const document = await Promise.race([loadingTask.promise, passwordFailure]);
    if (!Number.isInteger(document.numPages) || document.numPages < 1) {
      await loadingTask.destroy();
      throw pdfImportError("empty-document", "The PDF contains no selectable pages.");
    }
    if (document.numPages > MAX_PDF_PAGE_COUNT) {
      await loadingTask.destroy();
      throw pdfImportError(
        "page-limit",
        `The PDF has ${document.numPages} pages; the current limit is ${MAX_PDF_PAGE_COUNT}.`,
      );
    }
    const labels = await document.getPageLabels().catch(() => null);
    return {
      document,
      loadingTask,
      pageCount: document.numPages,
      pageLabels: Array.isArray(labels) && labels.length === document.numPages ? labels : null,
      importer: PDF_IMPORTER,
    };
  } catch (error) {
    await loadingTask.destroy().catch(() => {});
    throw normalizePdfImportError(error);
  }
}

export async function inspectPdfPage(opened, pageNumber) {
  const number = validatePageNumber(pageNumber, opened?.pageCount);
  try {
    const page = await opened.document.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const widthPt = finitePositive(viewport.width, "PDF page width");
    const heightPt = finitePositive(viewport.height, "PDF page height");
    const rotationDeg = normalizeRotation(viewport.rotation);
    const renderPlan = createPdfRenderPlan({ widthPt, heightPt });
    return Object.freeze({
      pageNumber: number,
      pageCount: opened.pageCount,
      pageLabel: opened.pageLabels?.[number - 1] ?? null,
      widthPt,
      heightPt,
      rotationDeg,
      ...renderPlan,
    });
  } catch (error) {
    throw normalizePdfImportError(error);
  }
}

export async function renderPdfPageToCanvas(opened, pageNumber, canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("PDF page rendering requires a canvas");
  }
  const descriptor = await inspectPdfPage(opened, pageNumber);
  const page = await opened.document.getPage(descriptor.pageNumber);
  const viewport = page.getViewport({ scale: descriptor.renderScale });
  canvas.width = descriptor.widthPx;
  canvas.height = descriptor.heightPx;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new TypeError("PDF page canvas context is unavailable");
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
  try {
    await page.render({
      canvasContext: context,
      viewport,
      background: "rgb(255,255,255)",
      intent: "display",
      annotationMode: options.annotationMode ?? 0,
    }).promise;
  } catch (error) {
    throw normalizePdfImportError(error);
  }
  return descriptor;
}

export function createPdfRenderPlan(page, options = {}) {
  const widthPt = finitePositive(page?.widthPt, "PDF page width");
  const heightPt = finitePositive(page?.heightPt, "PDF page height");
  const desiredScale = finitePositive(options.desiredScale ?? DEFAULT_PDF_RENDER_SCALE, "PDF render scale");
  const maximumDimension = positiveInteger(
    options.maximumDimensionPx ?? MAX_PDF_RENDER_DIMENSION_PX,
    "PDF render dimension limit",
  );
  const maximumPixels = positiveInteger(
    options.maximumPixels ?? MAX_PDF_RENDER_PIXELS,
    "PDF render pixel limit",
  );
  const dimensionScale = maximumDimension / Math.max(widthPt, heightPt);
  const pixelScale = Math.sqrt(maximumPixels / (widthPt * heightPt));
  const renderScale = Math.min(desiredScale, dimensionScale, pixelScale);
  if (!Number.isFinite(renderScale) || renderScale <= 0) {
    throw new RangeError("PDF page cannot be rendered within the configured limits");
  }
  const widthPx = Math.max(1, Math.floor(widthPt * renderScale));
  const heightPx = Math.max(1, Math.floor(heightPt * renderScale));
  if (widthPx > maximumDimension || heightPx > maximumDimension || widthPx * heightPx > maximumPixels) {
    throw new RangeError("PDF page render exceeds the configured raster limits");
  }
  return Object.freeze({ renderScale, widthPx, heightPx });
}

export function normalizePdfImportError(error) {
  if (error?.code?.startsWith?.("pdf-")) return error;
  const name = error?.name ?? "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "PasswordException" || /password/i.test(message)) {
    return pdfImportError("password-protected", "The PDF is password protected; remove the password before importing it.", error);
  }
  if (name === "InvalidPDFException" || /invalid pdf|xref|trailer|format/i.test(message)) {
    return pdfImportError("malformed", "The PDF is malformed or uses unsupported content and was not imported.", error);
  }
  if (name === "MissingPDFException") {
    return pdfImportError("missing", "The PDF source could not be read.", error);
  }
  return pdfImportError("render-failed", `The selected PDF page could not be prepared: ${message}`, error);
}

export async function closePdfReference(opened) {
  if (!opened) return;
  await opened.loadingTask?.destroy?.().catch(() => {});
}

function pdfImportError(code, message, cause) {
  const error = new TypeError(message, cause === undefined ? undefined : { cause });
  error.code = `pdf-${code}`;
  return error;
}

function validatePageNumber(value, pageCount) {
  if (!Number.isInteger(value) || value < 1 || value > pageCount) {
    throw new RangeError(`PDF page number must be between 1 and ${String(pageCount)}`);
  }
  return value;
}

function normalizeRotation(value) {
  if (!Number.isFinite(value) || value % 90 !== 0) throw new TypeError("PDF page rotation is invalid");
  return ((value % 360) + 360) % 360;
}

function finitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function validatePdfJs(pdfjs) {
  if (typeof pdfjs?.getDocument !== "function") throw new TypeError("PDF.js getDocument is required");
}
