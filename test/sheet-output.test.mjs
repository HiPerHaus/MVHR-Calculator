import assert from "node:assert/strict";
import test from "node:test";

import { applyCommand, createProject, identityQuaternion, knownMm } from "../src/domain/spatial.mjs";
import { createConfiguredMvhrComponent } from "../src/editor/mvhr-placement.mjs";
import { createA3SheetModel } from "../src/sheets/a3-sheet.mjs";
import { createSheetOutputPages, sheetPdfFileName } from "../src/sheets/sheet-output.mjs";

test("sheet output plans one exact A3 drawing followed by exact A4 parts-list pages", () => {
  let project = applyCommand(createProject("pdf-output-test"), {
    type: "floor.add",
    floor: {
      id: "ground",
      name: "Ground floor",
      transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "test") }, orientation: identityQuaternion() },
    },
  });
  project = applyCommand(project, {
    type: "component.add",
    component: createConfiguredMvhrComponent(
      { model: "q350-hrv", mounting: "vertical", handing: "left", layout: "unit-mounted-cw", cwSize: "320" },
      { id: "unit-test", floorId: "ground", xMm: 1000, yMm: 1000 },
    ),
  });
  const sheet = createA3SheetModel(project, {
    floorId: "ground",
    orientation: "landscape",
    includeSchedule: false,
    projectName: "PDF export test",
    siteName: "Test address",
    issueDate: "2026-10-30",
    drawingTitle: "Ventilation",
    drawingId: "V-01",
    status: "Preliminary — not for construction",
    revision: "A",
    revisionText: "Review",
  });
  const pages = createSheetOutputPages(sheet);
  assert.deepEqual(
    pages.map(({ kind, widthMm, heightMm, orientation }) => ({ kind, widthMm, heightMm, orientation })),
    [
      { kind: "drawing", widthMm: 420, heightMm: 297, orientation: "landscape" },
      { kind: "parts-list", widthMm: 210, heightMm: 297, orientation: "portrait" },
    ],
  );
  assert.match(pages[0].svg, /Page 1 of 2 · A3/u);
  assert.match(pages[1].svg, /Page 2 of 2 · A4/u);
});

test("PDF filenames remain portable and retain useful project and drawing identity", () => {
  assert.equal(sheetPdfFileName("Fletcher Street / MVHR", "V-01"), "Fletcher-Street-MVHR-V-01.pdf");
  assert.equal(sheetPdfFileName("", ""), "HiPer-Studio-drawing.pdf");
});
