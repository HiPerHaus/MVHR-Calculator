import assert from "node:assert/strict";
import test from "node:test";

import {
  pickRouteAtClientPoint,
  ROUTE_PICK_TOLERANCE_CSS_PX,
} from "../src/editor/route-picker.mjs";

const route = {
  id: "route-pickable",
  points: [{ x: 1000, y: 2000 }, { x: 9000, y: 2000 }],
};
const rect = { left: 20, top: 40, width: 1000, height: 600 };

test("route picking keeps a twelve-pixel tolerance at different camera zoom levels", () => {
  for (const camera of [
    { x: 0, y: 0, width: 1000, height: 600 },
    { x: 250, y: 100, width: 500, height: 300 },
    { x: -500, y: -300, width: 2000, height: 1200 },
  ]) {
    const midpointView = { x: 500, y: 200 };
    const midpointClient = {
      x: rect.left + ((midpointView.x - camera.x) / camera.width) * rect.width,
      y: rect.top + ((midpointView.y - camera.y) / camera.height) * rect.height,
    };
    const hit = pickRouteAtClientPoint([route], camera, rect, {
      x: midpointClient.x,
      y: midpointClient.y + ROUTE_PICK_TOLERANCE_CSS_PX - 0.25,
    });
    assert.equal(hit.routeId, route.id);
    assert.ok(hit.distancePx < ROUTE_PICK_TOLERANCE_CSS_PX);
    assert.equal(pickRouteAtClientPoint([route], camera, rect, {
      x: midpointClient.x,
      y: midpointClient.y + ROUTE_PICK_TOLERANCE_CSS_PX + 0.25,
    }), null);
  }
});

test("route picking selects the nearest eligible centreline", () => {
  const camera = { x: 0, y: 0, width: 1000, height: 600 };
  const nearby = { id: "route-nearby", points: [{ x: 1000, y: 2100 }, { x: 9000, y: 2100 }] };
  const hit = pickRouteAtClientPoint([route, nearby], camera, rect, { x: 500, y: 247 });
  assert.equal(hit.routeId, nearby.id);
});

test("route picking can follow the derived visual sweep instead of the saved control polygon", () => {
  const camera = { x: 0, y: 0, width: 1000, height: 600 };
  const controlRoute = {
    id: "route-curved",
    points: [{ x: 1000, y: 1000 }, { x: 5000, y: 1000 }, { x: 5000, y: 5000 }],
  };
  const visualSweep = [
    { x: 1000, y: 1000 },
    { x: 4000, y: 1000 },
    { x: 4750, y: 1250 },
    { x: 5000, y: 2000 },
    { x: 5000, y: 5000 },
  ];
  const clientPoint = { x: rect.left + 475, y: rect.top + 125 };
  assert.equal(pickRouteAtClientPoint([controlRoute], camera, rect, clientPoint), null);
  const hit = pickRouteAtClientPoint([controlRoute], camera, rect, clientPoint, {
    pointsForRoute: () => visualSweep,
  });
  assert.equal(hit.routeId, controlRoute.id);
});
