import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  deserializeProject,
  identityQuaternion,
  inspectFloorVentilationClear,
  knownMm,
  serializeProject,
  unknownMm,
} from "../src/domain/spatial.mjs";
import {
  createCommandHistory,
  executeCommand,
  redoCommand,
  undoCommand,
} from "../src/domain/history.mjs";
import { deriveRoomBoundaries } from "../src/domain/rooms.mjs";
import { createCatalogueComponent } from "../src/editor/component-catalogue.mjs";
import { createEquipmentAssembly } from "../src/editor/equipment-assemblies.mjs";

test("clearing one floor removes its full ventilation scope and one undo restores exact state", () => {
  const original = populatedTwoFloorProject();
  const beforeCanonical = serializeProject(original);
  const inspection = inspectFloorVentilationClear(original, "floor-ground");
  assert.deepEqual({
    componentCount: inspection.componentCount,
    terminalCount: inspection.terminalCount,
    assemblyCount: inspection.assemblyCount,
    routeCount: inspection.routeCount,
    connectionCount: inspection.connectionCount,
    associationCount: inspection.associationCount,
    ductRunSettingCount: inspection.ductRunSettingCount,
    blockingConnectionIds: inspection.blockingConnectionIds,
  }, {
    componentCount: 4,
    terminalCount: 1,
    assemblyCount: 1,
    routeCount: 1,
    connectionCount: 2,
    associationCount: 1,
    ductRunSettingCount: 1,
    blockingConnectionIds: [],
  });

  const history = executeCommand(createCommandHistory(original), {
    type: "ventilation.clearFloor",
    floorId: "floor-ground",
  });
  const cleared = history.present;

  assert.equal(cleared.components.some((component) => component.floorId === "floor-ground"), false);
  assert.equal(cleared.equipmentAssemblies.some((assembly) => assembly.floorId === "floor-ground"), false);
  assert.equal(cleared.routes.some((route) => route.floorId === "floor-ground"), false);
  assert.equal(cleared.connections.some((connection) => connection.id.startsWith("assembly-ground")), false);
  assert.deepEqual(cleared.rooms[0].terminalAssociations, []);

  assert.deepEqual(cleared.wallNodes, original.wallNodes);
  assert.deepEqual(cleared.walls, original.walls);
  assert.deepEqual(cleared.floorAreaOutlines, original.floorAreaOutlines);
  assert.deepEqual(cleared.referenceAssets, original.referenceAssets);
  assert.deepEqual(cleared.floorReferences, original.floorReferences);
  assert.deepEqual(roomWithoutAssociations(cleared.rooms[0]), roomWithoutAssociations(original.rooms[0]));
  assert.deepEqual(
    cleared.components.filter((component) => component.floorId === "floor-upper"),
    original.components.filter((component) => component.floorId === "floor-upper"),
  );
  assert.deepEqual(
    cleared.equipmentAssemblies.filter((assembly) => assembly.floorId === "floor-upper"),
    original.equipmentAssemblies.filter((assembly) => assembly.floorId === "floor-upper"),
  );
  assert.deepEqual(
    cleared.connections.filter((connection) => connection.id.startsWith("assembly-upper")),
    original.connections.filter((connection) => connection.id.startsWith("assembly-upper")),
  );

  const undone = undoCommand(history);
  assert.equal(serializeProject(undone.present), beforeCanonical);
  const redone = redoCommand(undone);
  assert.deepEqual(redone.present, cleared);
  assert.deepEqual(deserializeProject(serializeProject(cleared)), cleared);
  assert.throws(() => applyCommand(cleared, {
    type: "ventilation.clearFloor",
    floorId: "floor-ground",
  }), /No ventilation objects exist/);
});

test("a cross-floor direct connection blocks clearing without deleting either side", () => {
  let project = projectWithTwoFloors();
  const ground = createCatalogueComponent("synthetic-supply-terminal", {
    id: "ground-cross-floor-terminal",
    floorId: "floor-ground",
    xMm: 1000,
    yMm: 1000,
  });
  const upper = createCatalogueComponent("synthetic-supply-terminal", {
    id: "upper-cross-floor-terminal",
    floorId: "floor-upper",
    xMm: 1000,
    yMm: 1000,
  });
  project = applyCommand(project, { type: "component.add", component: ground });
  project = applyCommand(project, { type: "component.add", component: upper });
  project = applyCommand(project, {
    type: "connection.add",
    connection: {
      id: "connection-cross-floor",
      from: { componentId: ground.id, portId: ground.ports[0].id },
      to: { componentId: upper.id, portId: upper.ports[0].id },
    },
  });
  const before = serializeProject(project);
  assert.deepEqual(
    inspectFloorVentilationClear(project, "floor-ground").blockingConnectionIds,
    ["connection-cross-floor"],
  );
  assert.throws(() => applyCommand(project, {
    type: "ventilation.clearFloor",
    floorId: "floor-ground",
  }), /connections cross to another floor: connection-cross-floor/);
  assert.equal(serializeProject(project), before);
});

