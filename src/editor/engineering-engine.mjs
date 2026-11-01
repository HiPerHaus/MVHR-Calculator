import { routeLengthSummary, validateProject } from "../domain/spatial.mjs";
import { engineeringComponentFingerprint, engineeringRouteFingerprint, engineeringSystemFingerprint } from "../domain/engineering-inputs.mjs";
import { solveOperatingPoint, solveParallelBranchFlows } from "./engineering-solvers.mjs";

const EPSILON = 1e-9;
const ROOT_ROLES = Object.freeze({ supply: "Dwelling supply", extract: "Dwelling extract" });

/**
 * Deterministic design-flow evaluation for one saved engineering mode.
 * It evaluates explicit terminal allocations at their design targets. It does
 * not predict achieved flow or solve a nonlinear network operating point.
 */
export function evaluateEngineeringNetwork(project, floorId, mode = "normal") {
  validateProject(project);
  const design = project.engineeringInputs.networkDesigns.find(candidate => candidate.floorId === floorId && candidate.mode === mode) ?? null;
  if (!design) return emptyResult(floorId, mode, "No saved engineering network design exists for this floor and mode.");
  const components = project.components.filter(component => component.floorId === floorId);
  const routes = project.routes.filter(route => route.floorId === floorId && route.system === "mvhr");
  const componentById = new Map(components.map(component => [component.id, component]));
  const graph = createEngineeringGraph(components, routes, project.connections, componentById);
  const diagnostics = [...graph.diagnostics];
  const roots = rootEndpoints(components);
  const cycleComponents = cyclicComponents(graph.adjacency);
  if (cycleComponents.length > 0) diagnostics.push(diagnostic("unsupported-cycle-present", "warning", `The MVHR graph contains ${cycleComponents.length} connected cyclic region${cycleComponents.length === 1 ? "" : "s"}. Only allocations with a unique simple path are evaluated; ambiguous paths are blocked.`, { cycleComponentCount: cycleComponents.length }));

  const allocations = design.terminalAllocations.map(allocation => evaluateAllocation(allocation, componentById, roots, graph, diagnostics));
  const boundaries = Object.fromEntries(["supply", "extract"].flatMap(stream => evaluateSystemBoundaries(stream, components, roots, graph)).map(boundary => [unitStreamKey(boundary.unitComponentId, boundary.stream), boundary]));
  for (const boundary of Object.values(boundaries)) diagnostics.push(...boundary.diagnostics);
  const routeFlows = accumulateRouteFlows(allocations, boundaries);
  const routeInputs = new Map(design.routeResistanceInputs.map(input => [input.routeId, input]));
  const routeResults = routes.map(route => evaluateRoute(route, routeFlows.get(route.id) ?? 0, routeInputs.get(route.id) ?? null, design.fluid));
  const routeResultById = new Map(routeResults.map(result => [result.routeId, result]));
  const componentInputs = new Map(design.componentResistanceInputs.map(input => [componentInputKey(input.componentId, input.passageId), input]));
  const paths = allocations.map(allocation => evaluatePath(allocation, boundaries[unitStreamKey(allocation.root?.componentId, allocation.stream)], componentById, routeResultById, componentInputs));
  const spaceChecks = inspectSpaceAllocation(project, floorId, mode, design.terminalAllocations);
  diagnostics.push(...spaceChecks.diagnostics);
  const unitIds = [...new Set(Object.values(roots).flat().map(root => root.componentId))].sort();
  if (unitIds.length === 0) diagnostics.push(diagnostic("unit-root-missing", "error", "No supported MVHR unit with dwelling supply and extract roots is available on this floor.", { floorId }));
  const units = Object.fromEntries(unitIds.map(unitComponentId => {
    const unitStreams = Object.fromEntries(["supply", "extract"].map(stream => [stream, evaluateUnitStream(stream, unitComponentId, allocations, paths, design.fanCurves, componentById)]));
    const operatingPoints = Object.fromEntries(["supply", "extract"].map(stream => [stream, evaluateOperatingPointModel(stream, unitComponentId, unitStreams[stream], design, componentById, project)]));
    return [unitComponentId, { unitComponentId, streams: unitStreams, balance: evaluateDesignBalance(unitStreams, unitComponentId), operatingPoints }];
  }));
  for (const unit of Object.values(units)) {
    for (const stream of Object.values(unit.streams)) diagnostics.push(...stream.diagnostics);
    diagnostics.push(...unit.balance.diagnostics);
    for (const operatingPoint of Object.values(unit.operatingPoints)) diagnostics.push(...operatingPoint.diagnostics);
  }
  const streams = Object.fromEntries(["supply", "extract"].map(stream => [stream, aggregateUnitStreams(stream, units)]));
  const balance = evaluateDesignBalance(streams);
  diagnostics.push(...balance.diagnostics);
  for (const result of routeResults) diagnostics.push(...result.diagnostics);
  for (const path of paths) diagnostics.push(...path.diagnostics);

  const blocking = diagnostics.some(item => item.severity === "error");
  return deepFreeze({
    kind: "mvhr-engineering-evaluation.v1",
    floorId,
    mode,
    status: blocking ? "blocked" : "preliminary-review-required",
    design: structuredClone(design),
    allocations,
    spaceChecks,
    routes: routeResults,
    paths,
    boundaries,
    units,
    streams,
    balance,
    diagnostics: uniqueDiagnostics(diagnostics),
    assumptions: {
      densityKgM3: design.fluid.densityKgM3,
      dynamicViscosityPaS: design.fluid.dynamicViscosityPaS,
      basis: design.fluid.basis,
      source: design.fluid.source,
      elevationStaticHeadApplied: false,
    },
    evidenceBoundary: "Design-target evaluation only. Flows come from explicit terminal allocations, not predicted delivery. One active design option, one selected floor and one mode are evaluated at a time; no cross-floor or cross-option total is produced. Each connected unit is evaluated separately; independent fan duties are never summed. Pressure uses only saved internal geometry and explicit resistance evidence. Twin routes require either a declared equal split or two evidenced monotonic branch curves; solved unequal branches conserve flow and equal pressure without changing terminal targets. Transitional Reynolds-number routes remain unresolved. Elevation affects developed length only. Fan-duty screening remains separate from an optional evidenced fan/system curve intersection. The whole-system curve for that optional intersection is externally entered and is not derived from drawn routes. Neither curve is extrapolated and unsupported topology stays unresolved.",
  });
}

