import { matchCombinedGrilleSpacing } from "./combined-grille-drawing-spacing.mjs";
import { enableMountedCwDrawingConnections } from "./mounted-cw-drawing-connections.mjs";
import { enableTerminalDrawingConnection, selectTerminalDrawingEntry } from "./terminal-drawing-connections.mjs";
import { constrainEppPlanPoints, alignEppPortApproaches, realignEppPlanConnections, hasHrvCeilingElbow } from "./epp-plan-constraints.mjs";
import {
  MAX_DXF_REFERENCE_ASSETS,
  MAX_TOTAL_DXF_REFERENCE_BYTES,
  validateDxfAsset,
  validateFloorDxfReference,
} from "../import/dxf-reference.mjs";
import {
  MAX_PDF_PAGE_COUNT,
  MAX_PDF_REFERENCE_ASSETS,
  MAX_PDF_SOURCE_BYTES,
  MAX_TOTAL_PDF_SOURCE_BYTES,
  PDF_IMPORTER,
} from "../import/pdf-reference.mjs";
import { assertPortableProjectGrowth } from "../persistence/portable-envelope.mjs";
import { inspectFloorAreaOutline } from "./floor-area.mjs";
import {
  createDesignWorkflow,
  createQuoteDraft,
  createQuoteSnapshot,
  inferredLegacyWorkflow,
  normalizeDesignWorkflow,
  normalizeQuoteDraft,
  normalizeQuoteSnapshot,
} from "./design-workflow.mjs";
import {
  createEngineeringInputs,
  normalizeEngineeringInputs,
  normalizeFloorDuty,
} from "./engineering-inputs.mjs";
import {
  deriveRoomBoundaries,
  deriveZoneBoundaries,
  inspectRoomBoundary,
  inspectZoneBoundary,
  roomPolygonFromBoundary,
  ROOM_USE_TYPES,
  ROOM_VENTILATION_ROLES,
  roomBoundaryKey,
} from "./rooms.mjs";

/**
 * Renderer-independent spatial foundation for HiPer Studio.
 *
 * This module deliberately has no UI, persistence-provider, framework, or
 * network dependency. Canonical geometry is millimetres in a right-handed,
 * Z-up coordinate system. Unknown elevations remain explicit.
 */

export const SCHEMA_VERSION = 19;
export const MAX_EMBEDDED_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_REFERENCE_ASSETS = 8;
export const MAX_TOTAL_REFERENCE_BYTES = 20 * 1024 * 1024;
export const COORDINATE_SYSTEM = Object.freeze({
  lengthUnit: "mm",
  angleUnit: "rad",
  handedness: "right",
  upAxis: "z",
});

const EPSILON = 1e-12;
const PLAN_OPERATION_EPSILON_MM = 1e-6;
const FORBIDDEN_PROJECT_AUTHORITY_FIELDS = Object.freeze([
  "tenantId",
  "companyId",
  "saveVersion",
  "serverSaveVersion",
  "snapshotId",
  "roles",
  "permissions",
  "entitlements",
  "approvals",
  "reviewer",
  "issuedRevision",
  "catalogueVerification",
]);

export function knownMm(valueMm, provenance = null) {
  assertFinite(valueMm, "Known millimetre value");
  return { state: "known", valueMm, provenance };
}

export function assumedMm(valueMm, provenance) {
  assertFinite(valueMm, "Assumed millimetre value");
  if (!provenance || typeof provenance !== "string") {
    throw new TypeError("An assumed value requires provenance");
  }
  return { state: "assumed", valueMm, provenance };
}

export function unknownMm(reason = "not provided") {
  return { state: "unknown", valueMm: null, reason };
}

export function unresolvedAirflowTarget(reason = "not provided") {
  return normalizeAirflowTarget({
    state: "unresolved",
    valueLps: null,
    inputValue: null,
    inputUnit: null,
    basis: null,
    source: null,
    reason,
  }, "Airflow target");
}

export function airflowTargetFromInput(inputValue, inputUnit, basis, source) {
  return normalizeAirflowTarget({
    state: "known",
    inputValue,
    inputUnit,
    basis,
    source,
  }, "Airflow target");
}

export function unresolvedSpaceAirflowTargets() {
  return {
    normal: {
      required: unresolvedAirflowTarget("required normal airflow not provided"),
      assigned: unresolvedAirflowTarget("assigned normal airflow not provided"),
    },
  };
}

export function identityQuaternion() {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function quaternionFromYaw(yawRad) {
  assertFinite(yawRad, "Yaw");
  const half = yawRad / 2;
  return normalizeQuaternion({ x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) });
}

export function normalizeQuaternion(value) {
  const quaternion = {
    x: requireFinite(value?.x, "Quaternion x"),
    y: requireFinite(value?.y, "Quaternion y"),
    z: requireFinite(value?.z, "Quaternion z"),
    w: requireFinite(value?.w, "Quaternion w"),
  };
  const magnitude = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  if (magnitude < EPSILON) {
    throw new RangeError("Quaternion magnitude must be non-zero");
  }
  return {
    x: quaternion.x / magnitude,
    y: quaternion.y / magnitude,
    z: quaternion.z / magnitude,
    w: quaternion.w / magnitude,
  };
}

