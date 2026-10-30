import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCommand,
  createProject,
  identityQuaternion,
  knownMm,
  unknownMm,
} from "../src/domain/spatial.mjs";
import { deriveRoomBoundaries, deriveZoneBoundaries } from "../src/domain/rooms.mjs";
import { planSnappedWallChain } from "../src/editor/wall-snap.mjs";
import { createA3SheetModel, renderA3SheetSvg } from "../src/sheets/a3-sheet.mjs";
import { createA4PartsListPages, renderA4PartsListSvg } from "../src/sheets/a4-parts-list.mjs";

test("drawing keys use only the selected floor's closed outline area", () => {
  let project = projectWithFloors();
  project = addOutline(project, "floor-ground", "ground-area", [[0, 0], [6000, 0], [6000, 4000], [0, 4000]]);
  project = addOutline(project, "floor-upper", "upper-area", [[0, 0], [4000, 0], [4000, 3000], [0, 3000]]);

  const ground = createA3SheetModel(project, metadata("floor-ground"));
  const upper = createA3SheetModel(project, metadata("floor-upper"));
  assert.deepEqual(areaEvidence(ground), {
    status: "known",
    source: "floor-outline",
    areaMm2: 24_000_000,
    areaM2: 24,
    outlineId: "ground-area",
  });
  assert.equal(upper.printScene.floorArea.areaM2, 12);
  assert.equal(upper.printScene.floorArea.outlineId, "upper-area");

  const a3 = renderA3SheetSvg(ground);
  const [page] = createA4PartsListPages(ground);
  const a4 = renderA4PartsListSvg(ground, page);
  for (const svg of [a3, a4]) {
    assert.match(svg, /data-kind="floor-area-key"/u);
    assert.match(svg, /Floor area · 24 m²/u);
    assert.match(svg, /Preliminary closed-plan outline/u);
    assert.doesNotMatch(svg, /12 m²/u);
  }
});

test("an uncalibrated plan image without spatial area stays Not set, never zero", () => {
  let project = applyCommand(createProject("sheet-area-missing"), {
    type: "floor.add",
    floor: floor("floor-ground", "Ground Floor", 0),
  });
  project = applyCommand(project, {
    type: "reference.addImage",
    asset: {
      id: "unscaled-plan-asset",
      kind: "image",
      fileName: "unscaled-plan.png",
      mediaType: "image/png",
      byteLength: 3,
      sha256: "0".repeat(64),
      widthPx: 1000,
      heightPx: 500,
      dataUrl: "data:image/png;base64,AAAA",
    },
    reference: {
      id: "unscaled-plan",
      floorId: "floor-ground",
      assetId: "unscaled-plan-asset",
      visible: true,
      locked: true,
      opacity: 0.55,
      transform: {
        translationMm: { x: 0, y: 0 },
        rotationRad: 0,
        scaleMmPerPixel: unknownMm("not calibrated"),
      },
      calibration: null,
    },
  });

  const sheet = createA3SheetModel(project, metadata("floor-ground"));
  assert.equal(sheet.printScene.floorArea.status, "not-set");
  assert.equal(sheet.printScene.floorArea.areaMm2, null);
  const a3 = renderA3SheetSvg(sheet);
  const [page] = createA4PartsListPages(sheet);
  const a4 = renderA4PartsListSvg(sheet, page);
  for (const svg of [a3, a4]) {
    assert.match(svg, /Floor area · Not set/u);
    assert.match(svg, /No closed floor-area outline or confirmed rooms/u);
    assert.doesNotMatch(svg, /Floor area · 0(?:\.0+)? m²/u);
  }
});

