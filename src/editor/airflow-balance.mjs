import { validateProject } from "../domain/spatial.mjs";

/**
 * Read-only Normal-mode airflow summary. Required and assigned targets remain
 * distinct; no rate, tolerance, terminal split or equipment change is inferred.
 */
export function inspectAirflowBalance(project, floorId) {
  validateProject(project);
  const floor = project.floors.find((candidate) => candidate.id === floorId);
  if (!floor) throw new TypeError(`Airflow-balance floor not found: ${String(floorId)}`);

  const activeSpaces = activeVentilationSpaces(project, floorId);
  const assignedEndpointKeys = new Set();
  const lines = activeSpaces.map(({ kind, space }) => {
    const terminalIds = [];
    for (const association of space.terminalAssociations) {
      assignedEndpointKeys.add(endpointKey(association.componentId, association.portId));
      if (!terminalIds.includes(association.componentId)) terminalIds.push(association.componentId);
    }
    const required = space.airflowTargets.normal.required;
    const assigned = space.airflowTargets.normal.assigned;
    const ventilated = space.ventilationRole === "supply" || space.ventilationRole === "extract";
    return {
      kind,
      id: space.id,
      name: space.name,
      floorId: space.floorId,
      parentRoomId: kind === "zone" ? space.parentRoomId : null,
      ventilationRole: space.ventilationRole,
      terminalIds,
      terminalCount: terminalIds.length,
      required: structuredClone(required),
      assigned: structuredClone(assigned),
      assignedMinusRequiredLps: required.state === "known" && assigned.state === "known"
        ? assigned.valueLps - required.valueLps
        : null,
      coverageStatus: !ventilated
        ? "not-a-supply-or-extract-space"
        : assigned.state === "known" && terminalIds.length > 0
          ? terminalIds.length === 1
            ? "assigned-target-with-one-associated-terminal"
            : "assigned-target-not-allocated-across-multiple-terminals"
          : assigned.state === "known"
            ? "assigned-target-without-terminal"
            : terminalIds.length > 0
              ? "terminal-without-assigned-target"
              : "assigned-target-and-terminal-unresolved",
    };
  });

  const totals = {
    supply: sideTotals(lines, "supply"),
    extract: sideTotals(lines, "extract"),
  };
  const terminalComponents = project.components.filter((component) => (
    component.floorId === floorId && assignableTerminalPort(component) !== null
  ));
  const unassignedTerminals = terminalComponents.flatMap((component) => {
    const port = assignableTerminalPort(component);
    return assignedEndpointKeys.has(endpointKey(component.id, port.id)) ? [] : [{
      componentId: component.id,
      componentName: component.displayName ?? component.id,
      portId: port.id,
      stream: port.stream,
      role: port.role,
    }];
  });
  const missingAssignedTargetSpaces = lines.filter((line) => (
    (line.ventilationRole === "supply" || line.ventilationRole === "extract") &&
    line.assigned.state === "unresolved"
  ));
  const targetWithoutTerminalSpaces = lines.filter((line) => (
    line.assigned.state === "known" && line.terminalCount === 0
  ));
  const terminalWithoutTargetSpaces = lines.filter((line) => (
    line.assigned.state === "unresolved" && line.terminalCount > 0
  ));
  const assignedImbalanceLps = totals.supply.assignedKnownLps - totals.extract.assignedKnownLps;
  const complete = (
    totals.supply.spaceCount > 0 &&
    totals.extract.spaceCount > 0 &&
    totals.supply.assignedUnresolvedSpaceCount === 0 &&
    totals.extract.assignedUnresolvedSpaceCount === 0
  );
  const suggestions = lines.flatMap((line) => (
    line.required.state === "known" && line.assigned.state === "unresolved"
      ? [{
          id: `adopt-required:${line.kind}:${line.id}:normal`,
          action: "apply-required-to-assigned",
          status: "available-user-action-not-applied",
          spaceKind: line.kind,
          spaceId: line.id,
          mode: "normal",
          proposedTarget: {
            state: "known",
            inputValue: line.required.inputValue,
            inputUnit: line.required.inputUnit,
            valueLps: line.required.valueLps,
            basis: "Explicitly adopted from required Normal target",
            source: line.required.source,
            reason: null,
          },
        }]
      : []
  ));

  return deepFreeze({
    floorId,
    floorName: floor.name,
    mode: "normal",
    lines,
    totals,
    assignedImbalanceLps,
    assignedBalanceState: complete ? "calculated-no-tolerance-applied" : "incomplete",
    numericRelation: assignedImbalanceLps > 0
      ? "known-supply-subtotal-greater"
      : assignedImbalanceLps < 0
        ? "known-extract-subtotal-greater"
        : "known-subtotals-equal",
    missingAssignedTargetSpaceIds: missingAssignedTargetSpaces.map((line) => line.id),
    targetWithoutTerminalSpaceIds: targetWithoutTerminalSpaces.map((line) => line.id),
    terminalWithoutTargetSpaceIds: terminalWithoutTargetSpaces.map((line) => line.id),
    unassignedTerminals,
    suggestions,
    evidenceBoundary: "Normal-mode required and assigned room targets are explicit user inputs. Totals are arithmetic only: no regulatory rate, terminal allocation, balance tolerance, compliance verdict, pressure result or equipment change is inferred.",
  });
}

function activeVentilationSpaces(project, floorId) {
  const result = [];
  for (const room of project.rooms.filter((candidate) => candidate.floorId === floorId)) {
    const zones = project.zones.filter((zone) => zone.parentRoomId === room.id);
    if (zones.length > 0) {
      for (const zone of zones) result.push({ kind: "zone", space: zone });
    } else {
      result.push({ kind: "room", space: room });
    }
  }
  return result.sort((left, right) => left.space.name.localeCompare(right.space.name) || left.space.id.localeCompare(right.space.id));
}

function sideTotals(lines, stream) {
  const side = lines.filter((line) => line.ventilationRole === stream);
  return {
    stream,
    spaceCount: side.length,
    terminalCount: side.reduce((total, line) => total + line.terminalCount, 0),
    requiredKnownLps: sumKnown(side, "required"),
    requiredUnresolvedSpaceCount: side.filter((line) => line.required.state === "unresolved").length,
    assignedKnownLps: sumKnown(side, "assigned"),
    assignedUnresolvedSpaceCount: side.filter((line) => line.assigned.state === "unresolved").length,
  };
}

function sumKnown(lines, field) {
  return lines.reduce((total, line) => (
    total + (line[field].state === "known" ? line[field].valueLps : 0)
  ), 0);
}

function assignableTerminalPort(component) {
  const ports = component.ports.filter((port) => (
    port.system === "mvhr" && (port.stream === "supply" || port.stream === "extract")
  ));
  return ports.length === 1 ? ports[0] : null;
}

function endpointKey(componentId, portId) {
  return `${componentId}/${portId}`;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