export function multiplyQuaternions(left, right) {
  const a = normalizeQuaternion(left);
  const b = normalizeQuaternion(right);
  return normalizeQuaternion({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
}

export function inverseQuaternion(value) {
  const quaternion = normalizeQuaternion(value);
  return {
    x: -quaternion.x,
    y: -quaternion.y,
    z: -quaternion.z,
    w: quaternion.w,
  };
}

export function rotateVector(quaternion, vector) {
  const q = normalizeQuaternion(quaternion);
  const v = {
    x: requireFinite(vector?.x, "Vector x"),
    y: requireFinite(vector?.y, "Vector y"),
    z: requireFinite(vector?.z, "Vector z"),
  };
  const twiceCross = {
    x: 2 * (q.y * v.z - q.z * v.y),
    y: 2 * (q.z * v.x - q.x * v.z),
    z: 2 * (q.x * v.y - q.y * v.x),
  };
  return {
    x: v.x + q.w * twiceCross.x + (q.y * twiceCross.z - q.z * twiceCross.y),
    y: v.y + q.w * twiceCross.y + (q.z * twiceCross.x - q.x * twiceCross.z),
    z: v.z + q.w * twiceCross.z + (q.x * twiceCross.y - q.y * twiceCross.x),
  };
}

export function createProject(id) {
  requireOpaqueId(id, "Project ID");
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    coordinateSystem: { ...COORDINATE_SYSTEM },
    floors: [],
    components: [],
    equipmentAssemblies: [],
    routes: [],
    connections: [],
    wallNodes: [],
    walls: [],
    floorAreaOutlines: [],
    rooms: [],
    zones: [],
    referenceAssets: [],
    floorReferences: [],
    pdfReferenceAssets: [],
    cadReferenceAssets: [],
    floorCadReferences: [],
    workflow: createDesignWorkflow(),
    quoteDraft: createQuoteDraft(),
    quoteSnapshots: [],
    engineeringInputs: createEngineeringInputs(),
  };
}

export function applyCommand(project, command, options = {}) {
  const current = validateProject(project);
  const next = structuredClone(current);
  switch (command?.type) {
    case "floor.add": {
      const floor = normalizeFloor(command.floor);
      requireUniqueId(next.floors, floor.id, "Floor");
      next.floors.push(floor);
      break;
    }
    case "component.enableMountedCwDrawingConnections": {
      for(const component of next.components) enableMountedCwDrawingConnections(component);
      break;
    }
    case "terminal.enableDrawingConnections": {
      for(const component of next.components) if(enableTerminalDrawingConnection(component)) assignTerminalToContainingSpace(next,component);
      break;
    }
    case "component.add": {
      const component = normalizeComponent(command.component);
      requireUniqueId(next.components, component.id, "Component");
      requireEntity(next.floors, component.floorId, "Floor");
      next.components.push(component);
      if (command.autoAssignTerminalSpace === true) {
        assignTerminalToContainingSpace(next, component);
      }
      break;
    }
    case "equipmentAssembly.add": {
      const components = (command.components ?? []).map(normalizeComponent);
      const connections = (command.connections ?? []).map(normalizeConnection);
      if (components.length < 2) throw new TypeError("Equipment assembly requires at least two components");
      for (const component of components) {
        requireUniqueId(next.components, component.id, "Component");
        requireEntity(next.floors, component.floorId, "Floor");
        next.components.push(component);
      }
      for (const connection of connections) {
        requireUniqueId(next.connections, connection.id, "Connection");
        validateConnectionEndpoints(next, connection);
        next.connections.push(connection);
      }
      const assembly = normalizeEquipmentAssembly(command.assembly);
      if (!sameOpaqueIdSet(assembly.componentIds, components.map((component) => component.id))) {
        throw new TypeError("Equipment assembly member IDs must exactly match its atomic component additions");
      }
      if (!sameOpaqueIdSet(assembly.connectionIds, connections.map((connection) => connection.id))) {
        throw new TypeError("Equipment assembly connection IDs must exactly match its atomic connection additions");
      }
      requireUniqueId(next.equipmentAssemblies, assembly.id, "Equipment assembly");
      next.equipmentAssemblies.push(assembly);
      break;
    }
    case "component.matchCombinedGrilleSpacing": {
      for(const component of next.components)if(matchCombinedGrilleSpacing(component))synchronizeAttachedRouteEndpoints(next,component.id);
      break;
    }
    case "component.setExternalGrilleHanding": {
      const component=requireEntity(next.components,command.componentId,"Component");
      if(!/external.*grille|grille.*external/.test(component.catalogueItemId??"") || component.ports.filter(p=>["intake","exhaust"].includes(p.stream)).length!==2)throw new TypeError("Left/Right swapping requires a combined external grille");
      const handing=normalizeChoice(command.handing,["left","right"],"External grille intake side");
      if(handing!==(component.externalGrilleHanding??"left")) {
        for(const port of component.ports){port.positionMm.y=-port.positionMm.y;port.direction.y=-port.direction.y;}
        component.externalGrilleHanding=handing;
        synchronizeAttachedRouteEndpoints(next,component.id);
      }
      break;
    }
    case "component.replaceDrawingConfiguration": {
      const previous = requireEntity(next.components, command.componentId, "Component");
      assertComponentIsNotAssemblyMember(next, previous.id, "configure");
      const replacement = normalizeComponent(command.component);
      if (replacement.id !== previous.id || replacement.floorId !== previous.floorId) throw new TypeError("Configuration must preserve component and floor identities");
      replacement.positionMm = structuredClone(previous.positionMm);
      replacement.orientation = structuredClone(previous.orientation);
      const attachments = next.routes.flatMap(route => [route.startAttachment, route.endAttachment]).filter(Boolean);
      attachments.push(...next.connections.flatMap(connection => [connection.from, connection.to]));
      for (const endpoint of attachments.filter(endpoint => endpoint.componentId === previous.id)) {
        const oldPort = previous.ports.find(port => port.id === endpoint.portId);
        const newPort = replacement.ports.find(port => port.id === endpoint.portId);
        if (!newPort || !oldPort || newPort.stream !== oldPort.stream || newPort.system !== oldPort.system || newPort.interface.family !== oldPort.interface.family || newPort.interface.nominalSizeMm !== oldPort.interface.nominalSizeMm) {
          throw new TypeError("Disconnect affected ducts before changing the air service, connection size or removing a connected CW branch");
        }
      }
      next.components[next.components.findIndex(component => component.id === previous.id)] = replacement;
      synchronizeAttachedRouteEndpoints(next, previous.id);
      break;
    }
    case "component.moveXY": {
      const component = requireEntity(next.components, command.componentId, "Component");
      assertComponentIsNotAssemblyMember(next, component.id, "move");
      component.positionMm.x = requireFinite(command.xMm, "Component x");
      component.positionMm.y = requireFinite(command.yMm, "Component y");
      synchronizeAttachedRouteEndpoints(next, component.id);
      if (command.autoAssignTerminalSpace === true) {
        assignTerminalToContainingSpace(next, component);
      }
      break;
    }
    case "component.rotateFloorZ": {
      const component = requireEntity(next.components, command.componentId, "Component");
      assertComponentIsNotAssemblyMember(next, component.id, "rotate");
      const angleRad = requireFinite(command.angleRad, "Component floor-Z rotation");
      component.orientation = multiplyQuaternions(
        quaternionFromYaw(angleRad),
        component.orientation,
      );
      synchronizeAttachedRouteEndpoints(next, component.id);
      break;
    }
    case "component.setElevation": {
      const component = requireEntity(next.components, command.componentId, "Component");
      assertComponentIsNotAssemblyMember(next, component.id, "set elevation for");
      component.positionMm.z = normalizeMeasurement(command.elevationMm);
      synchronizeAttachedRouteEndpoints(next, component.id);
      break;
    }
    case "equipmentAssembly.moveBy": {
      const assembly = requireEntity(next.equipmentAssemblies, command.assemblyId, "Equipment assembly");
      const dxMm = requireFinite(command.dxMm, "Equipment assembly x movement");
      const dyMm = requireFinite(command.dyMm, "Equipment assembly y movement");
      for (const componentId of assembly.componentIds) {
        const component = requireEntity(next.components, componentId, "Equipment assembly component");
        component.positionMm.x += dxMm;
        component.positionMm.y += dyMm;
        synchronizeAttachedRouteEndpoints(next, component.id);
      }
      break;
    }
    case "equipmentAssembly.rotateFloorZ": {
      const assembly = requireEntity(next.equipmentAssemblies, command.assemblyId, "Equipment assembly");
      const angleRad = requireFinite(command.angleRad, "Equipment assembly floor-Z rotation");
      const components = assembly.componentIds.map((componentId) => (
        requireEntity(next.components, componentId, "Equipment assembly component")
      ));
      const centre = assemblyPlanCentre(components);
      const sine = Math.sin(angleRad);
      const cosine = Math.cos(angleRad);
      for (const component of components) {
        const dx = component.positionMm.x - centre.x;
        const dy = component.positionMm.y - centre.y;
        component.positionMm.x = centre.x + dx * cosine - dy * sine;
        component.positionMm.y = centre.y + dx * sine + dy * cosine;
        component.orientation = multiplyQuaternions(quaternionFromYaw(angleRad), component.orientation);
        synchronizeAttachedRouteEndpoints(next, component.id);
      }
      break;
    }
    case "equipmentAssembly.setElevation": {
      const assembly = requireEntity(next.equipmentAssemblies, command.assemblyId, "Equipment assembly");
      const elevationMm = normalizeMeasurement(command.elevationMm);
      for (const componentId of assembly.componentIds) {
        const component = requireEntity(next.components, componentId, "Equipment assembly component");
        component.positionMm.z = structuredClone(elevationMm);
        synchronizeAttachedRouteEndpoints(next, component.id);
      }
      break;
    }
    case "component.setDuctRunCount": {
      const component = requireEntity(next.components, command.componentId, "Component");
      if (!assignableRoomTerminalPort(component)) {
        throw new TypeError(`Component is not an assignable single-room MVHR terminal: ${component.id}`);
      }
      component.ductRunCount = normalizeDuctRunCount(command.ductRunCount);
      break;
    }
    case "component.delete": {
      const inspection = componentDeletionInspection(next, command.componentId);
      assertConfirmedComponentDeletionScope(command.confirmedScope, inspection);
      const componentIds = new Set(inspection.componentIds);
      const routeIds = new Set(inspection.routeIds);
      const connectionIds = new Set(inspection.connectionIds);
      next.components = next.components.filter((component) => !componentIds.has(component.id));
      next.routes = next.routes.filter((route) => !routeIds.has(route.id));
      next.connections = next.connections.filter((connection) => !connectionIds.has(connection.id));
      if (inspection.assemblyId !== null) {
        next.equipmentAssemblies = next.equipmentAssemblies.filter(
          (assembly) => assembly.id !== inspection.assemblyId,
        );
      }
      for (const space of [...next.rooms, ...next.zones]) {
        space.terminalAssociations = space.terminalAssociations.filter(
          (association) => !componentIds.has(association.componentId),
        );
      }
      for (const duty of next.engineeringInputs.floorDuties) {
        if (duty.unitComponentId !== null && componentIds.has(duty.unitComponentId)) {
          duty.unitComponentId = null;
        }
      }
      break;
    }
    case "ventilation.clearFloor": {
      const floorId = command.floorId;
      requireEntity(next.floors, floorId, "Ventilation clear floor");
      const inspection = floorVentilationClearInspection(next, floorId);
      if (inspection.isEmpty) {
        throw new TypeError(`No ventilation objects exist on floor: ${floorId}`);
      }
      if (inspection.blockingConnectionIds.length > 0) {
        throw new TypeError(
          `Cannot clear floor ventilation while direct connections cross to another floor: ${inspection.blockingConnectionIds.join(", ")}`,
        );
      }
      const componentIds = new Set(inspection.componentIds);
      const connectionIds = new Set(inspection.connectionIds);
      next.components = next.components.filter((component) => !componentIds.has(component.id));
      next.equipmentAssemblies = next.equipmentAssemblies.filter((assembly) => assembly.floorId !== floorId);
      next.routes = next.routes.filter((route) => route.floorId !== floorId);
      next.connections = next.connections.filter((connection) => !connectionIds.has(connection.id));
      for (const space of [...next.rooms, ...next.zones]) {
        space.terminalAssociations = space.terminalAssociations.filter(
          (association) => !componentIds.has(association.componentId),
        );
      }
      for (const duty of next.engineeringInputs.floorDuties) {
        if (duty.unitComponentId !== null && componentIds.has(duty.unitComponentId)) {
          duty.unitComponentId = null;
        }
      }
      break;
    }
    case "route.add": {
      for(const selection of command.terminalEntrySelections??[]) {
        if(![command.route?.startAttachment,command.route?.endAttachment].some(e=>e?.componentId===selection.componentId&&e.portId===selection.portId))throw new TypeError("Terminal entry must belong to a route endpoint");
        selectTerminalDrawingEntry(next,selection);
      }
      const route = normalizeRoute(command.route);
      requireUniqueId(next.routes, route.id, "Route");
      requireEntity(next.floors, route.floorId, "Floor");
      synchronizeRouteEndpoints(next, route);
      next.routes.push(route);
      break;
    }
    case "route.delete": {
      requireEntity(next.routes, command.routeId, "Route");
      next.routes = next.routes.filter(route => route.id !== command.routeId);
      break;
    }
    case "route.setParallelRunCount": {
      const route = requireEntity(next.routes, command.routeId, "Route");
      route.parallelRunCount = normalizeParallelRunCount(command.parallelRunCount);
      break;
    }
    case "route.insertPoint": {
      const route = requireEntity(next.routes, command.routeId, "Route");
      const segmentIndex = requireRouteSegmentIndex(route, command.segmentIndex);
      route.points.splice(segmentIndex + 1, 0, normalizeRoutePoint(command.point));
      constrainEditedEppRoute(route, next);
      break;
    }
    case "route.realignEppConnections": {
      const route=requireEntity(next.routes,command.routeId,"Route");
      if(!/^epp-rigid-dn/.test(route.ductKind))throw new TypeError("Connection realignment requires an EPP duct run");
      constrainEditedEppRoute(route,next,true);
      break;
    }
    case "route.movePoint": {
      const route = requireEntity(next.routes, command.routeId, "Route");
      const pointIndex = requireRouteInteriorPointIndex(route, command.pointIndex);
      route.points[pointIndex].x = requireFinite(command.xMm, "Route point x");
      route.points[pointIndex].y = requireFinite(command.yMm, "Route point y");
      constrainEditedEppRoute(route, next);
      break;
    }
    case "route.removePoint": {
      const route = requireEntity(next.routes, command.routeId, "Route");
      const pointIndex = requireRouteInteriorPointIndex(route, command.pointIndex);
      route.points.splice(pointIndex, 1);
      constrainEditedEppRoute(route, next);
      break;
    }
    case "route.attachEndpoint": {
      const route = requireEntity(next.routes, command.routeId, "Route");
      const end = normalizeChoice(command.end, ["start", "end"], "Route attachment end");
      const field = `${end}Attachment`;
      if (route[field] !== null) throw new TypeError(`Route ${end} endpoint is already attached`);
      route[field] = normalizeEndpoint(command.endpoint, `Route ${end} attachment`);
      synchronizeRouteEndpoints(next, route);
      break;
    }
    case "connection.add": {
      const connection = normalizeConnection(command.connection);
      requireUniqueId(next.connections, connection.id, "Connection");
      validateConnectionEndpoints(next, connection);
      next.connections.push(connection);
      break;
    }
    case "room.createFromBoundary": {
      createRoomFromBoundary(next, command);
      break;
    }
    case "room.updateMetadata": {
      const room = requireEntity(next.rooms, command.roomId, "Room");
      room.name = normalizeRoomName(command.name);
      room.use = normalizeChoice(command.use, ROOM_USE_TYPES, "Room use");
      room.ventilationRole = normalizeChoice(
        command.ventilationRole,
        ROOM_VENTILATION_ROLES,
        "Room ventilation role",
      );
      if (command.airflowTargets !== undefined) {
        room.airflowTargets = normalizeSpaceAirflowTargets(command.airflowTargets, room.ventilationRole);
      }
      break;
    }
    case "room.assignBoundary": {
      assignRoomBoundary(next, command);
      break;
    }
    case "terminal.assignRoom": {
      assignTerminalToRoom(next, command);
      break;
    }
    case "terminal.unassignRoom": {
      unassignTerminalFromRoom(next, command);
      break;
    }
    case "room.remove": {
      const room = requireEntity(next.rooms, command.roomId, "Room");
      const dependentZones = next.zones.filter((zone) => zone.parentRoomId === room.id);
      if (dependentZones.length > 0) {
        throw new TypeError(
          `Room removal is blocked by dependent zones: ${dependentZones.map((zone) => zone.id).join(", ")}`,
        );
      }
      next.rooms = next.rooms.filter((candidate) => candidate.id !== room.id);
      break;
    }
    case "zone.createFromBoundary": {
      createZoneFromBoundary(next, command);
      break;
    }
    case "zone.updateMetadata": {
      const zone = requireEntity(next.zones, command.zoneId, "Zone");
      zone.name = normalizeRoomName(command.name);
      zone.use = normalizeChoice(command.use, ROOM_USE_TYPES, "Zone use");
      zone.ventilationRole = normalizeChoice(
        command.ventilationRole,
        ROOM_VENTILATION_ROLES,
        "Zone ventilation role",
      );
      if (command.airflowTargets !== undefined) {
        zone.airflowTargets = normalizeSpaceAirflowTargets(command.airflowTargets, zone.ventilationRole);
      }
      break;
    }
    case "zone.assignBoundary": {
      assignZoneBoundary(next, command);
      break;
    }
    case "zone.remove": {
      const zone = requireEntity(next.zones, command.zoneId, "Zone");
      next.zones = next.zones.filter((candidate) => candidate.id !== zone.id);
      break;
    }
    case "floorArea.create": {
      const outline = normalizeFloorAreaOutline(command.outline);
      requireUniqueId(next.floorAreaOutlines, outline.id, "Floor area outline");
      requireEntity(next.floors, outline.floorId, "Floor area outline floor");
      if (next.floorAreaOutlines.some((candidate) => candidate.floorId === outline.floorId)) {
        throw new TypeError(`Only one floor area outline is supported per floor: ${outline.floorId}`);
      }
      next.floorAreaOutlines.push(outline);
      break;
    }
    case "floorArea.updateMetadata": {
      const outline = requireEntity(next.floorAreaOutlines, command.outlineId, "Floor area outline");
      outline.name = normalizeFloorAreaName(command.name);
      break;
    }
    case "floorArea.moveVertex": {
      const outline = requireEntity(next.floorAreaOutlines, command.outlineId, "Floor area outline");
      const vertex = requireEntity(outline.vertices, command.vertexId, "Floor area vertex");
      vertex.positionMm.x = requireFinite(command.xMm, "Floor area vertex x");
      vertex.positionMm.y = requireFinite(command.yMm, "Floor area vertex y");
      break;
    }
    case "floorArea.remove": {
      requireEntity(next.floorAreaOutlines, command.outlineId, "Floor area outline");
      next.floorAreaOutlines = next.floorAreaOutlines.filter(
        (candidate) => candidate.id !== command.outlineId,
      );
      break;
    }
    case "terminal.assignZone": {
      assignTerminalToZone(next, command);
      break;
    }
    case "terminal.assignUnassignedByPosition": {
      for (const component of next.components) {
        if (!assignableRoomTerminalPort(component) || terminalHasSpaceAssignment(next, component.id)) continue;
        assignTerminalToContainingSpace(next, component);
      }
      break;
    }
    case "wall.addChain": {
      addWallChain(next, command);
      break;
    }
    case "wall.moveNode": {
      const node = requireEntity(next.wallNodes, command.nodeId, "Wall node");
      node.positionMm.x = requireFinite(command.xMm, "Wall node x");
      node.positionMm.y = requireFinite(command.yMm, "Wall node y");
      break;
    }
    case "wall.split": {
      splitWall(next, command);
      break;
    }
    case "wall.delete": {
      const wall = requireEntity(next.walls, command.wallId, "Wall to delete");
      deleteWalls(next, new Set([wall.id]));
      break;
    }
    case "wall.deleteConnected": {
      const wall = requireEntity(next.walls, command.wallId, "Connected wall seed");
      deleteWalls(next, new Set(wallConnectedComponentIds(next, wall.id)));
      break;
    }
    case "reference.addImage": {
      const asset = normalizeReferenceAsset(command.asset);
      if (asset.source !== null) throw new TypeError("PNG upload cannot claim PDF page provenance");
      const reference = normalizeFloorReference(command.reference, asset);
      requireUniqueId(next.referenceAssets, asset.id, "Reference asset");
      requireUniqueId(next.floorReferences, reference.id, "Floor reference");
      requireEntity(next.floors, reference.floorId, "Floor");
      if (reference.assetId !== asset.id) {
        throw new TypeError("Floor reference must identify the added source asset");
      }
      next.referenceAssets.push(asset);
      next.floorReferences.push(reference);
      break;
    }
    case "reference.addPdfPage": {
      const pdfAsset = normalizePdfReferenceAsset(command.pdfAsset);
      const asset = normalizeReferenceAsset(command.asset);
      const reference = normalizeFloorReference(command.reference, asset);
      if (asset.source?.kind !== "pdf-page" || asset.source.pdfAssetId !== pdfAsset.id) {
        throw new TypeError("Rendered PDF page must identify its original PDF source");
      }
      if (asset.source.pageCount !== pdfAsset.pageCount) {
        throw new TypeError("Rendered PDF page count must match its original PDF source");
      }
      validatePdfPageRenderDimensions(asset);
      requireUniqueId(next.pdfReferenceAssets, pdfAsset.id, "PDF reference asset");
      requireUniqueId(next.referenceAssets, asset.id, "Reference asset");
      requireUniqueId(next.floorReferences, reference.id, "Floor reference");
      requireEntity(next.floors, reference.floorId, "Floor");
      if (reference.assetId !== asset.id) {
        throw new TypeError("Floor reference must identify the rendered PDF page asset");
      }
      next.pdfReferenceAssets.push(pdfAsset);
      next.referenceAssets.push(asset);
      next.floorReferences.push(reference);
      break;
    }
    case "reference.addCad": {
      const asset = validateDxfAsset(command.asset);
      const reference = validateFloorDxfReference(command.reference, asset);
      requireUniqueId(next.cadReferenceAssets, asset.id, "CAD reference asset");
      requireUniqueId(next.floorCadReferences, reference.id, "Floor CAD reference");
      requireEntity(next.floors, reference.floorId, "Floor");
      next.cadReferenceAssets.push(asset);
      next.floorCadReferences.push(reference);
      break;
    }
    case "reference.calibrate": {
      const reference = requireEntity(next.floorReferences, command.referenceId, "Floor reference");
      applyReferenceCalibration(next, reference, command);
      break;
    }
    case "reference.setVisibility": {
      const reference = requireEntity(next.floorReferences, command.referenceId, "Floor reference");
      if (typeof command.visible !== "boolean") {
        throw new TypeError("Reference visibility must be boolean");
      }
      reference.visible = command.visible;
      break;
    }
    case "reference.setCrop": {
      const reference = requireEntity(next.floorReferences, command.referenceId, "Floor reference");
      const asset = requireEntity(next.referenceAssets, reference.assetId, "Reference asset");
      if (asset.source?.kind !== "pdf-page") {
        throw new TypeError("Only rendered PDF page references support cropping");
      }
      reference.cropSourceRectPx = normalizeReferenceCrop(command.cropSourceRectPx, asset);
      break;
    }
    case "reference.resetCrop": {
      const reference = requireEntity(next.floorReferences, command.referenceId, "Floor reference");
      const asset = requireEntity(next.referenceAssets, reference.assetId, "Reference asset");
      if (asset.source?.kind !== "pdf-page") {
        throw new TypeError("Only rendered PDF page references support cropping");
      }
      reference.cropSourceRectPx = null;
      break;
    }
    case "quote.updateDraft": {
      next.quoteDraft = normalizeQuoteDraft(command.quoteDraft);
      break;
    }
    case "engineering.setFloorDuty": {
      const duty = normalizeFloorDuty(command.duty);
      requireEntity(next.floors, duty.floorId, "Engineering duty floor");
      if (duty.unitComponentId !== null) {
        const component = requireEntity(next.components, duty.unitComponentId, "Engineering duty unit component");
        if (component.floorId !== duty.floorId) {
          throw new TypeError("Engineering duty unit must be on the selected floor");
        }
        if (!isMvhrUnitComponent(component)) {
          throw new TypeError("Engineering duty selection must reference an MVHR unit component");
        }
      }
      next.engineeringInputs.floorDuties = next.engineeringInputs.floorDuties.filter(
        (candidate) => candidate.floorId !== duty.floorId,
      );
      next.engineeringInputs.floorDuties.push(duty);
      break;
    }
    case "engineering.clearFloorDuty": {
      requireEntity(next.floors, command.floorId, "Engineering duty floor");
      next.engineeringInputs.floorDuties = next.engineeringInputs.floorDuties.filter(
        (candidate) => candidate.floorId !== command.floorId,
      );
      break;
    }
    case "workflow.startPreliminaryLayout": {
      if (next.workflow.stage === "quick-quote") next.workflow.stage = "preliminary-layout";
      else if (next.workflow.stage !== "preliminary-layout") {
        throw new TypeError(`Cannot start preliminary layout from stage: ${next.workflow.stage}`);
      }
      break;
    }
    case "workflow.convertToProject": {
      if (next.workflow.convertedQuoteSnapshotId !== null) break;
      const snapshot = createQuoteSnapshot(next, {
        id: command.quoteSnapshotId,
        createdAtUtc: command.createdAtUtc,
      });
      requireUniqueId(next.quoteSnapshots, snapshot.id, "Quote snapshot");
      next.quoteSnapshots.push(snapshot);
      next.workflow.stage = "project-converted";
      next.workflow.convertedQuoteSnapshotId = snapshot.id;
      break;
    }
    case "workflow.startDetailedDesign": {
      if (next.workflow.stage === "detailed-design") break;
      if (next.workflow.stage !== "project-converted") {
        throw new TypeError(`Convert the quote to a project before detailed design: ${next.workflow.stage}`);
      }
      next.workflow.stage = "detailed-design";
      break;
    }
    default:
      throw new TypeError(`Unsupported command type: ${String(command?.type)}`);
  }
  const validated = validateProject(next);
  assertPortableProjectGrowth(canonicalStringify(current), canonicalStringify(validated), {
    maximumBytes: options.portableMaximumBytes,
  });
  return validated;
}

export function inspectFloorVentilationClear(project, floorId) {
  validateProject(project);
  requireEntity(project.floors, floorId, "Ventilation clear floor");
  return structuredClone(floorVentilationClearInspection(project, floorId));
}

export function inspectComponentDeletion(project, componentId) {
  validateProject(project);
  return structuredClone(componentDeletionInspection(project, componentId));
}

export function worldPortTransform(project, componentId, portId) {
  validateProject(project);
  const component = requireEntity(project.components, componentId, "Component");
  const floor = requireEntity(project.floors, component.floorId, "Floor");
  const port = requireEntity(component.ports, portId, "Port");
  const combinedOrientation = multiplyQuaternions(
    floor.transform.orientation,
    component.orientation,
  );
  const direction = rotateVector(combinedOrientation, port.direction);
  const transformed = componentPointToBuilding(project, componentId, port.positionMm);
  return {
    ...transformed,
    direction,
    orientation: combinedOrientation,
  };
}

export function routeEndpointTransform(project, routeId, end) {
  validateProject(project);
  const route = requireEntity(project.routes, routeId, "Route");
  const normalizedEnd = normalizeChoice(end, ["start", "end"], "Route endpoint transform end");
  const attachment = route[`${normalizedEnd}Attachment`];
  if (attachment === null) throw new TypeError(`Route ${normalizedEnd} endpoint is not attached`);
  const pointIndex = normalizedEnd === "start" ? 0 : route.points.length - 1;
  const world = worldPortTransform(project, attachment.componentId, attachment.portId);
  return {
    attachment: structuredClone(attachment),
    floorPositionMm: structuredClone(route.points[pointIndex]),
    buildingPositionMm: world.positionMm,
    buildingPositionState: world.positionState,
    direction: world.direction,
    orientation: world.orientation,
    ...(world.reason ? { reason: world.reason } : {}),
  };
}

export function floorPortTransform(project, componentId, portId) {
  validateProject(project);
  const component = requireEntity(project.components, componentId, "Component");
  const port = requireEntity(component.ports, portId, "Port");
  return {
    positionMm: componentPortPositionOnFloor(project, { componentId, portId }),
    direction: rotateVector(component.orientation, port.direction),
    orientation: structuredClone(component.orientation),
  };
}

export function componentPointToBuilding(project, componentId, localPointMm) {
  validateProject(project);
  const component = requireEntity(project.components, componentId, "Component");
  const floor = requireEntity(project.floors, component.floorId, "Floor");
  const floorTranslation = resolvePosition(floor.transform.translationMm);
  const componentPosition = resolvePosition(component.positionMm);
  const localPoint = normalizeKnownVector(localPointMm, "Component-local point");
  if (!floorTranslation || !componentPosition) {
    return unknownTransformResult();
  }
  const combinedOrientation = multiplyQuaternions(
    floor.transform.orientation,
    component.orientation,
  );
  const componentInBuilding = addVectors(
    floorTranslation,
    rotateVector(floor.transform.orientation, componentPosition),
  );
  return {
    positionMm: addVectors(
      componentInBuilding,
      rotateVector(combinedOrientation, localPoint),
    ),
    positionState: "known",
  };
}

export function buildingPointToComponent(project, componentId, buildingPointMm) {
  validateProject(project);
  const component = requireEntity(project.components, componentId, "Component");
  const floor = requireEntity(project.floors, component.floorId, "Floor");
  const floorTranslation = resolvePosition(floor.transform.translationMm);
  const componentPosition = resolvePosition(component.positionMm);
  const buildingPoint = normalizeKnownVector(buildingPointMm, "Building point");
  if (!floorTranslation || !componentPosition) {
    return unknownTransformResult();
  }
  const combinedOrientation = multiplyQuaternions(
    floor.transform.orientation,
    component.orientation,
  );
  const componentInBuilding = addVectors(
    floorTranslation,
    rotateVector(floor.transform.orientation, componentPosition),
  );
  return {
    positionMm: rotateVector(
      inverseQuaternion(combinedOrientation),
      subtractVectors(buildingPoint, componentInBuilding),
    ),
    positionState: "known",
  };
}

export function routeLengthSummary(route) {
  const normalized = normalizeRoute(route);
  let projectedMm = 0;
  let developedMm = 0;
  let developedKnown = true;

  for (let index = 1; index < normalized.points.length; index += 1) {
    const previous = normalized.points[index - 1];
    const current = normalized.points[index];
    projectedMm += Math.hypot(current.x - previous.x, current.y - previous.y);
    const previousZ = resolveMeasurement(previous.z);
    const currentZ = resolveMeasurement(current.z);
    if (previousZ === null || currentZ === null) {
      developedKnown = false;
    } else {
      developedMm += Math.hypot(
        current.x - previous.x,
        current.y - previous.y,
        currentZ - previousZ,
      );
    }
  }

  return {
    projectedMm,
    developedMm: developedKnown ? developedMm : null,
    developedState: developedKnown ? "known" : "unknown",
  };
}

export function arePortsConnected(project, left, right) {
  validateProject(project);
  const sameEndpoint = (candidate, endpoint) =>
    candidate.componentId === endpoint.componentId && candidate.portId === endpoint.portId;
  const directConnection = project.connections.some(
    (connection) =>
      (sameEndpoint(connection.from, left) && sameEndpoint(connection.to, right)) ||
      (sameEndpoint(connection.from, right) && sameEndpoint(connection.to, left)),
  );
  if (directConnection) return true;
  return project.routes.some(
    (route) => route.startAttachment !== null && route.endAttachment !== null && (
      (sameEndpoint(route.startAttachment, left) && sameEndpoint(route.endAttachment, right)) ||
      (sameEndpoint(route.startAttachment, right) && sameEndpoint(route.endAttachment, left))
    ),
  );
}

export function roomTerminalPort(project, componentId) {
  validateProject(project);
  const component = requireEntity(project.components, componentId, "Component");
  const port = assignableRoomTerminalPort(component);
  return port ? structuredClone(port) : null;
}

export function terminalRoomAssignment(project, componentId) {
  validateProject(project);
  const component = requireEntity(project.components, componentId, "Component");
  const port = assignableRoomTerminalPort(component);
  if (!port) return null;
  for (const room of project.rooms) {
    if (room.terminalAssociations.some(
      (association) => association.componentId === component.id && association.portId === port.id,
    )) {
      return {
        roomId: room.id,
        componentId: component.id,
        portId: port.id,
        assignmentMethod: room.terminalAssociations.find(
          (association) => association.componentId === component.id && association.portId === port.id,
        ).assignmentMethod,
      };
    }
  }
  for (const zone of project.zones) {
    if (zone.terminalAssociations.some(
      (association) => association.componentId === component.id && association.portId === port.id,
    )) {
      return {
        zoneId: zone.id,
        componentId: component.id,
        portId: port.id,
        assignmentMethod: zone.terminalAssociations.find(
          (association) => association.componentId === component.id && association.portId === port.id,
        ).assignmentMethod,
      };
    }
  }
  return null;
}

export function serializeProject(project) {
  return canonicalStringify(validateProject(project));
}

export function deserializeProject(json) {
  if (typeof json !== "string") {
    throw new TypeError("Serialized project must be a string");
  }
  return validateProject(migrateProjectData(JSON.parse(json)));
}

export function migrateProjectData(project) {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new TypeError("Project must be an object");
  }
  let migrated = structuredClone(project);
  if (migrated.schemaVersion === 1) {
    migrated = {
      ...migrated,
      schemaVersion: 2,
      referenceAssets: [],
      floorReferences: [],
    };
  }
  if (migrated.schemaVersion === 2) {
    migrated = {
      ...migrated,
      schemaVersion: 3,
      floorReferences: migrated.floorReferences.map((reference) => ({
        ...reference,
        calibration: reference.calibration === null
          ? null
          : {
              ...reference.calibration,
              modelScaleMode: "reference-only",
              modelScaleFactor: 1,
            },
      })),
    };
  }
  if (migrated.schemaVersion === 3) {
    migrated = {
      ...migrated,
      schemaVersion: 4,
      routes: migrated.routes.map((route) => ({
        ...route,
        role: null,
        startAttachment: null,
        endAttachment: null,
      })),
    };
  }
  if (migrated.schemaVersion === 4) {
    migrated = {
      ...migrated,
      schemaVersion: 5,
      routes: migrated.routes.map((route) => ({
        ...route,
        ductKind: "generic-duct",
      })),
    };
  }
  if (migrated.schemaVersion === 5) {
    migrated = {
      ...migrated,
      schemaVersion: 6,
      cadReferenceAssets: [],
      floorCadReferences: [],
    };
  }
  if (migrated.schemaVersion === 6) {
    migrated = {
      ...migrated,
      schemaVersion: 7,
      rooms: [],
    };
  }
  if (migrated.schemaVersion === 7) {
    migrated = {
      ...migrated,
      schemaVersion: 8,
      rooms: migrated.rooms.map((room) => ({
        ...room,
        volumeEvidence: room.volumeEvidence ?? {
          state: "unknown",
          valueM3: null,
          reason: "room volume not calculated",
        },
        terminalAssociations: room.terminalAssociations ?? [],
      })),
    };
  }
  if (migrated.schemaVersion === 8) {
    migrated = {
      ...migrated,
      schemaVersion: 9,
      zones: [],
      walls: migrated.walls.map((wall) => wall.classification === "virtual"
        ? {
            ...wall,
            boundaryRole: wall.boundaryRole ?? "legacy-virtual",
            parentRoomId: wall.parentRoomId ?? null,
          }
        : wall),
    };
  }
  if (migrated.schemaVersion === 9) {
    migrated = {
      ...migrated,
      schemaVersion: 10,
      floorAreaOutlines: [],
    };
  }
  if (migrated.schemaVersion === 10) {
    migrated = {
      ...migrated,
      schemaVersion: 11,
      components: migrated.components.map((component) => ({
        ...component,
        ductRunCount: component.ductRunCount ?? null,
      })),
    };
  }
  if (migrated.schemaVersion === 11) {
    migrated = {
      ...migrated,
      schemaVersion: 12,
      equipmentAssemblies: [],
    };
  }
  if (migrated.schemaVersion === 12) {
    migrated = {
      ...migrated,
      schemaVersion: 13,
    };
  }
  if (migrated.schemaVersion === 13) {
    migrated = {
      ...migrated,
      schemaVersion: 14,
      routes: migrated.routes.map((route) => ({
        ...route,
        parallelRunCount: route.parallelRunCount ?? null,
      })),
    };
  }
  if (migrated.schemaVersion === 14) {
    migrated = {
      ...migrated,
      schemaVersion: 15,
      workflow: inferredLegacyWorkflow(migrated),
      quoteDraft: createQuoteDraft(),
      quoteSnapshots: [],
    };
  }
  if (migrated.schemaVersion === 15) {
    migrated = {
      ...migrated,
      schemaVersion: 16,
      pdfReferenceAssets: [],
      referenceAssets: migrated.referenceAssets.map((asset) => ({
        ...asset,
        source: asset.source ?? null,
      })),
    };
  }
  if (migrated.schemaVersion === 16) {
    migrated = {
      ...migrated,
      schemaVersion: 17,
      rooms: migrated.rooms.map((room) => ({
        ...room,
        airflowTargets: unresolvedSpaceAirflowTargets(),
      })),
      zones: migrated.zones.map((zone) => ({
        ...zone,
        airflowTargets: unresolvedSpaceAirflowTargets(),
      })),
    };
  }
  if (migrated.schemaVersion === 17) {
    migrated = {
      ...migrated,
      schemaVersion: 18,
      engineeringInputs: createEngineeringInputs(),
    };
  }
  if (migrated.schemaVersion === 18) {
    migrated = {
      ...migrated,
      schemaVersion: 19,
      floorReferences: migrated.floorReferences.map((reference) => ({
        ...reference,
        cropSourceRectPx: null,
      })),
    };
  }
  if (migrated.schemaVersion === SCHEMA_VERSION) return migrated;
  throw new RangeError(`Unsupported schema version: ${String(project.schemaVersion)}`);
}