test("confirmed rooms provide an explicitly labelled subtotal without counting zones", () => {
  let project = applyCommand(createProject("sheet-room-area"), {
    type: "floor.add",
    floor: floor("floor-ground", "Ground Floor", 0),
  });
  project = applyCommand(project, {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["node-a", "node-b", "node-c", "node-d", "node-a"],
    wallIds: ["wall-a-b", "wall-b-c", "wall-c-d", "wall-d-a"],
    points: [[0, 0], [6000, 0], [6000, 4000], [0, 4000], [0, 0]].map(([x, y]) => ({ x, y, z: unknownMm("not measured") })),
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("not measured"),
    referenceLine: "centreline",
    classification: "physical",
  });
  const candidate = deriveRoomBoundaries(project, "floor-ground").candidates[0];
  project = applyCommand(project, {
    type: "room.createFromBoundary",
    roomId: "room-ground",
    floorId: "floor-ground",
    boundaryKey: candidate.key,
    name: "Living",
    use: "living",
    ventilationRole: "supply",
  });
  project = applyCommand(project, planSnappedWallChain(project, {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["divider-bottom", "divider-top"],
    wallIds: ["divider-main"],
    points: [[3000, 0], [3000, 4000]].map(([x, y]) => ({ x, y, z: unknownMm("not measured") })),
    splits: [],
    thicknessMm: 20,
    heightMm: unknownMm("not measured"),
    referenceLine: "centreline",
    classification: "virtual",
    parentRoomId: "room-ground",
  }, { idPrefix: "divider-main-snap" }));
  const zoneCandidates = deriveZoneBoundaries(project, "room-ground").candidates;
  assert.equal(zoneCandidates.length, 2);
  for (const [index, zoneCandidate] of zoneCandidates.entries()) {
    project = applyCommand(project, {
      type: "zone.createFromBoundary",
      zoneId: `zone-${index + 1}`,
      parentRoomId: "room-ground",
      boundaryKey: zoneCandidate.key,
      name: index === 0 ? "Kitchen" : "Dining",
      use: index === 0 ? "kitchen" : "dining",
      ventilationRole: index === 0 ? "extract" : "supply",
    });
  }

  const sheet = createA3SheetModel(project, metadata("floor-ground"));
  assert.equal(project.zones.length, 2);
  assert.equal(sheet.printScene.floorArea.source, "confirmed-rooms");
  assert.equal(sheet.printScene.floorArea.areaM2, 24);
  assert.equal(sheet.printScene.floorArea.roomCount, 1);
  assert.equal(sheet.printScene.floorArea.unresolvedRoomCount, 0);
  const svg = renderA3SheetSvg(sheet);
  assert.match(svg, /Known room area · 24 m²/u);
  assert.match(svg, /1 confirmed wall-face room/u);
});

function projectWithFloors() {
  let project = createProject("sheet-floor-area");
  project = applyCommand(project, { type: "floor.add", floor: floor("floor-ground", "Ground Floor", 0) });
  return applyCommand(project, { type: "floor.add", floor: floor("floor-upper", "Upper Floor", 3000) });
}

function floor(id, name, elevationMm) {
  return {
    id,
    name,
    transform: {
      translationMm: { x: 0, y: 0, z: knownMm(elevationMm, "sheet area test") },
      orientation: identityQuaternion(),
    },
  };
}

function addOutline(project, floorId, id, points) {
  return applyCommand(project, {
    type: "floorArea.create",
    outline: {
      id,
      floorId,
      name: `${floorId} floor area`,
      geometrySource: "manual-floor-area-outline",
      purpose: "preliminary-quoting",
      areaConvention: "closed-plan-outline",
      measurementBasis: "floor-local-plan-mm",
      vertices: points.map(([x, y], index) => ({
        id: `${id}-vertex-${index + 1}`,
        positionMm: { x, y, z: knownMm(0, "floor-local plan") },
      })),
      holes: [],
    },
  });
}

function metadata(floorId) {
  return {
    includeSchedule: false,
    floorId,
    orientation: "landscape",
    projectName: "Floor area drawing",
    siteName: "Test site",
    clientName: "Not set",
    drawingTitle: "MVHR Plan",
    drawingId: "HS-AREA-001",
    issueDate: "2026-10-30",
    status: "Preliminary — not for construction",
    revision: "DRAFT",
    revisionText: "Working-draft preview",
    drawnBy: "",
    checkedBy: "",
  };
}

function areaEvidence(sheet) {
  const { status, source, areaMm2, areaM2, outlineId } = sheet.printScene.floorArea;
  return { status, source, areaMm2, areaM2, outlineId };
}