function createEngineeringGraph(components, routes, connections, componentById) {
  const adjacency = new Map();
  const componentByEndpoint = new Map();
  const portByEndpoint = new Map();
  const diagnostics = [];
  const addNode = key => { if (!adjacency.has(key)) adjacency.set(key, []); };
  const addEdge = edge => {
    addNode(edge.from); addNode(edge.to);
    adjacency.get(edge.from).push(edge); adjacency.get(edge.to).push({ ...edge, from: edge.to, to: edge.from });
  };
  for (const component of components) {
    for (const port of component.ports) {
      const key = endpointKey(component.id, port.id);
      addNode(key);
      componentByEndpoint.set(key, component.id);
      portByEndpoint.set(key, port);
    }
    for (const passage of component.engineeringPassages ?? []) {
      const from = endpointKey(component.id, passage.fromPortId), to = endpointKey(component.id, passage.toPortId);
      const fromPort = portByEndpoint.get(from), toPort = portByEndpoint.get(to);
      if (fromPort?.system !== "mvhr" || toPort?.system !== "mvhr" || fromPort.stream !== toPort.stream || fromPort.role !== toPort.role) {
        diagnostics.push(diagnostic("component-passage-invalid", "error", `Component ${component.id} has an engineering passage that does not join matching typed MVHR ports.`, { componentId: component.id, passageId: passage.id }));
        continue;
      }
      addEdge({ id: `internal:${component.id}:${passage.id}`, kind: "internal", componentId: component.id, passageId: passage.id, from, to });
    }
    const groupedPorts = new Map();
    for (const port of component.ports.filter(port => port.system === "mvhr")) {
      const group = `${port.stream}\u0000${port.role}`;
      if (!groupedPorts.has(group)) groupedPorts.set(group, []);
      groupedPorts.get(group).push(port.id);
    }
    if ([...groupedPorts.values()].some(portIds => portIds.length > 1) && (component.engineeringPassages ?? []).length === 0) {
      diagnostics.push(diagnostic("component-passage-topology-unresolved", "error", `Component ${component.id} has multiple same-service ports but no explicit internal engineering passage topology.`, { componentId: component.id }));
    }
  }
  for (const route of routes) {
    if (!route.startAttachment || !route.endAttachment) {
      diagnostics.push(diagnostic("free-route-end", "error", `Route ${route.id} is not attached at both ends.`, { routeId: route.id }));
      continue;
    }
    addEdge({ id: `route:${route.id}`, kind: "route", routeId: route.id, from: endpointKey(route.startAttachment.componentId, route.startAttachment.portId), to: endpointKey(route.endAttachment.componentId, route.endAttachment.portId) });
  }
  for (const connection of connections) {
    if (!componentById.has(connection.from.componentId) || !componentById.has(connection.to.componentId)) continue;
    const from = endpointKey(connection.from.componentId, connection.from.portId), to = endpointKey(connection.to.componentId, connection.to.portId);
    if (portByEndpoint.get(from)?.system !== "mvhr" || portByEndpoint.get(to)?.system !== "mvhr") continue;
    addEdge({ id: `connection:${connection.id}`, kind: "connection", connectionId: connection.id, from, to });
  }
  return { adjacency, componentByEndpoint, diagnostics };
}

function rootEndpoints(components) {
  const unitComponents = components.filter(component => {
    const roles = new Set(component.ports.map(port => port.role));
    return roles.has(ROOT_ROLES.supply) && roles.has(ROOT_ROLES.extract);
  });
  return Object.fromEntries(["supply", "extract"].map(stream => [stream, unitComponents.flatMap(component => component.ports.filter(port => port.role === ROOT_ROLES[stream]).map(port => ({ componentId: component.id, portId: port.id, key: endpointKey(component.id, port.id) })))]));
}

function evaluateSystemBoundaries(stream, components, roots, graph) {
  const role = stream === "supply" ? "Outdoor intake" : "Outdoor exhaust";
  const unitRoots = roots[stream] ?? [];
  const unitComponentIds = new Set(unitRoots.map(root => root.componentId));
  const outsidePorts = components.filter(item => !unitComponentIds.has(item.id)).flatMap(component => component.ports.filter(port => port.role === role).map(port => ({ componentId: component.id, portId: port.id, key: endpointKey(component.id, port.id) })));
  const results = [...unitComponentIds].map(unitComponentId => {
    const diagnostics = [];
    const rootPorts = unitRoots.filter(root => root.componentId === unitComponentId);
    const unit = components.find(component => component.id === unitComponentId);
    const unitBoundaryPorts = unit?.ports.filter(port => port.role === role).map(port => ({ componentId: unit.id, portId: port.id, key: endpointKey(unit.id, port.id) })) ?? [];
    const resolvedCandidates = rootPorts.length === 1 && unitBoundaryPorts.length === 1
      ? outsidePorts.map(port => ({ port, resolved: resolveUniquePath(unitBoundaryPorts[0].key, port.key, graph.adjacency) }))
      : [];
    const unique = resolvedCandidates.filter(candidate => candidate.resolved.state === "unique");
    const ambiguous = resolvedCandidates.filter(candidate => candidate.resolved.state === "ambiguous");
    if (rootPorts.length !== 1 || unitBoundaryPorts.length !== 1 || unique.length !== 1 || ambiguous.length > 0) {
      diagnostics.push(diagnostic("system-boundary-count-invalid", "error", `${stream} unit ${unitComponentId} requires one dwelling root, one ${role} unit port and one unique external terminal path; found ${rootPorts.length} root ports, ${unitBoundaryPorts.length} boundary ports, ${unique.length} unique external path${unique.length === 1 ? "" : "s"} and ${ambiguous.length} ambiguous path${ambiguous.length === 1 ? "" : "s"}.`, { stream, role, unitComponentId }));
      return { unitComponentId, stream, role, state: "unresolved", externalComponentId: null, routeIds: [], componentIds: [], componentPassages: [], diagnostics };
    }
    const selected = unique[0], path = selected.resolved.path;
    return {
      unitComponentId, stream, role, state: "connected-unique-path", externalComponentId: selected.port.componentId,
      routeIds: path.filter(edge => edge.kind === "route").map(edge => edge.routeId),
      componentIds: [...new Set(path.flatMap(edge => [graph.componentByEndpoint.get(edge.from), graph.componentByEndpoint.get(edge.to)]).filter(componentId => componentId && componentId !== unitComponentId))],
      componentPassages: path.filter(edge => edge.kind === "internal").map(edge => ({ componentId: edge.componentId, passageId: edge.passageId })), diagnostics,
    };
  });
  const externalUse = new Map();
  for (const result of results.filter(item => item.state === "connected-unique-path")) {
    if (!externalUse.has(result.externalComponentId)) externalUse.set(result.externalComponentId, []);
    externalUse.get(result.externalComponentId).push(result);
  }
  for (const duplicate of [...externalUse.values()].filter(items => items.length > 1)) for (const result of duplicate) {
    result.state = "unresolved";
    result.diagnostics.push(diagnostic("system-boundary-shared-between-units", "error", `${role} terminal ${result.externalComponentId} is connected to more than one unit; independent unit boundaries cannot be inferred.`, { stream, role, unitComponentId: result.unitComponentId, componentId: result.externalComponentId }));
  }
  return results;
}

