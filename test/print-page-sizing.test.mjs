import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styleUrl = new URL("../app/style.css", import.meta.url);
const mainUrl = new URL("../app/main.mjs", import.meta.url);

test("print CSS keeps the drawing A3 and falls subsequent parts pages back to A4", async () => {
  const css = await readFile(styleUrl, "utf8");

  assert.match(css, /@page\s*\{\s*size:\s*A4 portrait;\s*margin:\s*0;\s*\}/u);
  assert.match(css, /@page\s+:first\s*\{\s*size:\s*A3 landscape;\s*margin:\s*0;\s*\}/u);
  assert.match(css, /@page\s+drawing\s*\{\s*size:\s*A3 landscape;\s*margin:\s*0;\s*\}/u);
  assert.match(css, /@page\s+parts\s*\{\s*size:\s*A4 portrait;\s*margin:\s*0;\s*\}/u);
  assert.match(css, /\.sheet-page\.sheet-a3\s*\{\s*page:drawing;\s*width:420mm;\s*height:297mm;\s*\}/u);
  assert.match(css, /\.sheet-page\.sheet-a4\s*\{\s*page:parts;\s*width:210mm;\s*height:297mm;\s*\}/u);
});

test("sheet preview describes the mixed print sizes before browser printing", async () => {
  const source = await readFile(mainUrl, "utf8");

  assert.match(source, /1 A3 drawing \+ \$\{partsPages\.length\} A4 parts-list page/u);
  assert.match(source, /window\.print\(\)/u);
});