export function validateProject(project) {
  if (!project || typeof project !== "object") {
    throw new TypeError("Project must be an object");
  }
  for (const field of FORBIDDEN_PROJECT_AUTHORITY_FIELDS) {
    if (Object.hasOwn(project, field)) {
      throw new TypeError(`Project data cannot confer authority: ${field}`);
    }
  }
  if (project.schemaVersion !== SCHEMA_VERSION) {
    throw new RangeError(`Unsupported schema version: ${String(project.schemaVersion)}`);
  }
  requireOpaqueId(project.id, "Project ID");
  if (
    !project.coordinateSystem ||
    project.coordinateSystem.lengthUnit !== COORDINATE_SYSTEM.lengthUnit ||
    project.coordinateSystem.angleUnit !== COORDINATE_SYSTEM.angleUnit ||
    project.coordinateSystem.handedness !== COORDINATE_SYSTEM.handedness ||
    project.coordinateSystem.upAxis !== COORDINATE_SYSTEM.upAxis
  ) {
    throw new TypeError("Project coordinate system must be canonical mm/rad/right-handed/Z-up");
  }
  for (const collection of [
    "floors",
    "components",
    "equipmentAssemblies",
    "routes",
    "connections",
    "wallNodes",
    "walls",
    "floorAreaOutlines",
    "rooms",
    "zones",
    "referenceAssets",
    "floorReferences",
    "pdfReferenceAssets",
    "cadReferenceAssets",
    "floorCadReferences",
    "quoteSnapshots",
  ]) {
    if (!Array.isArray(project[collection])) {
      throw new TypeError(`Project ${collection} must be an array`);
    }
    assertUniqueIds(project[collection], collection);
  }
  normalizeQuoteDraft(project.quoteDraft);
  const engineeringInputs = normalizeEngineeringInputs(project.engineeringInputs);
  const workflow = normalizeDesignWorkflow(project.workflow);
  project.quoteSnapshots.forEach(normalizeQuoteSnapshot);
  if (workflow.convertedQuoteSnapshotId !== null) {
    requireEntity(project.quoteSnapshots, workflow.convertedQuoteSnapshotId, "Converted quote snapshot");
  }
  if (workflow.stage === "project-converted" && workflow.convertedQuoteSnapshotId === null) {
    throw new TypeError("Converted project stage requires a quote snapshot");
  }
  project.floors.forEach((floor) => {
    normalizeFloor(floor);
    assertNormalizedQuaternion(floor.transform.orientation, "Floor orientation");
  });
  project.components.forEach((component) => {
    normalizeComponent(component);
    assertNormalizedQuaternion(component.orientation, "Component orientation");
    component.ports.forEach((port) => {
      assertNormalizedDirection(port.direction, "Port direction");
    });
    requireEntity(project.floors, component.floorId, "Floor");
  });
  for (const duty of engineeringInputs.floorDuties) {
    requireEntity(project.floors, duty.floorId, "Engineering duty floor");
    if (duty.unitComponentId === null) continue;
    const component = requireEntity(project.components, duty.unitComponentId, "Engineering duty unit component");
    if (component.floorId !== duty.floorId) {
      throw new TypeError("Engineering duty unit must be on the selected floor");
    }
    if (!isMvhrUnitComponent(component)) {
      throw new TypeError("Engineering duty selection must reference an MVHR unit component");
    }
  }
  const occupiedEndpoints = new Set();
  project.routes.forEach((route) => {
    for (const field of ["role", "startAttachment", "endAttachment", "ductKind", "parallelRunCount"]) {
      if (!Object.hasOwn(route, field)) {
        throw new TypeError(`Schema ${SCHEMA_VERSION} route is missing ${field}`);
      }
    }
    normalizeRoute(route);
    requireEntity(project.floors, route.floorId, "Floor");
    validateRouteAttachments(project, route);
    for (const endpoint of [route.startAttachment, route.endAttachment]) {
      if (endpoint === null) continue;
      const key = endpointKey(endpoint);
      if (occupiedEndpoints.has(key)) throw new TypeError(`Port is already occupied: ${key}`);
      occupiedEndpoints.add(key);
    }
  });
  project.connections.forEach((connection) => {
    normalizeConnection(connection);
    validateConnectionEndpoints(project, connection, { checkOccupancy: false });
    for (const endpoint of [connection.from, connection.to]) {
      const key = endpointKey(endpoint);
      if (occupiedEndpoints.has(key)) {
        throw new TypeError(`Port is already occupied: ${key}`);
      }
      occupiedEndpoints.add(key);
    }
  });
  const assemblyMembers = new Map();
  project.equipmentAssemblies.forEach((assembly) => {
    const normalized = normalizeEquipmentAssembly(assembly);
    requireEntity(project.floors, normalized.floorId, "Equipment assembly floor");
    for (const componentId of normalized.componentIds) {
      const component = requireEntity(project.components, componentId, "Equipment assembly component");
      if (component.floorId !== normalized.floorId) {
        throw new TypeError(`Equipment assembly components must share its floor: ${normalized.id}`);
      }
      const priorAssemblyId = assemblyMembers.get(componentId);
      if (priorAssemblyId) {
        throw new TypeError(`Component cannot belong to multiple equipment assemblies: ${componentId}`);
      }
      assemblyMembers.set(componentId, normalized.id);
    }
    for (const connectionId of normalized.connectionIds) {
      const connection = requireEntity(project.connections, connectionId, "Equipment assembly connection");
      if (!normalized.componentIds.includes(connection.from.componentId) || !normalized.componentIds.includes(connection.to.componentId)) {
        throw new TypeError(`Equipment assembly connection must remain internal: ${connectionId}`);
      }
    }
  });
  const wallNodeLocations = new Map();
  project.wallNodes.forEach((node) => {
    normalizeWallNode(node);
    requireEntity(project.floors, node.floorId, "Floor");
    const locationKey = wallNodeLocationKey(node.floorId, node.positionMm);
    const coincidentNode = wallNodeLocations.get(locationKey);
    if (coincidentNode) {
      throw new TypeError(
        `Coincident wall nodes must share one identity: ${coincidentNode} and ${node.id}`,
      );
    }
    wallNodeLocations.set(locationKey, node.id);
  });
  const wallEndpointPairs = new Map();
  project.walls.forEach((wall) => {
    validateWall(project, wall);
    const pairKey = wallEndpointPairKey(wall.startNodeId, wall.endNodeId);
    const overlappingWall = wallEndpointPairs.get(pairKey);
    if (overlappingWall) {
      throw new TypeError(
        `Walls cannot duplicate the same topological edge: ${overlappingWall} and ${wall.id}`,
      );
    }
    wallEndpointPairs.set(pairKey, wall.id);
  });
  const outlinedFloors = new Set();
  project.floorAreaOutlines.forEach((outline) => {
    const normalized = normalizeFloorAreaOutline(outline);
    requireEntity(project.floors, normalized.floorId, "Floor area outline floor");
    if (outlinedFloors.has(normalized.floorId)) {
      throw new TypeError(`Only one floor area outline is supported per floor: ${normalized.floorId}`);
    }
    outlinedFloors.add(normalized.floorId);
    inspectFloorAreaOutline(normalized);
  });
  const assignedRoomBoundaries = new Map();
  const assignedTerminalEndpoints = new Map();
  project.rooms.forEach((room) => {
    validateRoom(project, room);
    const assignmentKey = `${room.floorId}\u0000${roomBoundaryKey(room.boundary)}`;
    const existingRoomId = assignedRoomBoundaries.get(assignmentKey);
    if (existingRoomId) {
      throw new TypeError(`Rooms cannot share one authoritative boundary: ${existingRoomId} and ${room.id}`);
    }
    assignedRoomBoundaries.set(assignmentKey, room.id);
    if (
      room.terminalAssociations.length > 0 &&
      project.zones.some((zone) => zone.parentRoomId === room.id)
    ) {
      throw new TypeError(`Parent room cannot retain terminal assignments while zones exist: ${room.id}`);
    }
    for (const association of room.terminalAssociations) {
      const key = endpointKey(association);
      const existingRoomId = assignedTerminalEndpoints.get(key);
      if (existingRoomId) {
        throw new TypeError(`Terminal cannot be assigned to multiple rooms: ${existingRoomId} and ${room.id}`);
      }
      assignedTerminalEndpoints.set(key, room.id);
    }
  });
  const assignedZoneBoundaries = new Map();
  project.zones.forEach((zone) => {
    validateZone(project, zone);
    const assignmentKey = `${zone.parentRoomId}\u0000${roomBoundaryKey(zone.boundary)}`;
    const existingZoneId = assignedZoneBoundaries.get(assignmentKey);
    if (existingZoneId) {
      throw new TypeError(`Zones cannot share one authoritative boundary: ${existingZoneId} and ${zone.id}`);
    }
    assignedZoneBoundaries.set(assignmentKey, zone.id);
    for (const association of zone.terminalAssociations) {
      const key = endpointKey(association);
      const existingSpaceId = assignedTerminalEndpoints.get(key);
      if (existingSpaceId) {
        throw new TypeError(`Terminal cannot be assigned to multiple rooms or zones: ${existingSpaceId} and ${zone.id}`);
      }
      assignedTerminalEndpoints.set(key, zone.id);
    }
  });
  if (project.referenceAssets.length > MAX_REFERENCE_ASSETS) {
    throw new RangeError(`Project exceeds the ${MAX_REFERENCE_ASSETS}-reference prototype limit`);
  }
  let totalReferenceBytes = 0;
  project.referenceAssets.forEach((asset) => {
    normalizeReferenceAsset(asset);
    totalReferenceBytes += asset.byteLength;
  });
  if (totalReferenceBytes > MAX_TOTAL_REFERENCE_BYTES) {
    throw new RangeError(`Project reference bytes exceed the ${MAX_TOTAL_REFERENCE_BYTES}-byte prototype limit`);
  }
  if (project.pdfReferenceAssets.length > MAX_PDF_REFERENCE_ASSETS) {
    throw new RangeError(`Project exceeds the ${MAX_PDF_REFERENCE_ASSETS}-PDF-reference limit`);
  }
  let totalPdfReferenceBytes = 0;
  project.pdfReferenceAssets.forEach((asset) => {
    normalizePdfReferenceAsset(asset);
    totalPdfReferenceBytes += asset.byteLength;
  });
  if (totalPdfReferenceBytes > MAX_TOTAL_PDF_SOURCE_BYTES) {
    throw new RangeError(`Project PDF source bytes exceed the ${MAX_TOTAL_PDF_SOURCE_BYTES}-byte limit`);
  }
  project.floorReferences.forEach((reference) => {
    if (!Object.hasOwn(reference, "cropSourceRectPx")) {
      throw new TypeError(`Schema ${SCHEMA_VERSION} floor reference is missing cropSourceRectPx`);
    }
    requireEntity(project.floors, reference.floorId, "Floor");
    const asset = requireEntity(project.referenceAssets, reference.assetId, "Reference asset");
    normalizeFloorReference(reference, asset);
  });
  const usedReferenceAssets = new Set();
  for (const reference of project.floorReferences) {
    if (usedReferenceAssets.has(reference.assetId)) {
      throw new TypeError(`Reference asset is already placed: ${reference.assetId}`);
    }
    usedReferenceAssets.add(reference.assetId);
  }
  const usedPdfReferenceAssets = new Set();
  for (const asset of project.referenceAssets) {
    if (asset.source?.kind !== "pdf-page") continue;
    const pdfAsset = requireEntity(project.pdfReferenceAssets, asset.source.pdfAssetId, "PDF reference asset");
    if (asset.source.pageCount !== pdfAsset.pageCount) {
      throw new TypeError(`Rendered PDF page count does not match source: ${asset.id}`);
    }
    validatePdfPageRenderDimensions(asset);
    usedPdfReferenceAssets.add(pdfAsset.id);
  }
  for (const pdfAsset of project.pdfReferenceAssets) {
    if (!usedPdfReferenceAssets.has(pdfAsset.id)) {
      throw new TypeError(`PDF reference source has no rendered page placement: ${pdfAsset.id}`);
    }
  }
  if (project.cadReferenceAssets.length > MAX_DXF_REFERENCE_ASSETS) {
    throw new RangeError(`Project exceeds the ${MAX_DXF_REFERENCE_ASSETS}-DXF-reference prototype limit`);
  }
  let totalCadReferenceBytes = 0;
  project.cadReferenceAssets.forEach((asset) => {
    validateDxfAsset(asset);
    totalCadReferenceBytes += asset.byteLength;
  });
  if (totalCadReferenceBytes > MAX_TOTAL_DXF_REFERENCE_BYTES) {
    throw new RangeError(`Project DXF reference bytes exceed the ${MAX_TOTAL_DXF_REFERENCE_BYTES}-byte prototype limit`);
  }
  const usedCadReferenceAssets = new Set();
  project.floorCadReferences.forEach((reference) => {
    const asset = requireEntity(project.cadReferenceAssets, reference.assetId, "CAD reference asset");
    validateFloorDxfReference(reference, asset);
    requireEntity(project.floors, reference.floorId, "Floor");
    if (usedCadReferenceAssets.has(reference.assetId)) {
      throw new TypeError(`CAD reference asset is already placed: ${reference.assetId}`);
    }
    usedCadReferenceAssets.add(reference.assetId);
  });
  return project;
}