function evaluateAllocation(allocation, componentById, roots, graph, diagnostics) {
  const component = componentById.get(allocation.componentId);
  const port = component?.ports.find(candidate => candidate.id === allocation.portId) ?? null;
  const stream = port?.stream ?? "unknown";
  const result = { ...structuredClone(allocation), stream, endpointKey: endpointKey(allocation.componentId, allocation.portId), routeIds: [], componentIds: [], componentPassages: [], root: null, graphStatus: "blocked" };
  if (!port || !["supply", "extract"].includes(stream)) {
    diagnostics.push(diagnostic("allocation-terminal-invalid", "error", `Allocation ${allocation.id} does not reference one typed supply/extract terminal port.`, { allocationId: allocation.id }));
    return result;
  }
  const candidates = (roots[stream] ?? []).map(root => ({ root, resolved: resolveUniquePath(result.endpointKey, root.key, graph.adjacency) }));
  const unique = candidates.filter(candidate => candidate.resolved.state === "unique");
  const ambiguous = candidates.filter(candidate => candidate.resolved.state === "ambiguous");
  if (unique.length === 0 && ambiguous.length === 0) {
    diagnostics.push(diagnostic("allocation-disconnected", "error", `Allocation ${allocation.id} has no connected ${stream} path to the selected unit root.`, { allocationId: allocation.id, componentId: allocation.componentId }));
    return result;
  }
  if (unique.length !== 1 || ambiguous.length > 0) {
    diagnostics.push(diagnostic("allocation-path-ambiguous", "error", `Allocation ${allocation.id} does not resolve to exactly one unit: ${unique.length} unique and ${ambiguous.length} ambiguous ${stream} root paths were found.`, { allocationId: allocation.id, componentId: allocation.componentId }));
    return result;
  }
  const selected = unique[0], path = selected.resolved.path;
  result.routeIds = path.filter(edge => edge.kind === "route").map(edge => edge.routeId);
  result.componentIds = [...new Set(path.flatMap(edge => [
    graph.componentByEndpoint.get(edge.from),
    graph.componentByEndpoint.get(edge.to),
  ]).filter(Boolean))];
  result.componentPassages = path.filter(edge => edge.kind === "internal").map(edge => ({ componentId: edge.componentId, passageId: edge.passageId }));
  result.root = structuredClone(selected.root);
  result.graphStatus = "connected-unique-path";
  return result;
}

function accumulateRouteFlows(allocations, boundaries) {
  const totals = new Map();
  for (const allocation of allocations) if (allocation.graphStatus === "connected-unique-path") for (const routeId of allocation.routeIds) totals.set(routeId, (totals.get(routeId) ?? 0) + allocation.valueLps);
  for (const boundary of Object.values(boundaries)) {
    if (boundary?.state !== "connected-unique-path") continue;
    const flowLps = allocations.filter(allocation => allocation.stream === boundary.stream && allocation.root?.componentId === boundary.unitComponentId && allocation.graphStatus === "connected-unique-path").reduce((sum, allocation) => sum + allocation.valueLps, 0);
    for (const routeId of boundary.routeIds) totals.set(routeId, (totals.get(routeId) ?? 0) + flowLps);
  }
  return totals;
}

