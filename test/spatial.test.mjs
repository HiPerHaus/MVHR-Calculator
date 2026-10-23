import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyCommand,
  arePortsConnected,
  createProject,
  deserializeProject,
  identityQuaternion,
  knownMm,
  quaternionFromYaw,
  routeLengthSummary,
  serializeProject,
  unknownMm,
  worldPortTransform,
} from "../src/domain/spatial.mjs";

const fixtureUrl = new URL("./fixtures/spatial-round-trip.json", import.meta.url);

test("synthetic floor/component/port transforms match the master fixture", async () => {
  const project = deserializeProject(await readFile(fixtureUrl, "utf8"));
  const port = worldPortTransform(project, "component-unit", "port-supply");

  assert.equal(port.positionState, "known");
  assertVectorClose(port.positionMm, { x: 7900, y: 21000, z: 3350 });
  assertVectorClose(port.direction, { x: -1, y: 0, z: 0 });
});

test("canonical serialization round-trips stable identities and state", async () => {
  const project = deserializeProject(await readFile(fixtureUrl, "utf8"));
  const serialized = serializeProject(project);
  const reopened = deserializeProject(serialized);

  assert.equal(serializeProject(reopened), serialized);
  assert.equal(reopened.components[0].id, "component-unit");
  assert.equal(reopened.components[0].ports[0].id, "port-supply");
});

test("an XY move preserves unknown Z and full orientation", () => {
  let project = createProject("project-unknown-elevation");
  project = applyCommand(project, {
    type: "floor.add",
    floor: {
      id: "floor-upper",
      name: "Upper Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: unknownMm("floor elevation not measured") },
        orientation: quaternionFromYaw(Math.PI / 6),
      },
    },
  });
  project = applyCommand(project, {
    type: "component.add",
    component: {
      id: "component-terminal",
      floorId: "floor-upper",
      positionMm: { x: 100, y: 200, z: unknownMm("installation height not measured") },
      orientation: { x: 0.2, y: 0.1, z: 0.3, w: 0.9 },
      ports: [
        {
          id: "port-terminal",
          definitionId: "port-def-terminal",
          positionMm: { x: 0, y: 0, z: 20 },
          direction: { x: 0, y: 0, z: 1 },
          system: "mvhr",
          stream: "supply",
          role: "Dwelling supply",
        },
      ],
    },
  });
  const before = structuredClone(project.components[0]);
  const moved = applyCommand(project, {
    type: "component.moveXY",
    componentId: "component-terminal",
    xMm: 400,
    yMm: 500,
  });

  assert.deepEqual(moved.components[0].positionMm.z, before.positionMm.z);
  assert.deepEqual(moved.components[0].orientation, before.orientation);
  assert.equal(moved.components[0].positionMm.x, 400);
  assert.equal(moved.components[0].positionMm.y, 500);
  assert.equal(worldPortTransform(moved, "component-terminal", "port-terminal").positionState, "unknown");
  assert.equal(project.components[0].positionMm.x, 100, "commands must not mutate prior state");
});

test("projected and developed route lengths remain separate", async () => {
  const project = deserializeProject(await readFile(fixtureUrl, "utf8"));
  assert.deepEqual(routeLengthSummary(project.routes[0]), {
    projectedMm: 3000,
    developedMm: 5000,
    developedState: "known",
  });

  const unknownRoute = structuredClone(project.routes[0]);
  unknownRoute.points[2].z = unknownMm("rise not measured");
  assert.deepEqual(routeLengthSummary(unknownRoute), {
    projectedMm: 3000,
    developedMm: null,
    developedState: "unknown",
  });
});

test("visual overlap never creates connectivity; typed explicit connections do", () => {
  let project = createProject("project-connectivity");
  project = applyCommand(project, {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "synthetic-fixture") },
        orientation: identityQuaternion(),
      },
    },
  });

  for (const [componentId, portId, stream] of [
    ["component-a", "port-a", "supply"],
    ["component-b", "port-b", "supply"],
    ["component-c", "port-c", "extract"],
  ]) {
    project = applyCommand(project, {
      type: "component.add",
      component: {
        id: componentId,
        floorId: "floor-ground",
        positionMm: { x: 0, y: 0, z: knownMm(0, "synthetic-fixture") },
        orientation: identityQuaternion(),
        ports: [
          {
            id: portId,
            definitionId: `definition-${portId}`,
            positionMm: { x: 0, y: 0, z: 0 },
            direction: { x: 1, y: 0, z: 0 },
            system: "mvhr",
            stream,
            role: stream === "supply" ? "Dwelling supply" : "Dwelling extract",
          },
        ],
      },
    });
  }

  const a = { componentId: "component-a", portId: "port-a" };
  const b = { componentId: "component-b", portId: "port-b" };
  const c = { componentId: "component-c", portId: "port-c" };
  assert.equal(arePortsConnected(project, a, b), false);

  project = applyCommand(project, {
    type: "connection.add",
    connection: { id: "connection-a-b", from: a, to: b },
  });
  assert.equal(arePortsConnected(project, a, b), true);
  assert.throws(
    () =>
      applyCommand(project, {
        type: "connection.add",
        connection: { id: "connection-b-c", from: b, to: c },
      }),
    /matching typed system and stream|already occupied/,
  );
});

function assertVectorClose(actual, expected, tolerance = 1e-9) {
  for (const axis of ["x", "y", "z"]) {
    assert.ok(
      Math.abs(actual[axis] - expected[axis]) <= tolerance,
      `${axis}: expected ${expected[axis]}, received ${actual[axis]}`,
    );
  }
}

