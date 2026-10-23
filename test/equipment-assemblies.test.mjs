import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  deserializeProject,
  floorPortTransform,
  identityQuaternion,
  inspectComponentDeletion,
  knownMm,
  migrateProjectData,
  serializeProject,
  SCHEMA_VERSION,
  unknownMm,
} from "../src/domain/spatial.mjs";
import {
  createEquipmentAssembly,
  EQUIPMENT_ASSEMBLY_TEMPLATES,
  equipmentAssemblyCentre,
  equipmentAssemblyForComponent,
} from "../src/editor/equipment-assemblies.mjs";
import {
  activateMechanicalTool,
  createMechanicalInteractionState,
  handleMechanicalCanvasClick,
} from "../src/editor/mechanical-controller.mjs";
import { createCatalogueComponent } from "../src/editor/component-catalogue.mjs";

test("remote supply and extract templates create explicit generic grouped topology", () => {
  assert.deepEqual(EQUIPMENT_ASSEMBLY_TEMPLATES.map((item) => item.stream), ["supply", "extract"]);
  for (const template of EQUIPMENT_ASSEMBLY_TEMPLATES) {
    const value = createEquipmentAssembly(template.id, {
      id: `assembly-${template.stream}`,
      floorId: "floor-ground",
      xMm: 2000,
      yMm: 3000,
    });
    assert.equal(value.components.length, 3);
    assert.equal(value.connections.length, 2);
    assert.equal(value.assembly.evidenceStatus, "synthetic-not-manufacturer-verified");
    assert.equal(value.assembly.serviceZoneMm.evidenceStatus, "generic-placeholder-not-manufacturer-verified");
    assert.ok(value.components.every((component) => component.catalogueStatus === "synthetic-not-manufacturer-verified"));
    assert.ok(value.connections.every((connection) => connection.evidence.includes("not verified")));
    assert.deepEqual(value.components.map((component) => [
      component.displaySymbol.widthMm,
      component.displaySymbol.heightMm,
    ]), [[51, 336], [500, 320], [41, 336]]);
    assert.ok(value.components.every((component) => component.catalogueRecordVersionId.endsWith(".v3")));

    const minX = Math.min(...value.components.map((component) => (
      component.positionMm.x - component.displaySymbol.widthMm / 2
    )));
    const maxX = Math.max(...value.components.map((component) => (
      component.positionMm.x + component.displaySymbol.widthMm / 2
    )));
    assert.ok(
      Math.abs((maxX - minX) - 592) < 1e-9,
      "51 mm end plate + 500 mm attenuator + 41 mm radial plate",
    );
    assert.equal(Math.max(...value.components.map((component) => component.displaySymbol.heightMm)), 336);

    const routed = applyCommand(projectWithFloor(), { type: "equipmentAssembly.add", ...value });
    for (const connection of value.connections) {
      const from = floorPortTransform(routed, connection.from.componentId, connection.from.portId).positionMm;
      const to = floorPortTransform(routed, connection.to.componentId, connection.to.portId).positionMm;
      assert.ok(
        Math.hypot(from.x - to.x, from.y - to.y) < 1e-9,
        "source-sized envelopes must retain exact internal logical connections",
      );
      assert.equal(from.z.state, "unknown");
      assert.equal(to.z.state, "unknown");
    }
  }
  assert.throws(() => createCatalogueComponent("generic-supply-remote-attenuator", {
    id: "loose-assembly-member",
    floorId: "floor-ground",
    xMm: 0,
    yMm: 0,
  }), /only be placed through its equipment assembly/);
});

test("one atomic command places and persists an assembly with internal typed connections", () => {
  let project = projectWithFloor();
  const value = createEquipmentAssembly("generic-remote-supply-attenuation-set", {
    id: "assembly-supply-1",
    floorId: "floor-ground",
    xMm: 2000,
    yMm: 3000,
  });
  assert.throws(() => applyCommand(project, {
    type: "equipmentAssembly.add",
    assembly: value.assembly,
    components: value.components,
    connections: value.connections.slice(0, 1),
  }), /exactly match its atomic connection additions/);
  project = applyCommand(project, { type: "equipmentAssembly.add", ...value });

  assert.equal(project.equipmentAssemblies.length, 1);
  assert.equal(project.components.length, 3);
  assert.equal(project.connections.length, 2);
  assert.deepEqual(equipmentAssemblyCentre(project, project.equipmentAssemblies[0]), { x: 2000, y: 3000 });
  assert.equal(equipmentAssemblyForComponent(project, value.components[1].id).id, value.assembly.id);

  const reopened = deserializeProject(serializeProject(project));
  assert.deepEqual(reopened, project);
});