export function referenceScaleMmPerPixel(reference) {
  const normalized = normalizeFloorReference(reference);
  return normalized.transform.scaleMmPerPixel.state === "unknown"
    ? null
    : normalized.transform.scaleMmPerPixel.valueMm;
}

function applyReferenceCalibration(project, reference, command) {
  const pointA = normalizeSourcePoint(command.sourcePointApx, "Calibration point A");
  const pointB = normalizeSourcePoint(command.sourcePointBpx, "Calibration point B");
  const pixelDistance = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
  if (pixelDistance < EPSILON) {
    throw new RangeError("Calibration points must be distinct");
  }
  const knownDistanceMm = requireFinite(command.knownDistanceMm, "Known calibration distance");
  if (knownDistanceMm <= 0) {
    throw new RangeError("Known calibration distance must be positive");
  }
  const inputUnit = normalizeChoice(command.inputUnit, ["mm", "m"], "Calibration input unit");
  if (typeof command.acceptedAtUtc !== "string" || !Number.isFinite(Date.parse(command.acceptedAtUtc))) {
    throw new TypeError("Calibration accepted timestamp is invalid");
  }
  if (typeof command.rescaleFloorModel !== "boolean") {
    throw new TypeError("Calibration requires an explicit floor-model scale choice");
  }
  if (command.rescaleFloorModel) assertFloorModelCanRescale(project, reference.floorId);
  const priorScale = referenceScaleMmPerPixel(reference) ?? requireFinite(
    command.previewScaleMmPerPixel,
    "Calibration preview scale",
  );
  if (priorScale <= 0) throw new RangeError("Calibration preview scale must be positive");
  const scaleMmPerPixel = knownDistanceMm / pixelDistance;
  const rotation = reference.transform.rotationRad;
  const priorAnchor = sourcePointToWorld(reference.transform, pointA, priorScale);
  const rotatedNewAnchor = rotatePlanPoint(pointA, rotation, scaleMmPerPixel);
  reference.transform.translationMm = {
    x: priorAnchor.x - rotatedNewAnchor.x,
    y: priorAnchor.y - rotatedNewAnchor.y,
  };
  reference.transform.scaleMmPerPixel = knownMm(
    scaleMmPerPixel,
    `two-point calibration ${command.acceptedAtUtc}`,
  );
  reference.calibration = {
    sourcePointApx: pointA,
    sourcePointBpx: pointB,
    knownDistanceMm,
    inputUnit,
    acceptedAtUtc: command.acceptedAtUtc,
    scaleMmPerPixel,
    modelScaleMode: command.rescaleFloorModel ? "reference-and-floor-walls" : "reference-only",
    modelScaleFactor: command.rescaleFloorModel ? scaleMmPerPixel / priorScale : 1,
    secondCheck: null,
  };
  if (command.rescaleFloorModel) {
    scaleFloorPlanGeometry(
      project,
      reference.floorId,
      priorAnchor,
      scaleMmPerPixel / priorScale,
    );
  }
}

function scaleFloorPlanGeometry(project, floorId, anchorMm, scaleFactor) {
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    throw new RangeError("Floor-model scale factor must be positive");
  }
  const scalePoint = (point) => {
    point.x = anchorMm.x + (point.x - anchorMm.x) * scaleFactor;
    point.y = anchorMm.y + (point.y - anchorMm.y) * scaleFactor;
  };
  for (const node of project.wallNodes) {
    if (node.floorId === floorId) scalePoint(node.positionMm);
  }
  for (const outline of project.floorAreaOutlines) {
    if (outline.floorId !== floorId) continue;
    for (const vertex of outline.vertices) scalePoint(vertex.positionMm);
  }
}

function assertFloorModelCanRescale(project, floorId) {
  const componentCount = project.components.filter((component) => component.floorId === floorId).length;
  const routeCount = project.routes.filter((route) => route.floorId === floorId).length;
  if (componentCount > 0 || routeCount > 0) {
    throw new TypeError(
      "Floor drawing rescale is blocked while placed components or routes exist; choose Reference only or Cancel",
    );
  }
}

function normalizeReferenceAsset(asset) {
  requireOpaqueId(asset?.id, "Reference asset ID");
  if (asset.kind !== "image") throw new TypeError("Only image reference assets are supported");
  if (typeof asset.fileName !== "string" || !asset.fileName.trim()) {
    throw new TypeError("Reference asset filename is required");
  }
  normalizeChoice(asset.mediaType, ["image/png"], "Image media type");
  if (!Number.isInteger(asset.byteLength) || asset.byteLength < 1) {
    throw new TypeError("Reference asset byte length must be a positive integer");
  }
  if (asset.byteLength > MAX_EMBEDDED_IMAGE_BYTES) {
    throw new RangeError(`Reference asset exceeds the ${MAX_EMBEDDED_IMAGE_BYTES}-byte prototype limit`);
  }
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw new TypeError("Reference asset SHA-256 must be lowercase hexadecimal");
  }
  for (const field of ["widthPx", "heightPx"]) {
    if (!Number.isInteger(asset[field]) || asset[field] < 1) {
      throw new TypeError(`Reference asset ${field} must be a positive integer`);
    }
  }
  const expectedPrefix = `data:${asset.mediaType};base64,`;
  if (typeof asset.dataUrl !== "string" || !asset.dataUrl.startsWith(expectedPrefix)) {
    throw new TypeError("Reference asset must contain matching embedded source bytes");
  }
  const base64 = asset.dataUrl.slice(expectedPrefix.length);
  const maximumBase64Length = Math.ceil(MAX_EMBEDDED_IMAGE_BYTES / 3) * 4;
  if (base64.length > maximumBase64Length) {
    throw new RangeError("Reference asset encoded source exceeds the prototype limit");
  }
  if (base64.length < 4 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new TypeError("Reference asset source must use canonical base64 characters and padding");
  }
  const paddingLength = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const encodedByteLength = base64.length / 4 * 3 - paddingLength;
  if (encodedByteLength !== asset.byteLength) {
    throw new TypeError("Reference asset encoded source length must match its byte-length claim");
  }
  return {
    ...structuredClone(asset),
    source: normalizeRenderedReferenceSource(asset.source),
  };
}

function normalizeRenderedReferenceSource(source) {
  if (source === undefined || source === null) return null;
  if (!source || typeof source !== "object" || Array.isArray(source) || source.kind !== "pdf-page") {
    throw new TypeError("Rendered reference source must be PDF page provenance or null");
  }
  requireOpaqueId(source.pdfAssetId, "Rendered PDF source asset ID");
  if (!Number.isInteger(source.pageNumber) || source.pageNumber < 1 || source.pageNumber > MAX_PDF_PAGE_COUNT) {
    throw new RangeError("Rendered PDF page number is outside the supported range");
  }
  if (!Number.isInteger(source.pageCount) || source.pageCount < source.pageNumber || source.pageCount > MAX_PDF_PAGE_COUNT) {
    throw new RangeError("Rendered PDF page count is invalid");
  }
  const pageLabel = source.pageLabel === null
    ? null
    : normalizeBoundedText(source.pageLabel, "PDF page label", 120);
  const widthPt = requireFinite(source.widthPt, "PDF source page width");
  const heightPt = requireFinite(source.heightPt, "PDF source page height");
  if (widthPt <= 0 || heightPt <= 0) throw new RangeError("PDF source page dimensions must be positive");
  const rotationDeg = requireFinite(source.rotationDeg, "PDF source page rotation");
  if (rotationDeg % 90 !== 0) throw new TypeError("PDF source page rotation must be a multiple of 90 degrees");
  const renderScale = requireFinite(source.renderScale, "PDF page render scale");
  if (renderScale <= 0) throw new RangeError("PDF page render scale must be positive");
  if (source.rendererId !== PDF_IMPORTER.id || source.rendererVersion !== PDF_IMPORTER.version) {
    throw new TypeError("PDF page renderer provenance is unsupported");
  }
  return {
    kind: "pdf-page",
    pdfAssetId: source.pdfAssetId,
    pageNumber: source.pageNumber,
    pageCount: source.pageCount,
    pageLabel,
    widthPt,
    heightPt,
    rotationDeg: ((rotationDeg % 360) + 360) % 360,
    renderScale,
    rendererId: source.rendererId,
    rendererVersion: source.rendererVersion,
  };
}

function validatePdfPageRenderDimensions(asset) {
  const expectedWidthPx = Math.max(1, Math.floor(asset.source.widthPt * asset.source.renderScale));
  const expectedHeightPx = Math.max(1, Math.floor(asset.source.heightPt * asset.source.renderScale));
  if (asset.widthPx !== expectedWidthPx || asset.heightPx !== expectedHeightPx) {
    throw new TypeError(`Rendered PDF page pixel dimensions do not match provenance: ${asset.id}`);
  }
}

function normalizePdfReferenceAsset(asset) {
  requireOpaqueId(asset?.id, "PDF reference asset ID");
  if (asset.kind !== "pdf") throw new TypeError("PDF reference asset kind is invalid");
  const fileName = normalizeBoundedText(asset.fileName, "PDF filename", 255);
  if (asset.mediaType !== "application/pdf") throw new TypeError("PDF media type must be application/pdf");
  if (!Number.isInteger(asset.byteLength) || asset.byteLength < 8 || asset.byteLength > MAX_PDF_SOURCE_BYTES) {
    throw new RangeError(`PDF source byte length must be between 8 and ${MAX_PDF_SOURCE_BYTES}`);
  }
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw new TypeError("PDF source SHA-256 must be lowercase hexadecimal");
  }
  if (!Number.isInteger(asset.pageCount) || asset.pageCount < 1 || asset.pageCount > MAX_PDF_PAGE_COUNT) {
    throw new RangeError(`PDF page count must be between 1 and ${MAX_PDF_PAGE_COUNT}`);
  }
  if (asset.importerId !== PDF_IMPORTER.id || asset.importerVersion !== PDF_IMPORTER.version) {
    throw new TypeError("PDF importer provenance is unsupported");
  }
  const expectedPrefix = "data:application/pdf;base64,";
  if (typeof asset.dataUrl !== "string" || !asset.dataUrl.startsWith(expectedPrefix)) {
    throw new TypeError("PDF reference must contain matching embedded source bytes");
  }
  const base64 = asset.dataUrl.slice(expectedPrefix.length);
  const maximumBase64Length = Math.ceil(MAX_PDF_SOURCE_BYTES / 3) * 4;
  if (base64.length > maximumBase64Length) throw new RangeError("PDF encoded source exceeds the supported limit");
  if (base64.length < 4 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new TypeError("PDF source must use canonical base64 characters and padding");
  }
  const paddingLength = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  if (base64.length / 4 * 3 - paddingLength !== asset.byteLength) {
    throw new TypeError("PDF encoded source length must match its byte-length claim");
  }
  return {
    ...structuredClone(asset),
    fileName,
  };
}

