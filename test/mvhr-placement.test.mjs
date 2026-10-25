import assert from "node:assert/strict";
import test from "node:test";
import { createConfiguredMvhrComponent } from "../src/editor/mvhr-placement.mjs";
import { applyCommand, createProject, knownMm, identityQuaternion, serializeProject, deserializeProject } from "../src/domain/spatial.mjs";
import { createCommandHistory, executeCommand, undoCommand, redoCommand } from "../src/domain/history.mjs";

const placement = { id: "unit-configured", floorId: "floor-ground", xMm: 1200, yMm: 2300 };
const choice = { mounting: "vertical", model: "q350-hrv", handing: "right", layout: "remote-attenuators" };

test("configured Q350 preserves handed ports and pending accessories through save, undo and redo", () => {
  const component = createConfiguredMvhrComponent(choice, placement);
  assert.equal(component.catalogueItemId, "zehnder-q350-hrv-right-drawing-profile");
  assert.ok(component.ports.find(p => p.role === "Dwelling supply").positionMm.x > 0);
  assert.equal(component.mvhrDesignIntent.assemblyState, "layout-pending");
  let project = applyCommand(createProject("project-placement-test"), { type: "floor.add", floor: {
    id: "floor-ground", name: "Ground", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "test") }, orientation: identityQuaternion() },
  } });
  const history = executeCommand(createCommandHistory(project), { type: "component.add", component });
  assert.equal(history.present.components.length, 1);
  assert.equal(history.present.equipmentAssemblies.length, 0);
  assert.equal(history.present.connections.length, 0);
  assert.deepEqual(deserializeProject(serializeProject(history.present)), history.present);
  const undone = undoCommand(history);
  assert.equal(undone.present.components.length, 0);
  assert.deepEqual(redoCommand(undone).present, history.present);
});

test("horizontal mounting stays generic and cannot silently turn a Q350 on its side", () => {
  assert.throws(() => createConfiguredMvhrComponent({ ...choice, mounting: "horizontal" }, placement), /horizontal manufacturer profile/);
  const component = createConfiguredMvhrComponent({ ...choice, mounting: "horizontal", model: "generic", layout: "unit-only" }, placement);
  assert.equal(component.catalogueStatus, "synthetic-not-manufacturer-verified");
  assert.equal(component.mvhrDesignIntent.handing, null);
  assert.equal(component.positionMm.z.state, "unknown");
});

test("direct CW selection creates a schematic without manufacturing accessories or fit evidence", () => {
  const component = createConfiguredMvhrComponent({ ...choice, model: "q350-erv", handing: "left", layout: "unit-mounted-cw" }, placement);
  assert.equal(component.catalogueItemId, "zehnder-q350-erv-left-drawing-profile");
  assert.equal(component.mvhrDesignIntent.assemblyState, "schematic-mounted-cw");
  assert.throws(() => createConfiguredMvhrComponent({ ...choice, layout: "unknown" }, placement), /MVHR layout/);
});

test("German BIM variants are explicit exact-article placements and never inherit unverified CW mating", () => {
  const q350 = createConfiguredMvhrComponent({ ...choice, model: "q350-de-hrv", handing: "left", layout: "unit-only" }, placement);
  assert.equal(q350.catalogueItemId, "zehnder-q350-de-hrv-left-bim-profile");
  assert.equal(q350.catalogueSnapshot.manufacturerArticle, "471502009");
  assert.equal(q350.catalogueSnapshot.manufacturerGeometryAsset.assetId, "q350-de-hrv-left");
  assert.ok(q350.ports.every((port) => port.positionMm.z === 850));
  const q450 = createConfiguredMvhrComponent({ ...choice, model: "q450-de-erv", handing: "right", layout: "remote-attenuators" }, placement);
  assert.equal(q450.catalogueItemId, "zehnder-q450-de-erv-right-bim-profile");
  assert.equal(q450.catalogueSnapshot.manufacturerArticle, "471502012");
  assert.ok(q450.ports.every((port) => port.interface.nominalSizeMm === 180));
  assert.throws(() => createConfiguredMvhrComponent({ ...choice, model: "q350-de-hrv", layout: "unit-mounted-cw" }, placement), /no reviewed CW mating asset/);
});


