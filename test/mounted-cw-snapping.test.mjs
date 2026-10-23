import test from "node:test";
import assert from "node:assert/strict";
import {createConfiguredMvhrComponent} from "../src/editor/mvhr-placement.mjs";
import {createCatalogueComponent,routeFamilyForKind} from "../src/editor/component-catalogue.mjs";
import {deriveComponentPlanGraphic,mountedCwShapes} from "../src/editor/component-plan-graphics.mjs";
import {pendingMountedCwConnections} from "../src/domain/mounted-cw-drawing-connections.mjs";
import {pickPortAtClientPoint} from "../src/editor/port-picker.mjs";
import {applyCommand,createProject,knownMm,identityQuaternion,floorPortTransform,serializeProject,deserializeProject} from "../src/domain/spatial.mjs";
import {createCommandHistory,executeCommand,undoCommand} from "../src/domain/history.mjs";
const placement={id:"mounted-unit",floorId:"ground-floor",xMm:2000,yMm:2000};
function unit(model="q350-hrv",cwSize="625",handing="left"){return createConfiguredMvhrComponent({model,mounting:"vertical",handing,layout:"unit-mounted-cw",cwSize},placement);}
function fixture(component){let p=applyCommand(createProject("cw-snap-project"),{type:"floor.add",floor:{id:"ground-floor",name:"Ground",transform:{translationMm:{x:0,y:0,z:knownMm(0,"datum")},orientation:identityQuaternion()}}});return applyCommand(p,{type:"component.add",component});}
function connect(p,id){const c=p.components[0],branch=c.ports.find(port=>port.id===id),terminal=createCatalogueComponent("luna-supply",{id:"luna-terminal",floorId:"ground-floor",xMm:4000,yMm:2000});p=applyCommand(p,{type:"component.add",component:terminal});const family=routeFamilyForKind("semi-rigid-radial");return applyCommand(p,{type:"route.add",route:{id:"cw-radial",floorId:"ground-floor",system:"mvhr",stream:branch.stream,role:branch.role,ductKind:family.id,connectionInterface:family.connectionInterface,parallelRunCount:1,startAttachment:{componentId:c.id,portId:branch.id},endAttachment:{componentId:terminal.id,portId:terminal.ports[0].id},points:[floorPortTransform(p,c.id,branch.id).positionMm,floorPortTransform(p,terminal.id,terminal.ports[0].id).positionMm]}});}
test("every mounted CW branch circle has an exactly coincident typed DN90 snap target",()=>{
 for(const model of ["q350-hrv","q350-erv","aerofresh-450-hrv","aerofresh-450-erv"])for(const size of ["320","420","520","625"])for(const handing of ["left","right"]){
  const component=unit(model,size,handing),p=fixture(component),graphic=deriveComponentPlanGraphic(component),circles=mountedCwShapes(graphic).filter(s=>s.tag==="circle");
  const branches=component.ports.filter(port=>port.interface.nominalSizeMm===90);
  assert.equal(branches.length,circles.length);assert.equal(pendingMountedCwConnections(component),false);
  for(const circle of circles){
   const port=branches.find(port=>port.id===`${component.id}-port-${circle.attributes["data-cw-port-key"]}`);
   assert.equal(port.positionMm.x,circle.attributes.cx);assert.equal(port.positionMm.y,circle.attributes.cy);
   assert.equal(port.stream,circle.attributes["data-cw-branch"]);assert.equal(port.interface.family,"semi-rigid-pe");
   const position=floorPortTransform(p,component.id,port.id).positionMm;
   const hit=pickPortAtClientPoint(p,{x:0,y:0,width:400,height:400},{left:0,top:0,width:800,height:800},{x:position.x/5,y:position.y/5});
   assert.equal(hit.portId,port.id);
  }
 }
});
test("mounted CW branches route to Luna, follow unit moves/rotation and survive saves",()=>{
 let p=fixture(unit()),branch=p.components[0].ports.find(port=>port.id.endsWith("cw-supply-2-6"));
 p=connect(p,branch.id);
 p=applyCommand(p,{type:"component.rotateFloorZ",componentId:placement.id,angleRad:Math.PI/2});
 p=applyCommand(p,{type:"component.moveXY",componentId:placement.id,xMm:2500,yMm:3100});
 assert.deepEqual(p.routes[0].points[0],floorPortTransform(p,placement.id,branch.id).positionMm);
 assert.deepEqual(deserializeProject(serializeProject(p)),p);
 assert.throws(()=>applyCommand(p,{type:"component.replaceDrawingConfiguration",componentId:placement.id,component:unit("q350-hrv","320")}),/Disconnect affected ducts/);
 const updated=applyCommand(p,{type:"component.replaceDrawingConfiguration",componentId:placement.id,component:unit("q350-hrv","625","right")});
 assert.equal(updated.routes[0].startAttachment.portId,branch.id);
 assert.deepEqual(updated.routes[0].points[0],floorPortTransform(updated,placement.id,branch.id).positionMm);
});
test("existing mounted symbols gain snap targets undoably without changing pinned unit evidence",()=>{
 const component=unit();component.ports=component.ports.filter(port=>port.interface.nominalSizeMm!==90);delete component.mountedCwDrawingConnectionVersion;
 const p=fixture(component),snapshot=structuredClone(component.catalogueSnapshot);
 assert.equal(pendingMountedCwConnections(component),true);
 const h=executeCommand(createCommandHistory(p),{type:"component.enableMountedCwDrawingConnections"});
 assert.equal(h.present.components[0].ports.length,28);
 assert.deepEqual(h.present.components[0].catalogueSnapshot,snapshot);
 assert.deepEqual(undoCommand(h).present,p);
 assert.equal(pendingMountedCwConnections(h.present.components[0]),false);
});
