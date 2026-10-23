import { constrainEppPlanPoints } from "../domain/epp-plan-constraints.mjs";
import { DUCT_ROUTE_FAMILIES, routeFamilyForKind } from "./component-catalogue.mjs";

const TOOL_NAMES = Object.freeze(["select", "place-component", "place-assembly", "route"]);
const DUCT_KINDS = Object.freeze(DUCT_ROUTE_FAMILIES.map((family) => family.id));

export function createMechanicalInteractionState() {
  return {
    tool: "select",
    selectedComponentId: null,
    placement: null,
    ductKind: null,
    routeDraft: null,
    pointer: null,
  };
}

export function activateMechanicalTool(state, tool, options = {}) {
  requireState(state);
  if (!TOOL_NAMES.includes(tool)) throw new TypeError(`Unsupported mechanical tool: ${String(tool)}`);
  if (tool === "place-component") {
    requireId(options.catalogueItemId, "Synthetic catalogue item ID");
  }
  if (tool === "place-assembly") {
    requireId(options.assemblyTemplateId, "Equipment assembly template ID");
  }
  if (tool === "route" && !DUCT_KINDS.includes(options.ductKind)) {
    throw new TypeError(`Unsupported route duct kind: ${String(options.ductKind)}`);
  }
  return {
    ...state,
    tool,
    placement: tool === "place-component"
      ? { catalogueItemId: options.catalogueItemId }
      : tool === "place-assembly"
        ? { assemblyTemplateId: options.assemblyTemplateId }
      : null,
    ductKind: tool === "route" ? options.ductKind : null,
    routeDraft: null,
    pointer: null,
  };
}

export function updateMechanicalPointer(state, point) {
  requireState(state);
  return { ...state, pointer: rigidRoutePoint(state, normalizePoint(point)) };
}

export function handleMechanicalCanvasClick(state, input) {
  requireState(state);
  const point = normalizePoint(input?.point);
  const hit = normalizeHit(input?.hit ?? null);

  if (state.tool === "place-component") {
    return {
      state: { ...state, pointer: point },
      intent: {
        type: "component.place",
        catalogueItemId: state.placement.catalogueItemId,
        point,
      },
      message: "Synthetic component placement requested",
    };
  }

  if (state.tool === "place-assembly") {
    return {
      state: { ...state, pointer: point },
      intent: {
        type: "equipmentAssembly.place",
        assemblyTemplateId: state.placement.assemblyTemplateId,
        point,
      },
      message: "Generic equipment assembly placement requested",
    };
  }

  if (state.tool === "route") {
    return handleRouteClick(state, point, hit);
  }

  const componentId = hit?.kind === "component"
    ? hit.componentId
    : hit?.kind === "port"
      ? hit.componentId
      : null;
  return {
    state: { ...state, selectedComponentId: componentId, pointer: point },
    intent: null,
    message: componentId ? "Component selected" : "Component selection cleared",
  };
}

export function cancelMechanicalOperation(state) {
  requireState(state);
  return {
    ...state,
    tool: "select",
    placement: null,
    ductKind: null,
    routeDraft: null,
    pointer: null,
  };
}

export function resolveComponentPlacementState(state, outcome) {
  requireState(state);
  if (typeof outcome?.committed !== "boolean") {
    throw new TypeError("Component placement outcome must declare whether it committed");
  }
  if (!outcome.committed || outcome.returnToSelect !== true) return state;
  requireId(outcome.componentId, "Placed component ID");
  return {
    ...activateMechanicalTool(state, "select"),
    selectedComponentId: outcome.componentId,
  };
}

export function componentMoveIntent(state, point) {
  requireState(state);
  requireId(state.selectedComponentId, "Selected component ID");
  const normalized = normalizePoint(point);
  return {
    type: "component.moveXY",
    componentId: state.selectedComponentId,
    xMm: normalized.x,
    yMm: normalized.y,
  };
}

export function componentRotationIntent(state, angleRad = Math.PI / 2) {
  requireState(state);
  requireId(state.selectedComponentId, "Selected component ID");
  if (!Number.isFinite(angleRad)) throw new TypeError("Component rotation must be finite");
  return {
    type: "component.rotateFloorZ",
    componentId: state.selectedComponentId,
    angleRad,
  };
}

