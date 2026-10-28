import { floorPortTransform, unknownMm } from "../domain/spatial.mjs";
import { inspectFloorAreaOutline } from "../domain/floor-area.mjs";
import { inspectAutomaticEppRouting } from "./automatic-epp-routing.mjs";
import { findContainedDuctPath } from "./automatic-radial-routing.mjs";
import { routeFamilyForKind } from "./component-catalogue.mjs";
import { routingCoordinationInputs } from "./routing-coordination.mjs";

const SUPPORTED_RADIAL_KIND = "semi-rigid-radial";
const SUPPORTED_EPP_KINDS = new Set(["epp-rigid-dn125", "epp-rigid-dn160"]);

/**
 * Builds disposable replacements for explicitly selected, already attached
 * routes. Older projects do not record automatic-route provenance, so callers
 * must never infer selection from route IDs or geometry.
 */
export function inspectAutomaticRouteRerouting(project, floorId, routeIds, options = {}) {
  const selectedIds = normalizeSelectedIds(routeIds);
  const context = prerequisites(project, floorId, options);
  if (context.blocked) return result("blocked", [], [], context.message, context);
  if (selectedIds.length === 0) return result("nothing-selected", [], [], "Select at least one existing route to preview a replacement.", context);

  const selected = selectedIds.map((routeId) => project.routes.find((route) => route.id === routeId) ?? null);
  const unresolved = [];
  const proposals = [];
  const working = structuredClone(project);
  working.routes = working.routes.filter((route) => !selectedIds.includes(route.id));

  for (let index = 0; index < selected.length; index += 1) {
    const route = selected[index];
    const routeId = selectedIds[index];
    if (!route) {
      unresolved.push(unresolvedRoute(routeId, "The selected route no longer exists."));
      continue;
    }
    const problem = routeEligibilityProblem(route, floorId, options.system);
    if (problem) {
      unresolved.push(unresolvedRoute(route.id, problem));
      continue;
    }
    const elevation = preservedInteriorElevation(route);
    if (!elevation) {
      unresolved.push(unresolvedRoute(route.id, "This route has a custom interior vertical profile. Re-route it manually so rises and drops are not lost."));
      continue;
    }

    const planned = route.ductKind === SUPPORTED_RADIAL_KIND
      ? planRadialReplacement(working, route, context, options)
      : planEppReplacement(working, route, context, options);
    if (!planned) {
      unresolved.push(unresolvedRoute(route.id, "No full-width replacement could avoid the building boundary, marked exclusions and modelled duct clearances."));
      continue;
    }
    if (planned.problem) {
      unresolved.push(unresolvedRoute(route.id, planned.problem));
      continue;
    }

    const replacementRoute = {
      ...structuredClone(route),
      points: planned.points.map((point, pointIndex, points) => ({
        x: point.x,
        y: point.y,
        z: pointIndex === 0
          ? structuredClone(route.points[0].z)
          : pointIndex === points.length - 1
            ? structuredClone(route.points.at(-1).z)
            : structuredClone(elevation),
      })),
    };
    working.routes.push(structuredClone(replacementRoute));
    proposals.push(Object.freeze({
      routeId: route.id,
      system: route.system,
      stream: route.stream,
      role: route.role,
      ductKind: route.ductKind,
      diameterMm: planned.diameterMm,
      routingStyle: context.routingStyle,
      buildingAxisRad: context.buildingAxisRad,
      source: Object.freeze(endpointSummary(project, route.startAttachment)),
      destination: Object.freeze(endpointSummary(project, route.endAttachment)),
      points: Object.freeze(planned.points.map((point) => Object.freeze({ x: point.x, y: point.y }))),
      replacementRoute: Object.freeze(replacementRoute),
    }));
  }

  if (unresolved.length > 0) {
    return result(
      "unresolved",
      [],
      unresolved,
      `${unresolved.length} selected route${unresolved.length === 1 ? " cannot" : "s cannot"} be replaced safely. Nothing will be changed; deselect the unresolved route${unresolved.length === 1 ? "" : "s"} and preview again.`,
      context,
    );
  }
  const status = proposals.length === 0 ? "unresolved" : "ready";
  const message = proposals.length
    ? `${proposals.length} replacement${proposals.length === 1 ? "" : "s"} ready.`
    : "No replacement route is available.";
  return result(status, proposals, unresolved, message, context);
}

function prerequisites(project, floorId, options) {
  const floor = project?.floors?.find((candidate) => candidate.id === floorId);
  if (!floor) return { blocked: true, message: "Choose an existing floor before re-routing." };
  const outline = project.floorAreaOutlines?.find((candidate) => candidate.floorId === floorId);
  if (!outline) return { blocked: true, message: "Draw and confirm a closed building outline before re-routing." };
  if ((outline.holes?.length ?? 0) > 0) return { blocked: true, message: "Automatic re-routing does not yet support holes in the confirmed outline." };
  const scaleEvidence = scaleEvidenceForFloor(project, floorId);
  if (scaleEvidence === "manual-project-grid") return { blocked: true, message: "Calibrate the plan reference or import CAD with explicit units before re-routing." };
  const routingStyle = options.routingStyle === "building-aligned" ? "building-aligned" : "direct";
  if (routingStyle === "building-aligned" && !Number.isFinite(options.buildingAxisRad)) {
    return { blocked: true, message: "Confirm the building axis before previewing Building-aligned replacements." };
  }
  return {
    blocked: false,
    outline,
    polygon: inspectFloorAreaOutline(outline).polygon,
    scaleEvidence,
    routingStyle,
    buildingAxisRad: routingStyle === "building-aligned" ? options.buildingAxisRad : null,
  };
}

