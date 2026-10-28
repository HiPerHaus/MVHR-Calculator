import test from "node:test";
import assert from "node:assert/strict";
import { layoutPointerPosition } from "../src/editor/layout-pointer.mjs";

test("snap off keeps sub-grid movement and the original equipment grab offset", () => {
  const drag = { start: { x: 2400, y: 1800 }, pointerStart: { x: 2650, y: 1950 } };
  assert.deepEqual(layoutPointerPosition(drag.pointerStart, { snapEnabled: false, drag }), drag.start);
  assert.deepEqual(layoutPointerPosition({ x: 2649.25, y: 1912.5 }, { snapEnabled: false, drag }), { x: 2399.25, y: 1762.5 });
  assert.deepEqual(layoutPointerPosition({ x: 2512.25, y: 1687.5 }, { snapEnabled: false }), { x: 2512.25, y: 1687.5 });
});

test("snap on aligns the equipment anchor after accounting for the grab offset", () => {
  const drag = { start: { x: 2400, y: 1800 }, pointerStart: { x: 2650, y: 1950 } };
  assert.deepEqual(layoutPointerPosition({ x: 2590, y: 1830 }, { snapEnabled: true, drag }), { x: 2300, y: 1700 });
  assert.deepEqual(layoutPointerPosition({ x: 2512.25, y: 1687.5 }, { snapEnabled: true }), { x: 2500, y: 1700 });
});
