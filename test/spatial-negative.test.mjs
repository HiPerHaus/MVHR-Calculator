import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  buildingPointToComponent,
  componentPointToBuilding,
  createProject,
  deserializeProject,
  identityQuaternion,
  knownMm,
  MAX_REFERENCE_ASSETS,
  normalizeQuaternion,
  serializeProject,
  unknownMm,
  validateProject,
  worldPortTransform,
} from "../src/domain/spatial.mjs";

test("non-finite coordinates and zero orientations are rejected", () => {
  assert.throws(() => knownMm(Number.NaN), /finite/);
  assert.throws(() => knownMm(Number.POSITIVE_INFINITY), /finite/);
  assert.throws(() => normalizeQuaternion({ x: 0, y: 0, z: 0, w: 0 }), /non-zero/);

  const project = addComponent(projectWithFloor(), "component-finite", "port-finite", knownMm(0));
  assert.throws(
    () =>
      applyCommand(project, {
        type: "component.moveXY",
        componentId: "component-finite",
        xMm: Number.NaN,
        yMm: 0,
      }),
    /not found|finite/,
  );
});

test("component-local and building transforms round-trip known coordinates", () => {
  let project = createProject("project-transform-round-trip");
  project = applyCommand(project, {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 10000, y: 20000, z: knownMm(3000, "synthetic-fixture") },
        orientation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
      },
    },
  });
  project = applyCommand(project, {
    type: "component.add",
    component: {
      ...componentFixture("component-transform", "port-transform", knownMm(300, "synthetic-fixture")),
      positionMm: { x: 1000, y: 2000, z: knownMm(300, "synthetic-fixture") },
      orientation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
    },
  });

  const local = { x: 100, y: 0, z: 50 };
  const building = componentPointToBuilding(project, "component-transform", local);
  assert.equal(building.positionState, "known");
  assertVectorClose(building.positionMm, { x: 7900, y: 21000, z: 3350 });
  const recovered = buildingPointToComponent(
    project,
    "component-transform",
    building.positionMm,
  );
  assert.equal(recovered.positionState, "known");
  assertVectorClose(recovered.positionMm, local);
});

test("known zero elevation stays distinct from unknown elevation", () => {
  const known = addComponent(projectWithFloor(), "component-known", "port-known", knownMm(0));
  assert.equal(worldPortTransform(known, "component-known", "port-known").positionState, "known");
  assert.equal(
    worldPortTransform(known, "component-known", "port-known").positionMm.z,
    0,
  );

  let unknown = createProject("project-unknown-floor");
  unknown = applyCommand(unknown, {
    type: "floor.add",
    floor: floorFixture("floor-ground", unknownMm("datum not established")),
  });
  unknown = addComponent(unknown, "component-unknown", "port-unknown", knownMm(0));
  assert.equal(
    worldPortTransform(unknown, "component-unknown", "port-unknown").positionState,
    "unknown",
  );
});

test("unsupported schema and non-canonical units are rejected", () => {
  const wrongSchema = createProject("project-wrong-schema");
  wrongSchema.schemaVersion = 999;
  assert.throws(() => validateProject(wrongSchema), /Unsupported schema/);

  const wrongUnits = createProject("project-wrong-units");
  wrongUnits.coordinateSystem.lengthUnit = "m";
  assert.throws(() => serializeProject(wrongUnits), /canonical/);
});

test("project validation bounds embedded reference count before persistence", () => {
  const project = projectWithFloor();
  project.referenceAssets = Array.from({ length: MAX_REFERENCE_ASSETS + 1 }, (_, index) => ({
    id: `reference-asset-${index}`,
    kind: "image",
    fileName: `synthetic-${index}.png`,
    mediaType: "image/png",
    byteLength: 3,
    sha256: "0".repeat(64),
    widthPx: 1,
    heightPx: 1,
    dataUrl: "data:image/png;base64,AAAA",
  }));
  assert.throws(() => validateProject(project), /reference prototype limit/);
});

test("commands do not mutate their project or command inputs", () => {
  const project = projectWithFloor();
  const command = {
    type: "component.add",
    component: componentFixture("component-a", "port-a", knownMm(0)),
  };
  command.component.orientation = { x: 0, y: 0, z: 0, w: 2 };
  const projectBefore = structuredClone(project);
  const commandBefore = structuredClone(command);

  const next = applyCommand(project, command);

  assert.deepEqual(project, projectBefore);
  assert.deepEqual(command, commandBefore);
  assert.deepEqual(next.components[0].orientation, identityQuaternion());
});

