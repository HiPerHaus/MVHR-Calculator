import { renderInstallationDetailSheetSvg } from "./installation-detail-sheet.mjs";
import { renderA3SheetSvg } from "./a3-sheet.mjs";
import { createA4PartsListPages, renderA4PartsListSvg } from "./a4-parts-list.mjs";

export function createSheetOutputPages(sheet, {pageOffset=0, totalPageCount=null}={}) {
  const partCount = createA4PartsListPages(sheet).length;
  const total = totalPageCount ?? pageOffset + partCount + 2;
  const partsPages = createA4PartsListPages(sheet, { firstPageNumber: pageOffset + 3, totalPageCount: total });
  const drawingSvg = renderA3SheetSvg(sheet).replace(
    "</svg>",
    `<text x="12" y="${sheet.page.heightMm - 4}" font-size="2.3" fill="#687880">Page ${pageOffset+1} of ${total} · A3</text></svg>`,
  );
  const a3Class = `sheet-a3${sheet.page.orientation === "portrait" ? " sheet-a3-portrait" : ""}`;
  return [
    Object.freeze({
      kind: "drawing", widthMm: sheet.page.widthMm, heightMm: sheet.page.heightMm,
      orientation: sheet.page.orientation, className: a3Class,
      label: `Page ${pageOffset+1} · A3 drawing`, svg: drawingSvg,
    }),
    Object.freeze({
      kind: "installation-details", widthMm: sheet.page.widthMm, heightMm: sheet.page.heightMm,
      orientation: sheet.page.orientation, className: a3Class,
      label: `Page ${pageOffset+2} · A3 installation details`,
      svg: renderInstallationDetailSheetSvg(sheet, {pageNumber:pageOffset+2,totalPageCount:total}),
    }),
    ...partsPages.map((page) => Object.freeze({
      kind: "parts-list", widthMm: page.widthMm, heightMm: page.heightMm,
      orientation: "portrait", className: "sheet-a4",
      label: `Page ${page.pageNumber} · A4 parts list`, svg: renderA4PartsListSvg(sheet, page),
    })),
  ];
}

// All-options exports are one document with global page numbers. Each option
// keeps its own plan, details and parts list; no equipment is combined.
export function createSheetOutputDocument(sheets) {
  const totalPageCount = sheets.reduce((count,sheet)=>count+2+createA4PartsListPages(sheet).length,0);
  const pages=[];
  for (const sheet of sheets) pages.push(...createSheetOutputPages(sheet,{pageOffset:pages.length,totalPageCount}));
  return pages;
}

export function sheetPdfFileName(projectName, drawingId) {
  const stem = `${projectName || "HiPer Studio"}-${drawingId || "drawing"}`
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
  return `${stem || "HiPer-Studio-drawing"}.pdf`;
}