test("mounted CW sizes mirror without changing any unit snap ports", async () => {
  const { deriveComponentPlanGraphic, mountedCwShapes } = await import("../src/editor/component-plan-graphics.mjs");
  for (const handing of ["left", "right"]) for (const [cwSize, count] of [["320",6],["420",8],["520",10]]) {
    const base = createConfiguredMvhrComponent({ ...choice, handing, layout: "unit-only" }, placement);
    const mounted = createConfiguredMvhrComponent({ ...choice, handing, layout: "unit-mounted-cw", cwSize }, placement);
    assert.deepEqual(mounted.ports.filter(p=>p.interface.nominalSizeMm!==90), base.ports);
    const graphic = deriveComponentPlanGraphic(mounted);
    assert.equal(graphic.mountedCw.side, handing === "left" ? -1 : 1);
    assert.equal(graphic.drawingBoundsMm.maxX - graphic.drawingBoundsMm.minX, { "320":791, "420":824, "520":924 }[cwSize]);
    assert.equal(graphic.drawingBoundsMm.maxY - graphic.drawingBoundsMm.minY, 566);
    const shapes = mountedCwShapes(graphic);
    for (const stream of ["supply", "extract"]) {
      const branches = shapes.filter(s => s.attributes["data-cw-branch"] === stream);
      assert.equal(branches.length, count);
      assert.ok(branches.every(s => s.attributes.r === 45));
      assert.equal(new Set(branches.map(s => s.attributes.cx)).size, count/2);
      assert.equal(new Set(branches.map(s => s.attributes.cy)).size, 2);
    }
    for (const stream of ["intake", "exhaust"]) {
      const p = graphic.ports.find(p => p.stream === stream);
      assert.ok(handing === "left" ? p.xMm > 0 : p.xMm < 0);
      assert.ok(shapes.filter(s => s.tag === "circle").every(s => Math.sign(s.attributes.cx) !== Math.sign(p.xMm)));
    }
  }
});


test("mounted CW outdoor ports remain route-start snap targets through rotation and reopen", async () => {
  const { floorPortTransform } = await import("../src/domain/spatial.mjs");
  const { activateMechanicalTool, createMechanicalInteractionState, handleMechanicalCanvasClick } = await import("../src/editor/mechanical-controller.mjs");
  for (const handing of ["left", "right"]) {
    const unit = createConfiguredMvhrComponent({ ...choice, handing, layout: "unit-mounted-cw", cwSize: "320" }, placement);
    let project = applyCommand(createProject(`project-cw-snap-${handing}`), { type: "floor.add", floor: { id: "floor-ground", name: "Ground", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "test") }, orientation: identityQuaternion() } } });
    project = applyCommand(project, { type: "component.add", component: unit });
    project = applyCommand(project, { type: "component.rotateFloorZ", componentId: unit.id, angleRad: Math.PI/2 });
    project = deserializeProject(serializeProject(project));
    for (const stream of ["intake", "exhaust"]) {
      const port = project.components[0].ports.find(p => p.stream === stream);
      const point = floorPortTransform(project, unit.id, port.id).positionMm;
      const state = activateMechanicalTool(createMechanicalInteractionState(), "route", { ductKind: "epp-rigid-dn160" });
      const result = handleMechanicalCanvasClick(state, { point, hit: { kind: "port", componentId: unit.id, portId: port.id, system: "mvhr", stream, role: port.role, interface: port.interface, occupied: false } });
      assert.equal(result.state.routeDraft?.start.portId, port.id);
      assert.equal(result.state.routeDraft?.start.componentId, unit.id);
      assert.equal(result.state.routeDraft?.stream, stream);
      assert.equal(result.state.routeDraft.points[0].x, point.x);
      assert.equal(result.state.routeDraft.points[0].y, point.y);
    }
  }
});


