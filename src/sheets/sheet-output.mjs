import { renderA3SheetSvg } from "./a3-sheet.mjs";
import { createA4PartsListPages, renderA4PartsListSvg } from "./a4-parts-list.mjs";

export function createSheetOutputPages(sheet) {
  const partsPages = createA4PartsListPages(sheet);
  const totalPageCount = partsPages.length + 1;
  const drawingSvg = renderA3SheetSvg(sheet).replace(
    "</svg>",
    `<text x="12" y="293" font-size="2.3" fill="#687880">Page 1 of ${totalPageCount} · A3</text></svg>`,
  );
  return [
    Object.freeze({
      kind: "drawing",
      widthMm: 420,
      heightMm: 297,
      orientation: "landscape",
      className: "sheet-a3",
      label: "Page 1 · A3 drawing",
      svg: drawingSvg,
    }),
    ...partsPages.map((page) => Object.freeze({
      kind: "parts-list",
      widthMm: page.widthMm,
      heightMm: page.heightMm,
      orientation: "portrait",
      className: "sheet-a4",
      label: `Page ${page.pageNumber} · A4 parts list`,
      svg: renderA4PartsListSvg(sheet, page),
    })),
  ];
}

export function sheetPdfFileName(projectName, drawingId) {
  const stem = `${projectName || "HiPer Studio"}-${drawingId || "drawing"}`
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
  return `${stem || "HiPer-Studio-drawing"}.pdf`;
}