function normalizeFloorReference(reference, asset = null) {
  requireOpaqueId(reference?.id, "Floor reference ID");
  requireOpaqueId(reference?.floorId, "Floor-reference floor ID");
  requireOpaqueId(reference?.assetId, "Floor-reference asset ID");
  if (typeof reference.visible !== "boolean" || reference.locked !== true) {
    throw new TypeError("Image references require boolean visibility and a locked layer");
  }
  const opacity = requireFinite(reference.opacity, "Reference opacity");
  if (opacity < 0 || opacity > 1) throw new RangeError("Reference opacity must be between 0 and 1");
  const translationMm = {
    x: requireFinite(reference.transform?.translationMm?.x, "Reference translation x"),
    y: requireFinite(reference.transform?.translationMm?.y, "Reference translation y"),
  };
  const rotationRad = requireFinite(reference.transform?.rotationRad, "Reference rotation");
  const scaleMmPerPixel = normalizeMeasurement(reference.transform?.scaleMmPerPixel);
  if (scaleMmPerPixel.state !== "unknown" && scaleMmPerPixel.valueMm <= 0) {
    throw new RangeError("Reference scale must be positive when known");
  }
  if (reference.calibration !== null) {
    const calibration = reference.calibration;
    const pointA = normalizeSourcePoint(calibration?.sourcePointApx, "Calibration point A");
    const pointB = normalizeSourcePoint(calibration?.sourcePointBpx, "Calibration point B");
    if (Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y) < EPSILON) {
      throw new RangeError("Calibration points must be distinct");
    }
    if (!Number.isFinite(calibration?.knownDistanceMm) || calibration.knownDistanceMm <= 0) {
      throw new RangeError("Calibration known distance must be positive");
    }
    normalizeChoice(calibration.inputUnit, ["mm", "m"], "Calibration input unit");
    if (
      typeof calibration.acceptedAtUtc !== "string" ||
      !Number.isFinite(Date.parse(calibration.acceptedAtUtc))
    ) {
      throw new TypeError("Calibration accepted timestamp is invalid");
    }
    if (calibration.secondCheck !== null) {
      throw new TypeError("Second calibration checks are not implemented in this milestone");
    }
    if (!Number.isFinite(calibration.scaleMmPerPixel) || calibration.scaleMmPerPixel <= 0) {
      throw new RangeError("Calibration scale must be positive");
    }
    normalizeChoice(
      calibration.modelScaleMode,
      ["reference-only", "reference-and-floor-walls"],
      "Calibration model scale mode",
    );
    if (!Number.isFinite(calibration.modelScaleFactor) || calibration.modelScaleFactor <= 0) {
      throw new RangeError("Calibration model scale factor must be positive");
    }
    if (calibration.modelScaleMode === "reference-only" && calibration.modelScaleFactor !== 1) {
      throw new TypeError("Reference-only calibration cannot scale floor geometry");
    }
    if (scaleMmPerPixel.state === "unknown" || Math.abs(
      scaleMmPerPixel.valueMm - calibration.scaleMmPerPixel
    ) > 1e-9) {
      throw new TypeError("Reference transform and calibration scale must agree");
    }
  }
  const cropSourceRectPx = reference.cropSourceRectPx === undefined || reference.cropSourceRectPx === null
    ? null
    : normalizeReferenceCrop(reference.cropSourceRectPx, asset);
  if (cropSourceRectPx && asset && asset.source?.kind !== "pdf-page") {
    throw new TypeError("Only rendered PDF page references support cropping");
  }
  return {
    ...structuredClone(reference),
    opacity,
    transform: { translationMm, rotationRad, scaleMmPerPixel },
    cropSourceRectPx,
  };
}

function normalizeReferenceCrop(crop, asset) {
  const normalized = {
    x: requireFinite(crop?.x, "Reference crop x"),
    y: requireFinite(crop?.y, "Reference crop y"),
    width: requireFinite(crop?.width, "Reference crop width"),
    height: requireFinite(crop?.height, "Reference crop height"),
  };
  if (normalized.x < 0 || normalized.y < 0) {
    throw new RangeError("Reference crop origin must be inside the rendered page");
  }
  if (normalized.width <= 0 || normalized.height <= 0) {
    throw new RangeError("Reference crop must have positive width and height");
  }
  if (asset && (
    normalized.x + normalized.width > asset.widthPx ||
    normalized.y + normalized.height > asset.heightPx
  )) {
    throw new RangeError("Reference crop must remain inside the rendered page");
  }
  return normalized;
}

function normalizeSourcePoint(point, label) {
  return {
    x: requireFinite(point?.x, `${label} x`),
    y: requireFinite(point?.y, `${label} y`),
  };
}

export function sourcePointToWorld(transform, point, scaleMmPerPixel) {
  const rotated = rotatePlanPoint(point, transform.rotationRad, scaleMmPerPixel);
  return {
    x: transform.translationMm.x + rotated.x,
    y: transform.translationMm.y + rotated.y,
  };
}

export function worldPointToSource(transform, point, scaleMmPerPixel) {
  const scale = requireFinite(scaleMmPerPixel, "Reference scale");
  if (scale <= 0) throw new RangeError("Reference scale must be positive");
  const translated = {
    x: requireFinite(point?.x, "World point x") - transform.translationMm.x,
    y: requireFinite(point?.y, "World point y") - transform.translationMm.y,
  };
  const cosine = Math.cos(transform.rotationRad);
  const sine = Math.sin(transform.rotationRad);
  return {
    x: (translated.x * cosine + translated.y * sine) / scale,
    y: (-translated.x * sine + translated.y * cosine) / scale,
  };
}

function rotatePlanPoint(point, rotationRad, scale) {
  const cosine = Math.cos(rotationRad);
  const sine = Math.sin(rotationRad);
  return {
    x: (point.x * cosine - point.y * sine) * scale,
    y: (point.x * sine + point.y * cosine) * scale,
  };
}

function createRoomFromBoundary(project, command) {
  requireOpaqueId(command.roomId, "Room ID");
  requireOpaqueId(command.floorId, "Room floor ID");
  requireUniqueId(project.rooms, command.roomId, "Room");
  requireEntity(project.floors, command.floorId, "Floor");
  const candidate = requireRoomCandidate(project, command.floorId, command.boundaryKey);
  requireUnassignedRoomCandidate(project, candidate.key, null);
  project.rooms.push(normalizeRoom({
    id: command.roomId,
    floorId: command.floorId,
    name: command.name,
    use: command.use ?? "unspecified",
    geometrySource: "wall-face",
    boundary: candidate.boundary,
    holes: [],
    areaConvention: "wall-reference-lines",
    heightMm: command.heightMm ?? unknownMm("room height not set"),
    volumeEvidence: {
      state: "unknown",
      valueM3: null,
      reason: "room volume not calculated",
    },
    ventilationRole: command.ventilationRole ?? "unassigned",
    terminalAssociations: [],
    airflowTargets: command.airflowTargets ?? unresolvedSpaceAirflowTargets(),
  }));
}

function assignRoomBoundary(project, command) {
  const room = requireEntity(project.rooms, command.roomId, "Room");
  const candidate = requireRoomCandidate(project, room.floorId, command.boundaryKey);
  requireUnassignedRoomCandidate(project, candidate.key, room.id);
  room.boundary = structuredClone(candidate.boundary);
}

function createZoneFromBoundary(project, command) {
  requireOpaqueId(command.zoneId, "Zone ID");
  requireOpaqueId(command.parentRoomId, "Zone parent room ID");
  requireUniqueId(project.zones, command.zoneId, "Zone");
  const room = requireEntity(project.rooms, command.parentRoomId, "Zone parent room");
  if (room.terminalAssociations.length > 0) {
    throw new TypeError("Unassign parent-room terminals before creating ventilation zones");
  }
  const candidate = requireZoneCandidate(project, room.id, command.boundaryKey);
  requireUnassignedZoneCandidate(project, room.id, candidate.key, null);
  project.zones.push(normalizeZone({
    id: command.zoneId,
    parentRoomId: room.id,
    floorId: room.floorId,
    name: command.name,
    use: command.use ?? "unspecified",
    geometrySource: "room-divider-face",
    boundary: candidate.boundary,
    areaConvention: "wall-reference-lines",
    ventilationRole: command.ventilationRole ?? "unassigned",
    terminalAssociations: [],
    airflowTargets: command.airflowTargets ?? unresolvedSpaceAirflowTargets(),
  }));
}

function assignZoneBoundary(project, command) {
  const zone = requireEntity(project.zones, command.zoneId, "Zone");
  const candidate = requireZoneCandidate(project, zone.parentRoomId, command.boundaryKey);
  requireUnassignedZoneCandidate(project, zone.parentRoomId, candidate.key, zone.id);
  zone.boundary = structuredClone(candidate.boundary);
}

function requireZoneCandidate(project, parentRoomId, boundaryKey) {
  if (typeof boundaryKey !== "string" || boundaryKey.length === 0) {
    throw new TypeError("Zone boundary candidate key is required");
  }
  const candidate = deriveZoneBoundaries(project, parentRoomId).candidates.find(
    (item) => item.key === boundaryKey,
  );
  if (!candidate) throw new TypeError(`Eligible zone boundary not found: ${boundaryKey}`);
  return candidate;
}

function requireUnassignedZoneCandidate(project, parentRoomId, boundaryKey, ignoredZoneId) {
  const assigned = project.zones.find(
    (zone) =>
      zone.id !== ignoredZoneId &&
      zone.parentRoomId === parentRoomId &&
      roomBoundaryKey(zone.boundary) === boundaryKey,
  );
  if (assigned) throw new TypeError(`Zone boundary is already assigned: ${assigned.id}`);
}

function assignTerminalToRoom(project, command) {
  const room = requireEntity(project.rooms, command.roomId, "Room");
  if (project.zones.some((zone) => zone.parentRoomId === room.id)) {
    throw new TypeError("Assign the terminal to a child zone instead of its partitioned parent room");
  }
  const component = requireEntity(project.components, command.componentId, "Component");
  const port = requireRoomTerminalPort(component, command.portId);
  validateTerminalRoomCompatibility(room, component, port);
  removeTerminalAssignments(project, component.id, port.id);
  room.terminalAssociations.push({
    componentId: component.id,
    portId: port.id,
    assignmentMethod: "manual",
  });
}

function assignTerminalToZone(project, command) {
  const zone = requireEntity(project.zones, command.zoneId, "Zone");
  const component = requireEntity(project.components, command.componentId, "Component");
  const port = requireRoomTerminalPort(component, command.portId);
  validateTerminalRoomCompatibility(zone, component, port);
  removeTerminalAssignments(project, component.id, port.id);
  zone.terminalAssociations.push({
    componentId: component.id,
    portId: port.id,
    assignmentMethod: "manual",
  });
}

// A partitioned room contributes only its child zones; boundary and overlapping hits stay ambiguous.
export function terminalPlacementSpace(project, floorId, point) {
  const candidates = [];
  for (const room of project.rooms.filter(room => room.floorId === floorId)) {
    const zones = project.zones.filter(zone => zone.parentRoomId === room.id);
    for (const space of zones.length ? zones : [room]) {
      const inspection = zones.length ? inspectZoneBoundary(project, space) : inspectRoomBoundary(project, space);
      if (inspection.status === "current" && pointStrictlyInsidePolygon(point, inspection.polygon)) {
        candidates.push({ kind: zones.length ? "zone" : "room", space });
      }
    }
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function assignTerminalToContainingSpace(project, component) {
  const port = assignableRoomTerminalPort(component);
  if (!port) return;
  removeTerminalAssignments(project, component.id, port.id);

  const point = { x: component.positionMm.x, y: component.positionMm.y };
  const candidates = [];
  for (const room of project.rooms.filter((candidate) => candidate.floorId === component.floorId)) {
    const childZones = project.zones.filter((zone) => zone.parentRoomId === room.id);
    if (childZones.length > 0) {
      for (const zone of childZones) {
        const inspection = inspectZoneBoundary(project, zone);
        if (
          inspection.status === "current" &&
          pointStrictlyInsidePolygon(point, inspection.polygon) &&
          terminalSpaceIsCompatible(zone, port)
        ) {
          candidates.push({ kind: "zone", space: zone });
        }
      }
      continue;
    }
    const inspection = inspectRoomBoundary(project, room);
    if (
      inspection.status === "current" &&
      pointStrictlyInsidePolygon(point, inspection.polygon) &&
      terminalSpaceIsCompatible(room, port)
    ) {
      candidates.push({ kind: "room", space: room });
    }
  }

  if (candidates.length !== 1) return;
  candidates[0].space.terminalAssociations.push({
    componentId: component.id,
    portId: port.id,
    assignmentMethod: "spatial",
  });
}

function terminalSpaceIsCompatible(space, port) {
  if (space.ventilationRole === "none" || space.ventilationRole === "transfer") return false;
  return space.ventilationRole === "unassigned" || space.ventilationRole === port.stream;
}

function terminalHasSpaceAssignment(project, componentId) {
  return [...project.rooms, ...project.zones].some((space) => (
    space.terminalAssociations.some((association) => association.componentId === componentId)
  ));
}

function pointStrictlyInsidePolygon(point, polygon) {
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointOnSegment(point, polygon[index], polygon[(index + 1) % polygon.length])) return false;
  }
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const left = polygon[current];
    const right = polygon[previous];
    const crosses = (left.y > point.y) !== (right.y > point.y) &&
      point.x < ((right.x - left.x) * (point.y - left.y)) / (right.y - left.y) + left.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function unassignTerminalFromRoom(project, command) {
  const component = requireEntity(project.components, command.componentId, "Component");
  const port = requireRoomTerminalPort(component, command.portId);
  const assignedRoom = [...project.rooms, ...project.zones].find((room) => room.terminalAssociations.some(
    (association) => association.componentId === component.id && association.portId === port.id,
  ));
  if (!assignedRoom) throw new TypeError(`Terminal is not assigned to a room or zone: ${component.id}`);
  removeTerminalAssignments(project, component.id, port.id);
}

function removeTerminalAssignments(project, componentId, portId) {
  for (const space of [...project.rooms, ...project.zones]) {
    space.terminalAssociations = space.terminalAssociations.filter(
      (association) => !(association.componentId === componentId && association.portId === portId),
    );
  }
}

function requireRoomCandidate(project, floorId, boundaryKey) {
  if (typeof boundaryKey !== "string" || boundaryKey.length === 0) {
    throw new TypeError("Room boundary candidate key is required");
  }
  const candidate = deriveRoomBoundaries(project, floorId).candidates.find(
    (item) => item.key === boundaryKey,
  );
  if (!candidate) throw new TypeError(`Eligible room boundary not found: ${boundaryKey}`);
  return candidate;
}

function requireUnassignedRoomCandidate(project, boundaryKey, ignoredRoomId) {
  const assigned = project.rooms.find(
    (room) => room.id !== ignoredRoomId && roomBoundaryKey(room.boundary) === boundaryKey,
  );
  if (assigned) throw new TypeError(`Room boundary is already assigned: ${assigned.id}`);
}

function addWallChain(project, command) {
  requireOpaqueId(command.floorId, "Wall-chain floor ID");
  requireEntity(project.floors, command.floorId, "Floor");
  const classification = normalizeChoice(
    command.classification ?? "physical",
    ["physical", "virtual"],
    "Wall classification",
  );
  let dividerParent = null;
  if (classification === "virtual") {
    requireOpaqueId(command.parentRoomId, "Room-divider parent room ID");
    dividerParent = requireEntity(project.rooms, command.parentRoomId, "Room-divider parent room");
    if (dividerParent.floorId !== command.floorId) {
      throw new TypeError("Room divider and parent room must belong to the same floor");
    }
  } else if (command.parentRoomId !== undefined || command.boundaryRole !== undefined) {
    throw new TypeError("Physical walls cannot claim room-divider semantics");
  }
  const splits = command.splits ?? [];
  if (!Array.isArray(splits)) throw new TypeError("Wall-chain splits must be an array");
  assertUniqueValues(splits.map((split) => split.wallId), "Wall-chain split source wall ID");
  assertUniqueValues(splits.map((split) => split.nodeId), "Wall-chain split node ID");
  assertUniqueValues(splits.map((split) => split.newWallId), "Wall-chain split wall ID");
  for (const split of splits) {
    if (!command.nodeIds?.includes(split.nodeId)) {
      throw new TypeError(`Wall-chain split node must be used by the chain: ${String(split.nodeId)}`);
    }
    const sourceWall = requireEntity(project.walls, split.wallId, "Wall-chain split source wall");
    if (sourceWall.floorId !== command.floorId) {
      throw new TypeError("Wall-chain split source and chain must belong to the same floor");
    }
    splitWall(project, {
      wallId: split.wallId,
      newNodeId: split.nodeId,
      newWallId: split.newWallId,
      point: split.point,
    });
  }
  if (!Array.isArray(command.nodeIds) || !Array.isArray(command.wallIds)) {
    throw new TypeError("Wall chain requires nodeIds and wallIds arrays");
  }
  if (!Array.isArray(command.points) || command.points.length < 2) {
    throw new TypeError("Wall chain requires at least two points");
  }
  if (command.nodeIds.length !== command.points.length) {
    throw new TypeError("Wall-chain node IDs must match point count");
  }
  if (command.wallIds.length !== command.points.length - 1) {
    throw new TypeError("Wall-chain wall IDs must match segment count");
  }
  assertUniqueValues(command.wallIds, "Wall-chain wall ID");
  const points = command.points.map(normalizePosition);
  const thicknessMm = requireFinite(command.thicknessMm, "Wall thickness");
  if (thicknessMm <= 0) {
    throw new RangeError("Wall thickness must be positive");
  }
  const heightMm = normalizeMeasurement(command.heightMm);
  const referenceLine = normalizeChoice(
    command.referenceLine,
    ["centreline", "inside", "outside"],
    "Wall reference line",
  );
  if (dividerParent) {
    const parentGeometry = roomPolygonFromBoundary(project, dividerParent);
    for (const point of points) {
      if (!pointInOrOnPolygon(point, parentGeometry.polygon)) {
        throw new RangeError("Room-divider points must remain inside or on the parent room boundary");
      }
    }
  }

  command.nodeIds.forEach((id) => requireOpaqueId(id, "Wall-chain node ID"));
  command.wallIds.forEach((id) => requireUniqueId(project.walls, id, "Wall"));

  for (let index = 1; index < points.length; index += 1) {
    if (command.nodeIds[index] === command.nodeIds[index - 1]) {
      throw new RangeError("Consecutive wall-chain points must use different nodes");
    }
    if (Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y) < EPSILON) {
      throw new RangeError("Wall segments must have non-zero plan length");
    }
  }

  const newNodes = new Map();
  command.nodeIds.forEach((id, index) => {
    const point = points[index];
    const existing = project.wallNodes.find((node) => node.id === id);
    if (existing) {
      if (existing.floorId !== command.floorId || !planPositionsWithinOperationTolerance(existing.positionMm, point)) {
        throw new TypeError(`Reused wall node must retain its floor and plan position: ${id}`);
      }
      return;
    }
    const repeated = newNodes.get(id);
    if (repeated) {
      if (!positionsEqual(repeated.positionMm, point)) {
        throw new TypeError(`Repeated wall-chain node must retain its position: ${id}`);
      }
      return;
    }
    const coincidentExisting = project.wallNodes.find(
      (node) => node.floorId === command.floorId && planPositionsEqual(node.positionMm, point),
    );
    if (coincidentExisting) {
      throw new TypeError(
        `Wall-chain endpoint must reuse coincident node identity: ${coincidentExisting.id}`,
      );
    }
    const coincidentNew = [...newNodes.values()].find((node) =>
      planPositionsEqual(node.positionMm, point),
    );
    if (coincidentNew) {
      throw new TypeError(
        `Coincident wall-chain points must share one identity: ${coincidentNew.id}`,
      );
    }
    newNodes.set(id, { id, floorId: command.floorId, positionMm: point });
  });

  const proposedPairKeys = new Set(
    project.walls.map((wall) => wallEndpointPairKey(wall.startNodeId, wall.endNodeId)),
  );
  command.wallIds.forEach((id, index) => {
    const pairKey = wallEndpointPairKey(command.nodeIds[index], command.nodeIds[index + 1]);
    if (proposedPairKeys.has(pairKey)) {
      throw new TypeError(`Wall-chain segment duplicates an existing topological edge: ${id}`);
    }
    proposedPairKeys.add(pairKey);
  });

  project.wallNodes.push(...newNodes.values());
  project.walls.push(
    ...command.wallIds.map((id, index) => ({
      id,
      floorId: command.floorId,
      startNodeId: command.nodeIds[index],
      endNodeId: command.nodeIds[index + 1],
      thicknessMm,
      heightMm,
      referenceLine,
      classification,
      ...(classification === "virtual"
        ? { boundaryRole: "room-divider", parentRoomId: dividerParent.id }
        : {}),
    })),
  );
}