function evaluateRoute(route, flowLps, input, fluid) {
  const diagnostics = [];
  const length = routeLengthSummary(route);
  const parallelRunCount = route.parallelRunCount;
  if (!Number.isFinite(flowLps) || flowLps < 0) {
    diagnostics.push(diagnostic("route-flow-non-finite", "error", `Route ${route.id} design flow is outside the finite calculation range.`, { routeId: route.id }));
    return unresolvedRouteResult(route, flowLps, parallelRunCount, length.developedMm, diagnostics);
  }
  if (flowLps <= EPSILON) return { routeId: route.id, stream: route.stream, state: "unused", flowLps: 0, parallelRunCount, velocityMps: null, reynoldsNumber: null, frictionRegime: null, frictionFactor: null, pressureLossPa: null, diagnostics };
  if (!input) diagnostics.push(diagnostic("route-resistance-missing", "error", `Route ${route.id} has flow but no sourced resistance input.`, { routeId: route.id }));
  if (parallelRunCount === null) diagnostics.push(diagnostic("route-parallel-count-missing", "error", `Route ${route.id} needs an explicit Single or Twin physical run count before velocity can be calculated.`, { routeId: route.id }));
  if (length.developedMm === null) diagnostics.push(diagnostic("route-developed-length-missing", "error", `Route ${route.id} has unknown elevation, so developed length is unresolved.`, { routeId: route.id }));
  if (!input || parallelRunCount === null || length.developedMm === null) return unresolvedRouteResult(route, flowLps, parallelRunCount, length.developedMm, diagnostics);
  if (input.routeGeometryFingerprint !== engineeringRouteFingerprint(route)) {
    diagnostics.push(diagnostic("route-evidence-stale", "error", `Route ${route.id} resistance evidence is not bound to its current geometry and connections. Review and save the evidence again.`, { routeId: route.id }));
    return unresolvedRouteResult(route, flowLps, parallelRunCount, length.developedMm, diagnostics);
  }
  if (parallelRunCount === 2 && input.parallelFlowAssumption !== "equal-split-declared") {
    if (input.parallelFlowAssumption !== "unequal-resistance-model") {
      diagnostics.push(diagnostic("parallel-flow-assumption-missing", "error", `Twin route ${route.id} needs an explicit equal-flow assumption or two evidenced unequal branch resistance curves before velocity and pressure can be calculated.`, { routeId: route.id }));
      return unresolvedRouteResult(route, flowLps, parallelRunCount, length.developedMm, diagnostics);
    }
  }
  const section = routeSectionGeometry(input.crossSection);
  if (![section.hydraulicDiameterMm, section.areaMm2].every(finitePositive)) {
    diagnostics.push(diagnostic("route-calculation-out-of-range", "error", `Route ${route.id} internal geometry is outside the finite calculation range.`, { routeId: route.id }));
    return unresolvedRouteResult(route, flowLps, parallelRunCount, length.developedMm, diagnostics);
  }
  if (parallelRunCount === 2 && input.parallelFlowAssumption === "unequal-resistance-model") {
    const split = solveParallelBranchFlows(flowLps, input.parallelResistanceModel?.branches);
    diagnostics.push(...split.diagnostics.map(item => ({ ...item, target: { routeId: route.id } })));
    if (split.state !== "solved") return unresolvedRouteResult(route, flowLps, parallelRunCount, length.developedMm, diagnostics);
    const areaPerRunM2 = section.areaMm2 / 1_000_000;
    const branchResults = split.branchResults.map(branch => ({
      ...branch,
      velocityMps: branch.flowLps / 1000 / areaPerRunM2,
    }));
    if (branchResults.some(branch => !finiteNonNegative(branch.velocityMps)) || !finiteNonNegative(split.pressureLossPa)) {
      diagnostics.push(diagnostic("route-calculation-out-of-range", "error", `Twin route ${route.id} unequal branch result is outside the finite calculation range.`, { routeId: route.id }));
      return unresolvedRouteResult(route, flowLps, parallelRunCount, length.developedMm, diagnostics);
    }
    return {
      routeId: route.id, stream: route.stream, state: "calculated-design-flow-unequal-parallel", flowLps,
      flowPerRunLps: null, parallelRunCount, parallelFlowAssumption: input.parallelFlowAssumption,
      parallelResistanceModel: structuredClone(input.parallelResistanceModel), branchResults,
      flowResidualLps: split.flowResidualLps, pressureResidualPa: split.pressureResidualPa,
      residualTolerancePa: split.residualTolerancePa,
      developedLengthMm: length.developedMm, crossSection: structuredClone(input.crossSection),
      hydraulicDiameterMm: section.hydraulicDiameterMm, areaPerRunM2,
      velocityMps: null, reynoldsNumber: null, frictionRegime: "evidenced-branch-curves",
      frictionFactor: null, dynamicPressurePa: null, straightLossPa: null, fittingLossPa: null,
      additionalLossPa: null, pressureLossPa: split.pressureLossPa,
      basis: input.basis, source: input.source, diagnostics,
    };
  }
  if (input.additionalPressureLoss.state !== "known") diagnostics.push(diagnostic("route-additional-loss-missing", "error", `Route ${route.id} additional fitting/product loss is unresolved; enter an evidenced value, including an explicit sourced 0 Pa when genuinely none applies.`, { routeId: route.id }));
  const flowPerRunM3s = flowLps / 1000 / parallelRunCount;
  const diameterM = section.hydraulicDiameterMm / 1000;
  const areaM2 = section.areaMm2 / 1_000_000;
  const velocityMps = flowPerRunM3s / areaM2;
  const reynoldsNumber = fluid.densityKgM3 * velocityMps * diameterM / fluid.dynamicViscosityPaS;
  const relativeRoughness = input.roughnessMm / section.hydraulicDiameterMm;
  if (![flowPerRunM3s, diameterM, areaM2, velocityMps, reynoldsNumber, relativeRoughness].every(finiteNonNegative)) {
    diagnostics.push(diagnostic("route-calculation-out-of-range", "error", `Route ${route.id} produces a non-finite intermediate value; calculation is blocked rather than stored as zero or null.`, { routeId: route.id }));
    return unresolvedRouteResult(route, flowLps, parallelRunCount, length.developedMm, diagnostics);
  }
  const friction = darcyFrictionFactor(reynoldsNumber, relativeRoughness, input.crossSection.shape);
  if (friction.state === "transitional-unresolved") diagnostics.push(diagnostic("transitional-flow-unresolved", "error", `Route ${route.id} has Reynolds number ${formatNumber(reynoldsNumber)} in the transitional range; Studio will not select a friction factor without an approved method.`, { routeId: route.id }));
  if (friction.state === "rectangular-laminar-unresolved") diagnostics.push(diagnostic("rectangular-laminar-unresolved", "error", `Route ${route.id} is rectangular and laminar; Studio will not apply the circular 64/Re relation without an approved rectangular-duct method.`, { routeId: route.id }));
  const dynamicPressurePa = fluid.densityKgM3 * velocityMps * velocityMps / 2;
  const straightLossPa = friction.factor === null ? null : friction.factor * (length.developedMm / section.hydraulicDiameterMm) * dynamicPressurePa;
  const fittingLossPa = input.fittingKTotal * dynamicPressurePa;
  const additionalLossPa = input.additionalPressureLoss.state === "known" ? input.additionalPressureLoss.valuePa : null;
  const pressureLossPa = additionalLossPa === null || straightLossPa === null ? null : straightLossPa + fittingLossPa + additionalLossPa;
  if ([dynamicPressurePa, fittingLossPa, straightLossPa, pressureLossPa].filter(value => value !== null).some(value => !Number.isFinite(value))) {
    diagnostics.push(diagnostic("route-calculation-out-of-range", "error", `Route ${route.id} pressure calculation is outside the finite numeric range.`, { routeId: route.id }));
    return unresolvedRouteResult(route, flowLps, parallelRunCount, length.developedMm, diagnostics);
  }
  return { routeId: route.id, stream: route.stream, state: pressureLossPa === null ? "unresolved" : "calculated-design-flow", flowLps, flowPerRunLps: flowLps / parallelRunCount, parallelRunCount, parallelFlowAssumption: parallelRunCount === 2 ? input.parallelFlowAssumption : "not-applicable", developedLengthMm: length.developedMm, crossSection: structuredClone(input.crossSection), hydraulicDiameterMm: section.hydraulicDiameterMm, areaPerRunM2: areaM2, velocityMps, reynoldsNumber, frictionRegime: friction.regime, frictionFactor: friction.factor, dynamicPressurePa, straightLossPa, fittingLossPa, additionalLossPa, pressureLossPa, basis: input.basis, source: input.source, diagnostics };
}

