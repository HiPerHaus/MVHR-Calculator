import assert from "node:assert/strict";
import test from "node:test";
import {applyCommand,createProject,identityQuaternion,knownMm,serializeProject,deserializeProject} from "../src/domain/spatial.mjs";
import {createCatalogueComponent} from "../src/editor/component-catalogue.mjs";
import {inspectExternalGrilleSeparation,EXTERNAL_GRILLE_SEPARATION_RULE} from "../src/editor/external-grille-spacing.mjs";
import {auditVentilation} from "../src/editor/ventilation-audit.mjs";

function project(distance=1000,other="zehnder-external-grille-exhaust-dn160") {
 let p=applyCommand(createProject("grille-spacing"),{type:"floor.add",floor:{id:"floor-ground",name:"Ground",transform:{translationMm:{x:0,y:0,z:knownMm(0,"test")},orientation:identityQuaternion()}}});
 for(const [record,id,x] of [["zehnder-external-grille-intake-dn160","intake",0],[other,"other",distance]])p=applyCommand(p,{type:"component.add",component:createCatalogueComponent(record,{id,floorId:"floor-ground",xMm:x,yMm:0})});
 return p;
}

test("single intake and exhaust grilles require exactly 1500 mm centre-to-centre",()=>{
 assert.equal(EXTERNAL_GRILLE_SEPARATION_RULE.basis,"centre-to-centre");
 for(const [distance,status] of [[1499,"too-close"],[1500,"plan-clearance-met"],[1501,"plan-clearance-met"]]) {
  const p=project(distance),[pair]=inspectExternalGrilleSeparation(p,"floor-ground");
  assert.equal(pair.status,status);assert.equal(pair.distanceMm,distance);
  assert.equal(auditVentilation(p,"floor-ground").diagnostics.some(d=>d.code==="external-grille-separation"),status==="too-close");
 }
});

test("grille separation updates after moving and persists through save/reopen without mutating the project",()=>{
 let p=project(1000);const original=structuredClone(p);
 inspectExternalGrilleSeparation(p,"floor-ground");assert.deepEqual(p,original);
 p=applyCommand(p,{type:"component.moveXY",componentId:"other",xMm:1700,yMm:0});
 assert.equal(inspectExternalGrilleSeparation(deserializeProject(serializeProject(p)),"floor-ground")[0].status,"plan-clearance-met");
});

test("combined ports and same-service grilles are exempt from the separate intake/exhaust pair rule",()=>{
 for(const record of ["generic-external-grille-combined-dn160","zehnder-external-grille-intake-dn160"])assert.deepEqual(inspectExternalGrilleSeparation(project(100,record),"floor-ground"),[]);
 assert.deepEqual(inspectExternalGrilleSeparation(project(),"another-floor"),[]);
});

test("new single profiles retain source-backed envelope/article while old generic snapshots stay generic",()=>{
 const p=project(),c=p.components[0];
 assert.equal(c.catalogueSnapshot.manufacturerArticle,"990430584");
 assert.deepEqual(c.catalogueSnapshot.dimensions.body,{width:280,depth:73,height:281});
 const old=createCatalogueComponent("generic-external-grille-intake-dn160",{id:"old",floorId:"floor-ground",xMm:0,yMm:0});
 assert.equal(old.catalogueSnapshot.dimensions.body,null);
 const mixed={...p,components:[old,p.components[1]]};
 assert.equal(inspectExternalGrilleSeparation(mixed,"floor-ground")[0].status,"too-close");
});
