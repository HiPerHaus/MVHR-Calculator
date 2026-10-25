import { inspectExternalGrilleSeparation } from "./external-grille-spacing.mjs";
import { routeLengthSummary, validateProject } from "../domain/spatial.mjs";
import { routeFamilyForKind } from "./component-catalogue.mjs";
import { inspectRoutingCoordination } from "./routing-coordination.mjs";

const REQUIRED_HRV_ROLES = Object.freeze(["Dwelling supply", "Dwelling extract"]);

export function auditVentilation(project, floorId) {
  validateProject(project);
  const floor = project.floors.find((candidate) => candidate.id === floorId);
  if (!floor) throw new TypeError(`Floor not found: ${String(floorId)}`);

  const components = project.components.filter((component) => component.floorId === floorId);
  const componentIds = new Set(components.map((component) => component.id));
  const assemblies = project.equipmentAssemblies.filter((assembly) => assembly.floorId === floorId);
  const routes = project.routes.filter((route) => route.floorId === floorId);
  const connections = project.connections.filter((connection) => (
    componentIds.has(connection.from.componentId) && componentIds.has(connection.to.componentId)
  ));
  const componentById = new Map(components.map((component) => [component.id, component]));
  const assemblyByComponentId = new Map();
  for (const assembly of assemblies) {
    for (const componentId of assembly.componentIds) assemblyByComponentId.set(componentId, assembly);
  }

  const graph = createPortGraph(components, routes, connections);
  const diagnostics = [];
  const unitPortsByRole = genericUnitPortsByRole(components);
  const distributionPortsByRole = distributionMainPortsByRole(components, assemblies, connections);

  inspectRoutes(routes, componentById, diagnostics);
  inspectDirectConnections(connections, componentById, diagnostics);
  inspectSetoutOnlyUnits(components, diagnostics);
  inspectUnitMainPaths(unitPortsByRole, distributionPortsByRole, graph, diagnostics);
  inspectAssemblyMainPaths(assemblies, distributionPortsByRole, unitPortsByRole, graph, diagnostics);
  inspectOutlets(components, unitPortsByRole, graph, diagnostics);
  diagnostics.push(...inspectRoutingCoordination(project, floorId).diagnostics);
  const externalGrilleSeparation=inspectExternalGrilleSeparation(project,floorId);
  for(const pair of externalGrilleSeparation) {
    if(pair.status === "plan-clearance-met")continue;
    diagnostics.push(diagnostic("external-grille-separation",pair.status==="too-close"?"error":"warning",
      pair.status==="too-close"?"Separate outdoor grilles need 1.5 m between centres":"Outdoor grille clearance needs product dimensions",
      pair.distanceMm===null?`${pair.componentId} / ${pair.otherComponentId}: ${(pair.centreDistanceMm/1000).toFixed(2)} m between centres; clear edge separation cannot be verified for the generic symbol.`:`${pair.componentId} / ${pair.otherComponentId}: ${(pair.distanceMm/1000).toFixed(2)} m centre-to-centre in plan; minimum 1.50 m. Move the intake or exhaust grille farther apart.`,{componentId:pair.componentId}));
  }

  return deepFreeze({
    floorId,
    floorName: floor.name,
    parts: summarizeParts(components, assemblies, assemblyByComponentId),
    routes: summarizeRoutes(routes),
    spareBranches: summarizeSpareBranches(components, graph.externallyOccupied),
    externalGrilleSeparation,
    diagnostics: diagnostics.sort(compareDiagnostics),
    diagnosticCounts: countDiagnostics(diagnostics),
    evidenceBoundary: "Drafting counts and connection topology only. No airflow, pressure, acoustic, product-fit, cap-installed, price or procurement claim is made.",
  });
}

