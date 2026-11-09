import test from "node:test";
import assert from "node:assert/strict";
import { createProject, applyCommand, identityQuaternion, knownMm, unknownMm } from "../src/domain/spatial.mjs";
import { createCatalogueComponent, routeFamilyForKind } from "../src/editor/component-catalogue.mjs";
import { createConfiguredMvhrComponent } from "../src/editor/mvhr-placement.mjs";
import { createPartsSchedule } from "../src/editor/parts-schedule.mjs";
import { partsListRows } from "../src/sheets/a4-parts-list.mjs";
import { createPartsCsvRows, createPartsCsv, serializePartsCsv, partsCsvFileName, PARTS_CSV_COLUMNS } from "../src/sheets/parts-csv-export.mjs";

const options = { exportedAt: "2026-11-09T00:00:00.000Z" };
function base() {
  let project = createProject("csv-test");
  for (const id of ["ground", "upper"]) project = applyCommand(project, { type: "floor.add", floor: { id, name: id, transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "test") }, orientation: identityQuaternion() } } });
  return project;
}
function addUnit(project) {
  return applyCommand(project, { type: "component.add", component: createConfiguredMvhrComponent({ model: "q350-hrv", mounting: "vertical", handing: "left", layout: "unit-mounted-cw", cwSize: "320" }, { id: "unit", floorId: "ground", xMm: 1000, yMm: 1000 }) });
}
function addRoute(project, { id, floorId = "ground", length = 1000, runs = 1, kind = "semi-rigid-radial", known = false }) {
  const family = routeFamilyForKind(kind);
  return applyCommand(project, { type: "route.add", route: { id, floorId, system: "mvhr", stream: "supply", role: "Dwelling supply", ductKind: kind, connectionInterface: family.connectionInterface, parallelRunCount: runs, startAttachment: null, endAttachment: null, points: [{ x: 0, y: 0, z: known ? knownMm(2500, "test") : unknownMm("not set") }, { x: length, y: 0, z: known ? knownMm(2500, "test") : unknownMm("not set") }] } });
}

test("CSV keeps PDF quantities, project packs once across floors, and source state unchanged", () => {
  let project = addRoute(addRoute(addUnit(base()), { id: "ground-route", length: 24000 }), { id: "upper-route", floorId: "upper", length: 26000 });
  const before = structuredClone(project), rows = createPartsCsvRows(project, options);
  for (const floor of project.floors) {
    const expected = partsListRows(createPartsSchedule(project, { floorId: floor.id })).filter(row => !row.section);
    const actual = rows.filter(row => row.floorName === floor.name && !["route-measurement", "unresolved"].includes(row.kind));
    assert.deepEqual(actual.map(row => [row.ref, row.partNumber, row.description, row.quantity, row.unit]), expected.map(row => [row.ref, row.partNumber, row.description, row.quantity, row.unit]));
  }
  const coils = rows.filter(row => row.partNumber === "ZEN-CT90-50M");
  assert.equal(coils.length, 1); assert.equal(coils[0].quantity, "2");
  assert.match(coils[0].basis, /50.000 m known drawn plan length \+ 1.200 m/);
  assert.match(coils[0].scope, /all floors/);
  assert.equal(rows.filter(row => row.partNumber === "ZEN-C90-CSET").length, 1);
  assert.match(rows.find(row => row.partNumber === "ZEN-OR90").basis, /packs of 10/);
  assert.deepEqual(project, before);
});

test("unknown quantities and product choices remain visible, not zero", () => {
  let project = addRoute(base(), { id: "pending", runs: null });
  project = applyCommand(project, { type: "component.add", component: createCatalogueComponent("luna-supply", { id: "luna", floorId: "ground", xMm: 2000, yMm: 2000 }) });
  const rows = createPartsCsvRows(project, options);
  assert.equal(rows.find(row => row.partNumber === "ZEN-CT90-50M").quantity, "Pending");
  assert.ok(rows.some(row => row.kind === "selection" && /selection is required/.test(row.review)));
  assert.ok(rows.some(row => row.kind === "unresolved" && row.basis === "route-parallel-run-count-unset"));
  assert.ok(rows.some(row => row.kind === "unresolved" && row.basis === "route-developed-length-unknown"));
  assert.ok(rows.some(row => row.kind === "route-measurement" && row.unit === "m-developed" && row.quantity === "Pending"));
});

