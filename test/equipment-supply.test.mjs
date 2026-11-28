import test from "node:test";
import assert from "node:assert/strict";
import { createProject, applyCommand, serializeProject, deserializeProject, identityQuaternion, knownMm } from "../src/domain/spatial.mjs";
import { createCommandHistory, executeCommand, undoCommand, redoCommand } from "../src/domain/history.mjs";
import { engineeringComponentFingerprint } from "../src/domain/engineering-inputs.mjs";
import { OWNER_SUPPLIED_EQUIPMENT } from "../src/domain/equipment-supply.mjs";
import { createCatalogueComponent } from "../src/editor/component-catalogue.mjs";
import { createConfiguredMvhrComponent } from "../src/editor/mvhr-placement.mjs";
import { createPartsSchedule } from "../src/editor/parts-schedule.mjs";
import { inspectProductCostingReadiness } from "../src/editor/product-costing.mjs";
import { createA3SheetModel, renderA3SheetSvg } from "../src/sheets/a3-sheet.mjs";
import { createA4PartsListPages, renderA4PartsListSvg, partsListRows } from "../src/sheets/a4-parts-list.mjs";
import { createPartsCsvRows } from "../src/sheets/parts-csv-export.mjs";
import { createOsTakeoff } from "../app/os-takeoff.mjs";

const FLOOR = "ground";
const configuration = { model: "q350-hrv", mounting: "vertical", handing: "left", layout: "unit-mounted-cw", cwSize: "320" };
const owner = OWNER_SUPPLIED_EQUIPMENT;
const setSupply = (componentId, equipmentSupply = owner) => ({ type: "component.setEquipmentSupply", componentId, equipmentSupply });

function newDesign() {
  return applyCommand(createProject("equipment-supply-test"), { type: "floor.add", floor: {
    id: FLOOR, name: "Ground", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "test") }, orientation: identityQuaternion() },
  }});
}

function unit(id, equipmentSupply) {
  return createConfiguredMvhrComponent({ ...configuration, equipmentSupply }, { id, floorId: FLOOR, xMm: 1000, yMm: 2000 });
}

function add(project, component) {
  return applyCommand(project, { type: "component.add", component });
}

test("changing equipment supply changes only responsibility, including after undo, redo and reload", () => {
  const original = add(newDesign(), unit("q350"));
  const history = createCommandHistory(original);
  const edited = executeCommand(history, setSupply("q350"));
  const previous = original.components[0], current = edited.present.components[0];
  assert.equal(previous.equipmentSupply, undefined);
  assert.deepEqual(current, { ...previous, equipmentSupply: owner });
  assert.equal(engineeringComponentFingerprint(current), engineeringComponentFingerprint(previous));
  assert.equal(deserializeProject(serializeProject(edited.present)).components[0].equipmentSupply, owner);
  assert.equal(undoCommand(edited).present.components[0].equipmentSupply, undefined);
  assert.equal(redoCommand(undoCommand(edited)).present.components[0].equipmentSupply, owner);
  assert.deepEqual(applyCommand(edited.present, setSupply("q350", "included")).components[0], previous);
});

test("same physical model with two supply responsibilities does not group into two purchase quantities", () => {
  const project = add(add(newDesign(), unit("client-q350", owner)), unit("quoted-q350"));
  const schedule = createPartsSchedule(project, { floorId: FLOOR });
  const ownerLine = schedule.componentLines.find(line => line.equipmentSupply === owner);
  assert.deepEqual(ownerLine.componentIds, ["client-q350"]);
  assert.equal(ownerLine.quantity, 1);
  assert.equal(schedule.summary.componentQuantity, 2);
  const pdfRows = partsListRows(schedule);
  assert.ok(pdfRows.some(row => row.section && /Owner-supplied.*not for purchase/.test(row.description)));
  assert.equal(pdfRows.find(row => row.kind === owner).partNumber, "");
  assert.deepEqual(pdfRows.filter(row => row.partNumber === "ZEN-Q350HRV").map(row => row.quantity), ["1"]);
  const csv = createPartsCsvRows(project);
  const ownerRow = csv.find(row => row.kind === owner);
  assert.match(ownerRow.review, /Do not order or quote/);
  assert.ok(!csv.some(row => row.kind === "unresolved" && row.ref === ownerRow.ref));
  const takeoff = createOsTakeoff(csv, { id: "saved-project", save_version: 1 }, project.activeDesignOptionId, "centralised");
  assert.equal(takeoff.items.find(row => row.partNumber === "ZEN-Q350HRV").quantity, 1);
  for (const code of ["HRV-DRAIN", "PLU-SURGE", "ZEN-CCPRO", "ZEN-OPTBOX"]) {
    assert.equal(takeoff.items.find(row => row.partNumber === code).quantity, 2, code);
  }
  assert.ok(takeoff.items.some(row => /^CW320 attenuator/.test(row.description)));
  assert.ok(!takeoff.issues.some(issue => issue.includes(ownerRow.ref + " ·")));
  assert.deepEqual(inspectProductCostingReadiness(project, FLOOR).lines.flatMap(line => line.sourceComponentIds ?? []), ["quoted-q350"]);
});

