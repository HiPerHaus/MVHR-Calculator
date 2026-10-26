import assert from "node:assert/strict";
import test from "node:test";

import {
  clientPointToCamera,
  createInitialCameraFitScheduler,
  createCamera,
  fitCameraToBounds,
  panCamera,
  zoomCameraAt,
} from "../src/editor/camera.mjs";

function createFrameHarness() {
  const frames = [];
  return {
    requestFrame(callback) {
      frames.push(callback);
    },
    flush() {
      assert.ok(frames.length > 0, "expected a queued animation frame");
      frames.shift()();
    },
    get queued() {
      return frames.length;
    },
  };
}

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

test("initial fit waits for a visible stable canvas and applies only once", () => {
  const frames = createFrameHarness();
  let rect = { width: 0, height: 0 };
  const applied = [];
  const scheduler = createInitialCameraFitScheduler({
    requestFrame: frames.requestFrame,
    measure: () => rect,
    apply: (measured) => applied.push({ ...measured }),
  });

  scheduler.arm();
  frames.flush();
  assert.equal(scheduler.isPending(), true);
  assert.equal(frames.queued, 0);

  rect = { width: 900, height: 600 };
  scheduler.request();
  frames.flush();
  assert.equal(applied.length, 0);
  frames.flush();
  assert.deepEqual(applied, [{ width: 900, height: 600 }]);
  assert.equal(scheduler.isPending(), false);

  scheduler.request();
  assert.equal(frames.queued, 0);
});

test("initial fit uses the settled canvas size after responsive layout", () => {
  const frames = createFrameHarness();
  let rect = { width: 700, height: 700 };
  const applied = [];
  const scheduler = createInitialCameraFitScheduler({
    requestFrame: frames.requestFrame,
    measure: () => rect,
    apply: (measured) => applied.push({ ...measured }),
  });

  scheduler.arm();
  frames.flush();
  rect = { width: 1200, height: 600 };
  frames.flush();
  assert.equal(applied.length, 0);
  frames.flush();
  assert.deepEqual(applied, [{ width: 1200, height: 600 }]);
});

test("manual camera input cancels a pending fit and a new drawing can re-arm it", () => {
  const frames = createFrameHarness();
  const applied = [];
  const scheduler = createInitialCameraFitScheduler({
    requestFrame: frames.requestFrame,
    measure: () => ({ width: 800, height: 500 }),
    apply: (measured) => applied.push({ ...measured }),
  });

  scheduler.arm();
  scheduler.cancel();
  frames.flush();
  assert.equal(applied.length, 0);

  scheduler.arm();
  frames.flush();
  frames.flush();
  assert.deepEqual(applied, [{ width: 800, height: 500 }]);
});

test("fit contains drawing bounds in portrait and landscape canvases", () => {
  const bounds = { minX: -120, minY: 80, maxX: 920, maxY: 1380 };
  for (const aspectRatio of [0.75, 2]) {
    const fitted = fitCameraToBounds(bounds, aspectRatio, 55);
    assert.equal(fitted.width / fitted.height, aspectRatio);
    assert.ok(fitted.x <= bounds.minX);
    assert.ok(fitted.y <= bounds.minY);
    assert.ok(fitted.x + fitted.width >= bounds.maxX);
    assert.ok(fitted.y + fitted.height >= bounds.maxY);
  }
});