function splitWall(project, command) {
  requireOpaqueId(command.wallId, "Split source wall ID");
  requireOpaqueId(command.newNodeId, "Split node ID");
  requireOpaqueId(command.newWallId, "Split wall ID");
  const wall = requireEntity(project.walls, command.wallId, "Split source wall");
  const dependencies = findExplicitWallDependencies(project, new Set([wall.id]), {
    ignoredCollections: new Set(["rooms", "zones"]),
  });
  if (dependencies.length > 0) {
    throw new TypeError(`Wall split is blocked by dependent references: ${dependencies.join(", ")}`);
  }
  requireUniqueId(project.wallNodes, command.newNodeId, "Split node");
  requireUniqueId(project.walls, command.newWallId, "Split wall");
  const point = {
    x: requireFinite(command.point?.x, "Split point x"),
    y: requireFinite(command.point?.y, "Split point y"),
  };
  const start = requireEntity(project.wallNodes, wall.startNodeId, "Split wall start node");
  const end = requireEntity(project.wallNodes, wall.endNodeId, "Split wall end node");
  const dx = end.positionMm.x - start.positionMm.x;
  const dy = end.positionMm.y - start.positionMm.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < EPSILON) throw new RangeError("Cannot split a zero-length wall");
  const fraction = (
    (point.x - start.positionMm.x) * dx + (point.y - start.positionMm.y) * dy
  ) / lengthSquared;
  const projected = {
    x: start.positionMm.x + dx * fraction,
    y: start.positionMm.y + dy * fraction,
  };
  if (
    fraction <= EPSILON ||
    fraction >= 1 - EPSILON ||
    Math.hypot(point.x - projected.x, point.y - projected.y) > PLAN_OPERATION_EPSILON_MM
  ) {
    throw new RangeError("Wall split point must lie strictly inside the source wall");
  }
  const coincident = project.wallNodes.find(
    (node) =>
      node.floorId === wall.floorId &&
      node.positionMm.x === projected.x &&
      node.positionMm.y === projected.y,
  );
  if (coincident) {
    throw new TypeError(`Wall split must reuse existing junction identity: ${coincident.id}`);
  }

  const originalEndNodeId = wall.endNodeId;
  const originalWall = structuredClone(wall);
  project.wallNodes.push({
    id: command.newNodeId,
    floorId: wall.floorId,
    positionMm: {
      x: projected.x,
      y: projected.y,
      z: interpolateWallElevation(start.positionMm.z, end.positionMm.z, fraction),
    },
  });
  wall.endNodeId = command.newNodeId;
  project.walls.push({
    ...originalWall,
    id: command.newWallId,
    startNodeId: command.newNodeId,
    endNodeId: originalEndNodeId,
  });
  updateRoomBoundariesForWallSplit(project, originalWall, command.newWallId);
  updateZoneBoundariesForWallSplit(project, originalWall, command.newWallId);
}

function updateRoomBoundariesForWallSplit(project, originalWall, newWallId) {
  for (const room of project.rooms) {
    const index = room.boundary.findIndex((entry) => entry.wallId === originalWall.id);
    if (index < 0) continue;
    const entry = room.boundary[index];
    const replacement = entry.direction === "forward"
      ? [
          { wallId: originalWall.id, direction: "forward" },
          { wallId: newWallId, direction: "forward" },
        ]
      : [
          { wallId: newWallId, direction: "reverse" },
          { wallId: originalWall.id, direction: "reverse" },
        ];
    room.boundary.splice(index, 1, ...replacement);
  }
}

function updateZoneBoundariesForWallSplit(project, originalWall, newWallId) {
  for (const zone of project.zones) {
    const index = zone.boundary.findIndex((entry) => entry.wallId === originalWall.id);
    if (index < 0) continue;
    const entry = zone.boundary[index];
    const replacement = entry.direction === "forward"
      ? [
          { wallId: originalWall.id, direction: "forward" },
          { wallId: newWallId, direction: "forward" },
        ]
      : [
          { wallId: newWallId, direction: "reverse" },
          { wallId: originalWall.id, direction: "reverse" },
        ];
    zone.boundary.splice(index, 1, ...replacement);
  }
}

function interpolateWallElevation(start, end, fraction) {
  const normalizedStart = normalizeMeasurement(start);
  const normalizedEnd = normalizeMeasurement(end);
  if (normalizedStart.state === "unknown" || normalizedEnd.state === "unknown") {
    return unknownMm("wall split elevation depends on an unknown endpoint elevation");
  }
  const valueMm = normalizedStart.valueMm + (normalizedEnd.valueMm - normalizedStart.valueMm) * fraction;
  if (normalizedStart.state === "assumed" || normalizedEnd.state === "assumed") {
    return assumedMm(valueMm, "interpolated from wall endpoint evidence during split");
  }
  return knownMm(valueMm, "interpolated from wall endpoints during split");
}

export function wallConnectedComponentIds(project, seedWallId) {
  validateProject(project);
  requireEntity(project.walls, seedWallId, "Connected wall seed");
  const selected = new Set([seedWallId]);
  const nodes = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const wall of project.walls) {
      if (selected.has(wall.id)) {
        nodes.add(wall.startNodeId);
        nodes.add(wall.endNodeId);
      }
    }
    for (const wall of project.walls) {
      if (!selected.has(wall.id) && (nodes.has(wall.startNodeId) || nodes.has(wall.endNodeId))) {
        selected.add(wall.id);
        changed = true;
      }
    }
  }
  return [...selected];
}

function deleteWalls(project, wallIds) {
  if (!(wallIds instanceof Set) || wallIds.size === 0) {
    throw new TypeError("Wall deletion requires at least one wall identity");
  }
  const deletedWalls = project.walls.filter((wall) => wallIds.has(wall.id));
  if (deletedWalls.length !== wallIds.size) throw new TypeError("Wall deletion scope is invalid");
  const dependencies = findExplicitWallDependencies(project, wallIds);
  if (dependencies.length > 0) {
    throw new TypeError(`Wall deletion is blocked by dependent references: ${dependencies.join(", ")}`);
  }
  const candidateNodeIds = new Set(
    deletedWalls.flatMap((wall) => [wall.startNodeId, wall.endNodeId]),
  );
  project.walls = project.walls.filter((wall) => !wallIds.has(wall.id));
  const retainedNodeIds = new Set(
    project.walls.flatMap((wall) => [wall.startNodeId, wall.endNodeId]),
  );
  project.wallNodes = project.wallNodes.filter(
    (node) => !candidateNodeIds.has(node.id) || retainedNodeIds.has(node.id),
  );
}

function findExplicitWallDependencies(project, wallIds, options = {}) {
  const dependencies = [];
  const inspect = (value, path) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      const wallReferenceField = /wall/i.test(key) && (key.endsWith("Id") || key.endsWith("Ids"));
      if (wallReferenceField && typeof child === "string" && wallIds.has(child)) {
        dependencies.push(childPath);
        continue;
      }
      if (wallReferenceField && Array.isArray(child)) {
        child.forEach((item, index) => {
          if (typeof item === "string" && wallIds.has(item)) dependencies.push(`${childPath}[${index}]`);
        });
      }
      inspect(child, childPath);
    }
  };
  for (const [collectionName, collection] of Object.entries(project)) {
    if (collectionName === "walls" || collectionName === "wallNodes") continue;
    if (options.ignoredCollections?.has(collectionName)) continue;
    inspect(collection, collectionName);
  }
  return dependencies;
}

function normalizeWallNode(node) {
  requireOpaqueId(node?.id, "Wall node ID");
  requireOpaqueId(node?.floorId, "Wall-node floor ID");
  return {
    ...structuredClone(node),
    positionMm: normalizePosition(node.positionMm),
  };
}

function normalizeFloorAreaOutline(outline) {
  requireOpaqueId(outline?.id, "Floor area outline ID");
  requireOpaqueId(outline?.floorId, "Floor area outline floor ID");
  if (!Array.isArray(outline.vertices)) {
    throw new TypeError("Floor area outline vertices must be an array");
  }
  assertUniqueIds(outline.vertices, "floor area vertices");
  if (!Array.isArray(outline.holes) || outline.holes.length !== 0) {
    throw new TypeError("Floor area outline holes and exclusions are not implemented");
  }
  const normalized = {
    ...structuredClone(outline),
    name: normalizeFloorAreaName(outline.name),
    geometrySource: normalizeChoice(
      outline.geometrySource,
      ["manual-floor-area-outline"],
      "Floor area geometry source",
    ),
    purpose: normalizeChoice(
      outline.purpose,
      ["preliminary-quoting"],
      "Floor area purpose",
    ),
    areaConvention: normalizeChoice(
      outline.areaConvention,
      ["closed-plan-outline"],
      "Floor area convention",
    ),
    measurementBasis: normalizeChoice(
      outline.measurementBasis,
      ["floor-local-plan-mm"],
      "Floor area measurement basis",
    ),
    vertices: outline.vertices.map((vertex) => ({
      id: requireOpaqueId(vertex?.id, "Floor area vertex ID"),
      positionMm: normalizePosition(vertex?.positionMm),
    })),
    holes: [],
  };
  inspectFloorAreaOutline(normalized);
  return normalized;
}

function validateWall(project, wall) {
  requireOpaqueId(wall?.id, "Wall ID");
  requireOpaqueId(wall?.floorId, "Wall floor ID");
  requireOpaqueId(wall?.startNodeId, "Wall start-node ID");
  requireOpaqueId(wall?.endNodeId, "Wall end-node ID");
  if (wall.startNodeId === wall.endNodeId) {
    throw new TypeError("Wall endpoints must be different nodes");
  }
  requireEntity(project.floors, wall.floorId, "Floor");
  const start = requireEntity(project.wallNodes, wall.startNodeId, "Wall start node");
  const end = requireEntity(project.wallNodes, wall.endNodeId, "Wall end node");
  if (start.floorId !== wall.floorId || end.floorId !== wall.floorId) {
    throw new TypeError("Wall and endpoint nodes must belong to the same floor");
  }
  if (Math.hypot(end.positionMm.x - start.positionMm.x, end.positionMm.y - start.positionMm.y) < EPSILON) {
    throw new RangeError("Wall segments must have non-zero plan length");
  }
  if (!Number.isFinite(wall.thicknessMm) || wall.thicknessMm <= 0) {
    throw new RangeError("Wall thickness must be positive and finite");
  }
  normalizeMeasurement(wall.heightMm);
  normalizeChoice(wall.referenceLine, ["centreline", "inside", "outside"], "Wall reference line");
  const classification = normalizeChoice(
    wall.classification,
    ["physical", "virtual"],
    "Wall classification",
  );
  if (classification === "physical") {
    if (wall.boundaryRole !== undefined || wall.parentRoomId !== undefined) {
      throw new TypeError("Physical walls cannot claim room-divider semantics");
    }
    return;
  }
  const boundaryRole = normalizeChoice(
    wall.boundaryRole,
    ["room-divider", "legacy-virtual"],
    "Virtual boundary role",
  );
  if (boundaryRole === "legacy-virtual") {
    if (wall.parentRoomId !== null) {
      throw new TypeError("Legacy virtual walls cannot claim a parent room");
    }
    return;
  }
  requireOpaqueId(wall.parentRoomId, "Room-divider parent room ID");
  const parent = requireEntity(project.rooms, wall.parentRoomId, "Room-divider parent room");
  if (parent.floorId !== wall.floorId) {
    throw new TypeError("Room divider and parent room must belong to the same floor");
  }
  const parentGeometry = roomPolygonFromBoundary(project, parent);
  const midpoint = {
    x: (start.positionMm.x + end.positionMm.x) / 2,
    y: (start.positionMm.y + end.positionMm.y) / 2,
  };
  for (const point of [start.positionMm, midpoint, end.positionMm]) {
    if (!pointInOrOnPolygon(point, parentGeometry.polygon)) {
      throw new RangeError(`Room divider must remain inside its parent room: ${wall.id}`);
    }
  }
}

function normalizeRoom(room) {
  requireOpaqueId(room?.id, "Room ID");
  requireOpaqueId(room?.floorId, "Room floor ID");
  if (!Array.isArray(room.boundary)) {
    throw new TypeError("Room boundary must be an array");
  }
  roomBoundaryKey(room.boundary);
  if (!Array.isArray(room.holes) || room.holes.length !== 0) {
    throw new TypeError("Schema 8 room holes must remain empty until hole support is implemented");
  }
  if (!Array.isArray(room.terminalAssociations)) {
    throw new TypeError("Room terminal associations must be an array");
  }
  if (
    room.volumeEvidence?.state !== "unknown" ||
    room.volumeEvidence?.valueM3 !== null ||
    typeof room.volumeEvidence?.reason !== "string" ||
    room.volumeEvidence.reason.trim().length === 0
  ) {
    throw new TypeError("Schema 8 room volume evidence must remain explicitly unknown");
  }
  return {
    ...structuredClone(room),
    name: normalizeRoomName(room.name),
    use: normalizeChoice(room.use, ROOM_USE_TYPES, "Room use"),
    geometrySource: normalizeChoice(room.geometrySource, ["wall-face"], "Room geometry source"),
    boundary: room.boundary.map((entry) => ({
      wallId: requireOpaqueId(entry?.wallId, "Room boundary wall ID"),
      direction: normalizeChoice(
        entry?.direction,
        ["forward", "reverse"],
        "Room boundary direction",
      ),
    })),
    holes: [],
    areaConvention: normalizeChoice(
      room.areaConvention,
      ["wall-reference-lines"],
      "Room area convention",
    ),
    heightMm: normalizeMeasurement(room.heightMm),
    volumeEvidence: structuredClone(room.volumeEvidence),
    ventilationRole: normalizeChoice(
      room.ventilationRole,
      ROOM_VENTILATION_ROLES,
      "Room ventilation role",
    ),
    airflowTargets: normalizeSpaceAirflowTargets(room.airflowTargets, room.ventilationRole),
    terminalAssociations: room.terminalAssociations.map(normalizeTerminalAssociation),
  };
}

function validateRoom(project, room) {
  const normalized = normalizeRoom(room);
  requireEntity(project.floors, normalized.floorId, "Room floor");
  const oriented = normalized.boundary.map((entry) => {
    const wall = requireEntity(project.walls, entry.wallId, "Room boundary wall");
    if (wall.floorId !== normalized.floorId) {
      throw new TypeError(`Room boundary wall belongs to another floor: ${wall.id}`);
    }
    if (wall.classification !== "physical") {
      throw new TypeError(`Room boundary must use physical walls: ${wall.id}`);
    }
    return entry.direction === "forward"
      ? { wallId: wall.id, fromNodeId: wall.startNodeId, toNodeId: wall.endNodeId }
      : { wallId: wall.id, fromNodeId: wall.endNodeId, toNodeId: wall.startNodeId };
  });
  for (let index = 0; index < oriented.length; index += 1) {
    const current = oriented[index];
    const next = oriented[(index + 1) % oriented.length];
    if (current.toNodeId !== next.fromNodeId) {
      throw new TypeError(`Room boundary is discontinuous between ${current.wallId} and ${next.wallId}`);
    }
  }
  const localEndpoints = new Set();
  for (const association of normalized.terminalAssociations) {
    const key = endpointKey(association);
    if (localEndpoints.has(key)) throw new TypeError(`Room repeats terminal association: ${key}`);
    localEndpoints.add(key);
    const component = requireEntity(project.components, association.componentId, "Room terminal component");
    const port = requireRoomTerminalPort(component, association.portId);
    validateTerminalRoomCompatibility(normalized, component, port);
  }
}

