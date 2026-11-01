import { routeLengthSummary, validateProject } from "../domain/spatial.mjs";

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
  const routes = project.routes.filter(route => route.floorId === floorId);
  const componentById = new Map(components.map(component => [component.id, component]));
  const routeById = new Map(routes.map(route => [route.id, route]));
  const graph = createEngineeringGraph(components, routes, project.connections, componentById);
  const diagnostics = [...graph.diagnostics];
  const roots = rootEndpoints(components);
  const cycleEdges = cyclicEdgeIds(graph.adjacency);
  if (cycleEdges.size > 0) diagnostics.push(diagnostic("unsupported-cycle", "error", `The engineering graph contains an unsupported loop involving ${cycleEdges.size} edge${cycleEdges.size === 1 ? "" : "s"}.`, { edgeIds: [...cycleEdges] }));

  const allocations = design.terminalAllocations.map(allocation => evaluateAllocation(allocation, componentById, roots, graph, cycleEdges, diagnostics));
  const boundaries = Object.fromEntries(["supply", "extract"].map(stream => [stream, evaluateSystemBoundary(stream, components, roots, graph, cycleEdges)]));
  for (const boundary of Object.values(boundaries)) diagnostics.push(...boundary.diagnostics);
  const routeFlows = accumulateRouteFlows(allocations, boundaries);
  const routeInputs = new Map(design.routeResistanceInputs.map(input => [input.routeId, input]));
  const routeResults = routes.map(route => evaluateRoute(route, routeFlows.get(route.id) ?? 0, routeInputs.get(route.id) ?? null, design.fluid));
  const routeResultById = new Map(routeResults.map(result => [result.routeId, result]));
  const componentInputs = new Map(design.componentResistanceInputs.map(input => [input.componentId, input]));
  const paths = allocations.map(allocation => evaluatePath(allocation, boundaries[allocation.stream], componentById, routeResultById, componentInputs));
  const spaceChecks = inspectSpaceAllocation(project, floorId, mode, design.terminalAllocations);
  diagnostics.push(...spaceChecks.diagnostics);
  const streams = Object.fromEntries(["supply", "extract"].map(stream => [stream, evaluateStream(stream, allocations, paths, design.fanCurves)]));
  for (const stream of Object.values(streams)) diagnostics.push(...stream.diagnostics);
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
    streams,
    diagnostics: uniqueDiagnostics(diagnostics),
    assumptions: {
      densityKgM3: design.fluid.densityKgM3,
      dynamicViscosityPaS: design.fluid.dynamicViscosityPaS,
      basis: design.fluid.basis,
      source: design.fluid.source,
      elevationStaticHeadApplied: false,
    },
    evidenceBoundary: "Design-target evaluation only. Flows come from explicit terminal allocations, not predicted delivery. Pressure uses only saved internal diameters, roughness, fitting K values and explicit component/terminal losses. Missing evidence blocks a complete path. Elevation is used for developed length only and does not create a static-head penalty in the closed air circuit. Fan curves are interpolated only within saved verified points and are never extrapolated.",
  });
}

