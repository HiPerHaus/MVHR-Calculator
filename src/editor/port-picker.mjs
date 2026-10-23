import { terminalDrawingAnchors, lunaContinuousRimEntry } from "../domain/terminal-drawing-connections.mjs";
import { floorPortTransform } from "../domain/spatial.mjs";

/**
 * Screen-space component-port acquisition for the manual CAD shell.
 *
 * Port positions remain authoritative floor-local millimetres. Picking is
 * measured in CSS pixels so Fit and camera zoom cannot make an endpoint too
 * small to acquire. The nearest port wins; compatibility is still decided by
 * the mechanical controller after the hit has been identified.
 */

export const PORT_PICK_TOLERANCE_CSS_PX = 12;

export function pickPortAtClientPoint(project, camera, rect, clientPoint, options = {}) {
  if (!project || !Array.isArray(project.components)) {
    throw new TypeError("A project with components is required");
  }
  const tolerancePx = finitePositive(
    options.tolerancePx ?? PORT_PICK_TOLERANCE_CSS_PX,
    "Port pick tolerance",
  );
  const millimetresPerViewUnit = finitePositive(
    options.millimetresPerViewUnit ?? 10,
    "Millimetres per view unit",
  );
  validateCamera(camera);
  validateRect(rect);
  const click = {
    x: finite(clientPoint?.x, "Client x"),
    y: finite(clientPoint?.y, "Client y"),
  };

  let nearest = null;
  for (const component of project.components) {
    for (const port of component.ports ?? []) {
      const hiddenMountedMain=component.mvhrDesignIntent?.layout==="unit-mounted-cw" && ["supply","extract"].includes(port.stream) && port.interface?.family==="rigid-epp";
      if(hiddenMountedMain && !(project.routes??[]).some(route=>[route.startAttachment,route.endAttachment].some(endpoint=>endpoint?.componentId===component.id && endpoint?.portId===port.id)) && !(project.connections??[]).some(connection=>[connection.from,connection.to].some(endpoint=>endpoint?.componentId===component.id && endpoint?.portId===port.id)))continue;
      const isLuna=(component.displaySymbol??component.catalogueSnapshot?.symbol)?.shape === "luna-grille" && port.drawingEntries;
      const centreClient=isLuna?projectToClient(component.positionMm,camera,rect,millimetresPerViewUnit):null;
      const scale=viewScaleCssPixels(camera,rect)/millimetresPerViewUnit;
      const reference=options.approachPoint??(isLuna?{x:component.positionMm.x+(click.x-centreClient.x)/scale,y:component.positionMm.y+(click.y-centreClient.y)/scale}:null);
      const anchors=isLuna?[lunaContinuousRimEntry(component,reference)]:terminalDrawingAnchors(component,port);
      for(const anchor of anchors.length?anchors:[null]) {
      const position = anchor?.positionMm ?? floorPortTransform(project, component.id, port.id).positionMm;
      const client = projectToClient(position, camera, rect, millimetresPerViewUnit);
      const distancePx = isLuna?Math.max(0,Math.hypot(click.x-centreClient.x,click.y-centreClient.y)-((component.displaySymbol??component.catalogueSnapshot.symbol).widthMm*.21+2)*scale):Math.hypot(click.x - client.x, click.y - client.y);
      const acquisitionRadiusPx = portAcquisitionRadiusPx(
        port,
        camera,
        rect,
        millimetresPerViewUnit,
        tolerancePx,
      );
      if (distancePx > acquisitionRadiusPx) continue;
      const stackedCw = (component.displaySymbol??component.catalogueSnapshot?.symbol)?.cwProfile?.orientation === "horizontal";
      const occupied = stackedCw && ((project.routes??[]).some(route=>[route.startAttachment,route.endAttachment].some(endpoint=>endpoint?.componentId===component.id && endpoint?.portId===port.id)) || (project.connections??[]).some(connection=>[connection.from,connection.to].some(endpoint=>endpoint?.componentId===component.id && endpoint?.portId===port.id)));
      const sameProjection = nearest && component.id === nearest.componentId && Math.abs(distancePx-nearest.distancePx)<1e-7;
      if (
        nearest === null ||
        (sameProjection && nearest.occupied && !occupied) ||
        distancePx < nearest.distancePx ||
        (distancePx === nearest.distancePx && (!sameProjection || occupied === nearest.occupied) && endpointKey(component.id, port.id) < endpointKey(nearest.componentId, nearest.portId))
      ) {
        nearest = {
          occupied,
          componentId: component.id,
          portId: port.id,
          distancePx,
          acquisitionRadiusPx,
          ...(anchor?{entryId:anchor.id,positionMm:anchor.positionMm,localPositionMm:anchor.localPositionMm}:{}),
        };
      }
      }
    }
  }
  return nearest;
}

function projectToClient(point, camera, rect, millimetresPerViewUnit) {
  const viewX = finite(point?.x, "Port position x") / millimetresPerViewUnit;
  const viewY = finite(point?.y, "Port position y") / millimetresPerViewUnit;
  const scale = viewScaleCssPixels(camera, rect);
  const originX = rect.left + (rect.width - camera.width * scale) / 2;
  const originY = rect.top + (rect.height - camera.height * scale) / 2;
  return {
    x: originX + (viewX - camera.x) * scale,
    y: originY + (viewY - camera.y) * scale,
  };
}

function portAcquisitionRadiusPx(port, camera, rect, millimetresPerViewUnit, minimumPx) {
  const outsideDiameterMm = port?.drawingDiameterMm ?? port?.interface?.outsideDiameterMm;
  if (!Number.isFinite(outsideDiameterMm) || outsideDiameterMm <= 0) return minimumPx;
  const physicalRadiusPx = outsideDiameterMm / 2 / millimetresPerViewUnit * viewScaleCssPixels(camera, rect);
  return Math.max(minimumPx, physicalRadiusPx);
}

function viewScaleCssPixels(camera, rect) {
  return Math.min(rect.width / camera.width, rect.height / camera.height);
}

function endpointKey(componentId, portId) {
  return `${componentId}\u0000${portId}`;
}

function validateCamera(camera) {
  finite(camera?.x, "Camera x");
  finite(camera?.y, "Camera y");
  finitePositive(camera?.width, "Camera width");
  finitePositive(camera?.height, "Camera height");
}

function validateRect(rect) {
  finite(rect?.left, "Canvas left");
  finite(rect?.top, "Canvas top");
  finitePositive(rect?.width, "Canvas width");
  finitePositive(rect?.height, "Canvas height");
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function finitePositive(value, label) {
  const normalized = finite(value, label);
  if (normalized <= 0) throw new RangeError(`${label} must be positive`);
  return normalized;
}