function unresolvedRouteResult(route, flowLps, parallelRunCount, developedLengthMm, diagnostics) {
  return { routeId: route.id, stream: route.stream, state: "unresolved", flowLps: Number.isFinite(flowLps) ? flowLps : null, parallelRunCount, developedLengthMm, velocityMps: null, reynoldsNumber: null, frictionRegime: null, frictionFactor: null, pressureLossPa: null, diagnostics };
}

function routeSectionGeometry(crossSection) {
  if (crossSection.shape === "circular") {
    const diameter = crossSection.internalDiameterMm;
    return { areaMm2: Math.PI * diameter * diameter / 4, hydraulicDiameterMm: diameter };
  }
  const width = crossSection.internalWidthMm, height = crossSection.internalHeightMm;
  return { areaMm2: width * height, hydraulicDiameterMm: 2 * width * height / (width + height) };
}

function evaluatePath(allocation, boundary, componentById, routeResults, componentInputs) {
  const diagnostics = [];
  if (allocation.graphStatus !== "connected-unique-path") return { allocationId: allocation.id, stream: allocation.stream, state: "unresolved", routeIds: allocation.routeIds, pressureLossPa: null, diagnostics };
  if (boundary?.state !== "connected-unique-path") diagnostics.push(diagnostic("path-system-boundary-unresolved", "error", `Path ${allocation.id} has no complete ${allocation.stream} outdoor system boundary.`, { allocationId: allocation.id, stream: allocation.stream }));
  const routeIds = [...new Set([...(boundary?.routeIds ?? []), ...allocation.routeIds])];
  let total = 0;
  for (const routeId of routeIds) {
    const result = routeResults.get(routeId);
    if (!result || result.pressureLossPa === null) diagnostics.push(diagnostic("path-route-loss-unresolved", "error", `Path ${allocation.id} includes unresolved route ${routeId}.`, { allocationId: allocation.id, routeId }));
    else total += result.pressureLossPa;
  }
  const terminalLoss = allocation.terminalPressureLoss;
  if (terminalLoss.state !== "known") diagnostics.push(diagnostic("terminal-loss-unresolved", "error", `Allocation ${allocation.id} has no sourced terminal pressure loss.`, { allocationId: allocation.id }));
  else total += terminalLoss.valuePa;
  const terminalComponentId = allocation.componentId;
  const rootComponentId = allocation.root?.componentId ?? null;
  const componentPassages = uniqueComponentPassages([...(allocation.componentPassages ?? []), ...(boundary?.componentPassages ?? [])]);
  const passageComponentIds = new Set(componentPassages.map(item => item.componentId));
  const componentLevelIds = [...new Set([
    ...allocation.componentIds.filter(componentId => componentId !== terminalComponentId && componentId !== rootComponentId && (componentById.get(componentId)?.ports.length ?? 0) > 1),
    ...(boundary?.componentIds ?? []),
  ])].filter(componentId => componentId !== terminalComponentId && componentId !== rootComponentId && !passageComponentIds.has(componentId));
  const componentRequests = [
    ...componentPassages,
    ...componentLevelIds.map(componentId => ({ componentId, passageId: null })),
  ];
  for (const { componentId, passageId } of componentRequests) {
    const input = componentInputs.get(componentInputKey(componentId, passageId));
    const target = { allocationId: allocation.id, componentId, ...(passageId ? { passageId } : {}) };
    if (!input || input.pressureLoss.state !== "known") diagnostics.push(diagnostic("component-loss-unresolved", "error", `Path ${allocation.id} needs sourced pressure loss for ${passageId ? `passage ${passageId} of ` : "inline component "}${componentId}.`, target));
    else if (input.componentConfigurationFingerprint !== engineeringComponentFingerprint(componentById.get(componentId))) diagnostics.push(diagnostic("component-evidence-stale", "error", `Path ${allocation.id} has component-loss evidence that is not bound to the current configuration of ${componentId}.`, target));
    else total += input.pressureLoss.valuePa;
  }
  return { allocationId: allocation.id, stream: allocation.stream, state: diagnostics.some(item => item.severity === "error") ? "unresolved" : "calculated-design-flow", routeIds, inlineComponentIds: [...new Set(componentRequests.map(item => item.componentId))], componentPassages, pressureLossPa: diagnostics.length ? null : total, diagnostics };
}

