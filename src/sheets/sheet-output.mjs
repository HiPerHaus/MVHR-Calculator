import { renderInstallationDetailSheetSvg } from "./installation-detail-sheet.mjs";
import { renderA3SheetSvg } from "./a3-sheet.mjs";
import { createA4PartsListPages, renderA4PartsListSvg } from "./a4-parts-list.mjs";

export function createSheetOutputPages(sheet, {pageOffset=0, totalPageCount=null}={}) {
  const partCount = createA4PartsListPages(sheet).length;
  const total = totalPageCount ?? pageOffset + partCount + 2;
  const partsPages = createA4PartsListPages(sheet, { firstPageNumber: pageOffset + 3, totalPageCount: total });
  const drawingSvg = renderA3SheetSvg(sheet).replace(
    "</svg>",
    `<text data-output-page-number="true" x="12" y="${sheet.page.heightMm - 4}" font-size="2.3" fill="#687880">Page ${pageOffset+1} of ${total} · A3</text></svg>`,
  );
  const a3Class = `sheet-a3${sheet.page.orientation === "portrait" ? " sheet-a3-portrait" : ""}`;
  return [
    Object.freeze({
      kind: "drawing", pageNumber: pageOffset + 1, pageDescription: "A3 drawing", widthMm: sheet.page.widthMm, heightMm: sheet.page.heightMm,
      orientation: sheet.page.orientation, className: a3Class,
      label: `Page ${pageOffset+1} · A3 drawing`, svg: drawingSvg,
    }),
    Object.freeze({
      kind: "installation-details", pageNumber: pageOffset + 2, pageDescription: "A3 installation details", widthMm: sheet.page.widthMm, heightMm: sheet.page.heightMm,
      orientation: sheet.page.orientation, className: a3Class,
      label: `Page ${pageOffset+2} · A3 installation details`,
      svg: renderInstallationDetailSheetSvg(sheet, {pageNumber:pageOffset+2,totalPageCount:total}),
    }),
    ...partsPages.map((page, index) => Object.freeze({
      kind: "parts-list", pageNumber: page.pageNumber, partsPageNumber: index + 1, partsPageCount: partCount,
      pageDescription: `A4 parts list · ${index + 1} of ${partCount}`, widthMm: page.widthMm, heightMm: page.heightMm,
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

// Select original page indices, retain source order/content, and renumber only
// the generated footer. User-entered titles containing "Page ..." are untouched.
export function selectSheetOutputPages(pages, selectedIndices) {
  if (!Array.isArray(selectedIndices) || selectedIndices.length === 0) throw new TypeError("Select at least one page");
  const indices = new Set(selectedIndices);
  if (indices.size !== selectedIndices.length || selectedIndices.some(index => !Number.isInteger(index) || index < 0 || index >= pages.length)) {
    throw new TypeError("Selected page indices must be unique and available");
  }
  const selected = pages.filter((page, index) => indices.has(index));
  return selected.map((page, index) => {
    const number = index + 1;
    let footerCount = 0;
    let svg = page.svg.replace(/(<text\b[^>]*data-output-page-number="true"[^>]*>)Page \d+ of \d+/gu, (match, tag) => {
      footerCount += 1;
      return `${tag}Page ${number} of ${selected.length}`;
    });
    if (footerCount !== 1) throw new TypeError("Generated page footer is unavailable");
    if (page.kind === "parts-list") svg = svg.replace(/aria-label="A4 parts list page \d+"/u, `aria-label="A4 parts list page ${number}"`);
    const prefix = page.optionName ? `${page.optionName} · ${page.optionRevision} · ` : "";
    return Object.freeze({ ...page, sourcePageNumber: page.pageNumber, pageNumber: number,
      label: `${prefix}Page ${number} · ${page.pageDescription}`, svg });
  });
}

export function sheetPdfFileName(projectName, drawingId) {
  const stem = `${projectName || "HiPer Studio"}-${drawingId || "drawing"}`
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
  return `${stem || "HiPer-Studio-drawing"}.pdf`;
}
