import test from "node:test";
import assert from "node:assert/strict";
import {createConfiguredMvhrComponent} from "../src/editor/mvhr-placement.mjs";
import {deriveComponentPlanGraphic} from "../src/editor/component-plan-graphics.mjs";
import {CA200_GRAPHIC_ID,ca200Shapes} from "../src/editor/ca200-profile.mjs";
import {applyCommand,createProject,identityQuaternion,knownMm,floorPortTransform,serializeProject,deserializeProject} from "../src/domain/spatial.mjs";
import {createCommandHistory,executeCommand,undoCommand,redoCommand} from "../src/domain/history.mjs";
import {routeFamilyForKind} from "../src/editor/component-catalogue.mjs";
import {createPartsSchedule} from "../src/editor/parts-schedule.mjs";
const placement={id:"ca200-unit",floorId:"floor-ground",xMm:1500,yMm:2000};
function unit(mounting="horizontal",handing="left",layout="remote-attenuators"){return createConfiguredMvhrComponent({model:"ca200",mounting,handing,layout},placement);}
function fixture(component){let p=applyCommand(createProject("ca200-review"),{type:"floor.add",floor:{id:"floor-ground",name:"Ground",transform:{translationMm:{x:0,y:0,z:knownMm(0,"datum")},orientation:identityQuaternion()}}});return applyCommand(p,{type:"component.add",component});}
test("CA200 manual profiles support both mountings and manufacturer handed roles",()=>{
 for(const mounting of ["horizontal","vertical"])for(const handing of ["left","right"]){
  const c=unit(mounting,handing),g=deriveComponentPlanGraphic(c),p=fixture(c);
  assert.equal(g.graphicId,CA200_GRAPHIC_ID);assert.equal(g.widthMm,535);assert.equal(g.depthMm,mounting==="horizontal"?1200:315);
  assert.equal(c.ports.length,4);assert.ok(c.ports.every(p=>p.interface.nominalSizeMm===125));
  assert.equal(c.positionMm.z.state,"unknown");
  const supply=c.ports.find(p=>p.stream==="supply"),extract=c.ports.find(p=>p.stream==="extract"),intake=c.ports.find(p=>p.stream==="intake"),exhaust=c.ports.find(p=>p.stream==="exhaust");
  assert.equal(supply.positionMm.x,handing==="left"?-165:165);assert.equal(extract.positionMm.x,-supply.positionMm.x);
  assert.equal(exhaust.positionMm.x,supply.positionMm.x);assert.equal(intake.positionMm.x,extract.positionMm.x);
  if(mounting==="horizontal"){assert.equal(supply.positionMm.y,-600);assert.equal(intake.positionMm.y,600);assert.equal(ca200Shapes(g).filter(s=>s.attributes["data-ca200-part"]==="spigot").length,4);}
  else {assert.equal(supply.positionMm.y,exhaust.positionMm.y);assert.equal(supply.positionMm.z,600);assert.equal(exhaust.positionMm.z,-600);}
  assert.deepEqual(deserializeProject(serializeProject(p)),p);
 }
 assert.throws(()=>unit("horizontal","left","unit-mounted-cw"),/direct CW mounting/);
});
test("CA200 DN125 routing survives handed changes, undo and saves with one ceiling allowance",()=>{
 let p=fixture(unit());const c=p.components[0],port=c.ports.find(p=>p.stream==="supply"),start=floorPortTransform(p,c.id,port.id).positionMm;
 const family=routeFamilyForKind("epp-rigid-dn125");
 p=applyCommand(p,{type:"route.add",route:{id:"ca200-duct",floorId:"floor-ground",system:"mvhr",stream:"supply",role:"Dwelling supply",ductKind:family.id,connectionInterface:family.connectionInterface,parallelRunCount:1,startAttachment:{componentId:c.id,portId:port.id},endAttachment:null,points:[start,{...start,y:start.y-1500}]}});
 const history=executeCommand(createCommandHistory(p),{type:"component.replaceDrawingConfiguration",componentId:c.id,component:unit("horizontal","right")});
 assert.equal(history.present.routes[0].startAttachment.portId,port.id);
 assert.deepEqual(history.present.routes[0].points[0],floorPortTransform(history.present,c.id,port.id).positionMm);
 assert.deepEqual(undoCommand(history).present,p);assert.deepEqual(redoCommand(undoCommand(history)).present,history.present);
 const schedule=createPartsSchedule(history.present,{floorId:"floor-ground"});
 assert.equal(schedule.eppUnitConnectionAllowances.length,1);assert.equal(schedule.eppUnitConnectionAllowances[0].nominalSizeMm,125);
 assert.deepEqual(deserializeProject(serializeProject(history.present)),history.present);
});
