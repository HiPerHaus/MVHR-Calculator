import test from "node:test";
import assert from "node:assert/strict";
import {findCombinedGrilleAlignment} from "../src/editor/combined-grille-alignment.mjs";
import {createCatalogueComponent,routeFamilyForKind} from "../src/editor/component-catalogue.mjs";
import {applyCommand,createProject,knownMm,identityQuaternion,floorPortTransform,serializeProject,deserializeProject} from "../src/domain/spatial.mjs";
import {createCommandHistory,executeCommand,undoCommand} from "../src/domain/history.mjs";
function fixture(handing="left",angle=0){
 let p=applyCommand(createProject("grille-align"),{type:"floor.add",floor:{id:"floor-ground",name:"Ground",transform:{translationMm:{x:0,y:0,z:knownMm(0,"datum")},orientation:identityQuaternion()}}});
 p=applyCommand(p,{type:"component.add",component:createCatalogueComponent(`zehnder-q350-hrv-${handing}-drawing-profile`,{id:"hrv-unit",floorId:"floor-ground",xMm:2000,yMm:2000})});
 if(angle)p=applyCommand(p,{type:"component.rotateFloorZ",componentId:"hrv-unit",angleRad:angle});return p;
}
function proposed(p,offset=35){
 const unit=p.components[0],port=unit.ports.find(p=>p.stream==="intake"),other=unit.ports.find(p=>p.stream==="exhaust");
 const a=floorPortTransform(p,unit.id,port.id),b=floorPortTransform(p,unit.id,other.id),d=a.direction;
 return {x:(a.positionMm.x+b.positionMm.x)/2+d.x*3000-d.y*offset,y:(a.positionMm.y+b.positionMm.y)/2+d.y*3000+d.x*offset};
}
function grille(point,size=160){return createCatalogueComponent(`generic-external-grille-combined-dn${size}`,{id:"aligned-grille",floorId:"floor-ground",xMm:point.x,yMm:point.y});}
function assertPair(p,result){
 const temp={...p,routes:[],connections:[],components:[...p.components.filter(c=>c.id!==result.component.id),result.component]};
 for(const guide of result.guides){
  const port=result.component.ports.find(p=>p.stream===guide.stream),transform=floorPortTransform(temp,result.component.id,port.id),d=transform.direction;
  assert.ok(Math.abs((guide.from.x-guide.to.x)*d.y-(guide.from.y-guide.to.y)*d.x)<1e-5);
  assert.ok((guide.from.x-guide.to.x)*d.x+(guide.from.y-guide.to.y)*d.y>0);
 }
}
test("placing DN160 combined grilles aligns both Q350 air paths in either handing and all quarter turns",()=>{
 for(const handing of ["left","right"])for(const angle of [0,Math.PI/2,Math.PI,3*Math.PI/2]){
  const p=fixture(handing,angle),point=proposed(p),component=grille(point),before=structuredClone(p);
  const result=findCombinedGrilleAlignment(p,component,point,{toleranceMm:50,allowHandingChange:true,allowRotation:true});
  assert.ok(result,`${handing} ${angle}`);assert.ok(Math.abs(result.correctionMm-35)<1e-5);assertPair(p,result);
  assert.deepEqual(p,before);assert.deepEqual(component,grille(point));
 }
});
test("moving an aligned grille preserves handed pose and both straight EPP connections with undo",()=>{
 let p=fixture(),point=proposed(p),first=findCombinedGrilleAlignment(p,grille(point),point,{allowHandingChange:true,allowRotation:true});
 p=applyCommand(p,{type:"component.add",component:first.component});
 const family=routeFamilyForKind("epp-rigid-dn160"),unit=p.components[0],external=p.components[1];
 for(const stream of ["intake","exhaust"]){const a=unit.ports.find(p=>p.stream===stream),b=external.ports.find(p=>p.stream===stream);p=applyCommand(p,{type:"route.add",route:{id:`duct-${stream}`,floorId:"floor-ground",system:"mvhr",stream,role:a.role,ductKind:family.id,connectionInterface:family.connectionInterface,parallelRunCount:1,startAttachment:{componentId:unit.id,portId:a.id},endAttachment:{componentId:external.id,portId:b.id},points:[floorPortTransform(p,unit.id,a.id).positionMm,floorPortTransform(p,external.id,b.id).positionMm]}});}
 const moving={x:external.positionMm.x+500,y:external.positionMm.y+25};
 const snap=findCombinedGrilleAlignment(p,external,moving,{toleranceMm:50});assert.ok(snap);assertPair(p,snap);
 assert.deepEqual(snap.component.orientation,external.orientation);assert.equal(snap.handing,external.externalGrilleHanding);
 const h=executeCommand(createCommandHistory(p),{type:"component.moveXY",componentId:external.id,xMm:snap.point.x,yMm:snap.point.y});
 for(const route of h.present.routes){assert.equal(route.points.length,2);assert.deepEqual(route.points.at(-1),floorPortTransform(h.present,external.id,route.endAttachment.portId).positionMm);}
 assert.deepEqual(undoCommand(h).present,p);assert.equal(serializeProject(deserializeProject(serializeProject(h.present))),serializeProject(h.present));
});
test("alignment rejects out-of-range, mismatched size and an existing grille facing away",()=>{
 const p=fixture(),point=proposed(p,250);
 assert.equal(findCombinedGrilleAlignment(p,grille(point),point,{toleranceMm:50,allowHandingChange:true,allowRotation:true}),null);
 const near=proposed(p);
 assert.equal(findCombinedGrilleAlignment(p,grille(near,125),near,{allowHandingChange:true,allowRotation:true}),null);
 const wrongSide={x:0,y:near.y};assert.equal(findCombinedGrilleAlignment(p,grille(wrongSide),wrongSide,{toleranceMm:100}),null);
});
