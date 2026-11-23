import assert from "node:assert/strict";
import test from "node:test";
import { createOsTakeoff } from "../app/os-takeoff.mjs";

const stock = { kind: "part", ref: "90", description: "50 m coil", quantity: "2", unit: "coil", partNumber: "ZEN-CT90-50M" };
const cloud = { id: "cloud-record", save_version: 3 };
const exportRows = rows => createOsTakeoff(rows, cloud, "option-a", "centralised");

test("sends the stock once and keeps its purchase unit", () => {
  const result = exportRows([stock, ...["assembly", "route-measurement", "cut-piece", "summary"].map(kind => ({ ...stock, kind }))]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.items[0].unit, "coil");
});

test("leaves pending quantities and unresolved selections for review", () => {
  const result = exportRows([{ ...stock, quantity: "2 + pending" }, { ...stock, kind: "selection" }]);
  assert.equal(result.items.length, 0);
  assert.equal(result.issues.length, 2);
});

test("the same drawing version, option and scope produce the same revision on retry", () => {
  assert.deepEqual(exportRows([stock]), exportRows([stock]));
  assert.notEqual(exportRows([stock]).revision, createOsTakeoff([stock], cloud, "option-b", "combined").revision);
});
