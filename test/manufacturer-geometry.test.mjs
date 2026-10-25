import assert from "node:assert/strict";
import test from "node:test";

import { applyCommand, createProject, deserializeProject, floorPortTransform, identityQuaternion, knownMm, serializeProject, unknownMm } from "../src/domain/spatial.mjs";
import { createCatalogueComponent } from "../src/editor/component-catalogue.mjs";
import {
  MANUFACTURER_ASSET_IMPORT_REQUIREMENTS,
  MANUFACTURER_GEOMETRY_CONTRACT_VERSION,
  describeComponentGeometry,
  resolveManufacturerGeometryAsset,
} from "../src/editor/manufacturer-geometry.mjs";
import { createThreeDDrawingScene, renderThreeDDrawingSvg } from "../src/sheets/three-d-drawing.mjs";

test("manufacturer geometry exposes only pinned source-backed envelopes and saved typed ports", () => {
  let project = projectWithFloor();
  const q350 = createCatalogueComponent("zehnder-q350-hrv-left-drawing-profile", {
    id: "q350",
    floorId: "ground",
    xMm: 1000,
    yMm: 2000,
  });
  q350.positionMm.z = knownMm(2100, "measured base elevation");
  project = applyCommand(project, { type: "component.add", component: q350 });

  const geometry = describeComponentGeometry(project, project.components[0]);
  assert.equal(geometry.contractVersion, MANUFACTURER_GEOMETRY_CONTRACT_VERSION);
  assert.deepEqual(geometry.dimensions, { widthMm: 725, depthMm: 570, heightMm: 745 });
  assert.equal(geometry.evidenceState, "source-backed-envelope");
  assert.equal(geometry.solid, true);
  assert.equal(geometry.ports.length, 4);
  assert.ok(geometry.ports.every((port) => port.zMm === 2100));
  assert.equal(Object.isFrozen(geometry.ports), true);
});

test("unknown physical dimensions remain an explicit wireframe placeholder", () => {
  let project = projectWithFloor();
  const component = {
    id: "unknown-equipment",
    floorId: "ground",
    displayName: "Unverified equipment",
    catalogueItemId: "unverified",
    catalogueRecordVersionId: "unverified.v1",
    catalogueSnapshot: { recordId: "unverified", recordVersionId: "unverified.v1", dimensions: { unit: "mm", body: null }, ports: [] },
    positionMm: { x: 0, y: 0, z: unknownMm("height not measured") },
    orientation: identityQuaternion(),
    displaySymbol: { shape: "box", widthMm: 400, heightMm: 300 },
    ports: [],
  };
  project = applyCommand(project, { type: "component.add", component });
  const geometry = describeComponentGeometry(project, project.components[0]);
  assert.equal(geometry.evidenceState, "unknown-placeholder");
  assert.equal(geometry.solid, false);
  assert.equal(geometry.dimensions.heightMm, null);
  assert.match(geometry.evidenceSource, /display-only/);
});

test("native BIM integration contract requires neutral geometry, declared units and connector metadata", () => {
  assert.match(MANUFACTURER_ASSET_IMPORT_REQUIREMENTS.geometry, /IFC 4/);
  assert.match(MANUFACTURER_ASSET_IMPORT_REQUIREMENTS.units, /no unit may be inferred/i);
  assert.match(MANUFACTURER_ASSET_IMPORT_REQUIREMENTS.connectors, /XYZ/);
  assert.match(MANUFACTURER_ASSET_IMPORT_REQUIREMENTS.evidenceBoundary, /not geometry/);
});

