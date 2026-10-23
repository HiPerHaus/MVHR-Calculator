import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveDuctBodyGeometry,
  deriveSweptCentreline,
  deriveRigidEppCentreline,
  ductBodyDisplayLabel,
  TWIN_JOIN_MITER_LIMIT,
} from "../src/editor/duct-body-geometry.mjs";

test("single duct bodies use outside diameter when known and never mutate route authority", () => {
  const route = syntheticRoute({
    parallelRunCount: 1,
    connectionInterface: { nominalSizeMm: 160, outsideDiameterMm: 190 },
  });
  const before = structuredClone(route);
  const geometry = deriveDuctBodyGeometry(route, family(160));

  assert.equal(geometry.arrangement, "single");
  assert.equal(geometry.scaled, true);
  assert.equal(geometry.diameterMm, 190);
  assert.equal(geometry.diameterBasis, "outside");
  assert.equal(geometry.lanes.length, 1);
  assert.deepEqual(geometry.lanes[0][0], { x: 0, y: 0 });
  assert.deepEqual(geometry.lanes[0].at(-1), { x: 4000, y: 3000 });
  assert.deepEqual(route, before);
  assert.match(ductBodyDisplayLabel(geometry), /known outside diameter/);
});

test("nominal-only and unknown diameters remain explicitly distinguished", () => {
  const nominal = deriveDuctBodyGeometry(syntheticRoute({ parallelRunCount: 1 }), family(90));
  assert.equal(nominal.diameterMm, 90);
  assert.equal(nominal.diameterBasis, "nominal");
  assert.match(ductBodyDisplayLabel(nominal), /not an outside envelope/);

  const unknown = deriveDuctBodyGeometry(syntheticRoute({
    ductKind: "generic-duct",
    parallelRunCount: null,
  }), { id: "generic-duct", connectionInterface: null });
  assert.equal(unknown.scaled, false);
  assert.equal(unknown.diameterMm, null);
  assert.equal(unknown.arrangement, "unset");
  assert.match(ductBodyDisplayLabel(unknown), /Diameter unknown/);
});

test("bounded quadratic sweeps preserve endpoints without angular corner geometry", () => {
  const controlPoints = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 1000 },
  ];
  const sweep = deriveSweptCentreline(controlPoints);
  assert.deepEqual(sweep.points[0], controlPoints[0]);
  assert.deepEqual(sweep.points.at(-1), controlPoints.at(-1));
  assert.ok(sweep.points.length > controlPoints.length, "the displayed sweep is sampled geometry, not a rounded polyline join");
  assert.ok(sweep.points.every((point) => point.x >= 0 && point.x <= 1000 && point.y >= 0 && point.y <= 1000));
  assert.ok(sweep.visualSweepLengthMm < sweep.authoritativePolylineLengthMm);
  assert.equal(sweep.fallbackCornerCount, 0);
});

test("Twin bodies follow parallel sweeps and converge to one typed endpoint", () => {
  const geometry = deriveDuctBodyGeometry(syntheticRoute({ parallelRunCount: 2 }), family(160));
  assert.equal(geometry.lanes.length, 2);
  assert.deepEqual(geometry.lanes[0][0], { x: 0, y: 0 });
  assert.deepEqual(geometry.lanes[1][0], { x: 0, y: 0 });
  assert.deepEqual(geometry.lanes[0].at(-1), { x: 4000, y: 3000 });
  assert.deepEqual(geometry.lanes[1].at(-1), { x: 4000, y: 3000 });
  const middle = Math.floor(geometry.lanes[0].length / 2);
  const separation = Math.hypot(
    geometry.lanes[0][middle].x - geometry.lanes[1][middle].x,
    geometry.lanes[0][middle].y - geometry.lanes[1][middle].y,
  );
  assert.ok(separation > geometry.diameterMm, "parallel bodies are visually distinct");
  assert.equal(geometry.endpointPresentation, "lanes-converge-to-one-authoritative-endpoint");
  assert.match(ductBodyDisplayLabel(geometry), /schematic/);
});

