import assert from "node:assert/strict";
import test from "node:test";

import { solveOperatingPoint, solveParallelBranchFlows } from "../src/editor/engineering-solvers.mjs";

const branch = (id, points) => ({ id, points: points.map(([flowLps, pressureLossPa]) => ({ flowLps, pressureLossPa })), basis: "Analytic fixture", source: "Test", sourceVersion: "1" });

test("identical parallel resistance curves reduce exactly to equal flow", () => {
  const result = solveParallelBranchFlows(10, [branch("a", [[0, 0], [10, 100]]), branch("b", [[0, 0], [10, 100]])]);
  assert.equal(result.state, "solved");
  assert.ok(Math.abs(result.branchResults[0].flowLps - 5) < 1e-7);
  assert.ok(Math.abs(result.branchResults[1].flowLps - 5) < 1e-7);
  assert.ok(Math.abs(result.pressureLossPa - 50) < 1e-6);
  assert.ok(result.flowResidualLps < 1e-12);
  assert.ok(result.pressureResidualPa < 1e-6);
});

test("unequal linear branch curves conserve flow and equal pressure", () => {
  const result = solveParallelBranchFlows(9, [branch("low-r", [[0, 0], [10, 100]]), branch("high-r", [[0, 0], [10, 200]])]);
  assert.equal(result.state, "solved");
  assert.ok(Math.abs(result.branchResults[0].flowLps - 6) < 1e-7);
  assert.ok(Math.abs(result.branchResults[1].flowLps - 3) < 1e-7);
  assert.ok(Math.abs(result.pressureLossPa - 60) < 1e-6);
});

test("parallel solving blocks curve extrapolation and missing pressure intersection", () => {
  assert.equal(solveParallelBranchFlows(25, [branch("a", [[0, 0], [10, 100]]), branch("b", [[0, 0], [10, 200]])]).diagnostics[0].code, "parallel-flow-outside-domain");
  assert.equal(solveParallelBranchFlows(10, [branch("a", [[0, 100], [10, 200]]), branch("b", [[0, 0], [10, 50]])]).diagnostics[0].code, "parallel-pressure-intersection-missing");
});

test("operating point matches the independent analytic intersection", () => {
  const fan = [{ flowLps: 0, pressureLossPa: 100 }, { flowLps: 10, pressureLossPa: 0 }];
  const system = [{ flowLps: 0, pressureLossPa: 0 }, { flowLps: 10, pressureLossPa: 100 }];
  const result = solveOperatingPoint(fan, system);
  assert.equal(result.state, "solved-evidenced-curve-intersection");
  assert.ok(Math.abs(result.airflowLps - 5) < 1e-7);
  assert.ok(Math.abs(result.pressurePa - 50) < 1e-6);
  assert.ok(result.residualPa < 1e-6);
});

test("operating-point bisection handles a decreasing residual away from the midpoint", () => {
  const fan = [{ flowLps: 0, pressureLossPa: 1e12 }, { flowLps: 1, pressureLossPa: 0 }];
  const system = [{ flowLps: 0, pressureLossPa: 0 }, { flowLps: 1, pressureLossPa: 2e12 }];
  const result = solveOperatingPoint(fan, system);
  assert.equal(result.state, "solved-evidenced-curve-intersection");
  assert.ok(Math.abs(result.airflowLps - 1 / 3) < 1e-9);
  assert.ok(result.residualPa <= 200);
  assert.ok(result.residualPa <= result.residualTolerancePa);
});

test("solver pressure means stay finite at extreme finite magnitudes", () => {
  const operating = solveOperatingPoint(
    [{ flowLps: 0, pressureLossPa: 1.7e308 }, { flowLps: 1, pressureLossPa: 1.6e308 }],
    [{ flowLps: 0, pressureLossPa: 1.5e308 }, { flowLps: 1, pressureLossPa: 1.7e308 }],
  );
  assert.equal(operating.state, "solved-evidenced-curve-intersection");
  assert.equal(Number.isFinite(operating.pressurePa), true);
  const parallel = solveParallelBranchFlows(1, [
    branch("a", [[0, 1.5e308], [1, 1.7e308]]),
    branch("b", [[0, 1.5e308], [1, 1.7e308]]),
  ]);
  assert.equal(parallel.state, "solved");
  assert.equal(Number.isFinite(parallel.pressureLossPa), true);
  const overflowFlow = solveOperatingPoint(
    [{ flowLps: 0, pressureLossPa: 100 }, { flowLps: 1e308, pressureLossPa: 0 }],
    [{ flowLps: 0, pressureLossPa: 0 }, { flowLps: 1e308, pressureLossPa: 100 }],
  );
  assert.equal(overflowFlow.state, "unresolved");
  assert.equal(overflowFlow.diagnostics[0].code, "operating-point-result-non-finite");
});

test("operating point fails closed for invalid, disjoint or non-intersecting curves", () => {
  assert.equal(solveOperatingPoint([{ flowLps: 0, pressureLossPa: 100 }, { flowLps: 10, pressureLossPa: 120 }], [{ flowLps: 0, pressureLossPa: 0 }, { flowLps: 10, pressureLossPa: 50 }]).diagnostics[0].code, "fan-curve-not-monotonic");
  assert.equal(solveOperatingPoint([{ flowLps: 0, pressureLossPa: 100 }, { flowLps: 5, pressureLossPa: 80 }], [{ flowLps: 10, pressureLossPa: 20 }, { flowLps: 20, pressureLossPa: 100 }]).diagnostics[0].code, "operating-point-domain-disjoint");
  assert.equal(solveOperatingPoint([{ flowLps: 0, pressureLossPa: 200 }, { flowLps: 10, pressureLossPa: 100 }], [{ flowLps: 0, pressureLossPa: 0 }, { flowLps: 10, pressureLossPa: 50 }]).diagnostics[0].code, "operating-point-intersection-missing");
});
