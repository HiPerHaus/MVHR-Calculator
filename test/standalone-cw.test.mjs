import test from "node:test";
import assert from "node:assert/strict";
import { CW_PROFILES,standaloneCwRecordId,standaloneCwShapes } from "../src/editor/standalone-cw.mjs";
import {createCatalogueComponent,routeFamilyForKind} from "../src/editor/component-catalogue.mjs";
import {deriveComponentPlanGraphic} from "../src/editor/component-plan-graphics.mjs";
import {applyCommand,createProject,knownMm,identityQuaternion,serializeProject,deserializeProject,floorPortTransform} from "../src/domain/spatial.mjs";
import {createCommandHistory,executeCommand,undoCommand,redoCommand} from "../src/domain/history.mjs";
import {pickPortAtClientPoint} from "../src/editor/port-picker.mjs";
const placement={id:"cw-unit",floorId:"ground",xMm:1000,yMm:1000,allowAssemblyOnly:true};
function cw(size="625",orientation="vertical",stream="supply") {return createCatalogueComponent(standaloneCwRecordId({size,orientation,stream}),placement);}
function fixture(component=cw()) {
 let project=applyCommand(createProject("standalone-cw"),{type:"floor.add",floor:{id:"ground",name:"Ground",transform:{translationMm:{x:0,y:0,z:knownMm(0,"datum")},orientation:identityQuaternion()}}});
 return applyCommand(project,{type:"component.add",component});
}
function connect(project,branchId) {
 const component=project.components[0],branch=component.ports.find(p=>p.id===branchId),family=routeFamilyForKind("semi-rigid-radial"),start=floorPortTransform(project,"cw-unit",branchId).positionMm;
 return applyCommand(project,{type:"route.add",route:{id:"branch-route",floorId:"ground",system:"mvhr",stream:branch.stream,role:branch.role,ductKind:family.id,connectionInterface:family.connectionInterface,parallelRunCount:1,startAttachment:{componentId:"cw-unit",portId:branchId},endAttachment:null,points:[start,{...start,x:start.x+1000,y:start.y+300}]}});
}
test("standalone source-sized CW profiles retain both orientations and independent branch rows",()=>{
 for(const [size,p] of Object.entries(CW_PROFILES))for(const orientation of ["horizontal","vertical"])for(const stream of ["supply","extract"]) {
  const component=cw(size,orientation,stream),project=fixture(component),graphic=deriveComponentPlanGraphic(component),shapes=standaloneCwShapes(graphic);
  assert.equal(component.ports.length,p.count+1);
  assert.equal(component.ports[0].interface.nominalSizeMm,size==="220"?125:160);
  assert.equal(new Set(component.ports.map(p=>p.id)).size,p.count+1);
  assert.ok(component.ports.every(p=>p.stream===stream));
  assert.equal(component.positionMm.z.state,"unknown");
  assert.deepEqual(deserializeProject(serializeProject(project)),project);
  if(orientation==="vertical")assert.equal(shapes.filter(s=>s.attributes["data-cw-part"]==="branch" && s.attributes.r===45).length,p.count);
  else {
   const branches=component.ports.slice(1);
   assert.equal(new Set(branches.map(p=>p.positionMm.z)).size,2);
   assert.equal(new Set(branches.map(p=>`${p.positionMm.x},${p.positionMm.y}`)).size,p.count/2);
  }
 }
 assert.throws(()=>standaloneCwRecordId({size:"625",stream:"supply",orientation:"vertical",mainSize:125}),/DN125/);
});
test("CW resize and orientation edit preserve connected endpoint identity and support undo, redo, reopen",()=>{
 let project=fixture(cw("320","horizontal"));
 const id=project.components[0].ports[1].id;
 project=connect(project,id);
 const history=executeCommand(createCommandHistory(project),{type:"component.replaceDrawingConfiguration",componentId:"cw-unit",component:cw("625","vertical")});
 assert.equal(history.present.routes[0].startAttachment.portId,id);
 assert.deepEqual(history.present.routes[0].points[0],floorPortTransform(history.present,"cw-unit",id).positionMm);
 assert.deepEqual(undoCommand(history).present,project);
 assert.deepEqual(redoCommand(undoCommand(history)).present,history.present);
 assert.deepEqual(deserializeProject(serializeProject(history.present)),history.present);
 assert.throws(()=>applyCommand(history.present,{type:"component.replaceDrawingConfiguration",componentId:"cw-unit",component:cw("625","vertical","extract")}),/Disconnect affected ducts/);
});
test("downsizing never removes an occupied branch",()=>{
 let project=fixture();
 project=connect(project,project.components[0].ports.find(p=>p.id.endsWith("branch-2-6")).id);
 assert.throws(()=>applyCommand(project,{type:"component.replaceDrawingConfiguration",componentId:"cw-unit",component:cw("320")}),/Disconnect affected ducts/);
 assert.equal(project.components[0].ports.length,13);
});
test("horizontal coincident branch rows pick the next unoccupied port",()=>{
 let project=fixture(cw("320","horizontal"));
 const branch=project.components[0].ports.find(p=>p.id.endsWith("branch-1-1"));
 project=connect(project,branch.id);
 const position=floorPortTransform(project,"cw-unit",branch.id).positionMm;
 const picked=pickPortAtClientPoint(project,{x:0,y:0,width:400,height:200},{left:0,top:0,width:400,height:200},{x:position.x/10,y:position.y/10});
 assert.equal(picked.portId,"cw-unit-port-branch-2-1");
});


test("CW220 uses its DN125 end plate and four DN90 branches, including safe edits",()=>{
 const component=cw("220","vertical"),graphic=deriveComponentPlanGraphic(component);
 assert.equal(component.ports.length,5);
 assert.equal(graphic.widthMm,236);
 assert.equal(graphic.depthMm,230);
 assert.equal(graphic.casingWidth,220);
 assert.equal(graphic.mainSize,125);
 assert.equal(standaloneCwShapes(graphic).filter(s=>s.attributes["data-cw-part"]==="branch").length,4);
 assert.throws(()=>standaloneCwRecordId({size:"220",stream:"supply",orientation:"horizontal",mainSize:160}),/CW220 DN125/);
 let project=fixture(cw("320"));
 const branchId=project.components[0].ports.find(p=>p.id.endsWith("branch-1-1")).id;
 project=connect(project,branchId);
 const changed=applyCommand(project,{type:"component.replaceDrawingConfiguration",componentId:"cw-unit",component});
 assert.equal(changed.routes[0].startAttachment.portId,branchId);
 assert.deepEqual(changed.routes[0].points[0],floorPortTransform(changed,"cw-unit",branchId).positionMm);
});