test("short segments still show Twin separation while sharp reversals avoid loops and non-finite offsets", () => {
  const short = deriveDuctBodyGeometry({
    ...syntheticRoute({ parallelRunCount: 2 }),
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
  }, family(160));
  assert.ok(short.lanes[0].length >= 3);
  assert.deepEqual(short.lanes[0][0], short.lanes[1][0]);
  assert.deepEqual(short.lanes[0].at(-1), short.lanes[1].at(-1));
  const middle = Math.floor(short.lanes[0].length / 2);
  assert.notDeepEqual(short.lanes[0][middle], short.lanes[1][middle]);

  const reversal = deriveDuctBodyGeometry({
    ...syntheticRoute({ parallelRunCount: 2 }),
    points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 0 }],
  }, family(90));
  assert.equal(reversal.fallbackCornerCount, 1);
  for (const lane of reversal.lanes) {
    assert.ok(lane.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  }
});

test("tight sweep offsets stay miter-bounded and independent crossing routes do not create connections", () => {
  const route = {
    ...syntheticRoute({ parallelRunCount: 2 }),
    points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 30, y: 80 }, { x: 1000, y: 160 }],
  };
  const geometry = deriveDuctBodyGeometry(route, family(90));
  const maximumOffset = geometry.laneCentreOffsetMm * TWIN_JOIN_MITER_LIMIT + 1e-6;
  for (let laneIndex = 0; laneIndex < geometry.lanes.length; laneIndex += 1) {
    for (let index = 0; index < geometry.lanes[laneIndex].length; index += 1) {
      const offset = Math.hypot(
        geometry.lanes[laneIndex][index].x - geometry.sampledCentreline[index].x,
        geometry.lanes[laneIndex][index].y - geometry.sampledCentreline[index].y,
      );
      assert.ok(offset <= maximumOffset);
    }
  }
  const crossing = deriveDuctBodyGeometry({
    ...syntheticRoute({ parallelRunCount: 1 }),
    id: "route-crossing",
    points: [{ x: 500, y: -500 }, { x: 500, y: 500 }],
  }, family(90));
  assert.equal(crossing.lanes.length, 1);
  assert.equal(Object.hasOwn(crossing, "connections"), false);
  assert.equal(Object.hasOwn(geometry, "connections"), false);
});

function syntheticRoute(overrides = {}) {
  return {
    id: "route-render",
    ductKind: "epp-rigid-dn160",
    parallelRunCount: 1,
    connectionInterface: null,
    startAttachment: { componentId: "component-a", portId: "port-a" },
    endAttachment: { componentId: "component-b", portId: "port-b" },
    points: [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
      { x: 4000, y: 3000 },
    ],
    ...overrides,
  };
}

function family(nominalSizeMm) {
  return {
    id: `family-${nominalSizeMm}`,
    connectionInterface: {
      nominalSizeMm,
      outsideDiameterMm: null,
    },
  };
}


test("rigid EPP has straight legs, localized circular elbows and socket joint marks", () => {
  const points = [{x:0,y:0},{x:3000,y:0},{x:3000,y:3000}];
  const geometry = deriveDuctBodyGeometry(syntheticRoute({points}),family(160));
  assert.equal(geometry.rigidEpp,true);
  const elbow = geometry.elbows[0];
  assert.equal(elbow.angleDegrees,90);
  assert.equal(elbow.radiusMm,160);
  assert.equal(elbow.seams.length,2);
  assert.equal(elbow.fixedSleeve,false);
  assert.equal(elbow.endStyle,"plain");
  assert.ok(elbow.halfCutGuide);
  assert.deepEqual(elbow.entry,{x:2840,y:0});
  assert.ok(Math.abs(elbow.exit.x-3000)<1e-6);
  assert.deepEqual(geometry.sampledCentreline[1],elbow.entry);
  assert.deepEqual(geometry.sampledCentreline.at(-1),points.at(-1));
  const half = deriveRigidEppCentreline([{x:0,y:0},{x:3000,y:0},{x:5000,y:2000}],160);
  assert.equal(half.elbows[0].angleDegrees,45);
  assert.equal(half.elbows[0].radiusMm,elbow.radiusMm);
  assert.equal(half.elbows[0].seams.length,2);
  assert.equal(half.elbows[0].halfCutGuide,null);
  assert.equal(half.elbows[0].fixedSleeve,false);
});

test("short EPP legs and unsupported angles stay visible for review instead of distorting runs", () => {
  const short = deriveRigidEppCentreline([{x:0,y:0},{x:100,y:0},{x:100,y:100}],160);
  assert.equal(short.fallbackCornerCount,1);
  assert.equal(short.elbows[0].drawable,false);
  assert.equal(short.points.length,3);
  const other = deriveRigidEppCentreline([{x:0,y:0},{x:1000,y:0},{x:1200,y:1000}],160);
  assert.equal(other.elbows[0].drawable,false);
});
