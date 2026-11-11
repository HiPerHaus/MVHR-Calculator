import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, createProject, deserializeProject, identityQuaternion, knownMm, serializeProject } from "../src/domain/spatial.mjs";
import { createCatalogueComponent } from "../src/editor/component-catalogue.mjs";
import { createConfiguredMvhrComponent } from "../src/editor/mvhr-placement.mjs";
import { createA3SheetModel } from "../src/sheets/a3-sheet.mjs";
import { createDesignOptionOutput } from "../src/sheets/design-option-output.mjs";
import { createSheetOutputPages, selectSheetOutputPages } from "../src/sheets/sheet-output.mjs";
import { createPartsCsv } from "../src/sheets/parts-csv-export.mjs";

function fixture() {
  let project = applyCommand(createProject("export-options"), { type: "floor.add", floor: { id: "ground", name: "Ground Floor", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "QA") }, orientation: identityQuaternion() } } });
  project = applyCommand(project, { type: "component.add", component: createConfiguredMvhrComponent({ model: "q350-hrv", mounting: "vertical", handing: "left", layout: "unit-mounted-cw", cwSize: "320" }, { id: "q-original", floorId: "ground", xMm: 1000, yMm: 1000 }) });
  project = applyCommand(project, { type: "designOption.duplicate", id: "alternative", name: "AeroFresh alternative", revision: "B2", copyScopes: ["plan"], activate: true });
  project = applyCommand(project, { type: "component.add", component: createCatalogueComponent("aerofresh-30-compact-decentralised", { id: "af-alternative", floorId: "ground", xMm: 2000, yMm: 1000 }) });
  return project;
}
const createSheet = (project, option) => createA3SheetModel(project, { floorId: "ground", orientation: "landscape", includeSchedule: false, projectName: "QA options", drawingTitle: option.name, drawingId: option.id, issueDate: "2026-11-11", revision: option.revision, revisionText: "Working draft", status: "Preliminary — not for construction" });

test("selected export option has independent plan, engineering details, parts and CSV without switching the drawing", () => {
  const project = fixture(), before = serializeProject(project);
  const firstId = project.designOptions[0].id;
  const first = createDesignOptionOutput(project, { optionId: firstId, createSheet });
  const second = createDesignOptionOutput(project, { createSheet });
  assert.equal(first.entries.length, 1);
  assert.equal(first.entries[0].project.activeDesignOptionId, firstId);
  assert.equal(second.entries[0].project.activeDesignOptionId, "alternative");
  assert.deepEqual(first.entries[0].project.components.map(c => c.id), ["q-original"]);
  assert.deepEqual(second.entries[0].project.components.map(c => c.id), ["af-alternative"]);
  assert.match(first.pages[0].svg, /data-id="q-original"/);
  assert.doesNotMatch(first.pages[0].svg, /data-id="af-alternative"/);
  assert.match(first.pages[1].svg, /data-detail-id="q-cw320"/);
  assert.doesNotMatch(second.pages[1].svg, /data-detail-id="q-cw320"/);
  assert.ok(first.entries[0].sheet.partsSchedule.componentLines.some(line => /Q350/.test(line.description)));
  assert.ok(second.entries[0].sheet.partsSchedule.componentLines.every(line => !/Q350/.test(line.description)));
  assert.match(createPartsCsv(first.entries[0].project), /Q350/);
  assert.doesNotMatch(createPartsCsv(second.entries[0].project), /Q350/);
  for (const result of [first, second]) {
    assert.equal(result.pages[0].kind, "drawing");
    assert.equal(result.pages[1].kind, "installation-details");
    assert.ok(result.pages.slice(2).every(page => page.kind === "parts-list"));
    assert.ok(result.pages.every(page => page.optionId === result.entries[0].option.id));
    assert.match(result.pages[0].label, /Page 1 · A3 drawing/);
  }
  assert.equal(serializeProject(project), before);
});

