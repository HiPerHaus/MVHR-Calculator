export function inspectEquipmentFirstRouting(project, floorId) {
  const floor = project?.floors?.find((candidate) => candidate.id === floorId);
  if (!floor) return emptyWorkflow("Choose an existing floor.");
  const components = (project.components ?? []).filter((component) => component.floorId === floorId);
  const occupied = occupiedPortKeys(project);
  const units = components.filter(isHrvUnit);
  const outlets = components.filter(isDn90Outlet);
  const externalTerminals = components.filter(isExternalTerminal);
  const intakeTerminals = externalTerminals.filter((component) => component.ports.some((port) => port.stream === "intake"));
  const exhaustTerminals = externalTerminals.filter((component) => component.ports.some((port) => port.stream === "exhaust"));
  const distribution = components.filter(isDistributionComponent);
  const outletStreams = new Set(outlets.flatMap((component) => component.ports.map((port) => port.stream)));
  const distributionGaps = [...outletStreams].filter((stream) =>
    !distribution.some((component) => component.ports.some((port) => isDn90Port(port) && port.stream === stream)));
  const outline = project.floorAreaOutlines?.find((candidate) => candidate.floorId === floorId) ?? null;
  const hasScale = project.floorReferences?.some((reference) => reference.floorId === floorId && reference.calibration !== null)
    || project.floorCadReferences?.some((reference) => reference.floorId === floorId);
  const exclusions = (project.routingExclusions ?? []).filter((entry) => entry.floorId === floorId);
  const clearance = project.routingClearanceSettings?.find((entry) => entry.floorId === floorId)?.clearSpacingMm ?? null;
  const freeDn90 = components.flatMap((component) => component.ports.map((port) => ({ component, port })))
    .filter(({ component, port }) => isDn90Port(port) && !occupied.has(`${component.id}/${port.id}`));

  const equipmentMissing = [];
  if (units.length === 0) equipmentMissing.push("MVHR unit");
  if (outlets.length === 0) equipmentMissing.push("supply/extract outlets");
  if (intakeTerminals.length === 0) equipmentMissing.push("outdoor intake terminal");
  if (exhaustTerminals.length === 0) equipmentMissing.push("outdoor exhaust terminal");

  return Object.freeze({
    status: equipmentMissing.length === 0 && outline && hasScale ? "ready" : "attention",
    counts: Object.freeze({
      units: units.length,
      outlets: outlets.length,
      intakeTerminals: intakeTerminals.length,
      exhaustTerminals: exhaustTerminals.length,
      distribution: distribution.length,
      exclusions: exclusions.length,
      freeDn90Ports: freeDn90.length,
    }),
    steps: Object.freeze([
      step("equipment", equipmentMissing.length ? "attention" : "ready", equipmentMissing.length
        ? `Place ${equipmentMissing.join(", ")}.`
        : `${units.length} unit · ${outlets.length} outlet${outlets.length === 1 ? "" : "s"} · intake and exhaust terminals placed.`),
      step("distribution", distributionGaps.length ? "attention" : outletStreams.size ? "ready" : "waiting", distributionGaps.length
        ? `Place a compatible ${distributionGaps.join(" and ")} distribution component. Automatic distribution positioning is not inferred.`
        : outletStreams.size ? `${distribution.length} distribution component${distribution.length === 1 ? "" : "s"} cover the placed outlet services.` : "Place outlets before checking distribution demand."),
      step("constraints", !outline || !hasScale ? "attention" : "ready", !outline
        ? "Draw the closed building outline before automatic routing."
        : !hasScale ? "Calibrate the reference or use explicit CAD units before automatic routing."
          : `${exclusions.length} marked no-go area${exclusions.length === 1 ? "" : "s"} · parallel clearance ${clearance?.state === "unknown" || !clearance ? "not set" : `${clearance.valueMm} mm`}. Preferred corridors are not yet modelled.`),
      step("generate", "available", "Choose the duct system and route style, then preview. Typed intake, exhaust, supply and extract connections remain separate."),
      step("review", "available", "Apply only the routes you accept. Applied and manually drawn routes keep their occupied endpoints, so another preview generates only the remaining connections."),
    ]),
  });
}

function isHrvUnit(component) {
  const streams = new Set((component.ports ?? []).map((port) => port.stream));
  return streams.has("supply") && streams.has("extract") && streams.has("intake") && streams.has("exhaust");
}

function isDn90Outlet(component) {
  const eligible = (component.ports ?? []).filter(isDn90Port);
  return component.ports?.length === 1 && eligible.length === 1;
}

function isExternalTerminal(component) {
  return /external-grille/u.test(component.catalogueItemId ?? "")
    || ((component.ports?.length ?? 0) > 0 && component.ports.every((port) => ["intake", "exhaust"].includes(port.stream)));
}

function isDistributionComponent(component) {
  return (component.ports ?? []).filter(isDn90Port).length > 1;
}

function isDn90Port(port) {
  return port.system === "mvhr"
    && ["supply", "extract"].includes(port.stream)
    && port.interface?.family === "semi-rigid-pe"
    && port.interface?.nominalSizeMm === 90;
}

function occupiedPortKeys(project) {
  const keys = new Set();
  for (const route of project.routes ?? []) {
    for (const endpoint of [route.startAttachment, route.endAttachment]) {
      if (endpoint) keys.add(`${endpoint.componentId}/${endpoint.portId}`);
    }
  }
  for (const connection of project.connections ?? []) {
    for (const endpoint of [connection.from, connection.to]) {
      if (endpoint) keys.add(`${endpoint.componentId}/${endpoint.portId}`);
    }
  }
  return keys;
}

function step(id, status, detail) { return Object.freeze({ id, status, detail }); }
function emptyWorkflow(detail) {
  return Object.freeze({ status: "attention", counts: Object.freeze({ units: 0, outlets: 0, intakeTerminals: 0, exhaustTerminals: 0, distribution: 0, exclusions: 0, freeDn90Ports: 0 }), steps: Object.freeze([step("equipment", "attention", detail)]) });
}
