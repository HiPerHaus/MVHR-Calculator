import { jsPDF } from "./vendor/pdf.mjs";

export async function createMixedPagePdfBlob(pages, metadata = {}) {
  validatePages(pages);
  const first = pages[0];
  const pdf = new jsPDF({
    orientation: first.orientation,
    unit: "mm",
    format: [first.widthMm, first.heightMm],
    compress: true,
    putOnlyUsedFonts: true,
  });
  pdf.setDocumentProperties({
    title: metadata.title || "HiPer Studio drawing",
    subject: metadata.subject || "Preliminary ventilation drawing and parts list",
    author: metadata.author || "HiPer Studio",
    creator: "HiPer Studio",
  });

  for (const [index, page] of pages.entries()) {
    if (index > 0) pdf.addPage([page.widthMm, page.heightMm], page.orientation);
    const svg = parseSvg(page.svg);
    await pdf.svg(svg, {
      x: 0,
      y: 0,
      width: page.widthMm,
      height: page.heightMm,
    });
  }
  return pdf.output("blob");
}

export function downloadPdfBlob(blob, fileName) {
  if (!(blob instanceof Blob) || blob.type !== "application/pdf") {
    throw new TypeError("A generated PDF blob is required");
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function validatePages(pages) {
  if (!Array.isArray(pages) || pages.length < 2) {
    throw new TypeError("A drawing and at least one parts-list page are required");
  }
  for (const page of pages) {
    if (!Number.isFinite(page.widthMm) || page.widthMm <= 0 || !Number.isFinite(page.heightMm) || page.heightMm <= 0) {
      throw new TypeError("Every PDF page requires positive millimetre dimensions");
    }
    if (!["landscape", "portrait"].includes(page.orientation) || typeof page.svg !== "string") {
      throw new TypeError("Every PDF page requires an orientation and SVG source");
    }
  }
}

function parseSvg(source) {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg") {
    throw new TypeError("Generated sheet SVG could not be parsed for PDF export");
  }
  return parsed.documentElement;
}