export function requiresProjectReplacementConfirmation(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Project replacement state is required");
  }
  const wallDraftPointCount = Number(value.wallDraftPointCount ?? 0);
  if (!Number.isInteger(wallDraftPointCount) || wallDraftPointCount < 0) {
    throw new TypeError("Wall draft point count must be a non-negative integer");
  }
  return Boolean(
    value.committedProjectChanged ||
    wallDraftPointCount > 0 ||
    value.wallNodeDragActive ||
    value.componentDragActive ||
    value.routeDraftActive ||
    value.calibrationActive ||
    value.placementActive
  );
}

export function rigidRoutePoint(state, point) {
  if (!/^epp-rigid-dn/.test(state.ductKind ?? "") || !state.routeDraft?.points.length) return point;
  const origin = state.routeDraft.points.at(-1), dx = point.x-origin.x, dy = point.y-origin.y;
  const d=state.routeDraft.startDirection;
  if(state.routeDraft.points.length===1 && Math.hypot(d?.x??0,d?.y??0)>1e-6) {
    const norm=Math.hypot(d.x,d.y),ux=d.x/norm,uy=d.y/norm,length=Math.max(0,dx*ux+dy*uy);
    return {x:origin.x+length*ux,y:origin.y+length*uy};
  }
  const angle = Math.round(Math.atan2(dy,dx)/(Math.PI/4))*(Math.PI/4);
  const distance = dx*Math.cos(angle)+dy*Math.sin(angle);
  return {x:origin.x+distance*Math.cos(angle),y:origin.y+distance*Math.sin(angle)};
}

function handleRouteClick(state, point, hit) {
  const port = hit?.kind === "port" ? hit : null;
  if (state.routeDraft === null) {
    if (port === null) {
      return {
        state: { ...state, pointer: point },
        intent: null,
        message: "Choose a visible typed port to start the route",
      };
    }
    if (port.occupied) {
      return {
        state: { ...state, pointer: point },
        intent: null,
        message: `${port.role} port is already connected; choose a free labelled port`,
      };
    }
    const routeFamily = routeFamilyForKind(state.ductKind);
    if (!routeAcceptsPort(routeFamily, port)) {
      return {
        state: { ...state, pointer: point },
        intent: null,
        message: `The selected ${routeFamily.name} route does not match this ${port.role} port (${describeInterface(port.interface)})`,
      };
    }
    return {
      state: {
        ...state,
        pointer: point,
        routeDraft: {
          ductKind: state.ductKind,
          start: endpointFromHit(port),
          role: port.role,
          system: port.system,
          stream: port.stream,
          startInterface: port.interface,
          startDirection: port.ceilingElbow ? null : port.direction,
          startTerminalEntry: port.terminalEntry,
          connectionInterface: routeFamily.connectionInterface,
          points: [point],
        },
      },
      intent: null,
      message: "Route start attached; click intermediate points or a compatible end port",
    };
  }

  const draft = state.routeDraft;
  if (port === null) point = rigidRoutePoint(state, point);
  if (port !== null) {
    const end = endpointFromHit(port);
    if (sameEndpoint(draft.start, end)) {
      return { state, intent: null, message: "A route cannot end on its start port" };
    }
    if (port.occupied) {
      return { state, intent: null, message: `${port.role} port is already connected; choose a free labelled port` };
    }
    const routeFamily = routeFamilyForKind(draft.ductKind);
    const incompatibility = routeEndIncompatibility(draft, port, routeFamily);
    if (incompatibility) return { state, intent: null, message: incompatibility };
    return {
      state: { ...state, routeDraft: null, pointer: point },
      intent: {
        type: "route.commit",
        terminalEntrySelections:[draft.startTerminalEntry,port.terminalEntry].filter(Boolean),
        ductKind: draft.ductKind,
        parallelRunCount: 1,
        system: draft.system,
        stream: draft.stream,
        role: draft.role,
        connectionInterface: draft.connectionInterface,
        start: draft.start,
        end,
        points: /^epp-rigid-dn/.test(draft.ductKind) ? constrainEppPlanPoints([...draft.points, point]) : [...draft.points, point],
      },
      message: "Typed route commit requested",
    };
  }

  const previous = draft.points.at(-1);
  if (previous.x === point.x && previous.y === point.y) {
    return { state, intent: null, message: "Choose a different intermediate point" };
  }
  return {
    state: {
      ...state,
      pointer: point,
      routeDraft: { ...draft, points: [...draft.points, point] },
    },
    intent: null,
    message: "Intermediate route point added",
  };
}