function summarizeParts(components, assemblies, assemblyByComponentId) {
  const groupedComponentIds = new Set(assemblyByComponentId.keys());
  const linesByKey = new Map();
  for (const component of components) {
    const key = component.catalogueRecordVersionId ?? component.catalogueItemId ?? component.id;
    let line = linesByKey.get(key);
    if (!line) {
      line = {
        key,
        name: component.displayName ?? component.id,
        count: 0,
        groupedCount: 0,
        independentCount: 0,
        componentIds: [],
      };
      linesByKey.set(key, line);
    }
    line.count += 1;
    line.componentIds.push(component.id);
    if (groupedComponentIds.has(component.id)) line.groupedCount += 1;
    else line.independentCount += 1;
  }
  return {
    componentCount: components.length,
    assemblyGroupCount: assemblies.length,
    groupedComponentCount: groupedComponentIds.size,
    independentComponentCount: components.length - groupedComponentIds.size,
    lines: [...linesByKey.values()].sort((left, right) => left.name.localeCompare(right.name)),
    assemblyGroups: assemblies.map((assembly) => ({
      id: assembly.id,
      name: assembly.name,
      stream: assembly.stream,
      componentCount: assembly.componentIds.length,
      componentIds: [...assembly.componentIds],
    })),
  };
}

