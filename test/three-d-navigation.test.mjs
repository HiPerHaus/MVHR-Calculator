import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("customer navigation hides 3D without removing its workspace, renderer or export", async () => {
  const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../app/main.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/style.css", import.meta.url), "utf8");
  assert.match(html, /<button\b[^>]*id="three-d-nav"[^>]*\bhidden[^>]*>3D<\/button>/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(html, /id="three-d-workspace"/);
  assert.match(html, /id="export-three-d"/);
  assert.match(html, /id="three-d-height-form"/);
  assert.match(app, /threeDNavigationButton\.addEventListener\("click", \(\) => setTask\("three-d"\)\)/);
  assert.match(app, /exportThreeDButton\.addEventListener\("click", exportThreeDDrawing\)/);
  assert.match(app, /import \{ createDefaultThreeDView, createThreeDDrawingScene, renderThreeDDrawingSvg \} from "\.\.\/src\/sheets\/three-d-drawing\.mjs"/);
  assert.match(app, /const recoveredTask = recovered\.task === "three-d" \? "ventilation" : recovered\.task/);
  assert.doesNotMatch(app, /threeDNavigationButton\.hidden\s*=\s*false/);
});