function normalizeZone(zone) {
  requireOpaqueId(zone?.id, "Zone ID");
  requireOpaqueId(zone?.parentRoomId, "Zone parent room ID");
  requireOpaqueId(zone?.floorId, "Zone floor ID");
  if (!Array.isArray(zone.boundary)) throw new TypeError("Zone boundary must be an array");
  roomBoundaryKey(zone.boundary);
  if (!Array.isArray(zone.terminalAssociations)) {
    throw new TypeError("Zone terminal associations must be an array");
  }
  return {
    ...structuredClone(zone),
    name: normalizeRoomName(zone.name),
    use: normalizeChoice(zone.use, ROOM_USE_TYPES, "Zone use"),
    geometrySource: normalizeChoice(
      zone.geometrySource,
      ["room-divider-face"],
      "Zone geometry source",
    ),
    boundary: zone.boundary.map((entry) => ({
      wallId: requireOpaqueId(entry?.wallId, "Zone boundary edge ID"),
      direction: normalizeChoice(entry?.direction, ["forward", "reverse"], "Zone boundary direction"),
    })),
    areaConvention: normalizeChoice(
      zone.areaConvention,
      ["wall-reference-lines"],
      "Zone area convention",
    ),
    ventilationRole: normalizeChoice(
      zone.ventilationRole,
      ROOM_VENTILATION_ROLES,
      "Zone ventilation role",
    ),
    airflowTargets: normalizeSpaceAirflowTargets(zone.airflowTargets, zone.ventilationRole),
    terminalAssociations: zone.terminalAssociations.map(normalizeTerminalAssociation),
  };
}

function normalizeSpaceAirflowTargets(targets, ventilationRole) {
  if (!targets || typeof targets !== "object" || Array.isArray(targets)) {
    throw new TypeError("Space airflow targets are required");
  }
  if (!targets.normal || typeof targets.normal !== "object" || Array.isArray(targets.normal)) {
    throw new TypeError("Normal-mode airflow targets are required");
  }
  const normalized = {
    normal: {
      required: normalizeAirflowTarget(targets.normal.required, "Required normal airflow"),
      assigned: normalizeAirflowTarget(targets.normal.assigned, "Assigned normal airflow"),
    },
  };
  if (
    ventilationRole !== "supply" &&
    ventilationRole !== "extract" &&
    (normalized.normal.required.state === "known" || normalized.normal.assigned.state === "known")
  ) {
    throw new TypeError("Known airflow targets require a supply or extract ventilation role");
  }
  return normalized;
}

function normalizeAirflowTarget(target, label) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError(`${label} is required`);
  }
  const state = normalizeChoice(target.state, ["unresolved", "known"], `${label} state`);
  if (state === "unresolved") {
    if (
      target.valueLps !== null ||
      target.inputValue !== null ||
      target.inputUnit !== null ||
      target.basis !== null ||
      target.source !== null
    ) {
      throw new TypeError(`${label} unresolved state cannot contain a value, unit, basis or source`);
    }
    return {
      state,
      valueLps: null,
      inputValue: null,
      inputUnit: null,
      basis: null,
      source: null,
      reason: normalizeBoundedText(target.reason, `${label} unresolved reason`, 240),
    };
  }

  const inputValue = requireFinite(target.inputValue, `${label} input value`);
  if (inputValue <= 0) throw new RangeError(`${label} input value must be positive`);
  const inputUnit = normalizeChoice(target.inputUnit, ["l/s", "m3/h"], `${label} input unit`);
  const basis = normalizeBoundedText(target.basis, `${label} basis`, 500);
  const source = normalizeBoundedText(target.source, `${label} source`, 500);
  const valueLps = inputUnit === "l/s" ? inputValue : inputValue / 3.6;
  if (
    Object.hasOwn(target, "valueLps") &&
    (!Number.isFinite(target.valueLps) || Math.abs(target.valueLps - valueLps) > 1e-9)
  ) {
    throw new TypeError(`${label} canonical L/s value does not match its input value and unit`);
  }
  if (target.reason !== undefined && target.reason !== null) {
    throw new TypeError(`${label} known state cannot contain an unresolved reason`);
  }
  return {
    state,
    valueLps,
    inputValue,
    inputUnit,
    basis,
    source,
    reason: null,
  };
}

function validateZone(project, zone) {
  const normalized = normalizeZone(zone);
  const parent = requireEntity(project.rooms, normalized.parentRoomId, "Zone parent room");
  if (parent.floorId !== normalized.floorId) {
    throw new TypeError("Zone and parent room must belong to the same floor");
  }
  const parentWallIds = new Set(parent.boundary.map((entry) => entry.wallId));
  const oriented = normalized.boundary.map((entry) => {
    const wall = requireEntity(project.walls, entry.wallId, "Zone boundary edge");
    if (wall.floorId !== normalized.floorId) {
      throw new TypeError(`Zone boundary edge belongs to another floor: ${wall.id}`);
    }
    if (wall.classification === "physical" && !parentWallIds.has(wall.id)) {
      throw new TypeError(`Zone cannot use a physical wall outside its parent room: ${wall.id}`);
    }
    if (
      wall.classification === "virtual" &&
      (wall.boundaryRole !== "room-divider" || wall.parentRoomId !== parent.id)
    ) {
      throw new TypeError(`Zone divider belongs to another parent room: ${wall.id}`);
    }
    return entry.direction === "forward"
      ? { wallId: wall.id, fromNodeId: wall.startNodeId, toNodeId: wall.endNodeId }
      : { wallId: wall.id, fromNodeId: wall.endNodeId, toNodeId: wall.startNodeId };
  });
  for (let index = 0; index < oriented.length; index += 1) {
    const current = oriented[index];
    const next = oriented[(index + 1) % oriented.length];
    if (current.toNodeId !== next.fromNodeId) {
      throw new TypeError(`Zone boundary is discontinuous between ${current.wallId} and ${next.wallId}`);
    }
  }
  const localEndpoints = new Set();
  for (const association of normalized.terminalAssociations) {
    const key = endpointKey(association);
    if (localEndpoints.has(key)) throw new TypeError(`Zone repeats terminal association: ${key}`);
    localEndpoints.add(key);
    const component = requireEntity(project.components, association.componentId, "Zone terminal component");
    const port = requireRoomTerminalPort(component, association.portId);
    validateTerminalRoomCompatibility(normalized, component, port);
  }
}

function normalizeTerminalAssociation(association) {
  return {
    componentId: requireOpaqueId(association?.componentId, "Room terminal component ID"),
    portId: requireOpaqueId(association?.portId, "Room terminal port ID"),
    assignmentMethod: normalizeChoice(
      association?.assignmentMethod,
      ["manual", "spatial"],
      "Room terminal assignment method",
    ),
  };
}

function assignableRoomTerminalPort(component) {
  const candidates = component.ports.filter(
    (port) => port.system === "mvhr" && (port.stream === "supply" || port.stream === "extract"),
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function requireRoomTerminalPort(component, portId) {
  requireOpaqueId(portId, "Room terminal port ID");
  const port = assignableRoomTerminalPort(component);
  if (!port || port.id !== portId) {
    throw new TypeError(`Component is not an assignable single-room MVHR terminal: ${component.id}`);
  }
  return port;
}

function validateTerminalRoomCompatibility(room, component, port) {
  if (component.floorId !== room.floorId) {
    throw new TypeError("Room and terminal must belong to the same floor");
  }
  if (room.ventilationRole === "none" || room.ventilationRole === "transfer") {
    throw new TypeError(`Room ventilation role does not accept a terminal: ${room.ventilationRole}`);
  }
  if (
    (room.ventilationRole === "supply" || room.ventilationRole === "extract") &&
    room.ventilationRole !== port.stream
  ) {
    throw new TypeError(
      `Terminal stream ${port.stream} does not match room ventilation role ${room.ventilationRole}`,
    );
  }
}

function normalizeRoomName(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Room name is required");
  }
  const normalized = value.trim();
  if (normalized.length > 120) throw new RangeError("Room name cannot exceed 120 characters");
  return normalized;
}

function normalizeFloorAreaName(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Floor area outline name is required");
  }
  const normalized = value.trim();
  if (normalized.length > 120) {
    throw new RangeError("Floor area outline name cannot exceed 120 characters");
  }
  return normalized;
}

function pointInOrOnPolygon(point, polygon) {
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (pointOnSegment(point, start, end)) return true;
  }
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const left = polygon[current];
    const right = polygon[previous];
    const crosses = (left.y > point.y) !== (right.y > point.y) &&
      point.x < ((right.x - left.x) * (point.y - left.y)) / (right.y - left.y) + left.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointOnSegment(point, start, end) {
  const crossProduct =
    (point.x - start.x) * (end.y - start.y) -
    (point.y - start.y) * (end.x - start.x);
  if (Math.abs(crossProduct) > PLAN_OPERATION_EPSILON_MM) return false;
  const dotProduct =
    (point.x - start.x) * (end.x - start.x) +
    (point.y - start.y) * (end.y - start.y);
  if (dotProduct < -PLAN_OPERATION_EPSILON_MM) return false;
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dotProduct <= lengthSquared + PLAN_OPERATION_EPSILON_MM;
}

function normalizeFloor(floor) {
  requireOpaqueId(floor?.id, "Floor ID");
  if (!floor.name || typeof floor.name !== "string") {
    throw new TypeError("Floor name is required");
  }
  return {
    ...structuredClone(floor),
    transform: {
      translationMm: normalizePosition(floor.transform?.translationMm),
      orientation: normalizeQuaternion(floor.transform?.orientation),
    },
  };
}

function normalizeComponent(component) {
  requireOpaqueId(component?.id, "Component ID");
  requireOpaqueId(component?.floorId, "Component floor ID");
  if (!Array.isArray(component.ports)) {
    throw new TypeError("Component ports must be an array");
  }
  assertUniqueIds(component.ports, "ports");
  const ports = component.ports.map(normalizePort);
  const ductRunCount = normalizeDuctRunCount(component.ductRunCount ?? null);
  const normalized = {
    ...structuredClone(component),
    ductRunCount,
    positionMm: normalizePosition(component.positionMm),
    orientation: normalizeQuaternion(component.orientation),
    ports,
  };
  if (ductRunCount !== null && !assignableRoomTerminalPort(normalized)) {
    throw new TypeError("Duct run count is only valid for a single-port MVHR supply or extract terminal");
  }
  return normalized;
}

function isMvhrUnitComponent(component) {
  const roles = new Set(component.ports
    .filter((port) => port.system === "mvhr")
    .map((port) => port.role));
  if (roles.has("Dwelling supply") && roles.has("Dwelling extract")) return true;
  return typeof component.catalogueItemId === "string" && (
    component.catalogueItemId.includes("mvhr") ||
    component.catalogueItemId.includes("q350") ||
    component.catalogueItemId.includes("q450") ||
    component.catalogueItemId.includes("q600")
  );
}

function normalizeEquipmentAssembly(assembly) {
  requireOpaqueId(assembly?.id, "Equipment assembly ID");
  requireOpaqueId(assembly?.floorId, "Equipment assembly floor ID");
  requireOpaqueId(assembly?.templateId, "Equipment assembly template ID");
  if (typeof assembly.name !== "string" || !assembly.name.trim()) {
    throw new TypeError("Equipment assembly name is required");
  }
  if (assembly.system !== "mvhr") {
    throw new TypeError("Equipment assembly system must be mvhr");
  }
  const componentIds = normalizeOpaqueIdList(assembly.componentIds, "Equipment assembly component IDs", 2);
  const connectionIds = normalizeOpaqueIdList(assembly.connectionIds, "Equipment assembly connection IDs", 0);
  const serviceZone = assembly.serviceZoneMm;
  const normalizedServiceZone = {
    minX: requireFinite(serviceZone?.minX, "Equipment assembly service-zone min x"),
    minY: requireFinite(serviceZone?.minY, "Equipment assembly service-zone min y"),
    maxX: requireFinite(serviceZone?.maxX, "Equipment assembly service-zone max x"),
    maxY: requireFinite(serviceZone?.maxY, "Equipment assembly service-zone max y"),
    evidenceStatus: normalizeChoice(
      serviceZone?.evidenceStatus,
      ["generic-placeholder-not-manufacturer-verified"],
      "Equipment assembly service-zone evidence status",
    ),
    note: typeof serviceZone?.note === "string" && serviceZone.note.trim()
      ? serviceZone.note
      : (() => { throw new TypeError("Equipment assembly service-zone note is required"); })(),
  };
  if (normalizedServiceZone.maxX <= normalizedServiceZone.minX || normalizedServiceZone.maxY <= normalizedServiceZone.minY) {
    throw new RangeError("Equipment assembly service zone must have positive width and depth");
  }
  return {
    ...structuredClone(assembly),
    stream: normalizeChoice(assembly.stream, ["supply", "extract"], "Equipment assembly stream"),
    installationMode: normalizeChoice(
      assembly.installationMode,
      ["remote-via-rigid-epp"],
      "Equipment assembly installation mode",
    ),
    evidenceStatus: normalizeChoice(
      assembly.evidenceStatus,
      ["synthetic-not-manufacturer-verified"],
      "Equipment assembly evidence status",
    ),
    componentIds,
    connectionIds,
    serviceZoneMm: normalizedServiceZone,
  };
}

function normalizeOpaqueIdList(value, label, minimumLength) {
  if (!Array.isArray(value) || value.length < minimumLength) {
    throw new TypeError(`${label} must contain at least ${minimumLength} item${minimumLength === 1 ? "" : "s"}`);
  }
  const ids = value.map((id) => {
    requireOpaqueId(id, label);
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new TypeError(`${label} must be unique`);
  return ids;
}

function sameOpaqueIdSet(left, right) {
  return left.length === right.length && left.every((id) => right.includes(id));
}

function assertComponentIsNotAssemblyMember(project, componentId, operation) {
  const assembly = project.equipmentAssemblies.find((candidate) => candidate.componentIds.includes(componentId));
  if (assembly) {
    throw new TypeError(`Cannot ${operation} assembly member ${componentId} independently; use equipment assembly ${assembly.id}`);
  }
}

function assemblyPlanCentre(components) {
  return components.reduce((centre, component) => ({
    x: centre.x + component.positionMm.x / components.length,
    y: centre.y + component.positionMm.y / components.length,
  }), { x: 0, y: 0 });
}

function floorVentilationClearInspection(project, floorId) {
  const components = project.components.filter((component) => component.floorId === floorId);
  const componentIds = new Set(components.map((component) => component.id));
  const assemblies = project.equipmentAssemblies.filter((assembly) => assembly.floorId === floorId);
  const routes = project.routes.filter((route) => route.floorId === floorId);
  const connectionIds = [];
  const blockingConnectionIds = [];
  for (const connection of project.connections) {
    const fromOnFloor = componentIds.has(connection.from.componentId);
    const toOnFloor = componentIds.has(connection.to.componentId);
    if (fromOnFloor && toOnFloor) connectionIds.push(connection.id);
    else if (fromOnFloor !== toOnFloor) blockingConnectionIds.push(connection.id);
  }
  let associationCount = 0;
  for (const space of [...project.rooms, ...project.zones]) {
    associationCount += space.terminalAssociations.filter(
      (association) => componentIds.has(association.componentId),
    ).length;
  }
  const componentIdList = components.map((component) => component.id);
  const routeIds = routes.map((route) => route.id);
  return {
    floorId,
    isEmpty: componentIdList.length === 0 && routeIds.length === 0,
    componentIds: componentIdList,
    componentCount: componentIdList.length,
    terminalCount: components.filter((component) => assignableRoomTerminalPort(component)).length,
    ductRunSettingCount: components.filter((component) => component.ductRunCount !== null).length,
    assemblyIds: assemblies.map((assembly) => assembly.id),
    assemblyCount: assemblies.length,
    routeIds,
    routeCount: routeIds.length,
    connectionIds,
    connectionCount: connectionIds.length,
    associationCount,
    blockingConnectionIds,
  };
}

function componentDeletionInspection(project, componentId) {
  const selectedComponent = requireEntity(project.components, componentId, "Component to delete");
  const assembly = project.equipmentAssemblies.find(
    (candidate) => candidate.componentIds.includes(selectedComponent.id),
  ) ?? null;
  const componentIds = assembly ? [...assembly.componentIds] : [selectedComponent.id];
  const componentIdSet = new Set(componentIds);
  const routeIds = project.routes
    .filter((route) => (
      componentIdSet.has(route.startAttachment?.componentId) ||
      componentIdSet.has(route.endAttachment?.componentId)
    ))
    .map((route) => route.id);
  const connectionIds = project.connections
    .filter((connection) => (
      componentIdSet.has(connection.from.componentId) ||
      componentIdSet.has(connection.to.componentId)
    ))
    .map((connection) => connection.id);
  let associationCount = 0;
  for (const space of [...project.rooms, ...project.zones]) {
    associationCount += space.terminalAssociations.filter(
      (association) => componentIdSet.has(association.componentId),
    ).length;
  }
  return {
    selectedComponentId: selectedComponent.id,
    componentIds,
    componentCount: componentIds.length,
    assemblyId: assembly?.id ?? null,
    assemblyName: assembly?.name ?? null,
    routeIds,
    routeCount: routeIds.length,
    connectionIds,
    connectionCount: connectionIds.length,
    associationCount,
  };
}

function assertConfirmedComponentDeletionScope(confirmedScope, inspection) {
  if (!confirmedScope || typeof confirmedScope !== "object" || Array.isArray(confirmedScope)) {
    throw new TypeError("Component deletion requires an explicit confirmed scope");
  }
  const componentIds = normalizeConfirmedIdList(confirmedScope.componentIds, "Confirmed component IDs");
  const routeIds = normalizeConfirmedIdList(confirmedScope.routeIds, "Confirmed route IDs");
  const connectionIds = normalizeConfirmedIdList(confirmedScope.connectionIds, "Confirmed connection IDs");
  const assemblyId = confirmedScope.assemblyId ?? null;
  if (assemblyId !== null) requireOpaqueId(assemblyId, "Confirmed equipment assembly ID");
  if (
    !sameOpaqueIdSet(componentIds, inspection.componentIds) ||
    !sameOpaqueIdSet(routeIds, inspection.routeIds) ||
    !sameOpaqueIdSet(connectionIds, inspection.connectionIds) ||
    assemblyId !== inspection.assemblyId
  ) {
    throw new TypeError("Component deletion scope changed; review and confirm the current dependent objects");
  }
}

function normalizeConfirmedIdList(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  value.forEach((id) => requireOpaqueId(id, label));
  if (new Set(value).size !== value.length) throw new TypeError(`${label} must not contain duplicates`);
  return value;
}

function normalizeDuctRunCount(value) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1 || value > 12) {
    throw new RangeError("Terminal duct run count must be null or an integer from 1 to 12");
  }
  return value;
}

