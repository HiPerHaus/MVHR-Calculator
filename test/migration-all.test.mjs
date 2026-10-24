import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SCHEMA_VERSION,
  applyCommand,
  createProject,
  identityQuaternion,
  knownMm,
  unknownMm,
} from "../src/domain/spatial.mjs";
import {
  bytesToDataUrl,
  importPortableProject,
  PORTABLE_FORMAT,
  PORTABLE_PACKAGE_VERSION,
  sha256Hex,
} from "../src/persistence/portable-project.mjs";
import {
  createDxfReferenceRecords,
  inspectAsciiDxf,
} from "../src/import/dxf-reference.mjs";

const FIXED_TIME = "2026-10-15T23:00:00.000Z";

test("portable migration from every schema preserves every field available in that schema", async () => {
  const current = await completeCurrentProject();
  for (let schemaVersion = 1; schemaVersion <= SCHEMA_VERSION; schemaVersion += 1) {
    const legacy = toSchemaVersion(current, schemaVersion);
    const opened = await importPortableProject(JSON.stringify({
      format: PORTABLE_FORMAT,
      packageVersion: PORTABLE_PACKAGE_VERSION,
      exportedAtUtc: FIXED_TIME,
      projectJson: JSON.stringify(legacy),
    }));
    const migrated = opened.project;

    assert.equal(opened.migration.fromSchemaVersion, schemaVersion);
    assert.equal(opened.migration.toSchemaVersion, SCHEMA_VERSION);
    assert.equal(opened.migration.migrated, schemaVersion !== SCHEMA_VERSION);
    assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(migrated.floors, current.floors, `schema ${schemaVersion} floors`);
    assert.deepEqual(migrated.wallNodes, current.wallNodes, `schema ${schemaVersion} wall nodes`);
    assert.deepEqual(migrated.walls, current.walls, `schema ${schemaVersion} walls`);
    assert.deepEqual(migrated.components, current.components, `schema ${schemaVersion} components`);
    assert.deepEqual(migrated.equipmentAssemblies, [], `schema ${schemaVersion} equipment assemblies`);
    assert.deepEqual(migrated.connections, current.connections, `schema ${schemaVersion} connections`);
    assert.deepEqual(migrated.routes[0].points, current.routes[0].points, `schema ${schemaVersion} route geometry`);
    assert.equal(migrated.routes[0].role, null);
    assert.equal(migrated.routes[0].startAttachment, null);
    assert.equal(migrated.routes[0].endAttachment, null);
    assert.equal(migrated.routes[0].ductKind, "generic-duct");
    assert.equal(migrated.routes[0].parallelRunCount, null);

    if (schemaVersion === 1) {
      assert.deepEqual(migrated.referenceAssets, []);
      assert.deepEqual(migrated.floorReferences, []);
    } else {
      assert.deepEqual(migrated.referenceAssets, current.referenceAssets, `schema ${schemaVersion} image source`);
      assert.equal(migrated.floorReferences[0].transform.scaleMmPerPixel.valueMm, 10);
      assert.equal(migrated.floorReferences[0].calibration.knownDistanceMm, 10000);
      assert.equal(migrated.floorReferences[0].calibration.modelScaleMode, "reference-only");
      assert.equal(migrated.floorReferences[0].calibration.modelScaleFactor, 1);
      assert.equal(migrated.floorReferences[0].cropSourceRectPx, null);
    }

    if (schemaVersion < 6) {
      assert.deepEqual(migrated.cadReferenceAssets, []);
      assert.deepEqual(migrated.floorCadReferences, []);
    } else {
      assert.deepEqual(migrated.cadReferenceAssets, current.cadReferenceAssets);
      assert.deepEqual(migrated.floorCadReferences, current.floorCadReferences);
    }
    assert.deepEqual(migrated.rooms, [], `schema ${schemaVersion} rooms`);
    assert.deepEqual(migrated.zones, [], `schema ${schemaVersion} zones`);
    assert.deepEqual(
      migrated.floorAreaOutlines,
      schemaVersion < 10 ? [] : current.floorAreaOutlines,
      `schema ${schemaVersion} floor area outlines`,
    );
    assert.equal(
      migrated.workflow.stage,
      schemaVersion < 15 ? "preliminary-layout" : current.workflow.stage,
      `schema ${schemaVersion} inferred workflow stage`,
    );
    assert.deepEqual(migrated.quoteDraft, current.quoteDraft);
    assert.deepEqual(migrated.quoteSnapshots, []);
    for (const field of ["tenantId", "companyId", "entitlement", "approvalState", "issueRevision"]) {
      assert.equal(Object.hasOwn(migrated, field), false);
    }
  }
});