function createEngineeringGraph(components, routes, connections, componentById) {
  const adjacency = new Map();
  const componentByEndpoint = new Map();
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
    }
    const groups = new Map();
    for (const port of component.ports) {
      if (port.system !== "mvhr") continue;
      const key = `${port.stream}\u0000${port.role}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(endpointKey(component.id, port.id));
    }
    for (const endpoints of groups.values()) for (let index = 1; index < endpoints.length; index += 1) addEdge({ id: `internal:${component.id}:${index}`, kind: "internal", componentId: component.id, from: endpoints[0], to: endpoints[index] });
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
    addEdge({ id: `connection:${connection.id}`, kind: "connection", connectionId: connection.id, from: endpointKey(connection.from.componentId, connection.from.portId), to: endpointKey(connection.to.componentId, connection.to.portId) });
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

function evaluateSystemBoundary(stream, components, roots, graph, cycleEdges) {
  const diagnostics = [];
  const role = stream === "supply" ? "Outdoor intake" : "Outdoor exhaust";
  const unitRoots = roots[stream] ?? [];
  if (cycleEdges.size > 0) return { stream, role, state: "unresolved", routeIds: [], componentIds: [], diagnostics };
  if (unitRoots.length !== 1) {
    diagnostics.push(diagnostic("boundary-unit-root-invalid", "error", `${stream} system-boundary evaluation requires exactly one supported unit root.`, { stream }));
    return { stream, role, state: "unresolved", routeIds: [], componentIds: [], diagnostics };
  }
  const unitComponentId = unitRoots[0].componentId;
  const unitBoundaryPorts = components.filter(item => item.id === unitComponentId).flatMap(component => component.ports.filter(port => port.role === role).map(port => ({ componentId: component.id, portId: port.id, key: endpointKey(component.id, port.id) })));
  const outsidePorts = components.filter(item => item.id !== unitComponentId).flatMap(component => component.ports.filter(port => port.role === role).map(port => ({ componentId: component.id, portId: port.id, key: endpointKey(component.id, port.id) })));
  if (unitBoundaryPorts.length !== 1 || outsidePorts.length !== 1) {
    diagnostics.push(diagnostic("system-boundary-count-invalid", "error", `${stream} pressure evaluation requires one unit ${role} port and one explicit external ${role} terminal; found ${unitBoundaryPorts.length} unit and ${outsidePorts.length} external.`, { stream, role }));
    return { stream, role, state: "unresolved", routeIds: [], componentIds: [], diagnostics };
  }
  const path = uniquePath(unitBoundaryPorts[0].key, outsidePorts[0].key, graph.adjacency);
  if (!path) {
    diagnostics.push(diagnostic("system-boundary-disconnected", "error", `${role} is not connected to the selected unit, so the ${stream} fan path is incomplete.`, { stream, componentId: outsidePorts[0].componentId }));
    return { stream, role, state: "unresolved", routeIds: [], componentIds: [outsidePorts[0].componentId], diagnostics };
  }
  return {
    stream,
    role,
    state: "connected-unique-path",
    routeIds: path.filter(edge => edge.kind === "route").map(edge => edge.routeId),
    componentIds: [...new Set(path.flatMap(edge => [graph.componentByEndpoint.get(edge.from), graph.componentByEndpoint.get(edge.to)]).filter(componentId => componentId && componentId !== unitComponentId))],
    diagnostics,
  };
}

function evaluateAllocation(allocation, componentById, roots, graph, cycleEdges, diagnostics) {
  const component = componentById.get(allocation.componentId);
  const port = component?.ports.find(candidate => candidate.id === allocation.portId) ?? null;
  const stream = port?.stream ?? "unknown";
  const result = { ...structuredClone(allocation), stream, endpointKey: endpointKey(allocation.componentId, allocation.portId), routeIds: [], componentIds: [], root: null, graphStatus: "blocked" };
  if (!port || !["supply", "extract"].includes(stream)) {
    diagnostics.push(diagnostic("allocation-terminal-invalid", "error", `Allocation ${allocation.id} does not reference one typed supply/extract terminal port.`, { allocationId: allocation.id }));
    return result;
  }
  if (cycleEdges.size > 0) return result;
  const candidates = roots[stream] ?? [];
  if (candidates.length !== 1) {
    diagnostics.push(diagnostic("root-count-invalid", "error", `${stream} engineering evaluation requires exactly one supported unit root; found ${candidates.length}.`, { allocationId: allocation.id, stream }));
    return result;
  }
  const path = uniquePath(result.endpointKey, candidates[0].key, graph.adjacency);
  if (!path) {
    diagnostics.push(diagnostic("allocation-disconnected", "error", `Allocation ${allocation.id} has no connected ${stream} path to the selected unit root.`, { allocationId: allocation.id, componentId: allocation.componentId }));
    return result;
  }
  result.routeIds = path.filter(edge => edge.kind === "route").map(edge => edge.routeId);
  result.componentIds = [...new Set(path.flatMap(edge => [
    graph.componentByEndpoint.get(edge.from),
    graph.componentByEndpoint.get(edge.to),
  ]).filter(Boolean))];
  result.root = structuredClone(candidates[0]);
  result.graphStatus = "connected-unique-path";
  return result;
}

function accumulateRouteFlows(allocations, boundaries) {
  const totals = new Map();
  for (const allocation of allocations) if (allocation.graphStatus === "connected-unique-path") for (const routeId of allocation.routeIds) totals.set(routeId, (totals.get(routeId) ?? 0) + allocation.valueLps);
  for (const stream of ["supply", "extract"]) {
    const boundary = boundaries[stream];
    if (boundary?.state !== "connected-unique-path") continue;
    const flowLps = allocations.filter(allocation => allocation.stream === stream && allocation.graphStatus === "connected-unique-path").reduce((sum, allocation) => sum + allocation.valueLps, 0);
    for (const routeId of boundary.routeIds) totals.set(routeId, (totals.get(routeId) ?? 0) + flowLps);
  }
  return totals;
}

function evaluateRoute(route, flowLps, input, fluid) {
  const diagnostics = [];
  const length = routeLengthSummary(route);
  const parallelRunCount = route.parallelRunCount;
  if (flowLps <= EPSILON) return { routeId: route.id, stream: route.stream, state: "unused", flowLps: 0, parallelRunCount, velocityMps: 0, reynoldsNumber: 0, frictionFactor: 0, pressureLossPa: 0, diagnostics };
  if (!input) diagnostics.push(diagnostic("route-resistance-missing", "error", `Route ${route.id} has flow but no sourced resistance input.`, { routeId: route.id }));
  if (parallelRunCount === null) diagnostics.push(diagnostic("route-parallel-count-missing", "error", `Route ${route.id} needs an explicit Single or Twin physical run count before velocity can be calculated.`, { routeId: route.id }));
  if (length.developedMm === null) diagnostics.push(diagnostic("route-developed-length-missing", "error", `Route ${route.id} has unknown elevation, so developed length is unresolved.`, { routeId: route.id }));
  if (!input || parallelRunCount === null || length.developedMm === null) return { routeId: route.id, stream: route.stream, state: "unresolved", flowLps, parallelRunCount, developedLengthMm: length.developedMm, velocityMps: null, reynoldsNumber: null, frictionFactor: null, pressureLossPa: null, diagnostics };
  if (input.additionalPressureLoss.state !== "known") diagnostics.push(diagnostic("route-additional-loss-missing", "error", `Route ${route.id} additional fitting/product loss is unresolved; enter an evidenced value, including an explicit sourced 0 Pa when genuinely none applies.`, { routeId: route.id }));
  const flowPerRunM3s = flowLps / 1000 / parallelRunCount;
  const diameterM = input.internalDiameterMm / 1000;
  const areaM2 = Math.PI * diameterM * diameterM / 4;
  const velocityMps = flowPerRunM3s / areaM2;
  const reynoldsNumber = fluid.densityKgM3 * velocityMps * diameterM / fluid.dynamicViscosityPaS;
  const relativeRoughness = input.roughnessMm / input.internalDiameterMm;
  const frictionFactor = darcyFrictionFactor(reynoldsNumber, relativeRoughness);
  const dynamicPressurePa = fluid.densityKgM3 * velocityMps * velocityMps / 2;
  const straightLossPa = frictionFactor * (length.developedMm / input.internalDiameterMm) * dynamicPressurePa;
  const fittingLossPa = input.fittingKTotal * dynamicPressurePa;
  const additionalLossPa = input.additionalPressureLoss.state === "known" ? input.additionalPressureLoss.valuePa : null;
  const pressureLossPa = additionalLossPa === null ? null : straightLossPa + fittingLossPa + additionalLossPa;
  return { routeId: route.id, stream: route.stream, state: pressureLossPa === null ? "unresolved" : "calculated-design-flow", flowLps, flowPerRunLps: flowLps / parallelRunCount, parallelRunCount, developedLengthMm: length.developedMm, internalDiameterMm: input.internalDiameterMm, areaPerRunM2: areaM2, velocityMps, reynoldsNumber, frictionFactor, dynamicPressurePa, straightLossPa, fittingLossPa, additionalLossPa, pressureLossPa, basis: input.basis, source: input.source, diagnostics };
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
  const inlineComponentIds = [...new Set([
    ...allocation.componentIds.filter(componentId => componentId !== terminalComponentId && componentId !== rootComponentId && (componentById.get(componentId)?.ports.length ?? 0) > 1),
    ...(boundary?.componentIds ?? []),
  ])];
  for (const componentId of inlineComponentIds) {
    const input = componentInputs.get(componentId);
    if (!input || input.pressureLoss.state !== "known") diagnostics.push(diagnostic("component-loss-unresolved", "error", `Path ${allocation.id} needs sourced pressure loss for inline component ${componentId}.`, { allocationId: allocation.id, componentId }));
    else total += input.pressureLoss.valuePa;
  }
  return { allocationId: allocation.id, stream: allocation.stream, state: diagnostics.some(item => item.severity === "error") ? "unresolved" : "calculated-design-flow", routeIds, inlineComponentIds, pressureLossPa: diagnostics.length ? null : total, diagnostics };
}

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
    const targetLps = mode === "normal" ? (target?.state === "known" ? target.valueLps : null) : allocatedLps;
    const differenceLps = targetLps === null ? null : allocatedLps - targetLps;
    const state = mode !== "normal" ? "allocated-explicit-mode-profile" : targetLps === null ? "target-not-set-for-mode" : Math.abs(differenceLps) <= EPSILON ? "allocated" : "allocation-mismatch";
    if (["allocation-mismatch", "target-not-set-for-mode"].includes(state)) diagnostics.push(diagnostic(state, "error", state === "allocation-mismatch" ? `${space.name} terminal allocations differ from its assigned ${mode} target by ${formatNumber(differenceLps)} L/s.` : `${space.name} has no explicit assigned ${mode} target.`, { spaceKind: kind, spaceId: space.id }));
    lines.push({ spaceKind: kind, spaceId: space.id, name: space.name, stream: space.ventilationRole, targetLps, allocatedLps, differenceLps, allocationIds: matching.map(item => item.id), state });
  }
  return { lines, diagnostics };
}

function evaluateStream(stream, allocations, paths, fanCurves) {
  const diagnostics = [];
  const streamAllocations = allocations.filter(allocation => allocation.stream === stream);
  const designFlowLps = streamAllocations.reduce((sum, allocation) => sum + allocation.valueLps, 0);
  const streamPaths = paths.filter(path => path.stream === stream);
  const unresolvedPathCount = streamPaths.filter(path => path.pressureLossPa === null).length;
  const knownCritical = streamPaths.filter(path => path.pressureLossPa !== null).sort((a, b) => b.pressureLossPa - a.pressureLossPa)[0] ?? null;
  const requiredExternalStaticPressurePa = unresolvedPathCount === 0 && streamPaths.length > 0 ? knownCritical.pressureLossPa : null;
  if (streamPaths.length === 0) diagnostics.push(diagnostic("stream-no-paths", "error", `No connected ${stream} terminal path is available.`, { stream }));
  if (unresolvedPathCount > 0) diagnostics.push(diagnostic("stream-paths-unresolved", "error", `${unresolvedPathCount} ${stream} path${unresolvedPathCount === 1 ? " is" : "s are"} unresolved, so required fan pressure is not calculated.`, { stream }));
  const fanCurve = fanCurves.find(curve => curve.stream === stream) ?? null;
  const fanDuty = evaluateFanDuty(fanCurve, designFlowLps * 3.6, requiredExternalStaticPressurePa);
  diagnostics.push(...fanDuty.diagnostics);
  return { stream, designFlowLps, designFlowM3h: designFlowLps * 3.6, pathCount: streamPaths.length, unresolvedPathCount, criticalPathAllocationId: requiredExternalStaticPressurePa === null ? null : knownCritical.allocationId, requiredExternalStaticPressurePa, fanDuty, diagnostics };
}

function evaluateFanDuty(curve, airflowM3h, requiredPa) {
  const diagnostics = [];
  if (!curve || curve.state !== "known") {
    diagnostics.push(diagnostic("fan-curve-unresolved", "error", "A verified fan curve is not available for this stream and mode.", {}));
    return { state: "unresolved", availableExternalStaticPressurePa: null, marginPa: null, diagnostics };
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
  if (requiredPa === null) return { state: "network-duty-unresolved", availableExternalStaticPressurePa: available, marginPa: null, diagnostics };
  const marginPa = available - requiredPa;
  if (marginPa < -EPSILON) diagnostics.push(diagnostic("fan-duty-insufficient", "error", `The verified fan curve provides ${formatNumber(available)} Pa at ${formatNumber(airflowM3h)} m³/h, below the calculated ${formatNumber(requiredPa)} Pa design-flow requirement.`, {}));
  return { state: marginPa >= -EPSILON ? "sufficient-at-design-duty-review-required" : "insufficient-at-design-duty", availableExternalStaticPressurePa: available, requiredExternalStaticPressurePa: requiredPa, marginPa, source: curve.source, sourceVersion: curve.sourceVersion, diagnostics };
}

function darcyFrictionFactor(reynoldsNumber, relativeRoughness) {
  if (reynoldsNumber <= 0) return 0;
  if (reynoldsNumber < 2300) return 64 / reynoldsNumber;
  return 1 / (-1.8 * Math.log10((relativeRoughness / 3.7) ** 1.11 + 6.9 / reynoldsNumber)) ** 2;
}

function cyclicEdgeIds(adjacency) {
  const seenNodes = new Set(), cycleEdges = new Set();
  function visit(node, parentEdgeId) {
    seenNodes.add(node);
    for (const edge of adjacency.get(node) ?? []) {
      if (edge.id === parentEdgeId) continue;
      if (seenNodes.has(edge.to)) cycleEdges.add(edge.id);
      else visit(edge.to, edge.id);
    }
  }
  for (const node of adjacency.keys()) if (!seenNodes.has(node)) visit(node, null);
  return cycleEdges;
}

function uniquePath(start, target, adjacency) {
  if (!adjacency.has(start) || !adjacency.has(target)) return null;
  const queue = [start], prior = new Map([[start, null]]), via = new Map();
  while (queue.length) {
    const node = queue.shift();
    if (node === target) break;
    for (const edge of adjacency.get(node) ?? []) if (!prior.has(edge.to)) { prior.set(edge.to, node); via.set(edge.to, edge); queue.push(edge.to); }
  }
  if (!prior.has(target)) return null;
  const path = [];
  for (let node = target; node !== start; node = prior.get(node)) path.push(via.get(node));
  return path.reverse();
}

function emptyResult(floorId, mode, message) { return deepFreeze({ kind: "mvhr-engineering-evaluation.v1", floorId, mode, status: "not-configured", design: null, allocations: [], spaceChecks: { lines: [], diagnostics: [] }, routes: [], paths: [], streams: {}, diagnostics: [diagnostic("network-design-missing", "error", message, {})], assumptions: null, evidenceBoundary: "No engineering result is available without explicit sourced inputs." }); }
function endpointKey(componentId, portId) { return JSON.stringify([componentId, portId]); }
function diagnostic(code, severity, message, target) { return { code, severity, message, target }; }
function uniqueDiagnostics(items) { const seen = new Set(); return items.filter(item => { const key = JSON.stringify(item); if (seen.has(key)) return false; seen.add(key); return true; }); }
function formatNumber(value) { return Number(value.toFixed(3)).toLocaleString("en-AU"); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