test("exact German Q350 article binds its reviewed IFC4 mesh without promoting the export article", () => {
  let project = projectWithFloor();
  const german = createCatalogueComponent("zehnder-q350-de-hrv-left-bim-profile", {
    id: "q350-de",
    floorId: "ground",
    xMm: 1400,
    yMm: 1900,
  });
  german.positionMm.z = knownMm(1200, "measured base elevation");
  project = applyCommand(project, { type: "component.add", component: german });
  const geometry = describeComponentGeometry(project, project.components[0]);
  assert.equal(geometry.manufacturerAsset.assetId, "q350-de-hrv-left");
  assert.equal(geometry.manufacturerAsset.manufacturerArticle, "471502009");
  assert.equal(geometry.manufacturerAsset.source.format, "IFC4");
  assert.equal(geometry.manufacturerAsset.source.units, "mm");
  assert.equal(geometry.manufacturerAsset.meshSets.length, 20);
  assert.equal(geometry.manufacturerAsset.faceCount, 2619);
  assert.deepEqual(geometry.manufacturerAsset.boundsMm.min, [-400, -295, 0]);
  assert.equal(geometry.ports.find((port) => port.stream === "supply").zMm, 2050);

  const scene = createThreeDDrawingScene(project, "ground");
  const svg = renderThreeDDrawingSvg(scene);
  assert.match(svg, /data-manufacturer-geometry="q350-de-hrv-left"/);
  assert.match(svg, /data-manufacturer-article="471502009"/);
  assert.ok((svg.match(/<polygon /g) ?? []).length > 2500);

  const reopened = deserializeProject(serializeProject(project));
  assert.equal(resolveManufacturerGeometryAsset(reopened.components[0]).assetId, "q350-de-hrv-left");
  const beforePort = floorPortTransform(reopened, "q350-de", "q350-de-port-left-front").positionMm;
  const rotated = applyCommand(reopened, { type: "component.rotateFloorZ", componentId: "q350-de", angleRad: Math.PI / 2 });
  const afterPort = floorPortTransform(rotated, "q350-de", "q350-de-port-left-front").positionMm;
  assert.notDeepEqual(afterPort, beforePort);
  assert.notEqual(renderThreeDDrawingSvg(createThreeDDrawingScene(rotated, "ground")), svg);

  const exportArticle = createCatalogueComponent("zehnder-q350-hrv-left-drawing-profile", {
    id: "q350-export",
    floorId: "ground",
    xMm: 0,
    yMm: 0,
  });
  assert.equal(resolveManufacturerGeometryAsset(exportArticle), null);
});

test("German Q450 retains its reviewed connector conflict instead of pretending to be DN160", () => {
  const component = createCatalogueComponent("zehnder-q450-de-erv-right-bim-profile", {
    id: "q450-de",
    floorId: "ground",
    xMm: 0,
    yMm: 0,
  });
  assert.equal(component.catalogueSnapshot.manufacturerArticle, "471502012");
  assert.ok(component.ports.every((port) => port.interface.nominalSizeMm === 180));
  assert.ok(component.ports.every((port) => port.interface.outsideDiameterMm === 200));
  assert.equal(component.catalogueSnapshot.connectionSetout.routable, false);
  assert.match(component.catalogueSnapshot.connectionSetout.note, /conflicting/i);
  component.positionMm.z = knownMm(950, "measured base elevation");
  const project = applyCommand(projectWithFloor(), { type: "component.add", component });
  const svg = renderThreeDDrawingSvg(createThreeDDrawingScene(project, "ground"));
  assert.match(svg, /data-manufacturer-geometry="q450-de-erv-right"/);
  assert.match(svg, /data-manufacturer-article="471502012"/);
});

test("all eight supplied German hand and recovery variants bind only their exact article asset", () => {
  const articles = { "350-hrv": "471502009", "350-erv": "471502010", "450-hrv": "471502011", "450-erv": "471502012" };
  for (const size of ["350", "450"]) for (const type of ["hrv", "erv"]) for (const handing of ["left", "right"]) {
    const component = createCatalogueComponent(`zehnder-q${size}-de-${type}-${handing}-bim-profile`, {
      id: `q${size}-${type}-${handing}`,
      floorId: "ground",
      xMm: 0,
      yMm: 0,
    });
    const asset = resolveManufacturerGeometryAsset(component);
    assert.equal(asset.assetId, `q${size}-de-${type}-${handing}`);
    assert.equal(asset.manufacturerArticle, articles[`${size}-${type}`]);
    assert.equal(asset.distributionPortCount, 7);
    assert.equal(asset.distributionPorts.filter((port) => port.predefinedType === "DUCT").length, 4);
  }
});

function projectWithFloor() {
  const project = createProject("manufacturer-geometry");
  project.floors.push({
    id: "ground",
    name: "Ground",
    transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "ground datum") }, orientation: identityQuaternion() },
  });
  return project;
}