function componentInputKey(componentId, passageId) { return `${componentId}\u0000${passageId ?? ""}`; }
function uniqueComponentPassages(items) { const seen = new Set(); return items.filter(item => { const key = componentInputKey(item.componentId, item.passageId); if (seen.has(key)) return false; seen.add(key); return true; }); }

function inspectSpaceAllocation(project, floorId, mode, allocations) {
  const diagnostics = [];
  const lines = [];
  const activeSpaces = project.rooms.filter(room => room.floorId === floorId).flatMap(room => {
    const zones = project.zones.filter(zone => zone.parentRoomId === room.id);
    return zones.length ? zones.map(zone => ({ kind: "zone", space: zone })) : [{ kind: "room", space: room }];
  });
  for (const { kind, space } of activeSpaces) {
    if (!["supply", "extract"].includes(space.ventilationRole)) continue;
    const matching = allocations.filter(allocation => allocation.spaceKind === kind && allocation.spaceId === space.id);
    const allocatedLps = matching.reduce((sum, allocation) => sum + allocation.valueLps, 0);
    const target = mode === "normal" ? space.airflowTargets.normal.assigned : null;
    const targetLps = mode === "normal" ? (target?.state === "known" ? target.valueLps : null) : null;
    const differenceLps = targetLps === null ? null : allocatedLps - targetLps;
    const state = mode !== "normal"
      ? matching.length === 0 || allocatedLps <= EPSILON ? "mode-allocation-missing" : "allocated-explicit-mode-profile"
      : targetLps === null ? "target-not-set-for-mode" : Math.abs(differenceLps) <= EPSILON ? "allocated" : "allocation-mismatch";
    if (["allocation-mismatch", "target-not-set-for-mode", "mode-allocation-missing"].includes(state)) diagnostics.push(diagnostic(state, "error", state === "allocation-mismatch" ? `${space.name} terminal allocations differ from its assigned ${mode} target by ${formatNumber(differenceLps)} L/s.` : state === "mode-allocation-missing" ? `${space.name} has no explicit positive terminal allocation for ${mode} mode.` : `${space.name} has no explicit assigned ${mode} target.`, { spaceKind: kind, spaceId: space.id }));
    lines.push({ spaceKind: kind, spaceId: space.id, name: space.name, stream: space.ventilationRole, targetLps, allocatedLps, differenceLps, allocationIds: matching.map(item => item.id), state });
  }
  const activeKeys = new Set(activeSpaces.map(({ kind, space }) => `${kind}\u0000${space.id}`));
  for (const allocation of allocations) if (!activeKeys.has(`${allocation.spaceKind}\u0000${allocation.spaceId}`)) diagnostics.push(diagnostic("allocation-space-invalid", "error", `Allocation ${allocation.id} references a missing or inactive room/zone.`, { allocationId: allocation.id, spaceKind: allocation.spaceKind, spaceId: allocation.spaceId }));
  return { lines, diagnostics };
}

function evaluateUnitStream(stream, unitComponentId, allocations, paths, fanCurves, componentById) {
  const diagnostics = [];
  const streamAllocations = allocations.filter(allocation => allocation.stream === stream && allocation.root?.componentId === unitComponentId);
  const designFlowLps = streamAllocations.reduce((sum, allocation) => sum + allocation.valueLps, 0);
  const allocationIds = new Set(streamAllocations.map(allocation => allocation.id));
  const streamPaths = paths.filter(path => allocationIds.has(path.allocationId));
  const unresolvedPathCount = streamPaths.filter(path => path.pressureLossPa === null).length;
  const knownCritical = streamPaths.filter(path => path.pressureLossPa !== null).sort((a, b) => b.pressureLossPa - a.pressureLossPa)[0] ?? null;
  const requiredExternalStaticPressurePa = unresolvedPathCount === 0 && streamPaths.length > 0 ? knownCritical.pressureLossPa : null;
  if (streamPaths.length === 0) diagnostics.push(diagnostic("stream-no-paths", "error", `Unit ${unitComponentId} has no connected ${stream} terminal path.`, { stream, unitComponentId }));
  if (unresolvedPathCount > 0) diagnostics.push(diagnostic("stream-paths-unresolved", "error", `${unresolvedPathCount} ${stream} path${unresolvedPathCount === 1 ? " is" : "s are"} unresolved for unit ${unitComponentId}, so required fan pressure is not calculated.`, { stream, unitComponentId }));
  if (!Number.isFinite(designFlowLps)) diagnostics.push(diagnostic("stream-flow-out-of-range", "error", `${stream} terminal allocations exceed the finite calculation range for unit ${unitComponentId}.`, { stream, unitComponentId }));
  const fanCurve = fanCurves.find(curve => curve.stream === stream && curve.unitComponentId === unitComponentId)
    ?? fanCurves.find(curve => curve.stream === stream)
    ?? null;
  const fanDuty = evaluateFanDuty(fanCurve, Number.isFinite(designFlowLps) ? designFlowLps * 3.6 : null, requiredExternalStaticPressurePa, unitComponentId, componentById.get(unitComponentId));
  diagnostics.push(...fanDuty.diagnostics);
  return { unitComponentId, stream, designFlowLps, designFlowM3h: designFlowLps * 3.6, pathCount: streamPaths.length, unresolvedPathCount, criticalPathAllocationId: requiredExternalStaticPressurePa === null ? null : knownCritical.allocationId, requiredExternalStaticPressurePa, fanDuty, diagnostics };
}

function aggregateUnitStreams(stream, units) {
  const results = Object.values(units).map(unit => unit.streams[stream]);
  const designFlowLps = results.reduce((sum, result) => sum + result.designFlowLps, 0);
  const pathCount = results.reduce((sum, result) => sum + result.pathCount, 0);
  const unresolvedPathCount = results.reduce((sum, result) => sum + result.unresolvedPathCount, 0);
  if (results.length === 1) return { ...structuredClone(results[0]), unitCount: 1, unitResults: structuredClone(results) };
  return {
    stream, unitCount: results.length, designFlowLps, designFlowM3h: designFlowLps * 3.6,
    pathCount, unresolvedPathCount, criticalPathAllocationId: null, requiredExternalStaticPressurePa: null,
    fanDuty: { state: "per-unit-only", availableExternalStaticPressurePa: null, marginPa: null, diagnostics: [] },
    unitResults: structuredClone(results), diagnostics: [],
  };
}