async function completeCurrentProject() {
  let project = applyCommand(createProject("project-all-schema-migrations"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Synthetic Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "migration fixture datum") },
        orientation: identityQuaternion(),
      },
    },
  });
  project = applyCommand(project, {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["node-a", "node-b"],
    wallIds: ["wall-a-b"],
    points: [
      { x: 0, y: 0, z: unknownMm("migration wall base") },
      { x: 4000, y: 0, z: unknownMm("migration wall base") },
    ],
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("migration wall height"),
    referenceLine: "centreline",
    classification: "physical",
  });
  project = applyCommand(project, {
    type: "floorArea.create",
    outline: {
      id: "floor-area-ground",
      floorId: "floor-ground",
      name: "Preliminary ground-floor footprint",
      geometrySource: "manual-floor-area-outline",
      purpose: "preliminary-quoting",
      areaConvention: "closed-plan-outline",
      measurementBasis: "floor-local-plan-mm",
      vertices: [
        { id: "floor-area-a", positionMm: { x: 0, y: 0, z: knownMm(0, "migration floor plan") } },
        { id: "floor-area-b", positionMm: { x: 8000, y: 0, z: knownMm(0, "migration floor plan") } },
        { id: "floor-area-c", positionMm: { x: 8000, y: 5000, z: knownMm(0, "migration floor plan") } },
        { id: "floor-area-d", positionMm: { x: 0, y: 5000, z: knownMm(0, "migration floor plan") } },
      ],
      holes: [],
    },
  });
  project = applyCommand(project, {
    type: "component.add",
    component: {
      id: "component-migration",
      floorId: "floor-ground",
      positionMm: { x: 1000, y: 1000, z: unknownMm("migration component height") },
      orientation: identityQuaternion(),
      ports: [],
    },
  });
  project = applyCommand(project, {
    type: "route.add",
    route: {
      id: "route-migration",
      floorId: "floor-ground",
      system: "mvhr",
      stream: "supply",
      role: null,
      ductKind: "generic-duct",
      startAttachment: null,
      endAttachment: null,
      points: [
        { x: 500, y: 500, z: knownMm(0, "migration route datum") },
        { x: 3000, y: 2500, z: unknownMm("migration route rise") },
      ],
    },
  });
  const png = syntheticPngHeader(1001, 501);
  project = applyCommand(project, {
    type: "reference.addImage",
    asset: {
      id: "image-asset-migration",
      kind: "image",
      fileName: "synthetic-migration.png",
      mediaType: "image/png",
      byteLength: png.byteLength,
      sha256: await sha256Hex(png),
      widthPx: 1001,
      heightPx: 501,
      dataUrl: bytesToDataUrl(png, "image/png"),
    },
    reference: {
      id: "image-reference-migration",
      floorId: "floor-ground",
      assetId: "image-asset-migration",
      visible: true,
      locked: true,
      opacity: 0.5,
      transform: {
        translationMm: { x: 100, y: 200 },
        rotationRad: 0,
        scaleMmPerPixel: unknownMm("migration image uncalibrated"),
      },
      calibration: null,
    },
  });
  project = applyCommand(project, {
    type: "reference.calibrate",
    referenceId: "image-reference-migration",
    sourcePointApx: { x: 0, y: 0 },
    sourcePointBpx: { x: 1000, y: 0 },
    knownDistanceMm: 10000,
    inputUnit: "m",
    acceptedAtUtc: FIXED_TIME,
    previewScaleMmPerPixel: 10,
    rescaleFloorModel: false,
  });
  const dxfText = await readFile(new URL("./fixtures/dxf/supported-ac1015.dxf", import.meta.url), "utf8");
  const candidate = await inspectAsciiDxf(dxfText, { fileName: "supported-ac1015.dxf" });
  const records = createDxfReferenceRecords(candidate, {
    assetId: "cad-asset-migration",
    referenceId: "cad-reference-migration",
    floorId: "floor-ground",
    includedLayers: ["WALLS"],
    unitChoice: "mm",
    transform: {
      localOriginSource: { x: 0, y: 0 },
      translationMm: { x: 500, y: 600 },
      rotationRad: 0,
    },
    visible: true,
    opacity: 0.45,
    acceptPartial: false,
  });
  return applyCommand(project, { type: "reference.addCad", ...records });
}

function toSchemaVersion(current, schemaVersion) {
  const legacy = structuredClone(current);
  legacy.schemaVersion = schemaVersion;
  if (schemaVersion < 20) delete legacy.projectDetails;
  if (schemaVersion < 19) {
    for (const reference of legacy.floorReferences) delete reference.cropSourceRectPx;
  }
  if (schemaVersion < 18) delete legacy.engineeringInputs;
  if (schemaVersion < 17) {
    for (const room of legacy.rooms) delete room.airflowTargets;
    for (const zone of legacy.zones) delete zone.airflowTargets;
  }
  if (schemaVersion < 15) {
    delete legacy.workflow;
    delete legacy.quoteDraft;
    delete legacy.quoteSnapshots;
  }
  if (schemaVersion < 14) {
    for (const route of legacy.routes) delete route.parallelRunCount;
  }
  if (schemaVersion < 12) delete legacy.equipmentAssemblies;
  if (schemaVersion < 11) {
    for (const component of legacy.components) delete component.ductRunCount;
  }
  if (schemaVersion < 10) delete legacy.floorAreaOutlines;
  if (schemaVersion < 9) delete legacy.zones;
  if (schemaVersion < 7) delete legacy.rooms;
  if (schemaVersion < 6) {
    delete legacy.cadReferenceAssets;
    delete legacy.floorCadReferences;
  }
  if (schemaVersion < 5) {
    for (const route of legacy.routes) delete route.ductKind;
  }
  if (schemaVersion < 4) {
    for (const route of legacy.routes) {
      delete route.role;
      delete route.startAttachment;
      delete route.endAttachment;
    }
  }
  if (schemaVersion < 3) {
    for (const reference of legacy.floorReferences) {
      if (reference.calibration) {
        delete reference.calibration.modelScaleMode;
        delete reference.calibration.modelScaleFactor;
      }
    }
  }
  if (schemaVersion < 2) {
    delete legacy.referenceAssets;
    delete legacy.floorReferences;
  }
  return legacy;
}

function syntheticPngHeader(widthPx, heightPx) {
  const bytes = new Uint8Array(45);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, widthPx);
  view.setUint32(20, heightPx);
  bytes.set([8, 6, 0, 0, 0], 24);
  bytes.set([0x49, 0x45, 0x4e, 0x44], 37);
  return bytes;
}