function normalizePort(port) {
  requireOpaqueId(port?.id, "Port ID");
  requireOpaqueId(port?.definitionId, "Port definition ID");
  for (const field of ["system", "stream", "role"]) {
    if (!port[field] || typeof port[field] !== "string") {
      throw new TypeError(`Port ${field} is required`);
    }
  }
  const direction = normalizeDirection(port.direction);
  const normalized = {
    ...structuredClone(port),
    positionMm: normalizeKnownVector(port.positionMm, "Port position"),
    direction,
  };
  if (Object.hasOwn(port, "interface")) {
    normalized.interface = normalizeConnectionInterface(port.interface, "Port interface");
  }
  return normalized;
}

function normalizeRoute(route) {
  requireOpaqueId(route?.id, "Route ID");
  requireOpaqueId(route?.floorId, "Route floor ID");
  if (!route.system || !route.stream) {
    throw new TypeError("Route system and stream are required");
  }
  const role = route.role ?? null;
  if (role !== null && (typeof role !== "string" || !role.trim())) {
    throw new TypeError("Route role must be a non-empty string or null");
  }
  if (!Array.isArray(route.points) || route.points.length < 2) {
    throw new TypeError("Route requires at least two points");
  }
  const normalized = {
    ...structuredClone(route),
    role,
    ductKind: normalizeChoice(
      route.ductKind ?? "generic-duct",
      [
        "semi-rigid-radial",
        "epp-rigid-dn125",
        "epp-rigid-dn160",
        "flexible-round-dn150",
        "generic-duct",
      ],
      "Route duct kind",
    ),
    parallelRunCount: normalizeParallelRunCount(route.parallelRunCount ?? null),
    startAttachment: normalizeOptionalEndpoint(route.startAttachment, "Route start attachment"),
    endAttachment: normalizeOptionalEndpoint(route.endAttachment, "Route end attachment"),
    points: route.points.map(normalizeRoutePoint),
  };
  if (Object.hasOwn(route, "connectionInterface")) {
    normalized.connectionInterface = normalizeConnectionInterface(
      route.connectionInterface,
      "Route connection interface",
    );
  }
  return normalized;
}

function normalizeRoutePoint(point) {
  return {
    x: requireFinite(point?.x, "Route point x"),
    y: requireFinite(point?.y, "Route point y"),
    z: normalizeMeasurement(point?.z),
  };
}

function requireRouteSegmentIndex(route, value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= route.points.length - 1) {
    throw new RangeError("Route segment index is out of range");
  }
  return value;
}

function requireRouteInteriorPointIndex(route, value) {
  if (!Number.isSafeInteger(value) || value < 1 || value >= route.points.length - 1) {
    throw new RangeError("Only an intermediate route point can be edited; route endpoints remain fixed");
  }
  return value;
}

function normalizeParallelRunCount(value) {
  if (value === null) return null;
  if (value !== 1 && value !== 2) {
    throw new RangeError("Route parallel run count must be null, 1, or 2");
  }
  return value;
}

function normalizeConnectionInterface(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object or null`);
  }
  if (typeof value.family !== "string" || !value.family.trim()) {
    throw new TypeError(`${label} family is required`);
  }
  const nominalSizeMm = value.nominalSizeMm ?? null;
  if (nominalSizeMm !== null && (!Number.isFinite(nominalSizeMm) || nominalSizeMm <= 0)) {
    throw new TypeError(`${label} nominal size must be positive or null`);
  }
  return { ...structuredClone(value), family: value.family, nominalSizeMm };
}

function normalizeOptionalEndpoint(endpoint, label) {
  return endpoint === undefined || endpoint === null ? null : normalizeEndpoint(endpoint, label);
}

function synchronizeAttachedRouteEndpoints(project, componentId) {
  for (const route of project.routes) {
    if (
      route.startAttachment?.componentId === componentId ||
      route.endAttachment?.componentId === componentId
    ) {
      synchronizeRouteEndpoints(project, route);
    }
  }
}

function constrainEditedEppRoute(route, project, realign = false) {
  if (!/^epp-rigid-dn/.test(route.ductKind)) return;
  const direction = attachment => {
    if (!attachment || !project) return null;
    const component=requireEntity(project.components,attachment.componentId,"Component");
    const port=requireEntity(component.ports,attachment.portId,"Port");
    if (hasHrvCeilingElbow(component,port)) return null;
    return rotateVector(component.orientation,port.direction);
  };
  const align=realign ? realignEppPlanConnections : alignEppPortApproaches;
  route.points = align(constrainEppPlanPoints(route.points),direction(route.startAttachment),direction(route.endAttachment),Math.max(500,(route.connectionInterface?.nominalSizeMm ?? 160)*4));
}

function synchronizeRouteEndpoints(project, route) {
  validateRouteAttachmentTypes(project, route);
  if (route.startAttachment !== null) {
    route.points[0] = componentPortPositionOnFloor(project, route.startAttachment);
  }
  if (route.endAttachment !== null) {
    route.points[route.points.length - 1] = componentPortPositionOnFloor(
      project,
      route.endAttachment,
    );
  }
  constrainEditedEppRoute(route, project);
}

function validateRouteAttachments(project, route) {
  validateRouteAttachmentTypes(project, route);
  const bindings = [
    ["start", route.startAttachment, route.points[0]],
    ["end", route.endAttachment, route.points[route.points.length - 1]],
  ];
  for (const [end, endpoint, point] of bindings) {
    if (endpoint === null) continue;
    const derived = componentPortPositionOnFloor(project, endpoint);
    if (!positionsEqual(point, derived)) {
      throw new TypeError(`Attached route ${end} point must equal its derived component-port position`);
    }
  }
}

function validateRouteAttachmentTypes(project, route) {
  const attachments = [route.startAttachment, route.endAttachment].filter(
    (endpoint) => endpoint !== null,
  );
  if (attachments.length > 0 && route.role === null) {
    throw new TypeError("An attached route requires an explicit semantic role");
  }
  for (const endpoint of attachments) {
    const component = requireEntity(project.components, endpoint.componentId, "Route component");
    const port = requireEntity(component.ports, endpoint.portId, "Route port");
    if (component.floorId !== route.floorId) {
      throw new TypeError("Route and attached component must belong to the same floor");
    }
    if (port.system !== route.system || port.stream !== route.stream) {
      throw new TypeError("Route attachment must have matching typed system and stream");
    }
    if (port.role !== route.role) {
      throw new TypeError("Route attachment must have a matching typed role");
    }
    const routeInterface = route.connectionInterface ?? null;
    const portInterface = port.interface ?? null;
    if (!connectionInterfacesCompatible(routeInterface, portInterface)) {
      throw new TypeError("Route attachment requires a matching interface family and nominal size or an explicit adapter");
    }
  }
}

function connectionInterfacesCompatible(left, right) {
  if (left === null || right === null || left === undefined || right === undefined) return true;
  const samePhysicalFamily = left.family === right.family;
  const sameDrawingClass = (
    typeof left.drawingConnectionClass === "string" &&
    left.drawingConnectionClass.length > 0 &&
    left.drawingConnectionClass === right.drawingConnectionClass &&
    (left.connectionScope === "drawing-only" || right.connectionScope === "drawing-only")
  );
  if (!samePhysicalFamily && !sameDrawingClass) return false;
  if (left.nominalSizeMm === null || right.nominalSizeMm === null) return true;
  return left.nominalSizeMm === right.nominalSizeMm;
}

function componentPortPositionOnFloor(project, endpoint) {
  const component = requireEntity(project.components, endpoint.componentId, "Route component");
  const port = requireEntity(component.ports, endpoint.portId, "Route port");
  const offset = rotateVector(component.orientation, port.positionMm);
  const componentZ = normalizeMeasurement(component.positionMm.z);
  let z;
  if (componentZ.state === "unknown") {
    z = unknownMm(`route endpoint depends on unknown component elevation: ${component.id}`);
  } else if (componentZ.state === "assumed") {
    z = assumedMm(
      componentZ.valueMm + offset.z,
      `derived from ${component.id}/${port.id}; ${componentZ.provenance}`,
    );
  } else {
    z = knownMm(
      componentZ.valueMm + offset.z,
      `derived from ${component.id}/${port.id}`,
    );
  }
  return {
    x: component.positionMm.x + offset.x,
    y: component.positionMm.y + offset.y,
    z,
  };
}

function normalizeConnection(connection) {
  requireOpaqueId(connection?.id, "Connection ID");
  return {
    ...structuredClone(connection),
    from: normalizeEndpoint(connection.from, "Connection from"),
    to: normalizeEndpoint(connection.to, "Connection to"),
  };
}

function normalizeEndpoint(endpoint, label) {
  requireOpaqueId(endpoint?.componentId, `${label} component ID`);
  requireOpaqueId(endpoint?.portId, `${label} port ID`);
  return { componentId: endpoint.componentId, portId: endpoint.portId };
}

function validateConnectionEndpoints(project, connection, options = {}) {
  const from = findPort(project, connection.from);
  const to = findPort(project, connection.to);
  if (
    connection.from.componentId === connection.to.componentId &&
    connection.from.portId === connection.to.portId
  ) {
    throw new TypeError("A port cannot connect to itself");
  }
  if (from.system !== to.system || from.stream !== to.stream) {
    throw new TypeError("Connection endpoints must have matching typed system and stream");
  }
  if (from.role !== to.role) {
    throw new TypeError("Connection endpoints must have a matching typed role");
  }
  if (options.checkOccupancy !== false) {
    for (const endpoint of [connection.from, connection.to]) {
      const occupied = project.connections.some(
        (candidate) => endpointEquals(candidate.from, endpoint) || endpointEquals(candidate.to, endpoint),
      );
      if (occupied) {
        throw new TypeError(`Port is already occupied: ${endpoint.componentId}/${endpoint.portId}`);
      }
    }
  }
}

function findPort(project, endpoint) {
  const component = requireEntity(project.components, endpoint.componentId, "Component");
  return requireEntity(component.ports, endpoint.portId, "Port");
}

function endpointEquals(left, right) {
  return left.componentId === right.componentId && left.portId === right.portId;
}

function endpointKey(endpoint) {
  return `${endpoint.componentId}/${endpoint.portId}`;
}

function wallEndpointPairKey(leftNodeId, rightNodeId) {
  return [leftNodeId, rightNodeId].sort().join("::");
}

function wallNodeLocationKey(floorId, position) {
  const normalized = normalizePosition(position);
  return `${floorId}:${normalized.x}:${normalized.y}`;
}

function positionsEqual(left, right) {
  return canonicalStringify(normalizePosition(left)) === canonicalStringify(normalizePosition(right));
}

function planPositionsEqual(left, right) {
  const normalizedLeft = normalizePosition(left);
  const normalizedRight = normalizePosition(right);
  return normalizedLeft.x === normalizedRight.x && normalizedLeft.y === normalizedRight.y;
}

function planPositionsWithinOperationTolerance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y) <= PLAN_OPERATION_EPSILON_MM;
}

function normalizePosition(position) {
  return {
    x: requireFinite(position?.x, "Position x"),
    y: requireFinite(position?.y, "Position y"),
    z: normalizeMeasurement(position?.z),
  };
}

function resolvePosition(position) {
  const normalized = normalizePosition(position);
  const z = resolveMeasurement(normalized.z);
  return z === null ? null : { x: normalized.x, y: normalized.y, z };
}

function normalizeMeasurement(measurement) {
  if (!measurement || typeof measurement !== "object") {
    throw new TypeError("Measurement is required");
  }
  if (measurement.state === "unknown") {
    if (measurement.valueMm !== null) {
      throw new TypeError("Unknown measurement value must be null");
    }
    return {
      state: "unknown",
      valueMm: null,
      reason: measurement.reason || "not provided",
    };
  }
  if (measurement.state !== "known" && measurement.state !== "assumed") {
    throw new TypeError(`Unsupported measurement state: ${String(measurement.state)}`);
  }
  assertFinite(measurement.valueMm, "Measurement value");
  if (measurement.state === "assumed" && !measurement.provenance) {
    throw new TypeError("Assumed measurement requires provenance");
  }
  return {
    state: measurement.state,
    valueMm: measurement.valueMm,
    provenance: measurement.provenance ?? null,
  };
}

function resolveMeasurement(measurement) {
  const normalized = normalizeMeasurement(measurement);
  return normalized.state === "unknown" ? null : normalized.valueMm;
}

function normalizeKnownVector(vector, label) {
  return {
    x: requireFinite(vector?.x, `${label} x`),
    y: requireFinite(vector?.y, `${label} y`),
    z: requireFinite(vector?.z, `${label} z`),
  };
}

function normalizeDirection(direction) {
  const vector = normalizeKnownVector(direction, "Direction");
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length < EPSILON) {
    throw new RangeError("Direction must be non-zero");
  }
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function assertNormalizedQuaternion(value, label) {
  const normalized = normalizeQuaternion(value);
  for (const key of ["x", "y", "z", "w"]) {
    if (Math.abs(normalized[key] - value[key]) > 1e-9) {
      throw new TypeError(`${label} must be normalized`);
    }
  }
}

function assertNormalizedDirection(value, label) {
  const normalized = normalizeDirection(value);
  for (const key of ["x", "y", "z"]) {
    if (Math.abs(normalized[key] - value[key]) > 1e-9) {
      throw new TypeError(`${label} must be normalized`);
    }
  }
}

function addVectors(left, right) {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function subtractVectors(left, right) {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function unknownTransformResult() {
  return {
    positionMm: null,
    positionState: "unknown",
    reason: "Floor or component elevation is unknown",
  };
}

function canonicalStringify(value) {
  return JSON.stringify(sortObject(value), null, 2);
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortObject(value[key])]),
    );
  }
  return value;
}

function assertUniqueIds(collection, label) {
  const ids = new Set();
  for (const entity of collection) {
    requireOpaqueId(entity?.id, `${label} ID`);
    if (ids.has(entity.id)) {
      throw new TypeError(`Duplicate ${label} ID: ${entity.id}`);
    }
    ids.add(entity.id);
  }
}

function assertUniqueValues(values, label) {
  const unique = new Set(values);
  if (unique.size !== values.length) {
    throw new TypeError(`Duplicate ${label}`);
  }
  values.forEach((value) => requireOpaqueId(value, label));
}

function normalizeChoice(value, choices, label) {
  if (!choices.includes(value)) {
    throw new TypeError(`${label} must be one of: ${choices.join(", ")}`);
  }
  return value;
}

function requireUniqueId(collection, id, label) {
  if (collection.some((entity) => entity.id === id)) {
    throw new TypeError(`${label} ID already exists: ${id}`);
  }
}

function requireEntity(collection, id, label) {
  const entity = collection.find((candidate) => candidate.id === id);
  if (!entity) {
    throw new TypeError(`${label} not found: ${id}`);
  }
  return entity;
}

function requireOpaqueId(value, label) {
  if (typeof value !== "string" || value.trim().length < 3) {
    throw new TypeError(`${label} must be a non-empty opaque string`);
  }
  return value;
}

function normalizeBoundedText(value, label, maximumLength) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  const normalized = value.trim();
  if (normalized.length > maximumLength) throw new RangeError(`${label} exceeds ${maximumLength} characters`);
  return normalized;
}

function requireFinite(value, label) {
  assertFinite(value, label);
  return value;
}

function assertFinite(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite`);
  }
}