test("Aerofresh 450 mounted CW520 uses manufacturer handing and 160 mm EPP interfaces", async () => {
  const { deriveComponentPlanGraphic, mountedCwShapes } = await import("../src/editor/component-plan-graphics.mjs");
  for (const handing of ["left", "right"]) {
    const component = createConfiguredMvhrComponent({ ...choice, model: "aerofresh-450-hrv", handing, layout: "unit-mounted-cw", cwSize: "520" }, placement);
    assert.equal(component.productId, "AER-450HRV");
    assert.deepEqual(component.catalogueSnapshot.dimensions.body, { width:728, depth:608, height:881 });
    const graphic = deriveComponentPlanGraphic(component);
    assert.equal(graphic.modelName, "Aerofresh 450");
    assert.ok(graphic.ports.every(p => p.displayOutsideDiameterMm === 190));
    assert.ok(component.ports.every(p => p.interface.outsideDiameterMm === null));
    assert.equal(graphic.drawingBoundsMm.maxX-graphic.drawingBoundsMm.minX, 870);
    assert.equal(graphic.drawingBoundsMm.maxY-graphic.drawingBoundsMm.minY, 650);
    const branches = mountedCwShapes(graphic).filter(s=>s.tag === "circle");
    assert.equal(branches.length, 20);
    assert.ok(branches.every(s=>s.attributes.r === 45));
    const outdoor = component.ports.filter(p=>["intake","exhaust"].includes(p.stream));
    assert.equal(outdoor.length, 2);
    assert.ok(outdoor.every(p=>p.interface.nominalSizeMm === 160));
    assert.ok(outdoor.every(p=>handing === "left" ? p.positionMm.x < 0 : p.positionMm.x > 0));
    assert.equal(graphic.mountedCw.side, handing === "left" ? 1 : -1);
    assert.equal(component.catalogueSnapshot.connectionSetout.orientationConvention, "manufacturer");
    const intake = outdoor.find(p=>p.stream === "intake");
    assert.deepEqual(intake.positionMm, handing === "left" ? {x:-164,y:-117,z:0} : {x:164,y:117,z:0});
    const legacy = structuredClone(component);
    delete legacy.catalogueSnapshot.connectionSetout.orientationConvention;
    delete legacy.connectionSetout?.orientationConvention;
    assert.equal(deriveComponentPlanGraphic(legacy).mountedCw.side, handing === "left" ? -1 : 1);
  }
  assert.throws(()=>createConfiguredMvhrComponent({ ...choice, model:"aerofresh-300-hrv", layout:"unit-mounted-cw" },placement),/remote only/);
});


test("Aerofresh CW625 retains its distinct envelope and twelve 90 mm branches per stream", async () => {
  const { deriveComponentPlanGraphic, mountedCwShapes } = await import("../src/editor/component-plan-graphics.mjs");
  for (const handing of ["left", "right"]) {
    const component = createConfiguredMvhrComponent({ ...choice, model: "aerofresh-450-erv", handing, layout: "unit-mounted-cw", cwSize: "625" }, placement);
    const graphic = deriveComponentPlanGraphic(component);
    assert.equal(graphic.drawingBoundsMm.maxX-graphic.drawingBoundsMm.minX, 970);
    assert.equal(graphic.drawingBoundsMm.maxY-graphic.drawingBoundsMm.minY, 640);
    assert.equal(graphic.mountedDimensions.heightMm, 1400);
    assert.equal(graphic.mountedDimensions.moduleWidthMm, 641);
    assert.match(graphic.mountedDimensions.source, /CW625/);
    const shapes = mountedCwShapes(graphic);
    for (const stream of ["supply", "extract"]) {
      const branches = shapes.filter(s=>s.attributes["data-cw-branch"] === stream);
      assert.equal(branches.length, 12);
      assert.ok(branches.every(s=>s.attributes.r === 45));
      assert.equal(new Set(branches.map(s=>s.attributes.cx)).size, 6);
      assert.equal(new Set(branches.map(s=>s.attributes.cy)).size, 2);
    }
    const previous = createConfiguredMvhrComponent({ ...choice, model: "aerofresh-450-erv", handing, layout: "unit-mounted-cw", cwSize: "520" }, placement);
    assert.deepEqual(component.ports.filter(p=>p.interface.nominalSizeMm!==90), previous.ports.filter(p=>p.interface.nominalSizeMm!==90));
  }
});


