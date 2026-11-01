const FLOW_TOLERANCE_LPS = 1e-7;
const PRESSURE_TOLERANCE_PA = 1e-6;
const MAX_ITERATIONS = 80;

/**
 * Splits one declared total flow between two evidenced monotonic branch curves.
 * The solved branches conserve flow and have equal pressure loss. No branch
 * curve is extrapolated.
 */
export function solveParallelBranchFlows(totalFlowLps, branches) {
  if (!Number.isFinite(totalFlowLps) || totalFlowLps <= 0) return unresolved("invalid-total-flow", "Parallel total flow must be a positive finite value.");
  if (!Array.isArray(branches) || branches.length !== 2) return unresolved("unsupported-branch-count", "Exactly two branch resistance curves are required.");
  const [left, right] = branches;
  if (!validIncreasingCurve(left?.points) || !validIncreasingCurve(right?.points)) return unresolved("invalid-branch-curve", "Each branch curve must have at least two finite points with strictly increasing flow and pressure loss.");
  const leftDomain = domain(left.points), rightDomain = domain(right.points);
  const lower = Math.max(leftDomain.minimum, totalFlowLps - rightDomain.maximum);
  const upper = Math.min(leftDomain.maximum, totalFlowLps - rightDomain.minimum);
  if (lower > upper + FLOW_TOLERANCE_LPS) return unresolved("parallel-flow-outside-domain", "The requested total flow cannot be divided without extrapolating a branch curve.");
  const residual = leftFlow => interpolate(left.points, leftFlow) - interpolate(right.points, totalFlowLps - leftFlow);
  const lowerResidual = residual(lower), upperResidual = residual(upper);
  if (![lowerResidual, upperResidual].every(Number.isFinite) || lowerResidual > PRESSURE_TOLERANCE_PA || upperResidual < -PRESSURE_TOLERANCE_PA) {
    return unresolved("parallel-pressure-intersection-missing", "The evidenced branch curves do not reach equal pressure within their verified flow domains.");
  }
  const solution = bisect(lower, upper, residual);
  if (solution === null) return unresolved("parallel-solver-not-converged", "Parallel branch equal-pressure solving did not converge within the bounded iteration limit.");
  const leftFlowLps = solution.value;
  const rightFlowLps = totalFlowLps - leftFlowLps;
  const leftPressurePa = interpolate(left.points, leftFlowLps);
  const rightPressurePa = interpolate(right.points, rightFlowLps);
  const pressureLossPa = safeMean(leftPressurePa, rightPressurePa);
  if (![leftFlowLps, rightFlowLps, leftPressurePa, rightPressurePa, pressureLossPa].every(Number.isFinite)) {
    return unresolved("parallel-result-non-finite", "Parallel branch solving produced a non-finite result and was rejected.");
  }
  return {
    state: "solved",
    totalFlowLps,
    pressureLossPa,
    branchResults: [
      branchResult(left, leftFlowLps, leftPressurePa),
      branchResult(right, rightFlowLps, rightPressurePa),
    ],
    flowResidualLps: Math.abs(totalFlowLps - leftFlowLps - rightFlowLps),
    pressureResidualPa: Math.abs(leftPressurePa - rightPressurePa),
    residualTolerancePa: solution.residualTolerance,
    iterations: solution.iterations,
    diagnostics: [],
  };
}

/**
 * Finds the unique intersection of one strictly decreasing fan curve and one
 * strictly increasing evidenced system-pressure curve. Inputs use canonical
 * L/s and Pa. The solution never extrapolates either curve.
 */