test("owner flag copies with markup, is editable by option, and never leaves a default purchase row", () => {
  const original = add(newDesign(), unit("q350", owner));
  assert.ok(!createPartsCsvRows(original).some(row => row.partNumber === "ZEN-Q350HRV"));
  const other = applyCommand(original, { type: "designOption.duplicate", id: "other", name: "Other", revision: "B", copyScopes: ["markup"], activate: true });
  assert.equal(other.components[0].equipmentSupply, owner);
  const supplied = applyCommand(other, setSupply(other.components[0].id, "included"));
  assert.ok(createPartsCsvRows(supplied).some(row => row.partNumber === "ZEN-Q350HRV"));
  const switched = applyCommand(supplied, { type: "designOption.switch", optionId: original.activeDesignOptionId });
  assert.equal(switched.components[0].equipmentSupply, owner);
});

test("owner-supplied decentralised head stays modelled; controllers and grilles cannot be tagged", () => {
  const models = [
    ["aerofresh-30-compact-decentralised", "head"],
    ["aerofresh-smove-controller-decentralised", "controller"],
    ["luna-supply", "grille"],
  ];
  let project = newDesign();
  for (const [record, id] of models) project = add(project, createCatalogueComponent(record, { id, floorId: FLOOR, xMm: 1000, yMm: 1000 }));
  assert.throws(() => applyCommand(project, setSupply("controller")), /Only an MVHR unit/);
  assert.throws(() => applyCommand(project, setSupply("grille")), /Only an MVHR unit/);
  assert.throws(() => applyCommand(project, setSupply("head", "bad")), /Choose included or owner-supplied/);
  const marked = applyCommand(project, setSupply("head"));
  const schedule = createPartsSchedule(marked, { floorId: FLOOR });
  assert.equal(schedule.decentralisedSystems.unitCount, 1);
  assert.ok(schedule.componentLines.some(line => line.equipmentSupply === owner && line.componentIds.includes("head")));
  assert.ok(createPartsCsvRows(marked).some(row => row.kind === "part" && /sMove/i.test(row.description)));
});


test("rendered drawing and PDF-source parts sheet identify owner equipment without a purchase SKU", () => {
  const project = add(add(newDesign(), unit("client-q350", owner)), unit("quoted-q350"));
  const sheet = createA3SheetModel(project, { floorId: FLOOR, projectName: "Owner equipment test", drawingTitle: "Ventilation",
    drawingId: "V01", revision: "A", revisionText: "test", issueDate: "2026-11-28", status: "Preliminary — not for construction", includeSchedule: true });
  const plan = renderA3SheetSvg(sheet);
  const parts = createA4PartsListPages(sheet).map(page => renderA4PartsListSvg(sheet, page)).join("");
  assert.match(plan, /data-keep-on-drawing="true"[^>]*>Q350[^<]*Owner-supplied/);
  assert.match(plan, /not for purchase/);
  assert.match(parts, /Owner-supplied units/);
  assert.equal((parts.match(/ZEN-Q350HRV/g) ?? []).length, 1);
  assert.match(parts, /ZEN-OPTBOX/);
});