test("EPP project rounding and explicit allowances stay distinct from measured routes", () => {
  let project = addRoute(base(), { id: "epp-ground", kind: "epp-rigid-dn160", length: 400 });
  project = addRoute(project, { id: "epp-upper", floorId: "upper", kind: "epp-rigid-dn160", length: 300, runs: 2, known: true });
  const rows = createPartsCsvRows(project, options), stock = rows.filter(row => row.partNumber === "AER-DUC-DN160-1MSL");
  assert.equal(stock.length, 1); assert.equal(stock[0].quantity, "1");
  assert.match(stock[0].basis, /across streams and floors/); assert.match(stock[0].basis, /four sleeves/);
  assert.match(stock[0].review, /unresolved height/);
  assert.ok(rows.some(row => row.kind === "route-measurement" && row.unit === "m-developed" && row.quantity === "0.600"));
  assert.ok(rows.some(row => row.kind === "unresolved" && row.basis === "epp-allowance-review"));
});

test("only the active design option is exported", () => {
  let project = addUnit(base());
  const originalOptionId = project.activeDesignOptionId;
  project = applyCommand(project, { type: "designOption.duplicate", id: "empty-option", name: "Empty alternative", revision: "B", copyScopes: [], activate: true });
  const rows = createPartsCsvRows(project, options);
  assert.ok(rows.every(row => row.optionName === "Empty alternative" && row.revision === "B"));
  assert.equal(rows.some(row => row.partNumber === "ZEN-Q350HRV"), false);
  project = applyCommand(project, { type: "designOption.switch", optionId: originalOptionId });
  assert.ok(createPartsCsvRows(project, options).some(row => row.partNumber === "ZEN-Q350HRV"));
});

test("decentralised cable is separate plan markup with unresolved specification evidence", () => {
  let project = base();
  for (const [record, id, x] of [["aerofresh-30-compact-decentralised", "head", 1000], ["aerofresh-smove-controller-decentralised", "controller", 2000]]) project = applyCommand(project, { type: "component.add", component: createCatalogueComponent(record, { id, floorId: "ground", xMm: x, yMm: 1000 }) });
  project = applyCommand(project, { type: "decentralisedCable.add", cable: { id: "cable", floorId: "ground", controllerId: "controller", unitComponentId: "head", cableKind: "combined-power-control", topologyStatus: "verified-synchronised-pairs", maximumRouteLengthMm: null, specification: { status: "candidate-manual-mirror", label: "LiYY 3 × 0.75 mm²", source: "test fixture" }, points: [{ x: 2000, y: 1000 }, { x: 1000, y: 1000 }] } });
  const rows = createPartsCsvRows(project, options), cable = rows.find(row => row.kind === "decentralised-cable");
  assert.equal(cable.quantity, "1.00"); assert.equal(cable.unit, "m-plan");
  assert.match(cable.basis, /rises, drops, slack and termination allowance excluded/);
  assert.ok(rows.some(row => row.kind === "unresolved" && row.basis === "decentralised-cable-spec-unverified"));
  assert.equal(rows.some(row => row.kind === "route-measurement"), false);
});

test("CSV uses UTF-8 BOM, quoted RFC-style records and neutralizes spreadsheet formulas", () => {
  const values = ["=HYPERLINK(\"https://example.invalid\")", " +SUM(1,2)", "-1+2", "@SUM(1)", "\ttext", "normal, \"quoted\"\nline", "Lüna × 90 mm"];
  const csv = serializePartsCsv(values.map(description => ({ description, quantity: "2" })));
  assert.equal(csv.charCodeAt(0), 0xFEFF); assert.ok(csv.endsWith("\r\n"));
  const parsed = parseCsv(csv.slice(1)), descriptionIndex = PARTS_CSV_COLUMNS.findIndex(([key]) => key === "description");
  assert.equal(parsed.length, values.length + 1);
  assert.ok(parsed.every(row => row.length === PARTS_CSV_COLUMNS.length));
  assert.deepEqual(parsed.slice(1).map(row => row[descriptionIndex]), values.map((value, index) => index < 5 ? `'${value}` : value));
});