export function solveOperatingPoint(fanPoints, systemPoints) {
  if (!validDecreasingCurve(fanPoints)) return unresolved("fan-curve-not-monotonic", "Operating-point solving requires a strictly decreasing finite fan curve.");
  if (!validIncreasingCurve(systemPoints)) return unresolved("system-curve-not-monotonic", "Operating-point solving requires a strictly increasing finite system pressure curve.");
  const fanDomain = domain(fanPoints), systemDomain = domain(systemPoints);
  const lower = Math.max(fanDomain.minimum, systemDomain.minimum);
  const upper = Math.min(fanDomain.maximum, systemDomain.maximum);
  if (lower > upper + FLOW_TOLERANCE_LPS) return unresolved("operating-point-domain-disjoint", "Fan and system curves have no shared verified flow domain.");
  const residual = flowLps => interpolate(fanPoints, flowLps) - interpolate(systemPoints, flowLps);
  const lowerResidual = residual(lower), upperResidual = residual(upper);
  if (![lowerResidual, upperResidual].every(Number.isFinite) || lowerResidual < -PRESSURE_TOLERANCE_PA || upperResidual > PRESSURE_TOLERANCE_PA) {
    return unresolved("operating-point-intersection-missing", "Fan and system curves do not intersect inside their verified domains.");
  }
  const solution = bisect(lower, upper, residual);
  if (solution === null) return unresolved("operating-point-not-converged", "Operating-point solving did not converge within the bounded iteration limit.");
  const fanPressurePa = interpolate(fanPoints, solution.value);
  const systemPressurePa = interpolate(systemPoints, solution.value);
  const pressurePa = safeMean(fanPressurePa, systemPressurePa);
  const residualPa = Math.abs(fanPressurePa - systemPressurePa);
  const airflowM3h = solution.value * 3.6;
  if (![solution.value, airflowM3h, fanPressurePa, systemPressurePa, pressurePa, residualPa].every(Number.isFinite)) {
    return unresolved("operating-point-result-non-finite", "Operating-point solving produced a non-finite result and was rejected.");
  }
  return {
    state: "solved-evidenced-curve-intersection",
    airflowLps: solution.value,
    airflowM3h,
    pressurePa,
    residualPa,
    residualTolerancePa: solution.residualTolerance,
    iterations: solution.iterations,
    fanDomainLps: [fanDomain.minimum, fanDomain.maximum],
    systemDomainLps: [systemDomain.minimum, systemDomain.maximum],
    diagnostics: [],
  };
}

function bisect(lower, upper, residual) {
  let low = lower, high = upper;
  let lowResidual = residual(low), highResidual = residual(high);
  if (![lowResidual, highResidual].every(Number.isFinite)) return null;
  if (Math.abs(lowResidual) <= PRESSURE_TOLERANCE_PA) return { value: low, iterations: 0, residualTolerance: PRESSURE_TOLERANCE_PA };
  if (Math.abs(highResidual) <= PRESSURE_TOLERANCE_PA) return { value: high, iterations: 0, residualTolerance: PRESSURE_TOLERANCE_PA };
  if (Math.sign(lowResidual) === Math.sign(highResidual)) return null;
  const residualTolerance = Math.max(PRESSURE_TOLERANCE_PA, Math.max(Math.abs(lowResidual), Math.abs(highResidual)) * 1e-10);
  for (let iterations = 0; iterations <= MAX_ITERATIONS; iterations += 1) {
    const middle = (low + high) / 2;
    const value = residual(middle);
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) <= residualTolerance) return { value: middle, iterations, residualTolerance };
    if (Math.sign(value) === Math.sign(lowResidual)) {
      low = middle;
      lowResidual = value;
    } else {
      high = middle;
      highResidual = value;
    }
  }
  return null;
}

function safeMean(left, right) {
  return left / 2 + right / 2;
}

function interpolate(points, flowLps) {
  if (flowLps < points[0].flowLps - FLOW_TOLERANCE_LPS || flowLps > points.at(-1).flowLps + FLOW_TOLERANCE_LPS) return null;
  const exact = points.find(point => Math.abs(point.flowLps - flowLps) <= FLOW_TOLERANCE_LPS);
  if (exact) return exact.pressureLossPa;
  const upperIndex = points.findIndex(point => point.flowLps > flowLps);
  if (upperIndex <= 0) return null;
  const lower = points[upperIndex - 1], upper = points[upperIndex];
  const ratio = (flowLps - lower.flowLps) / (upper.flowLps - lower.flowLps);
  return lower.pressureLossPa + ratio * (upper.pressureLossPa - lower.pressureLossPa);
}

function validIncreasingCurve(points) {
  return validCurve(points, (previous, current) => current.pressureLossPa > previous.pressureLossPa);
}

function validDecreasingCurve(points) {
  return validCurve(points, (previous, current) => current.pressureLossPa < previous.pressureLossPa);
}

function validCurve(points, pressureOrder) {
  if (!Array.isArray(points) || points.length < 2) return false;
  if (points.some(point => !Number.isFinite(point?.flowLps) || point.flowLps < 0 || !Number.isFinite(point?.pressureLossPa) || point.pressureLossPa < 0)) return false;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].flowLps <= points[index - 1].flowLps || !pressureOrder(points[index - 1], points[index])) return false;
  }
  return true;
}

function domain(points) { return { minimum: points[0].flowLps, maximum: points.at(-1).flowLps }; }
function branchResult(branch, flowLps, pressureLossPa) { return { id: branch.id, flowLps, pressureLossPa, basis: branch.basis, source: branch.source, sourceVersion: branch.sourceVersion }; }
function unresolved(code, message) { return { state: "unresolved", diagnostics: [{ code, severity: "error", message, target: {} }] }; }
