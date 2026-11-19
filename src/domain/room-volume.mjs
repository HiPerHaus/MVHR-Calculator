import { inspectRoomBoundary } from "./rooms.mjs";

export const DEFAULT_CEILING_HEIGHT_MM = 2500;
export const VOLUME_METHOD = "wall-reference-polygon-single-plane-v1";
export const PHPP_VOLUME_SOURCE = "https://passipedia.org/planning/building_services/ventilation/differentiation_between_vv_and_vn50_values";
function positive(value, name) { if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be a positive finite number`); return value; }
export function normalizeCeiling(value, allowInherit = true) {
  if (value === undefined || value === null || value.type === "inherit") {
    if (allowInherit) return {type:"inherit"};
    return {type:"unknown"};
  }
  if (value.type === "unknown") return {type:"unknown"};
  if (value.type === "flat") return {type:"flat",heightMm:positive(value.heightMm,"Ceiling height")};
  if (value.type === "raked" && allowInherit) {
    const lowMm=positive(value.lowMm,"Low height"), highMm=positive(value.highMm,"High height");
    if(highMm < lowMm) throw new RangeError("High height must not be below low height");
    if(!Number.isFinite(value.directionDeg)) throw new TypeError("Rake direction must be finite");
    return {type:"raked",lowMm,highMm,directionDeg:((value.directionDeg%360)+360)%360};
  }
  throw new TypeError("Unsupported ceiling shape");
}
// Integrates one linear ceiling plane over a simple polygon using its area centroid.
// Low/high heights occur at the polygon's extrema along the entered low-to-high axis.
export function volumeFromGeometry(geometry, ceiling) {
  ceiling=normalizeCeiling(ceiling);
  if(geometry.status !== "current" || !Number.isFinite(geometry.areaMm2) || geometry.areaMm2 <= 0) return {state:"unknown",valueM3:null,reason:"Room boundary is not current"};
  let meanHeightMm;
  if(ceiling.type === "flat") meanHeightMm=ceiling.heightMm;
  else if(ceiling.type === "raked") {
    const angle=ceiling.directionDeg*Math.PI/180, x=Math.cos(angle), y=Math.sin(angle);
    const projections=geometry.polygon.map(p=>p.x*x+p.y*y), min=Math.min(...projections), max=Math.max(...projections);
    if(max-min < 1e-6 || !geometry.centroidMm) return {state:"unknown",valueM3:null,reason:"Rake geometry unresolved"};
    const fraction=(geometry.centroidMm.x*x+geometry.centroidMm.y*y-min)/(max-min);
    meanHeightMm=ceiling.lowMm+(ceiling.highMm-ceiling.lowMm)*fraction;
  } else return {state:"unknown",valueM3:null,reason:"Ceiling height not set"};
  if(!Number.isFinite(geometry.areaMm2*meanHeightMm/1e9)) throw new RangeError("Room volume exceeds numeric range");
  return {state:"calculated",valueM3:geometry.areaMm2*meanHeightMm/1e9,areaM2:geometry.areaMm2/1e6,meanHeightMm,method:VOLUME_METHOD,convention:"Wall-reference-line area × actual-height ceiling plane; not verified net air volume, TFA or n50 volume"};
}
// Only absent defaults receive the assumption. Explicit unknown remains unresolved.
export function floorCeiling(floor) {
  if(floor && floor.ceiling === undefined) return {ceiling:{type:"flat",heightMm:DEFAULT_CEILING_HEIGHT_MM},source:"assumed default 2.5 m (not verified)",assumed:true};
  return {ceiling:normalizeCeiling(floor?.ceiling,false),source:"floor default",assumed:false};
}
export function roomVolume(project, room) {
  const floor=project.floors.find(f=>f.id===room.floorId);
  let ceiling=normalizeCeiling(room.ceiling);
  let source="room override", assumed=false;
  if(ceiling.type === "inherit") {
    // Preserve pre-existing explicit room heights rather than replacing them.
    if(room.ceiling === undefined && room.heightMm?.state !== "unknown" && room.heightMm?.valueMm > 0) { ceiling={type:"flat",heightMm:room.heightMm.valueMm}; source=`legacy room height (${room.heightMm.state})`; assumed=room.heightMm.state==="assumed"; }
    else {({ceiling,source,assumed}=floorCeiling(floor));}
  }
  if(room.boundaryState === "reassignment-required") return {state:"unknown",valueM3:null,source,ceiling,assumed,reason:"Room boundary needs reassignment"};
  return {...volumeFromGeometry(inspectRoomBoundary(project,room),ceiling),source,ceiling,assumed};
}
export function floorVolumes(project, floorId) {
  const rooms=project.rooms.filter(r=>r.floorId===floorId).map(room=>({id:room.id,name:room.name,...roomVolume(project,room)}));
  return {rooms,assumedRoomCount:rooms.filter(r=>r.assumed&&r.state==="calculated").length,knownSubtotalM3:rooms.reduce((sum,r)=>sum+(r.valueM3??0),0),complete:rooms.length>0&&rooms.every(r=>r.state==="calculated")};
}
export function normalizeVentilationReference(value) {
  if(value===undefined) return null;
  if(!value || typeof value!=="object") throw new TypeError("Invalid ventilation reference");
  const nullable=(v,n)=>v===null?null:positive(v,n);
  const tfaM2=nullable(value.tfaM2,"Reviewed dwelling TFA"), occupants=nullable(value.occupants,"Occupancy");
  if(tfaM2!==null&&!Number.isFinite(tfaM2*2.5)) throw new RangeError("Reference volume exceeds numeric range");
  if(occupants!==null&&!Number.isFinite(occupants*30)) throw new RangeError("Occupancy reference exceeds numeric range");
  if(occupants!==null&&!Number.isSafeInteger(occupants)) throw new TypeError("Occupancy must be a whole number");
  if(typeof value.source!=="string" || value.source.length>1000) throw new TypeError("Reference source required");
  return {tfaM2,occupants,source:value.source};
}
// Transparent planning references, not an approved allocation or code compliance engine.
export function ventilationReferenceAssessment(value) {
  const input=normalizeVentilationReference(value);
  const referenceVolumeM3=input?.tfaM2===null || !input ? null : input.tfaM2*2.5;
  const areaReferenceM3h=referenceVolumeM3===null?null:referenceVolumeM3*0.3;
  const occupantReferenceM3h=input?.occupants===null || !input ? null : input.occupants*30;
  return {method:"residential-planning-reference-v1",referenceVolumeM3,areaReferenceM3h,occupantReferenceM3h,comparisonM3h:areaReferenceM3h===null||occupantReferenceM3h===null?null:Math.max(areaReferenceM3h,occupantReferenceM3h),source:PHPP_VOLUME_SOURCE,boundary:"Whole-dwelling planning comparison only. 30 m³/h/person is a stated design assumption; extraction, room allocation, local requirements and certifier review remain unresolved. Never applies targets automatically."};
}