function populatedTwoFloorProject() {
  let project = projectWithTwoFloors();
  project = applyCommand(project, {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["node-a", "node-b", "node-c", "node-d", "node-a"],
    wallIds: ["wall-a-b", "wall-b-c", "wall-c-d", "wall-d-a"],
    points: [point(0, 0), point(6000, 0), point(6000, 4000), point(0, 4000), point(0, 0)],
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("test wall height"),
    referenceLine: "centreline",
    classification: "physical",
  });
  const boundary = deriveRoomBoundaries(project, "floor-ground").candidates[0];
  project = applyCommand(project, {
    type: "room.createFromBoundary",
    roomId: "room-ground",
    floorId: "floor-ground",
    boundaryKey: boundary.key,
    name: "Bedroom",
    use: "bedroom",
    ventilationRole: "supply",
  });
  project = applyCommand(project, {
    type: "floorArea.create",
    outline: {
      id: "outline-ground",
      floorId: "floor-ground",
      name: "Ground outline",
      geometrySource: "manual-floor-area-outline",
      purpose: "preliminary-quoting",
      areaConvention: "closed-plan-outline",
      measurementBasis: "floor-local-plan-mm",
      vertices: [
        outlineVertex("outline-a", 0, 0),
        outlineVertex("outline-b", 6000, 0),
        outlineVertex("outline-c", 6000, 4000),
        outlineVertex("outline-d", 0, 4000),
      ],
      holes: [],
    },
  });
  project = applyCommand(project, {
    type: "reference.addImage",
    asset: {
      id: "asset-ground",
      kind: "image",
      fileName: "synthetic-ground.png",
      mediaType: "image/png",
      byteLength: 3,
      sha256: "0".repeat(64),
      widthPx: 1000,
      heightPx: 500,
      dataUrl: "data:image/png;base64,AAAA",
    },
    reference: {
      id: "reference-ground",
      floorId: "floor-ground",
      assetId: "asset-ground",
      visible: true,
      locked: true,
      opacity: 0.55,
      transform: {
        translationMm: { x: 250, y: 350 },
        rotationRad: 0.1,
        scaleMmPerPixel: knownMm(10, "test calibration"),
      },
      calibration: null,
    },
  });

  const groundAssembly = createEquipmentAssembly("generic-remote-supply-attenuation-set", {
    id: "assembly-ground",
    floorId: "floor-ground",
    xMm: 1500,
    yMm: 1000,
  });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...groundAssembly });
  const groundTerminal = createCatalogueComponent("synthetic-supply-terminal", {
    id: "terminal-ground",
    floorId: "floor-ground",
    xMm: 4500,
    yMm: 2500,
  });
  project = applyCommand(project, { type: "component.add", component: groundTerminal });
  project = applyCommand(project, {
    type: "component.setDuctRunCount",
    componentId: groundTerminal.id,
    ductRunCount: 2,
  });
  project = applyCommand(project, {
    type: "terminal.assignRoom",
    roomId: "room-ground",
    componentId: groundTerminal.id,
    portId: groundTerminal.ports[0].id,
  });
  const radialPlate = groundAssembly.components[2];
  project = applyCommand(project, {
    type: "route.add",
    route: {
      id: "route-ground",
      floorId: "floor-ground",
      system: "mvhr",
      stream: "supply",
      role: "Dwelling supply",
      ductKind: "semi-rigid-radial",
      startAttachment: { componentId: radialPlate.id, portId: `${radialPlate.id}-port-branch-1` },
      endAttachment: { componentId: groundTerminal.id, portId: groundTerminal.ports[0].id },
      points: [
        { x: 0, y: 0, z: unknownMm("derived on add") },
        { x: 1, y: 1, z: unknownMm("derived on add") },
      ],
    },
  });

  const upperAssembly = createEquipmentAssembly("generic-remote-extract-attenuation-set", {
    id: "assembly-upper",
    floorId: "floor-upper",
    xMm: 2000,
    yMm: 1800,
  });
  return applyCommand(project, { type: "equipmentAssembly.add", ...upperAssembly });
}

function projectWithTwoFloors() {
  let project = createProject("project-ventilation-clear");
  for (const [id, name, elevation] of [
    ["floor-ground", "Ground Floor", 0],
    ["floor-upper", "Upper Floor", 3000],
  ]) {
    project = applyCommand(project, {
      type: "floor.add",
      floor: {
        id,
        name,
        transform: {
          translationMm: { x: 0, y: 0, z: knownMm(elevation, "test floor datum") },
          orientation: identityQuaternion(),
        },
      },
    });
  }
  return project;
}

function point(x, y) {
  return { x, y, z: unknownMm("test plan") };
}

function outlineVertex(id, x, y) {
  return { id, positionMm: { x, y, z: knownMm(0, "test plan") } };
}

function roomWithoutAssociations(room) {
  const value = structuredClone(room);
  value.terminalAssociations = [];
  return value;
}