function normalizeHit(hit) {
  if (hit === null) return null;
  if (hit.kind === "component") {
    requireId(hit.componentId, "Hit component ID");
    return { kind: "component", componentId: hit.componentId };
  }
  if (hit.kind === "port") {
    for (const [value, label] of [
      [hit.componentId, "Hit component ID"],
      [hit.portId, "Hit port ID"],
      [hit.system, "Hit port system"],
      [hit.stream, "Hit port stream"],
      [hit.role, "Hit port role"],
    ]) requireId(value, label);
    return {
      kind: "port",
      componentId: hit.componentId,
      portId: hit.portId,
      system: hit.system,
      stream: hit.stream,
      role: hit.role,
      interface: normalizeInterface(hit.interface),
      occupied: hit.occupied === true,
      direction: hit.direction ? structuredClone(hit.direction) : null,
      ceilingElbow: hit.ceilingElbow === true,
      terminalEntry: hit.terminalEntry ? structuredClone(hit.terminalEntry) : null,
    };
  }
  if (hit.kind === "wall") return { kind: "wall" };
  throw new TypeError(`Unsupported canvas hit: ${String(hit.kind)}`);
}

function normalizeInterface(value) {
  if (value === undefined || value === null) return null;
  requireId(value.family, "Hit port interface family");
  const nominalSizeMm = value.nominalSizeMm ?? null;
  if (nominalSizeMm !== null && (!Number.isFinite(nominalSizeMm) || nominalSizeMm <= 0)) {
    throw new TypeError("Hit port nominal size must be positive or null");
  }
  return { ...structuredClone(value), family: value.family, nominalSizeMm };
}

function routeAcceptsPort(routeFamily, port) {
  if (routeFamily.connectionInterface === null || port.interface === null) return true;
  return interfacesCompatible(routeFamily.connectionInterface, port.interface);
}

function routeEndIncompatibility(draft, port, routeFamily) {
  if (port.system !== draft.system) {
    return `End port is incompatible: system ${port.system}; route requires ${draft.system}`;
  }
  if (port.stream !== draft.stream || port.role !== draft.role) {
    return `End port is incompatible: ${port.role} (${port.stream}); route started from ${draft.role} (${draft.stream})`;
  }
  if (!routeAcceptsPort(routeFamily, port)) {
    return `End port is incompatible with ${routeFamily.name}: ${describeInterface(port.interface)}`;
  }
  if (
    !interfacesCompatible(draft.startInterface, port.interface) &&
    !explicitDrawingRouteBridgesInterfaces(routeFamily, draft.startInterface, port.interface)
  ) {
    return `End port is incompatible with route start: ${describeInterface(draft.startInterface)} cannot connect to ${describeInterface(port.interface)}`;
  }
  return null;
}

function explicitDrawingRouteBridgesInterfaces(routeFamily, left, right) {
  const routeInterface = routeFamily.connectionInterface;
  if (routeInterface?.connectionScope !== "drawing-only" || left === null || right === null) return false;
  return interfacesCompatible(routeInterface, left) && interfacesCompatible(routeInterface, right);
}

function describeInterface(value) {
  if (!value) return "interface unspecified";
  const size = value.nominalSizeMm === null || value.nominalSizeMm === undefined
    ? "size unspecified"
    : `DN${value.nominalSizeMm}`;
  const drawingClass = typeof value.drawingConnectionClass === "string" && value.drawingConnectionClass
    ? ` · drawing class ${value.drawingConnectionClass}`
    : "";
  return `${value.family} ${size}${drawingClass}`;
}

function interfacesCompatible(left, right) {
  if (left === null || right === null || left === undefined || right === undefined) return true;
  const samePhysicalFamily = left.family === right.family;
  const sameDrawingClass = (
    typeof left.drawingConnectionClass === "string" &&
    left.drawingConnectionClass.length > 0 &&
    left.drawingConnectionClass === right.drawingConnectionClass
  );
  if (!samePhysicalFamily && !sameDrawingClass) return false;
  if (left.nominalSizeMm === null || right.nominalSizeMm === null) return true;
  return left.nominalSizeMm === right.nominalSizeMm;
}

function endpointFromHit(hit) {
  return { componentId: hit.componentId, portId: hit.portId };
}

function sameEndpoint(left, right) {
  return left.componentId === right.componentId && left.portId === right.portId;
}

function normalizePoint(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError("Mechanical pointer position must be finite");
  }
  return { x, y };
}

function requireState(state) {
  if (!state || typeof state !== "object" || !TOOL_NAMES.includes(state.tool)) {
    throw new TypeError("Mechanical interaction state is invalid");
  }
}

function requireId(value, label) {
  if (typeof value !== "string" || value.trim().length < 1) {
    throw new TypeError(`${label} is required`);
  }
}
