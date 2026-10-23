import assert from "node:assert/strict";
import test from "node:test";

import {
  clientPointToCamera,
  createCamera,
  fitCameraToBounds,
  panCamera,
  zoomCameraAt,
} from "../src/editor/camera.mjs";

test("zoom keeps the selected world anchor fixed", () => {
  const camera = createCamera();
  const anchor = { x: 300, y: 200 };
  const zoomed = zoomCameraAt(camera, anchor, 0.5);

  assert.deepEqual(zoomed, { x: 150, y: 100, width: 600, height: 400 });
  const beforeRatio = {
    x: (anchor.x - camera.x) / camera.width,
    y: (anchor.y - camera.y) / camera.height,
  };
  const afterRatio = {
    x: (anchor.x - zoomed.x) / zoomed.width,
    y: (anchor.y - zoomed.y) / zoomed.height,
  };
  assert.deepEqual(afterRatio, beforeRatio);
});

test("pan and fit change only the camera representation", () => {
  const camera = createCamera();
  const panned = panCamera(camera, { x: 120, y: -80 });
  assert.deepEqual(panned, { x: 120, y: -80, width: 1200, height: 800 });

  const fitted = fitCameraToBounds({ minX: 100, minY: 200, maxX: 900, maxY: 600 });
  assert.equal(fitted.width / fitted.height, 1.5);
  assert.ok(fitted.x <= 100 && fitted.y <= 200);
  assert.ok(fitted.x + fitted.width >= 900 && fitted.y + fitted.height >= 600);
});

test("client coordinates map consistently through the active camera", () => {
  const camera = { x: 100, y: 200, width: 600, height: 400 };
  const world = clientPointToCamera(
    camera,
    { x: 400, y: 300 },
    { x: 100, y: 100, width: 600, height: 400 },
  );
  assert.deepEqual(world, { x: 400, y: 400 });
});