test("duplicate entity and port IDs are rejected", () => {
  const project = projectWithFloor();
  assert.throws(
    () => applyCommand(project, { type: "floor.add", floor: floorFixture("floor-ground", knownMm(0)) }),
    /already exists/,
  );

  const duplicated = structuredClone(project);
  duplicated.floors.push(structuredClone(duplicated.floors[0]));
  assert.throws(() => deserializeProject(JSON.stringify(duplicated)), /Duplicate/);

  const badComponent = componentFixture("component-ports", "port-duplicate", knownMm(0));
  badComponent.ports.push(structuredClone(badComponent.ports[0]));
  assert.throws(
    () => applyCommand(project, { type: "component.add", component: badComponent }),
    /Duplicate ports ID/,
  );
});

test("dangling, zero-direction, and incompatible-role connections are rejected", () => {
  let project = projectWithFloor();
  project = addComponent(project, "component-a", "port-a", knownMm(0), "Dwelling supply");
  project = addComponent(project, "component-b", "port-b", knownMm(0), "Dwelling supply");
  project = addComponent(project, "component-c", "port-c", knownMm(0), "Outdoor intake");

  assert.throws(
    () =>
      applyCommand(project, {
        type: "connection.add",
        connection: {
          id: "connection-dangling",
          from: { componentId: "component-a", portId: "port-a" },
          to: { componentId: "component-missing", portId: "port-missing" },
        },
      }),
    /not found/,
  );

  const zeroDirection = componentFixture("component-zero", "port-zero", knownMm(0));
  zeroDirection.ports[0].direction = { x: 0, y: 0, z: 0 };
  assert.throws(
    () => applyCommand(project, { type: "component.add", component: zeroDirection }),
    /non-zero/,
  );

  assert.throws(
    () =>
      applyCommand(project, {
        type: "connection.add",
        connection: {
          id: "connection-role-mismatch",
          from: { componentId: "component-a", portId: "port-a" },
          to: { componentId: "component-c", portId: "port-c" },
        },
      }),
    /role/,
  );
});

test("persisted projects reject non-canonical orientations and multiply occupied ports", () => {
  let project = projectWithFloor();
  project = addComponent(project, "component-a", "port-a", knownMm(0));
  project = addComponent(project, "component-b", "port-b", knownMm(0));
  project = addComponent(project, "component-c", "port-c", knownMm(0));

  const nonCanonical = structuredClone(project);
  nonCanonical.components[0].orientation = { x: 0, y: 0, z: 0, w: 2 };
  assert.throws(() => validateProject(nonCanonical), /normalized/);

  const occupied = structuredClone(project);
  occupied.connections = [
    {
      id: "connection-a-b",
      from: { componentId: "component-a", portId: "port-a" },
      to: { componentId: "component-b", portId: "port-b" },
    },
    {
      id: "connection-b-c",
      from: { componentId: "component-b", portId: "port-b" },
      to: { componentId: "component-c", portId: "port-c" },
    },
  ];
  assert.throws(() => validateProject(occupied), /already occupied/);
});

function projectWithFloor() {
  return applyCommand(createProject("project-negative-fixture"), {
    type: "floor.add",
    floor: floorFixture("floor-ground", knownMm(0, "synthetic-fixture")),
  });
}

function floorFixture(id, z) {
  return {
    id,
    name: "Ground Floor",
    transform: {
      translationMm: { x: 0, y: 0, z },
      orientation: identityQuaternion(),
    },
  };
}

function addComponent(project, componentId, portId, z, role = "Dwelling supply") {
  return applyCommand(project, {
    type: "component.add",
    component: componentFixture(componentId, portId, z, role),
  });
}

function componentFixture(componentId, portId, z, role = "Dwelling supply") {
  return {
    id: componentId,
    floorId: "floor-ground",
    positionMm: { x: 0, y: 0, z },
    orientation: identityQuaternion(),
    ports: [
      {
        id: portId,
        definitionId: `definition-${portId}`,
        positionMm: { x: 0, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        system: "mvhr",
        stream: "supply",
        role,
      },
    ],
  };
}

function assertVectorClose(actual, expected, tolerance = 1e-9) {
  for (const axis of ["x", "y", "z"]) {
    assert.ok(Math.abs(actual[axis] - expected[axis]) <= tolerance);
  }
}