function evaluateOperatingPointModel(stream, unitComponentId, unitStream, design, componentById, project) {
  const model = (design.operatingPointModels ?? []).find(item => item.stream === stream && item.unitComponentId === unitComponentId) ?? null;
  if (!model) return { unitComponentId, stream, state: "not-configured", airflowLps: null, airflowM3h: null, pressurePa: null, diagnostics: [] };
  const diagnostics = [];
  const unit = componentById.get(unitComponentId);
  if (!unit || model.unitConfigurationFingerprint !== engineeringComponentFingerprint(unit) || model.networkConfigurationFingerprint !== engineeringSystemFingerprint(project, design.floorId, unitComponentId, stream)) {
    diagnostics.push(diagnostic("operating-point-model-stale", "error", `The ${stream} system-pressure curve is not bound to the current unit and network configuration for ${unitComponentId}.`, { stream, unitComponentId }));
    return { unitComponentId, stream, state: "unresolved", airflowLps: null, airflowM3h: null, pressurePa: null, diagnostics };
  }
  if (unitStream.pathCount === 0 || unitStream.unresolvedPathCount > 0) {
    diagnostics.push(diagnostic("operating-point-topology-unresolved", "error", `Operating-point solving for unit ${unitComponentId} ${stream} requires complete, uniquely connected design-flow paths.`, { stream, unitComponentId }));
    return { unitComponentId, stream, state: "unresolved", airflowLps: null, airflowM3h: null, pressurePa: null, diagnostics };
  }
  const fanCurve = design.fanCurves.find(curve => curve.state === "known" && curve.stream === stream && curve.unitComponentId === unitComponentId) ?? null;
  if (!fanCurve || fanCurve.unitConfigurationFingerprint !== engineeringComponentFingerprint(unit) || fanCurve.pressureConvention !== "external-static" || !fanCurve.filterCondition) {
    diagnostics.push(diagnostic("operating-point-fan-evidence-unresolved", "error", `Operating-point solving for unit ${unitComponentId} ${stream} requires a current externally-rated fan curve and explicit filter condition.`, { stream, unitComponentId }));
    return { unitComponentId, stream, state: "unresolved", airflowLps: null, airflowM3h: null, pressurePa: null, diagnostics };
  }
  const solved = solveOperatingPoint(
    fanCurve.points.map(point => ({ flowLps: point.airflowM3h / 3.6, pressureLossPa: point.externalStaticPressurePa })),
    model.systemPressurePoints,
  );
  diagnostics.push(...solved.diagnostics.map(item => ({ ...item, target: { stream, unitComponentId } })));
  return {
    unitComponentId, stream, state: solved.state,
    airflowLps: solved.airflowLps ?? null, airflowM3h: solved.airflowM3h ?? null, pressurePa: solved.pressurePa ?? null,
    residualPa: solved.residualPa ?? null, residualTolerancePa: solved.residualTolerancePa ?? null, iterations: solved.iterations ?? null,
    fanCurve: { filterCondition: fanCurve.filterCondition, basis: fanCurve.basis, source: fanCurve.source, sourceVersion: fanCurve.sourceVersion },
    systemCurve: { basis: model.basis, source: model.source, sourceVersion: model.sourceVersion }, diagnostics,
  };
}

function evaluateDesignBalance(streams, unitComponentId = null) {
  const supplyLps = streams.supply?.designFlowLps ?? null, extractLps = streams.extract?.designFlowLps ?? null;
  const target = unitComponentId === null ? { scope: "floor-option" } : { unitComponentId };
  const subject = unitComponentId === null ? "Floor/option" : `Unit ${unitComponentId}`;
  if (![supplyLps, extractLps].every(Number.isFinite)) return { state: "unresolved", supplyLps, extractLps, differenceLps: null, diagnostics: [diagnostic("design-balance-unresolved", "error", `${subject} supply/extract design-flow balance is outside the finite calculation range.`, target)] };
  const differenceLps = supplyLps - extractLps;
  return {
    state: Math.abs(differenceLps) <= EPSILON ? "arithmetically-balanced" : "imbalance-review-required",
    supplyLps, extractLps, differenceLps,
    diagnostics: Math.abs(differenceLps) <= EPSILON ? [] : [diagnostic("design-flow-imbalance", "warning", `${subject} assigned supply and extract design flows differ by ${formatNumber(differenceLps)} L/s. No compliance tolerance is inferred; review the intended balance.`, target)],
  };
}

