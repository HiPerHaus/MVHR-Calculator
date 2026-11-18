import test from "node:test";
import assert from "node:assert/strict";
import {volumeFromGeometry,normalizeCeiling,roomVolume,floorVolumes,ventilationReferenceAssessment} from "../src/domain/room-volume.mjs";
import {applyCommand,createProject,knownMm,unknownMm,identityQuaternion,serializeProject,deserializeProject} from "../src/domain/spatial.mjs";
import {deriveRoomBoundaries} from "../src/domain/rooms.mjs";
const rectangle={status:"current",areaMm2:24e6,centroidMm:{x:3000,y:2000},polygon:[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}]};
test("flat and raked rectangular volumes use canonical millimetres",()=>{
 assert.equal(volumeFromGeometry(rectangle,{type:"flat",heightMm:2700}).valueM3,64.8);
 assert.equal(volumeFromGeometry(rectangle,{type:"raked",lowMm:2400,highMm:3600,directionDeg:0}).valueM3,72);
 assert.equal(volumeFromGeometry(rectangle,{type:"raked",lowMm:2400,highMm:3600,directionDeg:90}).valueM3,72);
});
test("raked irregular volume integrates centroid, not the simple endpoint average",()=>{
 const tri={status:"current",areaMm2:8e6,centroidMm:{x:4000/3,y:4000/3},polygon:[{x:0,y:0},{x:4000,y:0},{x:0,y:4000}]};
 assert.equal(volumeFromGeometry(tri,{type:"raked",lowMm:2000,highMm:5000,directionDeg:0}).valueM3,24);
 assert.equal(volumeFromGeometry(tri,{type:"raked",lowMm:2000,highMm:5000,directionDeg:180}).valueM3,32);
});
test("unknown and invalid geometry never becomes zero known volume",()=>{
 assert.equal(volumeFromGeometry(rectangle,{type:"unknown"}).valueM3,null);
 assert.equal(volumeFromGeometry({...rectangle,status:"reassignment-required"},{type:"flat",heightMm:2700}).valueM3,null);
 for(const heightMm of [0,-1,NaN,Infinity,"2700"]) assert.throws(()=>normalizeCeiling({type:"flat",heightMm}));
 assert.throws(()=>normalizeCeiling({type:"raked",lowMm:3000,highMm:2000,directionDeg:0}));
 assert.throws(()=>normalizeCeiling({type:"raked",lowMm:2000,highMm:3000,directionDeg:NaN}));
});
test("floor default inheritance and overrides survive serialization and preserve targets",()=>{
 let p=fixture(); const targets=structuredClone(p.rooms[0].airflowTargets);
 assert.equal(roomVolume(p,p.rooms[0]).valueM3,null);
 p=applyCommand(p,{type:"floor.setCeiling",floorId:"floor",ceiling:{type:"flat",heightMm:2700}});
 assert.equal(roomVolume(p,p.rooms[0]).valueM3,64.8);
 p=applyCommand(p,{type:"room.setCeiling",roomId:"room",ceiling:{type:"raked",lowMm:2400,highMm:3600,directionDeg:0}});
 p=deserializeProject(serializeProject(p));assert.equal(roomVolume(p,p.rooms[0]).valueM3,72);
 p=applyCommand(p,{type:"floor.setCeiling",floorId:"floor",ceiling:{type:"flat",heightMm:3000}});
 assert.equal(roomVolume(p,p.rooms[0]).valueM3,72);
 p=applyCommand(p,{type:"room.setCeiling",roomId:"room",ceiling:{type:"inherit"}});
 assert.equal(roomVolume(p,p.rooms[0]).source,"floor default");
 p=applyCommand(p,{type:"room.setCeiling",roomId:"room",ceiling:{type:"unknown"}});
 assert.equal(floorVolumes(p,"floor").complete,false);assert.equal(roomVolume(p,p.rooms[0]).valueM3,null);
 assert.deepEqual(p.rooms[0].airflowTargets,targets);
 assert.throws(()=>applyCommand(p,{type:"room.setCeiling",roomId:"missing",ceiling:{type:"flat",heightMm:2700}}));
});
test("legacy explicit height retained and stale boundaries excluded",()=>{
 let p=fixture();p.rooms[0].heightMm=knownMm(2500,"legacy");
 p=applyCommand(p,{type:"floor.setCeiling",floorId:"floor",ceiling:{type:"flat",heightMm:3000}});
 assert.equal(roomVolume(p,p.rooms[0]).valueM3,60);
 p.rooms[0].boundaryState="reassignment-required";assert.equal(roomVolume(p,p.rooms[0]).valueM3,null);
});
test("PHPP references require separate TFA and keep missing occupancy unresolved",()=>{
 const r=ventilationReferenceAssessment({tfaM2:200,occupants:4,source:"reviewed test"});
 assert.equal(r.referenceVolumeM3,500);assert.equal(r.areaReferenceM3h,150);assert.equal(r.occupantReferenceM3h,120);assert.equal(r.comparisonM3h,150);
 assert.equal(ventilationReferenceAssessment().comparisonM3h,null);
 assert.throws(()=>ventilationReferenceAssessment({tfaM2:1e308,occupants:4,source:""}));
 assert.throws(()=>ventilationReferenceAssessment({tfaM2:200,occupants:1e308,source:""}));
 assert.equal(ventilationReferenceAssessment({tfaM2:200,occupants:null,source:""}).comparisonM3h,null);
 assert.throws(()=>ventilationReferenceAssessment({tfaM2:200,occupants:1.5,source:""}));
 let p=fixture();p=applyCommand(p,{type:"ventilation.setReference",reference:{tfaM2:200,occupants:4,source:"review"}});
 assert.deepEqual(deserializeProject(serializeProject(p)).ventilationReference,{tfaM2:200,occupants:4,source:"review"});
});
function fixture(){
 let p=applyCommand(createProject("volume-test"),{type:"floor.add",floor:{id:"floor",name:"Ground",transform:{translationMm:{x:0,y:0,z:knownMm(0,"test")},orientation:identityQuaternion()}}});
 p=applyCommand(p,{type:"wall.addChain",floorId:"floor",nodeIds:["node-a","node-b","node-c","node-d","node-a"],wallIds:["wall-ab","wall-bc","wall-cd","wall-da"],points:[[0,0],[6000,0],[6000,4000],[0,4000],[0,0]].map(([x,y])=>({x,y,z:unknownMm("test")})),splits:[],thicknessMm:140,heightMm:unknownMm("test"),referenceLine:"centreline",classification:"physical"});
 return applyCommand(p,{type:"room.createFromBoundary",roomId:"room",floorId:"floor",boundaryKey:deriveRoomBoundaries(p,"floor").candidates[0].key,name:"Living",use:"living",ventilationRole:"supply"});
}