test("assembly movement, rotation and elevation remain grouped while member-only edits are blocked", () => {
  const value = createEquipmentAssembly("generic-remote-extract-attenuation-set", {
    id: "assembly-extract-1",
    floorId: "floor-ground",
    xMm: 0,
    yMm: 0,
  });
  let project = applyCommand(projectWithFloor(), { type: "equipmentAssembly.add", ...value });
  const memberId = value.components[0].id;
  assert.throws(() => applyCommand(project, {
    type: "component.moveXY",
    componentId: memberId,
    xMm: 50,
    yMm: 50,
  }), /use equipment assembly/);

  project = applyCommand(project, {
    type: "equipmentAssembly.moveBy",
    assemblyId: value.assembly.id,
    dxMm: 1000,
    dyMm: 500,
  });
  assert.deepEqual(equipmentAssemblyCentre(project, project.equipmentAssemblies[0]), { x: 1000, y: 500 });
  for (const [actual, expected] of project.components.map((component) => component.positionMm.x)
    .map((value, index) => [value, [726 + 1 / 6, 1001 + 2 / 3, 1272 + 1 / 6][index]])) {
    assert.ok(Math.abs(actual - expected) < 1e-9);
  }

  project = applyCommand(project, {
    type: "equipmentAssembly.rotateFloorZ",
    assemblyId: value.assembly.id,
    angleRad: Math.PI / 2,
  });
  assert.ok(Math.abs(project.components[0].positionMm.x - 1000) < 1e-9);
  assert.ok(Math.abs(project.components[0].positionMm.y - (226 + 1 / 6)) < 1e-9);
  assert.ok(Math.abs(project.components[2].positionMm.x - 1000) < 1e-9);
  assert.ok(Math.abs(project.components[2].positionMm.y - (772 + 1 / 6)) < 1e-9);

  project = applyCommand(project, {
    type: "equipmentAssembly.setElevation",
    assemblyId: value.assembly.id,
    elevationMm: knownMm(2400, "manual equipment placement"),
  });
  assert.ok(project.components.every((component) => component.positionMm.z.valueMm === 2400));
  project = applyCommand(project, {
    type: "equipmentAssembly.setElevation",
    assemblyId: value.assembly.id,
    elevationMm: unknownMm("installation height not set"),
  });
  assert.ok(project.components.every((component) => component.positionMm.z.state === "unknown"));
});

test("deleting one selected assembly member explicitly removes the whole atomic assembly", () => {
  const value = createEquipmentAssembly("generic-remote-supply-attenuation-set", {
    id: "assembly-delete-1",
    floorId: "floor-ground",
    xMm: 2000,
    yMm: 3000,
  });
  let project = applyCommand(projectWithFloor(), { type: "equipmentAssembly.add", ...value });
  const inspection = inspectComponentDeletion(project, value.components[1].id);
  assert.equal(inspection.assemblyId, value.assembly.id);
  assert.equal(inspection.componentCount, 3);
  assert.equal(inspection.connectionCount, 2);

  project = applyCommand(project, {
    type: "component.delete",
    componentId: value.components[1].id,
    confirmedScope: inspection,
  });
  assert.deepEqual(project.equipmentAssemblies, []);
  assert.deepEqual(project.components, []);
  assert.deepEqual(project.connections, []);
  assert.equal(project.floors.length, 1);
});

test("schema 11 migration adds no invented equipment assemblies and placement intent stays explicit", () => {
  const legacy = projectWithFloor();
  legacy.schemaVersion = 11;
  delete legacy.equipmentAssemblies;
  const migrated = migrateProjectData(legacy);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(migrated.equipmentAssemblies, []);

  const state = activateMechanicalTool(createMechanicalInteractionState(), "place-assembly", {
    assemblyTemplateId: "generic-remote-supply-attenuation-set",
  });
  const result = handleMechanicalCanvasClick(state, { point: { x: 400, y: 800 }, hit: null });
  assert.deepEqual(result.intent, {
    type: "equipmentAssembly.place",
    assemblyTemplateId: "generic-remote-supply-attenuation-set",
    point: { x: 400, y: 800 },
  });
  assert.equal(result.state.tool, "place-assembly");
});

function projectWithFloor() {
  return applyCommand(createProject("project-equipment-assemblies"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "test datum") },
        orientation: identityQuaternion(),
      },
    },
  });
}
