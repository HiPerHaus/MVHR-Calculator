import {mountedCwDrawingLayout,mountedCwDrawingParts} from "../domain/mounted-cw-drawing-connections.mjs";
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

  if(options.ductKind==="semi-rigid-radial"){
    const cw=pickCwBody(project,camera,rect,click,options,millimetresPerViewUnit,tolerancePx);
    if(cw)return cw.unavailable?null:cw;
  }
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

// Body acquisition chooses an actual free branch; it never creates a connection
// to the casing. The controller still validates the returned typed endpoint.
function pickCwBody(project,camera,rect,click,options,mmPerUnit,tolerancePx){
 const scale=viewScaleCssPixels(camera,rect)/mmPerUnit;
 let best=null,bodySeen=false;
 for(const component of project.components){
  const symbol=component.displaySymbol??component.catalogueSnapshot?.symbol;
  const mounted=mountedCwDrawingParts(mountedCwDrawingLayout(component)).plates;
  const regions=mounted.length?mounted:symbol?.cwProfile?[{x:-symbol.widthMm/2,y:-symbol.heightMm/2,width:symbol.widthMm,height:symbol.heightMm,stream:symbol.cwProfile.stream}]:[];
  if(!regions.length)continue;
  const centre=projectToClient(component.positionMm,camera,rect,mmPerUnit),q=component.orientation;
  const yaw=Math.atan2(2*(q.w*q.z+q.x*q.y),1-2*(q.y*q.y+q.z*q.z)),c=Math.cos(yaw),s=Math.sin(yaw);
  const dx=(click.x-centre.x)/scale,dy=(click.y-centre.y)/scale;
  const local={x:c*dx+s*dy,y:-s*dx+c*dy};
  const hitRegions=regions.filter(r=>Math.hypot(Math.max(r.x-local.x,0,local.x-r.x-r.width),Math.max(r.y-local.y,0,local.y-r.y-r.height))*scale<=tolerancePx);
  if(!hitRegions.length)continue;
  bodySeen=true;
  for(const port of component.ports??[]){
   if(port.interface?.family!=="semi-rigid-pe"||port.interface.nominalSizeMm!==90)continue;
   if(options.routeDraft?(port.stream!==options.routeDraft.stream||port.system!==options.routeDraft.system||port.role!==options.routeDraft.role):!hitRegions.some(r=>r.stream===port.stream))continue;
   if(portOccupied(project,component.id,port.id))continue;
   const position=floorPortTransform(project,component.id,port.id).positionMm;
   const target=options.approachPoint?projectToClient(options.approachPoint,camera,rect,mmPerUnit):click;
   const client=projectToClient(position,camera,rect,mmPerUnit),score=Math.hypot(target.x-client.x,target.y-client.y);
   const key=endpointKey(component.id,port.id);
   if(!best||score<best.score||(score===best.score&&key<best.key))best={componentId:component.id,portId:port.id,occupied:false,distancePx:Math.hypot(click.x-client.x,click.y-client.y),acquisitionRadiusPx:tolerancePx,bodyAcquired:true,score,key};
  }
 }
 if(!best)return bodySeen?{unavailable:true}:null;
 const {score,key,...result}=best;return result;
}
function portOccupied(project,componentId,portId){
 const matches=e=>e?.componentId===componentId&&e?.portId===portId;
 return (project.routes??[]).some(r=>matches(r.startAttachment)||matches(r.endAttachment))||(project.connections??[]).some(c=>matches(c.from)||matches(c.to));
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