test("AF450 accepts CW320, CW420 and CW520 for both recovery types and orientations", async () => {
  const { deriveComponentPlanGraphic, mountedCwShapes } = await import("../src/editor/component-plan-graphics.mjs");
  for (const model of ["aerofresh-450-hrv", "aerofresh-450-erv"]) for (const handing of ["left", "right"]) {
    const baseline = createConfiguredMvhrComponent({ ...choice, model, handing, layout:"unit-mounted-cw", cwSize:"520" }, placement);
    for (const [cwSize, count] of [["320",6],["420",8],["520",10]]) {
      const component = createConfiguredMvhrComponent({ ...choice, model, handing, layout:"unit-mounted-cw", cwSize }, placement);
      assert.deepEqual(component.ports.filter(p=>p.interface.nominalSizeMm!==90), baseline.ports.filter(p=>p.interface.nominalSizeMm!==90));
      const graphic = deriveComponentPlanGraphic(component);
      const shapes = mountedCwShapes(graphic);
      for (const stream of ["supply", "extract"]) {
        const branches = shapes.filter(s=>s.attributes["data-cw-branch"] === stream);
        assert.equal(branches.length, count);
        assert.ok(branches.every(s=>s.attributes.r === 45));
      }
      if (cwSize !== "520") {
        assert.equal(graphic.mountedDimensions.measuredEnvelopeMm, null);
        assert.equal(graphic.mountedDimensions.heightMm, null);
        assert.equal(graphic.mountedDimensions.envelopeStatus, "schematic-layout-allowance");
      }
    }
  }
});


test("Aerofresh manuals distinguish body size, spigot height and service boundary", async () => {
  const { AEROFRESH_MANUAL_EVIDENCE: e } = await import("../src/editor/aerofresh-manual-evidence.mjs");
  assert.deepEqual(e["300"].body, { width:660, depth:443, height:760 });
  assert.equal(e["300"].nominalSpigotDiameterMm,125);
  assert.equal(e["300"].spigotProtrusionMm,63);
  assert.equal(e["300"].mountingPolicy,"remote-only");
  assert.deepEqual(e["450"].body, { width:728, depth:608, height:881 });
  assert.equal(e["450"].nominalSpigotDiameterMm,200);
  assert.equal(e["450"].service.rearToServiceBoundaryMm,1100);
  assert.equal(e["450"].portSetout.pitchConflictMm,1);
});


test("Q350 CW625 uses manufacturer envelope and preserves handed unit ports", async () => {
  const { deriveComponentPlanGraphic, mountedCwShapes } = await import("../src/editor/component-plan-graphics.mjs");
  for (const model of ["q350-hrv", "q350-erv"]) for (const handing of ["left", "right"]) {
    const component = createConfiguredMvhrComponent({ ...choice, model, handing, layout: "unit-mounted-cw", cwSize: "625" }, placement);
    const base = createConfiguredMvhrComponent({ ...choice, model, handing, layout: "unit-only" }, placement);
    assert.deepEqual(component.ports.filter(p=>p.interface.nominalSizeMm!==90), base.ports);
    const graphic = deriveComponentPlanGraphic(component);
    assert.equal(graphic.drawingBoundsMm.maxX - graphic.drawingBoundsMm.minX, 1029);
    assert.equal(graphic.depthMm, 566);
    assert.equal(graphic.mountedDimensions.heightMm, 1414);
    assert.equal(graphic.mountedDimensions.moduleWidthMm, 641);
    assert.match(graphic.mountedDimensions.source, /pages-5-7/);
    const shapes = mountedCwShapes(graphic);
    for (const stream of ["supply", "extract"]) {
      const branches = shapes.filter(s => s.attributes["data-cw-branch"] === stream);
      assert.equal(branches.length, 12);
      assert.ok(branches.every(s => s.attributes.r === 45));
      assert.equal(new Set(branches.map(s => s.attributes.cx)).size, 6);
    }
  }
});