test("all export options retain separate groups and continuous page numbers without changing saved or unsaved data", () => {
  const project = fixture(), before = serializeProject(project);
  const { entries, pages } = createDesignOptionOutput(project, { optionId: null, createSheet });
  assert.equal(entries.length, 2);
  assert.equal(pages.filter(page => page.kind === "drawing").length, 2);
  let active = null;
  for (const [index, page] of pages.entries()) {
    if (page.kind === "drawing") active = page.optionId;
    assert.equal(page.optionId, active);
    assert.ok(page.label.includes(`Page ${index + 1} ·`));
    assert.ok(page.svg.includes(`Page ${index + 1} of ${pages.length}`));
  }
  assert.deepEqual(entries.map(entry => entry.option.name), ["Option A", "AeroFresh alternative"]);
  assert.equal(serializeProject(project), before);
  assert.equal(serializeProject(deserializeProject(before)), before);
});

test("legacy single-option exports work and invalid selection cannot silently export another option", () => {
  const legacy = fixture();
  legacy.schemaVersion = 22;
  delete legacy.designOptions;
  delete legacy.activeDesignOptionId;
  const project = deserializeProject(JSON.stringify(legacy));
  const output = createDesignOptionOutput(project, { createSheet });
  assert.equal(output.entries.length, 1);
  assert.equal(output.entries[0].option.name, "Option A");
  assert.throws(() => createDesignOptionOutput(project, { optionId: "missing", createSheet }), /unavailable/);
  assert.throws(() => createDesignOptionOutput(project), /sheet factory/);
});


test("selected output pages keep source order with consecutive numbering and unchanged input", () => {
  const output = createDesignOptionOutput(fixture(), { optionId: null, createSheet });
  const before = structuredClone(output.pages);
  const secondDrawing = output.pages.findIndex(page => page.optionId === "alternative" && page.kind === "drawing");
  const indices = [output.pages.length - 1, 1, secondDrawing];
  const selected = selectSheetOutputPages(output.pages, indices);
  assert.deepEqual(selected.map(page => page.kind), ["installation-details", "drawing", "parts-list"]);
  assert.deepEqual(selected.map(page => page.pageNumber), [1, 2, 3]);
  assert.deepEqual(selected.map(page => page.sourcePageNumber), [2, secondDrawing + 1, output.pages.length]);
  for (const [index, page] of selected.entries()) assert.match(page.svg, new RegExp(`Page ${index + 1} of 3`));
  assert.match(selected[2].svg, /aria-label="A4 parts list page 3"/);
  assert.match(selected[0].svg, /Read with the corresponding plan/);
  assert.deepEqual(output.pages, before);
  assert.throws(() => selectSheetOutputPages(output.pages, []), /at least one/);
  for (const invalid of [[-1], [999], [0, 0], [0.5]]) assert.throws(() => selectSheetOutputPages(output.pages, invalid), /unique and available/);
});

test("a selected continuation page retains every parts row while page numbers and user titles stay correct", () => {
  const project = fixture();
  const sheet = createSheet(project, { ...project.designOptions[1], name: "Page 7 of 99 · customer title" });
  const line = sheet.partsSchedule.componentLines[0];
  const longSheet = { ...sheet, metadata: { ...sheet.metadata, projectName: "Page 7 of 99 · customer title" }, partsSchedule: { ...sheet.partsSchedule, componentLines: Array.from({ length: 100 }, (_, index) => ({ ...line, ref: `QA${index}`, description: `Independent parts row ${index}` })) } };
  const pages = createSheetOutputPages(longSheet);
  assert.ok(pages.length > 5);
  const last = pages.length - 1;
  const selected = selectSheetOutputPages(pages, [last]);
  assert.equal(selected[0].kind, "parts-list");
  assert.equal(selected[0].partsPageNumber, pages[last].partsPageNumber);
  assert.equal(selected[0].partsPageCount, pages.length - 2);
  assert.ok(selected[0].svg.includes(`Parts sheet ${pages.length - 2} of ${pages.length - 2} for this option`));
  assert.match(selected[0].svg, /Page 1 of 1/);
  assert.match(selected[0].svg, /Page 7 of 99 · customer title/);
  const normalize = value => value.replace(/Page \d+ of \d+ · A4/u, "FOOTER").replace(/aria-label="A4 parts list page \d+"/u, "ARIA");
  assert.equal(normalize(selected[0].svg), normalize(pages[last].svg));
});