test("export metadata is reproducible and no fabricated prices or totals are added", () => {
  const project = addUnit(base());
  assert.equal(createPartsCsv(project, options), createPartsCsv(project, options));
  const csv = createPartsCsv(project, options);
  assert.match(csv, /No prices/); assert.match(csv, /not for construction/);
  assert.equal(PARTS_CSV_COLUMNS.some(([key]) => /price|cost|amount|currency/i.test(key)), false);
  assert.equal(partsCsvFileName("Test / Site", "Option A"), "Test-Site-Option-A-parts.csv");
  assert.ok(partsCsvFileName("x".repeat(200), "test").length <= 124);
});

function parseCsv(source) {
  const records = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') { if (quoted && source[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if (char === "\r" && !quoted && source[i + 1] === "\n") { row.push(cell); records.push(row); row = []; cell = ""; i++; }
    else cell += char;
  }
  assert.equal(quoted, false); return records;
}

test("real download handler uses current option, restores repeated-click state and revokes URLs", async () => {
  const { readFileSync } = await import("node:fs");
  const { runInNewContext } = await import("node:vm");
  const source = readFileSync(new URL("../app/main.mjs", import.meta.url), "utf8");
  const handlerSource = source.slice(source.indexOf("function exportPartsCsv() {"), source.indexOf("async function exportSheetPreviewPdf() {"));
  assert.match(source, /exportPartsCsvButton\.addEventListener\("click", exportPartsCsv\)/);
  const downloads = [], timers = [], revoked = [], clicks = [], buttons = { disabled: false };
  const context = {
    sheetPreviewPanel: { hidden: false }, exportPartsCsvButton: buttons,
    history: { present: addUnit(base()) }, currentProjectName: "CSV review",
    createPartsCsv, partsCsvFileName, Blob, interactionMessage: "", sheetPreviewStatus: { textContent: "" },
    URL: { createObjectURL(blob) { downloads.push(blob); return `blob:csv-${downloads.length}`; }, revokeObjectURL(url) { revoked.push(url); } },
    document: { createElement() { return { click() { assert.equal(buttons.disabled, true); clicks.push({ href: this.href, fileName: this.download }); }, remove() { this.removed = true; } }; }, body: { append() {} } },
    window: { setTimeout(callback, ms) { assert.equal(ms, 30_000); timers.push(callback); } }, updateStatus() {},
  };
  const handler = runInNewContext(`${handlerSource}; exportPartsCsv`, context);
  handler(); handler();
  assert.equal(downloads.length, 2); assert.equal(buttons.disabled, false);
  assert.equal(downloads[0].type, "text/csv;charset=utf-8");
  assert.match(await downloads[0].text(), /ZEN-Q350HRV/);
  assert.match(context.sheetPreviewStatus.textContent, /all floors.*no prices/);
  context.history.present = applyCommand(context.history.present, { type: "designOption.duplicate", id: "empty-ui-option", name: "Empty alternative", revision: "B", copyScopes: [], activate: true });
  handler();
  assert.match(clicks[2].fileName, /Empty-alternative-parts.csv/);
  assert.doesNotMatch(await downloads[2].text(), /ZEN-Q350HRV/);
  context.sheetPreviewPanel.hidden = true; handler(); assert.equal(downloads.length, 3);
  timers.forEach(callback => callback()); assert.deepEqual(revoked, ["blob:csv-1", "blob:csv-2", "blob:csv-3"]);
  context.sheetPreviewPanel.hidden = false;
  context.createPartsCsv = () => { throw new Error("synthetic failure"); };
  handler(); assert.equal(buttons.disabled, false); assert.match(context.sheetPreviewStatus.textContent, /Parts CSV export failed: synthetic failure/);
});
