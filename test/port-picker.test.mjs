import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  floorPortTransform,
  identityQuaternion,
  knownMm,
} from "../src/domain/spatial.mjs";
import { createCatalogueComponent } from "../src/editor/component-catalogue.mjs";
import { createEquipmentAssembly } from "../src/editor/equipment-assemblies.mjs";
import {
  pickPortAtClientPoint,
  PORT_PICK_TOLERANCE_CSS_PX,
} from "../src/editor/port-picker.mjs";

const rect = { left: 20, top: 40, width: 1000, height: 600 };

test("port picking keeps a twelve-pixel acquisition radius across camera zoom levels", () => {
  const { project, terminalPort } = isolatedPortFixture();
  for (const camera of [
    { x: -100, y: -100, width: 1200, height: 720 },
    { x: -500, y: -300, width: 4000, height: 2400 },
    { x: -1000, y: -600, width: 12000, height: 7200 },
  ]) {
    const centre = endpointClientPoint(project, terminalPort, camera);
    const inside = pickPortAtClientPoint(project, camera, rect, {
      x: centre.x + PORT_PICK_TOLERANCE_CSS_PX - 0.25,
      y: centre.y,
    });
    assert.equal(inside.componentId, terminalPort.componentId);
    assert.equal(inside.portId, terminalPort.portId);
    assert.ok(inside.distancePx < PORT_PICK_TOLERANCE_CSS_PX);
    assert.equal(pickPortAtClientPoint(project, camera, rect, {
      x: centre.x + PORT_PICK_TOLERANCE_CSS_PX + 0.25,
      y: centre.y,
    }), null);
  }
});

test("nearest EPP port identity wins when a fitted view visually compresses adjacent assembly ports", () => {
  const { project, eppPort, modulePort } = fixture();
  const camera = { x: -1000, y: -600, width: 12000, height: 7200 };
  const eppCentre = endpointClientPoint(project, eppPort, camera);
  const picked = pickPortAtClientPoint(project, camera, rect, eppCentre);

  assert.equal(picked.componentId, eppPort.componentId);
  assert.equal(picked.portId, eppPort.portId);
  assert.notEqual(picked.portId, modulePort.portId);
});

test("letterboxed SVG projection and the full evidenced Q350 collar remain acquirable", () => {
  const { project, unitPort } = fixture();
  const camera = { x: 0, y: 0, width: 393.216, height: 262.144 };
  const centre = endpointClientPoint(project, unitPort, camera);
  const scale = Math.min(rect.width / camera.width, rect.height / camera.height);
  const collarRadiusPx = 190 / 2 / 10 * scale;
  const rim = pickPortAtClientPoint(project, camera, rect, {
    x: centre.x + collarRadiusPx - 0.25,
    y: centre.y,
  });

  assert.equal(rim.componentId, unitPort.componentId);
  assert.equal(rim.portId, unitPort.portId);
  assert.ok(rim.distancePx > PORT_PICK_TOLERANCE_CSS_PX);
  assert.ok(rim.distancePx < rim.acquisitionRadiusPx);
});

function fixture() {
  let project = applyCommand(createProject("project-port-picker"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "port picker datum") },
        orientation: identityQuaternion(),
      },
    },
  });
  const unit = createCatalogueComponent("zehnder-q350-hrv-right-drawing-profile", {
    id: "component-q350-right",
    floorId: "floor-ground",
    xMm: 1000,
    yMm: 1000,
  });
  const assemblyValue = createEquipmentAssembly("generic-remote-extract-attenuation-set", {
    id: "assembly-extract",
    floorId: "floor-ground",
    xMm: 5000,
    yMm: 1000,
  });
  project = applyCommand(project, { type: "component.add", component: unit });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...assemblyValue });
  const endPlate = project.components.find((component) => component.id === "assembly-extract-end-plate");
  return {
    project,
    unitPort: endpoint(unit, unit.ports.find((port) => port.stream === "extract")),
    eppPort: endpoint(endPlate, endPlate.ports.find((port) => port.interface?.family === "rigid-epp")),
    modulePort: endpoint(endPlate, endPlate.ports.find((port) => port.interface?.family === "generic-cw-module")),
  };
}

function isolatedPortFixture() {
  let project = applyCommand(createProject("project-isolated-port-picker"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "isolated port picker datum") },
        orientation: identityQuaternion(),
      },
    },
  });
  const terminal = createCatalogueComponent("synthetic-supply-terminal", {
    id: "component-isolated-terminal",
    floorId: "floor-ground",
    xMm: 1000,
    yMm: 1000,
  });
  project = applyCommand(project, { type: "component.add", component: terminal });
  return { project, terminalPort: endpoint(terminal, terminal.ports[0]) };
}

function endpoint(component, port) {
  return { componentId: component.id, portId: port.id };
}

function endpointClientPoint(project, endpointValue, camera) {
  const position = floorPortTransform(project, endpointValue.componentId, endpointValue.portId).positionMm;
  const viewX = position.x / 10;
  const viewY = position.y / 10;
  const scale = Math.min(rect.width / camera.width, rect.height / camera.height);
  const originX = rect.left + (rect.width - camera.width * scale) / 2;
  const originY = rect.top + (rect.height - camera.height * scale) / 2;
  return { x: originX + (viewX - camera.x) * scale, y: originY + (viewY - camera.y) * scale };
}