function evaluateFanDuty(curve, airflowM3h, requiredPa, rootComponentId, rootComponent) {
  const diagnostics = [];
  if (!curve || curve.state !== "known") {
    diagnostics.push(diagnostic("fan-curve-unresolved", "error", "A verified fan curve is not available for this stream and mode.", {}));
    return { state: "unresolved", availableExternalStaticPressurePa: null, marginPa: null, diagnostics };
  }
  if (airflowM3h === null || !Number.isFinite(airflowM3h)) {
    diagnostics.push(diagnostic("fan-duty-flow-out-of-range", "error", "Fan-duty airflow is outside the finite calculation range.", {}));
    return { state: "unresolved", availableExternalStaticPressurePa: null, marginPa: null, diagnostics };
  }
  if (!rootComponentId || curve.unitComponentId !== rootComponentId || curve.unitConfigurationFingerprint !== engineeringComponentFingerprint(rootComponent)) {
    diagnostics.push(diagnostic("fan-curve-unit-mismatch", "error", "The saved fan curve is not bound to the one unit root and its current configuration for this stream.", { unitComponentId: curve.unitComponentId }));
    return { state: "unit-mismatch", availableExternalStaticPressurePa: null, marginPa: null, diagnostics };
  }
  if (curve.pressureConvention !== "external-static" || !curve.filterCondition) {
    diagnostics.push(diagnostic("fan-curve-condition-unresolved", "error", "The saved fan curve needs an explicit external-static convention and filter condition before duty screening.", {}));
    return { state: "condition-unresolved", availableExternalStaticPressurePa: null, marginPa: null, diagnostics };
  }
  const first = curve.points[0], last = curve.points.at(-1);
  if (airflowM3h < first.airflowM3h - EPSILON || airflowM3h > last.airflowM3h + EPSILON) {
    diagnostics.push(diagnostic("fan-curve-outside-domain", "error", `Design airflow ${formatNumber(airflowM3h)} m³/h is outside the verified fan-curve domain ${first.airflowM3h}–${last.airflowM3h} m³/h; extrapolation is blocked.`, {}));
    return { state: "outside-verified-domain", availableExternalStaticPressurePa: null, marginPa: null, diagnostics };
  }
  const upperIndex = curve.points.findIndex(point => point.airflowM3h >= airflowM3h - EPSILON);
  const upper = curve.points[Math.max(upperIndex, 0)], lower = curve.points[Math.max(0, upperIndex - 1)];
  const ratio = Math.abs(upper.airflowM3h - lower.airflowM3h) <= EPSILON ? 0 : (airflowM3h - lower.airflowM3h) / (upper.airflowM3h - lower.airflowM3h);
  const available = lower.externalStaticPressurePa + ratio * (upper.externalStaticPressurePa - lower.externalStaticPressurePa);
  if (!Number.isFinite(available)) {
    diagnostics.push(diagnostic("fan-curve-calculation-out-of-range", "error", "Fan-curve interpolation is outside the finite calculation range.", {}));
    return { state: "unresolved", availableExternalStaticPressurePa: null, marginPa: null, diagnostics };
  }
  if (requiredPa === null) return { state: "network-duty-unresolved", availableExternalStaticPressurePa: available, marginPa: null, diagnostics };
  const marginPa = available - requiredPa;
  if (marginPa < -EPSILON) diagnostics.push(diagnostic("fan-duty-insufficient", "error", `The verified fan curve provides ${formatNumber(available)} Pa at ${formatNumber(airflowM3h)} m³/h, below the calculated ${formatNumber(requiredPa)} Pa design-flow requirement.`, {}));
  return { state: marginPa >= -EPSILON ? "sufficient-at-design-duty-review-required" : "insufficient-at-design-duty", availableExternalStaticPressurePa: available, requiredExternalStaticPressurePa: requiredPa, marginPa, pressureConvention: curve.pressureConvention, filterCondition: curve.filterCondition, source: curve.source, sourceVersion: curve.sourceVersion, diagnostics };
}

function darcyFrictionFactor(reynoldsNumber, relativeRoughness, shape) {
  if (reynoldsNumber < 2300 && shape !== "circular") return { state: "rectangular-laminar-unresolved", regime: "laminar-rectangular", factor: null };
  if (reynoldsNumber < 2300) return { state: "known", regime: "laminar-circular", factor: 64 / reynoldsNumber };
  if (reynoldsNumber < 4000) return { state: "transitional-unresolved", regime: "transitional", factor: null };
  return { state: "known", regime: "turbulent-haaland", factor: 1 / (-1.8 * Math.log10((relativeRoughness / 3.7) ** 1.11 + 6.9 / reynoldsNumber)) ** 2 };
}

function finiteNonNegative(value) { return Number.isFinite(value) && value >= 0; }
function finitePositive(value) { return Number.isFinite(value) && value > 0; }

function cyclicComponents(adjacency) {
  const visited = new Set(), cyclic = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const nodes = [], edgeIds = new Set(), stack = [start];
    while (stack.length) {
      const node = stack.pop();
      if (visited.has(node)) continue;
      visited.add(node); nodes.push(node);
      for (const edge of adjacency.get(node) ?? []) { edgeIds.add(edge.id); if (!visited.has(edge.to)) stack.push(edge.to); }
    }
    if (edgeIds.size >= nodes.length && nodes.length > 1) cyclic.push({ nodeCount: nodes.length, edgeCount: edgeIds.size });
  }
  return cyclic;
}

function resolveUniquePath(start, target, adjacency) {
  if (!adjacency.has(start) || !adjacency.has(target)) return { state: "disconnected", path: null };
  const paths = [];
  const visit = (node, visitedNodes, path) => {
    if (paths.length >= 2) return;
    if (node === target) { paths.push([...path]); return; }
    for (const edge of adjacency.get(node) ?? []) {
      if (visitedNodes.has(edge.to)) continue;
      visitedNodes.add(edge.to); path.push(edge);
      visit(edge.to, visitedNodes, path);
      path.pop(); visitedNodes.delete(edge.to);
      if (paths.length >= 2) return;
    }
  };
  visit(start, new Set([start]), []);
  if (paths.length === 0) return { state: "disconnected", path: null };
  if (paths.length > 1) return { state: "ambiguous", path: null };
  return { state: "unique", path: paths[0] };
}

function emptyResult(floorId, mode, message) { return deepFreeze({ kind: "mvhr-engineering-evaluation.v1", floorId, mode, status: "not-configured", design: null, allocations: [], spaceChecks: { lines: [], diagnostics: [] }, routes: [], paths: [], streams: {}, diagnostics: [diagnostic("network-design-missing", "error", message, {})], assumptions: null, evidenceBoundary: "No engineering result is available without explicit sourced inputs." }); }
function unitStreamKey(unitComponentId, stream) { return `${unitComponentId ?? "unresolved"}\u0000${stream}`; }
function endpointKey(componentId, portId) { return JSON.stringify([componentId, portId]); }
function diagnostic(code, severity, message, target) { return { code, severity, message, target }; }
function uniqueDiagnostics(items) { const seen = new Set(); return items.filter(item => { const key = JSON.stringify(item); if (seen.has(key)) return false; seen.add(key); return true; }); }
function formatNumber(value) { return Number(value.toFixed(3)).toLocaleString("en-AU"); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