function summarizeRoutes(routes) {
  const groups = new Map();
  let projectedMm = 0;
  let developedMm = 0;
  let developedKnown = true;
  for (const route of routes) {
    const family = routeFamilyForKind(route.ductKind);
    const length = routeLengthSummary(route);
    projectedMm += length.projectedMm;
    if (length.developedMm === null) developedKnown = false;
    else developedMm += length.developedMm;
    let group = groups.get(route.ductKind);
    if (!group) {
      group = {
        ductKind: route.ductKind,
        name: family.name,
        interfaceFamily: family.connectionInterface?.family ?? null,
        nominalSizeMm: family.connectionInterface?.nominalSizeMm ?? null,
        routeCount: 0,
        projectedMm: 0,
        developedMm: 0,
        developedKnown: true,
        routeIds: [],
      };
      groups.set(route.ductKind, group);
    }
    group.routeCount += 1;
    group.projectedMm += length.projectedMm;
    group.routeIds.push(route.id);
    if (length.developedMm === null) group.developedKnown = false;
    else group.developedMm += length.developedMm;
  }
  return {
    routeCount: routes.length,
    projectedMm,
    developedMm: developedKnown ? developedMm : null,
    developedState: developedKnown ? "known" : "unknown",
    groups: [...groups.values()].map((group) => ({
      ...group,
      developedMm: group.developedKnown ? group.developedMm : null,
      developedState: group.developedKnown ? "known" : "unknown",
    })).sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function createPortGraph(components, routes, connections) {
  const adjacency = new Map();
  const externallyOccupied = new Set();
  const ensure = (key) => {
    if (!adjacency.has(key)) adjacency.set(key, new Set());
  };
  const join = (left, right) => {
    ensure(left);
    ensure(right);
    adjacency.get(left).add(right);
    adjacency.get(right).add(left);
  };
  for (const component of components) {
    for (const port of component.ports) ensure(endpointKey(component.id, port.id));
    const groups = new Map();
    for (const port of component.ports) {
      const key = `${port.system}\u0000${port.stream}\u0000${port.role}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(endpointKey(component.id, port.id));
    }
    for (const keys of groups.values()) {
      for (let index = 1; index < keys.length; index += 1) join(keys[0], keys[index]);
    }
  }
  for (const route of routes) {
    for (const endpoint of [route.startAttachment, route.endAttachment]) {
      if (endpoint) externallyOccupied.add(endpointKey(endpoint.componentId, endpoint.portId));
    }
    if (route.startAttachment && route.endAttachment) {
      join(endpointKey(route.startAttachment.componentId, route.startAttachment.portId), endpointKey(route.endAttachment.componentId, route.endAttachment.portId));
    }
  }
  for (const connection of connections) {
    externallyOccupied.add(endpointKey(connection.from.componentId, connection.from.portId));
    externallyOccupied.add(endpointKey(connection.to.componentId, connection.to.portId));
    const fromComponent = components.find((component) => component.id === connection.from.componentId);
    const toComponent = components.find((component) => component.id === connection.to.componentId);
    const fromPort = fromComponent?.ports.find((port) => port.id === connection.from.portId);
    const toPort = toComponent?.ports.find((port) => port.id === connection.to.portId);
    if (interfacesCompatible(fromPort?.interface, toPort?.interface)) {
      join(endpointKey(connection.from.componentId, connection.from.portId), endpointKey(connection.to.componentId, connection.to.portId));
    }
  }
  return { adjacency, externallyOccupied };
}

function genericUnitPortsByRole(components) {
  const result = new Map(REQUIRED_HRV_ROLES.map((role) => [role, []]));
  for (const component of components.filter(isGenericHrv)) {
    for (const port of component.ports) {
      if (result.has(port.role)) result.get(port.role).push(endpointValue(component, port));
    }
  }
  return result;
}

function distributionMainPortsByRole(components, assemblies, connections) {
  const internalConnectionKeys = new Set(connections.flatMap((connection) => [
    endpointKey(connection.from.componentId, connection.from.portId),
    endpointKey(connection.to.componentId, connection.to.portId),
  ]));
  const result = new Map(REQUIRED_HRV_ROLES.map((role) => [role, []]));
  const assemblyComponentIds = new Set(assemblies.flatMap((assembly) => assembly.componentIds));
  for (const component of components) {
    const isAssemblyMember = assemblyComponentIds.has(component.id);
    const isStandaloneDistribution = component.catalogueItemId === "generic-supply-attenuation-distribution-160"
      || component.catalogueItemId === "generic-extract-attenuation-distribution-160";
    if (!isAssemblyMember && !isStandaloneDistribution) continue;
    for (const port of component.ports) {
      if (!result.has(port.role) || port.interface?.family !== "rigid-epp") continue;
      const endpoint = endpointValue(component, port);
      if (!internalConnectionKeys.has(endpoint.key)) result.get(port.role).push(endpoint);
    }
  }
  return result;
}

function inspectRoutes(routes, componentById, diagnostics) {
  for (const route of routes) {
    const family = routeFamilyForKind(route.ductKind);
    const attachments = [route.startAttachment, route.endAttachment];
    if (attachments.some((attachment) => attachment === null)) {
      diagnostics.push(diagnostic("route-incomplete", "warning", "Route has a free end", `${family.name} route ${route.id} is not attached at both ends.`, {
        routeId: route.id,
        componentId: attachments.find(Boolean)?.componentId ?? null,
      }));
      continue;
    }
    const ports = attachments.map((attachment) => {
      const component = componentById.get(attachment.componentId);
      return component?.ports.find((port) => port.id === attachment.portId) ?? null;
    });
    for (let index = 0; index < ports.length; index += 1) {
      const port = ports[index];
      if (!port) continue;
      if (port.system !== route.system || port.stream !== route.stream || port.role !== route.role) {
        diagnostics.push(diagnostic("route-role-conflict", "error", "Route role conflict", `${family.name} route ${route.id} does not match ${port.role}.`, {
          routeId: route.id,
          componentId: attachments[index].componentId,
        }));
      }
      const expectedInterface = route.connectionInterface ?? family.connectionInterface;
      if (!interfacesCompatible(expectedInterface, port.interface)) {
        diagnostics.push(diagnostic("route-size-conflict", "error", "Route interface or size conflict", `${family.name} route ${route.id} does not match ${port.role} ${formatInterface(port.interface)}. Add an explicit adapter instead of inferring a transition.`, {
          routeId: route.id,
          componentId: attachments[index].componentId,
        }));
      }
    }
    if (!interfacesCompatible(ports[0]?.interface, ports[1]?.interface)) {
      diagnostics.push(diagnostic("route-endpoint-size-conflict", "error", "Connected ports need an explicit adapter", `${family.name} route ${route.id} joins ${formatInterface(ports[0]?.interface)} to ${formatInterface(ports[1]?.interface)}. Add a modelled explicit adapter or correct an endpoint.`, {
        routeId: route.id,
        componentId: attachments[0].componentId,
      }));
    }
  }
}

function inspectDirectConnections(connections, componentById, diagnostics) {
  for (const connection of connections) {
    const fromComponent = componentById.get(connection.from.componentId);
    const toComponent = componentById.get(connection.to.componentId);
    const fromPort = fromComponent?.ports.find((port) => port.id === connection.from.portId);
    const toPort = toComponent?.ports.find((port) => port.id === connection.to.portId);
    if (interfacesCompatible(fromPort?.interface, toPort?.interface)) continue;
    diagnostics.push(diagnostic(
      "direct-connection-size-conflict",
      "error",
      "Direct connection needs an explicit adapter",
      `${fromComponent?.displayName ?? connection.from.componentId} ${formatInterface(fromPort?.interface)} is directly joined to ${toComponent?.displayName ?? connection.to.componentId} ${formatInterface(toPort?.interface)}. Add a modelled explicit adapter or correct the connection.`,
      { componentId: connection.from.componentId },
    ));
  }
}

function inspectSetoutOnlyUnits(components, diagnostics) {
  for (const component of components.filter((candidate) => (
    candidate.catalogueStatus === "verified-dimensional-setout-routable-ports-pending" && candidate.ports.length === 0
  ))) {
    diagnostics.push(diagnostic("unit-setout-only", "warning", "Placed HRV setout has no routable ports", `${component.displayName} is a body setout only. Use the generic drafting HRV for typed routing until branded handed port evidence is verified.`, {
      componentId: component.id,
    }));
  }
}

function inspectUnitMainPaths(unitPortsByRole, distributionMainPortsByRole, graph, diagnostics) {
  for (const role of REQUIRED_HRV_ROLES) {
    for (const endpoint of unitPortsByRole.get(role)) {
      if (!graph.externallyOccupied.has(endpoint.key)) {
        diagnostics.push(diagnostic("unit-main-disconnected", "error", `${role} main route is missing`, `${endpoint.componentName} ${role} port is free. Connect it with the matching DN160 main route.`, {
          componentId: endpoint.componentId,
          portId: endpoint.portId,
        }));
      } else if (!canReachAny(endpoint.key, distributionMainPortsByRole.get(role), graph.adjacency)) {
        diagnostics.push(diagnostic("unit-main-incomplete", "error", `${role} path does not reach distribution`, `${endpoint.componentName} ${role} is connected but does not reach a matching remote or standalone distribution main.`, {
          componentId: endpoint.componentId,
          portId: endpoint.portId,
        }));
      }
    }
  }
}

function inspectAssemblyMainPaths(assemblies, distributionMainPortsByRole, unitPortsByRole, graph, diagnostics) {
  for (const assembly of assemblies) {
    const role = assembly.stream === "supply" ? "Dwelling supply" : "Dwelling extract";
    const main = distributionMainPortsByRole.get(role).find((endpoint) => assembly.componentIds.includes(endpoint.componentId));
    if (!main) continue;
    if (!graph.externallyOccupied.has(main.key)) {
      diagnostics.push(diagnostic("assembly-main-disconnected", "error", `${assembly.name} main route is missing`, `Its ${formatInterface(main.interface)} main port is free. Spare radial branches are allowed; this required main path is not.`, {
        assemblyId: assembly.id,
        componentId: main.componentId,
        portId: main.portId,
      }));
    } else if (!canReachAny(main.key, unitPortsByRole.get(role), graph.adjacency)) {
      diagnostics.push(diagnostic("assembly-main-incomplete", "error", `${assembly.name} does not reach the correct HRV side`, `The ${role.toLowerCase()} main is connected but no matching generic HRV port is reachable.`, {
        assemblyId: assembly.id,
        componentId: main.componentId,
        portId: main.portId,
      }));
    }
  }
}

function inspectOutlets(components, unitPortsByRole, graph, diagnostics) {
  for (const component of components) {
    const terminalPort = assignableOutletPort(component);
    if (!terminalPort) continue;
    const endpoint = endpointValue(component, terminalPort);
    if (!graph.externallyOccupied.has(endpoint.key)) {
      diagnostics.push(diagnostic("outlet-disconnected", "error", "Outlet is disconnected", `${component.displayName} has no attached ${formatInterface(terminalPort.interface)} route.`, {
        componentId: component.id,
        portId: terminalPort.id,
      }));
    } else if (!canReachAny(endpoint.key, unitPortsByRole.get(terminalPort.role) ?? [], graph.adjacency)) {
      diagnostics.push(diagnostic("outlet-path-incomplete", "error", "Outlet path does not reach the correct HRV side", `${component.displayName} is connected locally but no ${terminalPort.role.toLowerCase()} HRV port is reachable through the modelled network.`, {
        componentId: component.id,
        portId: terminalPort.id,
      }));
    }
    if (component.ductRunCount === null) {
      diagnostics.push(diagnostic("outlet-run-count-unset", "warning", "Outlet run count is unset", `${component.displayName} still needs an explicit duct-run count. No airflow is inferred.`, {
        componentId: component.id,
        portId: terminalPort.id,
      }));
    }
  }
}

function summarizeSpareBranches(components, externallyOccupied) {
  const totals = new Map([["supply", { stream: "supply", count: 0, componentIds: [] }], ["extract", { stream: "extract", count: 0, componentIds: [] }]]);
  for (const component of components) {
    const branches = component.ports.filter((port) => (
      port.interface?.family === "semi-rigid-pe" && port.interface?.nominalSizeMm === 90
    ));
    if (branches.length < 2) continue;
    for (const port of branches) {
      if (externallyOccupied.has(endpointKey(component.id, port.id))) continue;
      const total = totals.get(port.stream);
      if (!total) continue;
      total.count += 1;
      if (!total.componentIds.includes(component.id)) total.componentIds.push(component.id);
    }
  }
  return [...totals.values()].filter((value) => value.count > 0);
}

function canReachAny(startKey, targets, adjacency) {
  const targetKeys = new Set(targets.map((target) => target.key));
  if (targetKeys.has(startKey)) return true;
  const seen = new Set([startKey]);
  const queue = [startKey];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of adjacency.get(current) ?? []) {
      if (targetKeys.has(next)) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

function assignableOutletPort(component) {
  const candidates = component.ports.filter((port) => (
    port.system === "mvhr" && (port.role === "Dwelling supply" || port.role === "Dwelling extract")
  ));
  return candidates.length === 1 ? candidates[0] : null;
}

function isGenericHrv(component) {
  return component.catalogueItemId === "synthetic-mvhr-placeholder";
}

function endpointValue(component, port) {
  return {
    key: endpointKey(component.id, port.id),
    componentId: component.id,
    componentName: component.displayName ?? component.id,
    portId: port.id,
    role: port.role,
    interface: port.interface ?? null,
  };
}

function endpointKey(componentId, portId) {
  return `${componentId}/${portId}`;
}

function interfacesCompatible(left, right) {
  if (left === null || right === null || left === undefined || right === undefined) return true;
  if (left.family !== right.family) return false;
  if (left.nominalSizeMm === null || right.nominalSizeMm === null) return true;
  return left.nominalSizeMm === right.nominalSizeMm;
}

function formatInterface(value) {
  if (!value) return "interface pending";
  const size = value.nominalSizeMm === null || value.nominalSizeMm === undefined ? "size pending" : `DN${value.nominalSizeMm}`;
  return `${size} ${String(value.family).replaceAll("-", " ")}`;
}

function diagnostic(code, severity, title, detail, target = {}) {
  return {
    id: `${code}:${target.componentId ?? target.routeId ?? target.assemblyId ?? title}`,
    code,
    severity,
    title,
    detail,
    componentId: target.componentId ?? null,
    portId: target.portId ?? null,
    routeId: target.routeId ?? null,
    assemblyId: target.assemblyId ?? null,
  };
}

function countDiagnostics(diagnostics) {
  return diagnostics.reduce((counts, value) => ({ ...counts, [value.severity]: counts[value.severity] + 1 }), {
    error: 0,
    warning: 0,
    info: 0,
  });
}

function compareDiagnostics(left, right) {
  const rank = { error: 0, warning: 1, info: 2 };
  return rank[left.severity] - rank[right.severity] || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
