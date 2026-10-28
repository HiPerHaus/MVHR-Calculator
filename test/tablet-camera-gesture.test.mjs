import assert from "node:assert/strict";
import test from "node:test";

import {
  beginPinchCameraGesture,
  updatePinchCameraGesture,
} from "../src/editor/tablet-camera-gesture.mjs";

const camera = { x: 0, y: 0, width: 1200, height: 800 };
const rect = { left: 100, top: 50, width: 600, height: 400 };

test("two-finger translation pans without changing drawing scale", () => {
  const gesture = beginPinchCameraGesture(camera, [{ x: 250, y: 200 }, { x: 450, y: 200 }], rect);
  const next = updatePinchCameraGesture(gesture, [{ x: 300, y: 230 }, { x: 500, y: 230 }]);
  assert.equal(next.width, camera.width);
  assert.equal(next.height, camera.height);
  assert.deepEqual(next, { x: -100, y: -60, width: 1200, height: 800 });
});

test("pinch zoom keeps the original world anchor under the moving midpoint", () => {
  const gesture = beginPinchCameraGesture(camera, [{ x: 250, y: 200 }, { x: 450, y: 200 }], rect);
  const next = updatePinchCameraGesture(gesture, [{ x: 250, y: 200 }, { x: 650, y: 200 }]);
  assert.deepEqual(next, { x: 150, y: 150, width: 600, height: 400 });
});

test("pinch gestures reject collapsed touches and invalid viewports", () => {
  assert.throws(
    () => beginPinchCameraGesture(camera, [{ x: 10, y: 10 }, { x: 10, y: 10 }], rect),
    /separated/,
  );
  assert.throws(
    () => beginPinchCameraGesture(camera, [{ x: 10, y: 10 }, { x: 20, y: 20 }], { ...rect, width: 0 }),
    /positive/,
  );
});