function routeEligibilityProblem(route, floorId, requestedSystem) {
  if (route.floorId !== floorId) return "The route is not on the active floor.";
  if (!route.startAttachment || !route.endAttachment) return "Only routes attached at both typed endpoints can be re-routed automatically.";
  const routeSystem = route.ductKind === SUPPORTED_RADIAL_KIND ? "dn90" : SUPPORTED_EPP_KINDS.has(route.ductKind) ? "epp" : null;
  if (!routeSystem) return "This duct family is not supported by automatic re-routing.";
  if (requestedSystem && routeSystem !== requestedSystem) return `Choose the ${routeSystem === "dn90" ? "DN90 radial" : "EPP main / outdoor"} system to re-route this duct.`;
  return null;
}

function planRadialReplacement(project, route, context, options) {
  const start = endpointRecord(project, route.startAttachment);
  const end = endpointRecord(project, route.endAttachment);
  if (!start || !end) return { problem: "One or both attached ports no longer exist." };
  const family = routeFamilyForKind(route.ductKind);
  const diameterMm = family.connectionInterface.nominalSizeMm;
  if (diameterMm !== 90) return { problem: "The selected radial route does not have a supported DN90 interface." };
  const coordination = routingCoordinationInputs(project, route.floorId);
  const endpointComponentIds = new Set([start.component.id, end.component.id]);
  const points = findContainedDuctPath(start.positionMm, end.positionMm, context.polygon, diameterMm, {
    ...options,
    routingStyle: context.routingStyle,
    buildingAxisRad: context.buildingAxisRad,
    forbiddenPolygons: coordination.forbiddenPolygons,
    blockedSegments: coordination.blockedSegments.filter((segment) => !segment.endpointComponentIds?.some((id) => endpointComponentIds.has(id))),
    clearSpacingMm: coordination.clearSpacingMm,
  });
  return points ? { points, diameterMm } : null;
}

function planEppReplacement(project, route, context, options) {
  const startKey = endpointKey(route.startAttachment);
  const endKey = endpointKey(route.endAttachment);
  const inspection = inspectAutomaticEppRouting(project, route.floorId, { startKey, endKey }, {
    ...options,
    routingStyle: context.routingStyle,
    buildingAxisRad: context.buildingAxisRad,
  });
  if (!inspection.proposal) return { problem: inspection.message };
  return { points: inspection.proposal.points, diameterMm: inspection.proposal.diameterMm };
}

function endpointRecord(project, attachment) {
  const component = project.components.find((candidate) => candidate.id === attachment.componentId);
  const port = component?.ports.find((candidate) => candidate.id === attachment.portId);
  if (!component || !port) return null;
  return { component, port, positionMm: floorPortTransform(project, component.id, port.id).positionMm };
}

function endpointSummary(project, attachment) {
  const record = endpointRecord(project, attachment);
  return {
    componentId: attachment.componentId,
    portId: attachment.portId,
    displayName: record?.component.displayName ?? attachment.componentId,
    stream: record?.port.stream ?? null,
    role: record?.port.role ?? null,
  };
}

function preservedInteriorElevation(route) {
  if (route.routingElevationMm) return structuredClone(route.routingElevationMm);
  const interior = route.points.slice(1, -1).map((point) => point.z);
  if (interior.length === 0) return unknownMm("re-routed plan elevation not set");
  const first = interior[0];
  return interior.every((measurement) => sameMeasurement(first, measurement)) ? structuredClone(first) : null;
}

function sameMeasurement(left, right) {
  return left?.state === right?.state && left?.valueMm === right?.valueMm;
}

function normalizeSelectedIds(routeIds) {
  if (!Array.isArray(routeIds)) return [];
  return [...new Set(routeIds.filter((routeId) => typeof routeId === "string" && routeId.length > 0))];
}

function scaleEvidenceForFloor(project, floorId) {
  if (project.floorReferences?.some((reference) => reference.floorId === floorId && reference.calibration !== null)) return "calibrated-image";
  if (project.floorCadReferences?.some((reference) => reference.floorId === floorId)) return "explicit-cad-units";
  return "manual-project-grid";
}

function unresolvedRoute(routeId, reason) { return Object.freeze({ routeId, reason }); }
function endpointKey(endpoint) { return `${endpoint.componentId}/${endpoint.portId}`; }
function result(status, proposals, unresolved, message, prerequisites) {
  return Object.freeze({
    status,
    proposals: Object.freeze(proposals),
    unresolved: Object.freeze(unresolved),
    message,
    prerequisites: Object.freeze({
      scaleEvidence: prerequisites.scaleEvidence ?? null,
      routingStyle: prerequisites.routingStyle ?? null,
      buildingAxisRad: prerequisites.buildingAxisRad ?? null,
    }),
    notes: Object.freeze([
      "Only explicitly selected routes are replaced; unselected and unresolved routes remain unchanged.",
      "Plan geometry only; airflow, pressure loss, supports, unmodelled obstacles and installation fit are not certified.",
    ]),
  });
}
