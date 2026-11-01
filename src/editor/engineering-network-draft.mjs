import { unresolvedPressureInput } from "../domain/engineering-inputs.mjs";

/**
 * Creates an explicit, reviewable draft from existing room associations.
 * It never divides a room target between multiple terminals. Only a space with
 * one associated typed terminal can be copied into the draft automatically.
 */
export function createEngineeringNetworkDraft(project, floorId, mode = "normal", options = {}) {
  const factor = mode === "normal" ? 1 : positive(options.normalTargetFactor, "Engineering mode factor");
  const allocations = [];
  const unresolved = [];
  for (const { kind, space } of activeSpaces(project, floorId)) {
    if (!["supply", "extract"].includes(space.ventilationRole)) continue;
    const target = space.airflowTargets.normal.assigned;
    if (target.state !== "known") {
      unresolved.push({ code: "assigned-target-unresolved", spaceKind: kind, spaceId: space.id, message: `${space.name} has no assigned Normal target.` });
      continue;
    }
    const terminals = space.terminalAssociations.filter(association => {
      const component = project.components.find(item => item.id === association.componentId);
      const port = component?.ports.find(item => item.id === association.portId);
      return component?.floorId === floorId && port?.stream === space.ventilationRole;
    });
    if (terminals.length !== 1) {
      unresolved.push({ code: terminals.length === 0 ? "terminal-missing" : "allocation-required", spaceKind: kind, spaceId: space.id, message: terminals.length === 0 ? `${space.name} has no associated ${space.ventilationRole} terminal.` : `${space.name} has ${terminals.length} terminals; enter an explicit allocation for each rather than dividing automatically.` });
      continue;
    }
    const inputUnit = target.inputUnit;
    const inputValue = target.inputValue * factor;
    allocations.push({
      id: `engineering-${mode}-${terminals[0].componentId}-${terminals[0].portId}`,
      componentId: terminals[0].componentId,
      portId: terminals[0].portId,
      spaceKind: kind,
      spaceId: space.id,
      inputValue,
      inputUnit,
      valueLps: inputUnit === "l/s" ? inputValue : inputValue / 3.6,
      basis: mode === "normal" ? `Explicit copy of assigned Normal target: ${target.basis}` : `Explicit user action: assigned Normal target multiplied by ${factor}`,
      source: target.source,
      terminalPressureLoss: unresolvedPressureInput("terminal pressure-loss evidence not provided"),
    });
  }
  return {
    design: {
      floorId,
      mode,
      basis: mode === "normal" ? "Explicit terminal allocations copied from reviewed assigned Normal room targets" : `Explicit ${mode} draft based on Normal targets and user-entered factor ${factor}`,
      source: "HiPer Studio room targets and terminal associations; designer review required",
      sourceVersion: "engineering-draft.v1",
      occupancy: { state: "unresolved", persons: null, basis: null, source: null, reason: "project occupancy not entered for this engineering mode" },
      fluid: {
        densityKgM3: 1.204,
        dynamicViscosityPaS: 0.0000181,
        basis: "Preliminary dry-air working properties at approximately 20 °C and standard atmospheric pressure; designer review required",
        source: "HiPer Studio reversible engineering assumption; replace with project conditions when required",
      },
      terminalAllocations: allocations,
      routeResistanceInputs: [],
      componentResistanceInputs: [],
      fanCurves: ["supply", "extract"].map(stream => ({ state: "unresolved", stream, unitComponentId: null, unitConfigurationFingerprint: null, pressureConvention: null, filterCondition: null, points: [], basis: null, source: null, sourceVersion: null, reason: "verified article-specific fan curve not provided" })),
    },
    unresolved,
    evidenceBoundary: "This draft copies only explicit saved room targets with exactly one associated terminal. It does not infer a split across multiple terminals, product resistance, fan performance, compliance or achieved airflow.",
  };
}

function activeSpaces(project, floorId) {
  return project.rooms.filter(room => room.floorId === floorId).flatMap(room => {
    const zones = project.zones.filter(zone => zone.parentRoomId === room.id);
    return zones.length ? zones.map(space => ({ kind: "zone", space })) : [{ kind: "room", space: room }];
  });
}

function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be a positive number`);
  return value;
}
