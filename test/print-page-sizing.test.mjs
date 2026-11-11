import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styleUrl = new URL("../app/style.css", import.meta.url);
const mainUrl = new URL("../app/main.mjs", import.meta.url);
const indexUrl = new URL("../app/index.html", import.meta.url);
const pdfExportUrl = new URL("../app/sheet-pdf-export.mjs", import.meta.url);

test("print CSS keeps the drawing A3 and falls subsequent parts pages back to A4", async () => {
  const css = await readFile(styleUrl, "utf8");

  assert.match(css, /@page\s*\{\s*size:\s*A4 portrait;\s*margin:\s*0;\s*\}/u);
  assert.doesNotMatch(css, /@page\s+:first/u);
  assert.match(css, /@page drawing-portrait \{ size: A3 portrait; margin: 0; \}/u);
  assert.match(css, /@page\s+drawing\s*\{\s*size:\s*A3 landscape;\s*margin:\s*0;\s*\}/u);
  assert.match(css, /@page\s+parts\s*\{\s*size:\s*A4 portrait;\s*margin:\s*0;\s*\}/u);
  assert.match(css, /\.sheet-page\.sheet-a3\s*\{\s*page:drawing;\s*width:420mm;\s*height:297mm;\s*\}/u);
  assert.match(css, /\.sheet-page\.sheet-a4\s*\{\s*page:parts;\s*width:210mm;\s*height:297mm;\s*\}/u);
});

test("sheet preview describes the mixed print sizes before browser printing", async () => {
  const source = await readFile(mainUrl, "utf8");

  assert.match(source, /\$\{entries\.length\} A3 drawing/u);
  assert.match(source, /\$\{entries\.length\} A3 installation detail sheet/u);
  assert.match(source, /\$\{partsPageCount\} A4 parts-list page/u);
  assert.match(source, /window\.print\(\)/u);
});

test("sheet preview exposes separate direct PDF and browser print actions", async () => {
  const [index, main, pdfExport] = await Promise.all([
    readFile(indexUrl, "utf8"),
    readFile(mainUrl, "utf8"),
    readFile(pdfExportUrl, "utf8"),
  ]);
  assert.match(index, /id="export-sheet-pdf"[^>]*>Export PDF</u);
  assert.match(index, /id="print-sheet-preview"[^>]*>Print</u);
  assert.match(main, /const pages = sheetPreviewPages/u);
  assert.match(main, /const metadata = sheetPreviewPdfMetadata/u);
  assert.match(main, /createMixedPagePdfBlob\(pages, metadata\)/u);
  assert.match(pdfExport, /new jsPDF/u);
  assert.match(pdfExport, /pdf\.addPage\(\[page\.widthMm, page\.heightMm\], page\.orientation\)/u);
  assert.match(pdfExport, /pdf\.output\("blob"\)/u);
});
