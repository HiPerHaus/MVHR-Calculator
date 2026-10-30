import {deriveComponentPlanGraphic,externalGrilleShapes,EXTERNAL_GRILLE_PLAN_GRAPHIC_ID} from "../src/editor/component-plan-graphics.mjs";
import {createA3SheetModel,renderA3SheetSvg} from "../src/sheets/a3-sheet.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import {constrainEppPlanPoints,isEppPlanSegment,alignEppPortApproaches,hasHrvCeilingElbow} from "../src/domain/epp-plan-constraints.mjs";
import {applyCommand,createProject,identityQuaternion,knownMm,unknownMm,floorPortTransform,serializeProject,deserializeProject} from "../src/domain/spatial.mjs";
import {createCatalogueComponent,routeFamilyForKind} from "../src/editor/component-catalogue.mjs";
import {createCommandHistory,executeCommand,undoCommand,redoCommand} from "../src/domain/history.mjs";

function assertAngles(points) { for(let i=1;i<points.length;i++) assert.ok(isEppPlanSegment(points[i-1],points[i]),JSON.stringify(points)); }
function fixture() {
 let p=applyCommand(createProject("epp-workflow"),{type:"floor.add",floor:{id:"floor-ground",name:"Ground",transform:{translationMm:{x:0,y:0,z:knownMm(0,"test")},orientation:identityQuaternion()}}});
 for(const [record,id,x,y] of [["zehnder-q350-hrv-left-drawing-profile","unit",0,0],["generic-external-grille-combined-dn160","grille",4000,2500]])p=applyCommand(p,{type:"component.add",component:createCatalogueComponent(record,{id,floorId:"floor-ground",xMm:x,yMm:y})});
 const unit=p.components[0],grille=p.components[1];
 const a=unit.ports.find(port=>port.stream==="intake"),b=grille.ports.find(port=>port.stream==="intake");
 const start=floorPortTransform(p,unit.id,a.id).positionMm,end=floorPortTransform(p,grille.id,b.id).positionMm;
 const family=routeFamilyForKind("epp-rigid-dn160");
 p=applyCommand(p,{type:"route.add",route:{id:"epp-run",floorId:"floor-ground",system:"mvhr",stream:"intake",role:"Outdoor intake",ductKind:family.id,connectionInterface:family.connectionInterface,parallelRunCount:1,startAttachment:{componentId:unit.id,portId:a.id},endAttachment:{componentId:grille.id,portId:b.id},points:[start,{x:-1500,y:1500,z:unknownMm("test")},end]}});
 return p;
}
function assertInline(project) {
 const route=project.routes[0];assertAngles(route.points);
 for(const [attachment,point,neighbor] of [[route.startAttachment,route.points[0],route.points[1]],[route.endAttachment,route.points.at(-1),route.points.at(-2)]]) {
  const transform=floorPortTransform(project,attachment.componentId,attachment.portId);
  assert.deepEqual(point,transform.positionMm);
  const component=project.components.find(c=>c.id===attachment.componentId);
  if(hasHrvCeilingElbow(component,component.ports.find(p=>p.id===attachment.portId)))continue;
  const dx=neighbor.x-point.x,dy=neighbor.y-point.y,d=transform.direction;
  assert.ok(Math.abs(dx*d.y-dy*d.x)<1e-5);
  assert.ok(dx*d.x+dy*d.y>0);
 }
}

test("final EPP legs correct slight offsets and retain exact endpoints",()=>{
 const points=[{x:0,y:0},{x:0,y:1000},{x:1000,y:1004}];
 const constrained=constrainEppPlanPoints(points);assertAngles(constrained);
 assert.deepEqual(constrained.at(-1),points.at(-1));
 assert.equal(constrained[1].y,1004);
 const other=constrainEppPlanPoints([{x:0,y:0,z:unknownMm("test")},{x:1234,y:531,z:unknownMm("test")}]);
 assertAngles(other);assert.ok(other.every(p=>p.z.state==="unknown"));
});

test("EPP port approaches remain inline through point edits, equipment moves and save",()=>{
 let p=fixture();assertInline(p);
 p=applyCommand(p,{type:"route.movePoint",routeId:"epp-run",pointIndex:1,xMm:1000,yMm:937});assertInline(p);
 p=applyCommand(p,{type:"component.moveXY",componentId:"grille",xMm:5000,yMm:2531});assertInline(p);
 assertInline(deserializeProject(serializeProject(p)));
});

test("whole-run deletion is isolated and undo restores all endpoint bindings",()=>{
 const p=fixture();let history=createCommandHistory(p);
 history=executeCommand(history,{type:"route.delete",routeId:"epp-run"});
 assert.equal(history.present.routes.length,0);assert.deepEqual(history.present.components,p.components);
 history=undoCommand(history);assert.deepEqual(history.present,p);
 history=redoCommand(history);assert.equal(history.present.routes.length,0);
 assert.throws(()=>applyCommand(history.present,{type:"route.delete",routeId:"missing"}));
});

test("combined exterior grille keeps intake and exhaust as distinct compatible endpoints",()=>{
 const p=fixture(),grille=p.components.find(c=>c.id==="grille");
 assert.deepEqual(grille.ports.map(port=>port.stream),["intake","exhaust"]);
 assert.notEqual(grille.ports[0].id,grille.ports[1].id);
 const invalid=structuredClone(p.routes[0]);invalid.id="bad";invalid.startAttachment=null;
 invalid.endAttachment.portId=grille.ports.find(port=>port.stream==="exhaust").id;
 assert.throws(()=>applyCommand(p,{type:"route.add",route:invalid}),/role|stream|incompatible/i);
});


test("inline completion avoids a reversing final elbow when both ports face the same side",()=>{
 const points=[{x:5710,y:3838},{x:5390,y:3838},{x:4368,y:4860},{x:4368,y:5180},{x:2220,y:5180}];
 const aligned=alignEppPortApproaches(points,{x:-1,y:0},{x:-1,y:0},640);
 assertAngles(aligned);
 for(let i=1;i<aligned.length-1;i++) {
  const a=aligned[i-1],b=aligned[i],c=aligned[i+1];
  assert.ok((b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)>=-1e-5,JSON.stringify(aligned));
 }
 assert.deepEqual(aligned[0],points[0]);assert.deepEqual(aligned.at(-1),points.at(-1));
});


test("placed combined grille swaps Left/Right without changing port identities and ducts follow",()=>{
 const p=fixture(),old=p.components.find(c=>c.id==="grille");
 let history=createCommandHistory(p);
 history=executeCommand(history,{type:"component.setExternalGrilleHanding",componentId:"grille",handing:"right"});
 const flipped=history.present.components.find(c=>c.id==="grille");
 assert.equal(flipped.externalGrilleHanding,"right");
 assert.deepEqual(flipped.ports.map(p=>p.id),old.ports.map(p=>p.id));
 assert.equal(flipped.ports[0].positionMm.y,-old.ports[0].positionMm.y);
 assertInline(history.present);
 assert.deepEqual(undoCommand(history).present,p);
 const graphic=deriveComponentPlanGraphic(flipped);
 assert.equal(graphic.graphicId,EXTERNAL_GRILLE_PLAN_GRAPHIC_ID);
 assert.equal(graphic.handing,"right");
 const shapes=externalGrilleShapes(graphic);
 assert.equal(graphic.view,"plan");
 assert.ok(!shapes.some(s=>s.tag==="circle"));
 const hood=shapes.find(s=>s.attributes["data-part"]==="projecting-exhaust-hood");
 const exhaust=graphic.ports.find(p=>p.stream==="exhaust");
 assert.ok(Math.abs(hood.attributes.y+hood.attributes.height/2-exhaust.yMm)<1e-6);
 assert.equal(shapes.filter(s=>s.attributes["data-part"]==="rear-duct-neck").length,2);
 const arrows=shapes.filter(s=>s.attributes["data-part"]==="airflow-arrow");
 assert.deepEqual(arrows.map(s=>[s.attributes["data-stream"],s.attributes["data-flow-x"],s.attributes["data-flow-y"]]),[["intake",-1,0],["exhaust",1,0]]);
 assert.deepEqual(arrows.map(s=>s.attributes.fill),["#1769d2","#e2342f"]);
 assert.ok(arrows.every(arrow=>arrow.attributes["data-grille-clearance-mm"]>=120));
 for(const arrow of arrows) {
  const values=arrow.attributes.d.match(/-?\d+(?:\.\d+)?/gu).map(Number),xs=values.filter((_,index)=>index%2===0);
  assert.ok(Math.min(...xs)>=graphic.widthMm/2+arrow.attributes["data-grille-clearance-mm"]-1e-6,"airflow arrow stays wholly beyond the outside grille face");
 }
 assert.deepEqual(shapes.filter(s=>s.tag==="text").map(s=>s.text).sort(),["EHA","Exhaust air out","ODA","Outside Air"]);
 const labels=shapes.filter(s=>s.attributes["data-part"]==="airflow-label");
 assert.deepEqual(labels.map(s=>[s.attributes["data-stream"],s.text]),[["intake","Outside Air"],["exhaust","Exhaust air out"]]);
 assert.ok(graphic.drawingBoundsMm.minX<=-174&&graphic.drawingBoundsMm.maxX>=700,"offset arrows and labels are included in print fitting bounds");
 const sheet=createA3SheetModel(history.present,{projectName:"Grille review",drawingTitle:"Ventilation",drawingId:"V01",revision:"A",revisionText:"Review",issueDate:"2026-10-23",status:"Preliminary — not for construction",floorId:"floor-ground"});
 const svg=renderA3SheetSvg(sheet);
 assert.match(svg,/data-external-grille-handing="right"/);
 assert.ok(svg.indexOf('data-id="grille"')>svg.indexOf('data-id="epp-run"'),"external grille face masks the rounded route cap without changing route geometry");
 assert.equal((svg.match(/data-part="airflow-arrow"/g)||[]).length,4,"drawing and legend both retain two semantic airflow arrows");
});

test("single external grilles derive intake inward and exhaust outward airflow from typed ports through every quarter turn",()=>{
 for(const [record,stream] of [["generic-external-grille-intake-dn160","intake"],["generic-external-grille-exhaust-dn160","exhaust"],["zehnder-external-grille-intake-dn160","intake"],["zehnder-external-grille-exhaust-dn160","exhaust"]]) {
  for(const quarterTurns of [0,1,2,3]) {
   let component=createCatalogueComponent(record,{id:`${stream}-${quarterTurns}`,floorId:"floor-ground",xMm:0,yMm:0});
   for(let turn=0;turn<quarterTurns;turn++) {
    let p=applyCommand(createProject(`rotation-${stream}-${quarterTurns}`),{type:"floor.add",floor:{id:"floor-ground",name:"Ground",transform:{translationMm:{x:0,y:0,z:knownMm(0,"test")},orientation:identityQuaternion()}}});
    p=applyCommand(p,{type:"component.add",component});
    p=applyCommand(p,{type:"component.rotateFloorZ",componentId:component.id,angleRad:Math.PI/2});
    component=p.components[0];
   }
   const graphic=deriveComponentPlanGraphic(component),arrow=externalGrilleShapes(graphic).find(s=>s.attributes["data-part"]==="airflow-arrow");
   const label=externalGrilleShapes(graphic).find(s=>s.attributes["data-part"]==="airflow-label");
   const port=graphic.ports.find(candidate=>candidate.stream===stream),sign=stream==="intake"?1:-1;
   assert.deepEqual([arrow.attributes["data-stream"],arrow.attributes["data-flow-x"],arrow.attributes["data-flow-y"]],[stream,port.directionX*sign||0,port.directionY*sign||0]);
   assert.equal(label.text,stream==="intake"?"Outside Air":"Exhaust air out");
   assert.equal(label.attributes["data-keep-on-drawing"],"true");
   assert.ok(Math.abs(component.orientation.z-Math.sin(quarterTurns*Math.PI/4))<1e-9);
   assert.ok(Math.abs(component.orientation.w-Math.cos(quarterTurns*Math.PI/4))<1e-9);
  }
 }
});

test("near-grille clicks do not force a box loop before a downward-facing connection",()=>{
 const input=[{x:0,y:5000},{x:0,y:0},{x:60,y:0}];
 const output=alignEppPortApproaches(input,{x:-1,y:0},{x:0,y:1},640);
 assertAngles(output);
 assert.deepEqual(output[0],input[0]);assert.deepEqual(output.at(-1),input.at(-1));
 assert.ok(output.every(p=>p.y>=0 && p.y<=5000));
 assert.ok(output.every(p=>p.x<=60));
 assert.ok(output.length<=5,JSON.stringify(output));
 assert.equal(output.at(-2).x,60);assert.ok(output.at(-2).y>0);
 for(let i=1;i<output.length-1;i++)assert.ok((output[i].x-output[i-1].x)*(output[i+1].x-output[i].x)+(output[i].y-output[i-1].y)*(output[i+1].y-output[i].y)>=-1e-6);
});

test("existing HRV-to-combined grille end loops can be realigned and undone",()=>{
 let p=fixture();
 p=applyCommand(p,{type:"route.delete",routeId:"epp-run"});
 p=applyCommand(p,{type:"component.rotateFloorZ",componentId:"grille",angleRad:-Math.PI/2});
 const unit=p.components.find(c=>c.id==="unit"),grille=p.components.find(c=>c.id==="grille");
 const a=unit.ports.find(port=>port.stream==="intake"),b=grille.ports.find(port=>port.stream==="intake");
 const start=floorPortTransform(p,unit.id,a.id).positionMm;
 const target={x:start.x+60,y:start.y-5000};
 const oldEnd=floorPortTransform(p,grille.id,b.id).positionMm;
 p=applyCommand(p,{type:"component.moveXY",componentId:"grille",xMm:grille.positionMm.x+target.x-oldEnd.x,yMm:grille.positionMm.y+target.y-oldEnd.y});
 const end=floorPortTransform(p,grille.id,b.id).positionMm,first={...start,x:start.x+640};
 // This fixture's left-handed unit has outdoor ports pointing right.
 const points=[start,first,{...end,x:first.x},{...end,x:end.x+640},{...end,x:end.x+640,y:end.y+640},{...end,y:end.y+640},end];
 const family=routeFamilyForKind("epp-rigid-dn160");
 p=applyCommand(p,{type:"route.add",route:{id:"existing-loop",floorId:"floor-ground",system:"mvhr",stream:"intake",role:"Outdoor intake",ductKind:family.id,connectionInterface:family.connectionInterface,parallelRunCount:1,startAttachment:{componentId:unit.id,portId:a.id},endAttachment:{componentId:grille.id,portId:b.id},points}});
 const saved=structuredClone(p),length=ps=>ps.slice(1).reduce((n,q,i)=>n+Math.hypot(q.x-ps[i].x,q.y-ps[i].y),0);
 const history=executeCommand(createCommandHistory(p),{type:"route.realignEppConnections",routeId:"existing-loop"});
 const result=history.present.routes[0];assertAngles(result.points);
 assert.ok(length(result.points)<length(saved.routes[0].points));
 assert.deepEqual(result.startAttachment,saved.routes[0].startAttachment);assert.deepEqual(result.endAttachment,saved.routes[0].endAttachment);
 assert.deepEqual(result.points[0],start);assert.deepEqual(result.points.at(-1),end);
 assert.deepEqual(history.present.components,saved.components);
 assert.deepEqual(undoCommand(history).present,saved);
 assert.deepEqual(redoCommand(undoCommand(history)).present,history.present);
 const reopened=deserializeProject(serializeProject(history.present));
 assert.deepEqual(reopened.routes,history.present.routes);
 assert.equal(serializeProject(reopened),serializeProject(history.present));
});

test("DN160 combined grille drawing pitch matches Q350 and existing connected grilles update undoably",()=>{
 for(const handing of ["left","right"]){
  let p=fixture();
  if(handing==="right")p=applyCommand(p,{type:"component.setExternalGrilleHanding",componentId:"grille",handing});
  const unit=p.components.find(c=>c.id==="unit"),newGrille=p.components.find(c=>c.id==="grille");
  const outdoor=unit.ports.filter(port=>["intake","exhaust"].includes(port.stream));
  const unitPitch=Math.abs(outdoor[0].positionMm.y-outdoor[1].positionMm.y);
  assert.equal(Math.abs(newGrille.ports[0].positionMm.y-newGrille.ports[1].positionMm.y),unitPitch);
  const old=structuredClone(newGrille);for(const port of old.ports)port.positionMm.y*=240/unitPitch;
  p=applyCommand(p,{type:"component.replaceDrawingConfiguration",componentId:"grille",component:old});
  const snapshot=structuredClone(p.components.find(c=>c.id==="grille").catalogueSnapshot);
  const history=executeCommand(createCommandHistory(p),{type:"component.matchCombinedGrilleSpacing"});
  const updated=history.present.components.find(c=>c.id==="grille");
  assert.equal(Math.abs(updated.ports[0].positionMm.y-updated.ports[1].positionMm.y),unitPitch);
  assert.deepEqual(updated.ports.map(port=>port.id),old.ports.map(port=>port.id));
  assert.equal(Math.sign(updated.ports[0].positionMm.y),Math.sign(old.ports[0].positionMm.y));
  assert.deepEqual(updated.catalogueSnapshot,snapshot);
  assertInline(history.present);
  assert.deepEqual(undoCommand(history).present,p);
 }
 const small=createCatalogueComponent("generic-external-grille-combined-dn125",{id:"small-grille",floorId:"floor-ground",xMm:0,yMm:0});
 assert.equal(Math.abs(small.ports[0].positionMm.y-small.ports[1].positionMm.y),240);
});


test("HRV ceiling outlet can head diagonally back across the unit in either drawing direction",()=>{
 for(const reverse of [false,true]) {
  let p=fixture();p=applyCommand(p,{type:"route.delete",routeId:"epp-run"});
  const unit=p.components.find(c=>c.id==="unit"),grille=p.components.find(c=>c.id==="grille");
  const a=unit.ports.find(p=>p.stream==="intake"),b=grille.ports.find(p=>p.stream==="intake");
  const start=floorPortTransform(p,unit.id,a.id).positionMm;
  const target={x:start.x-2000,y:start.y-3000};
  const oldEnd=floorPortTransform(p,grille.id,b.id).positionMm;
  p=applyCommand(p,{type:"component.moveXY",componentId:"grille",xMm:grille.positionMm.x+target.x-oldEnd.x,yMm:grille.positionMm.y+target.y-oldEnd.y});
  const end=floorPortTransform(p,grille.id,b.id).positionMm;
  const points=[start,{...start,x:start.x-1000,y:start.y-1000},{...start,x:start.x-1000,y:end.y},end];
  const unitEnd={componentId:unit.id,portId:a.id},grilleEnd={componentId:grille.id,portId:b.id};
  const family=routeFamilyForKind("epp-rigid-dn160");
  p=applyCommand(p,{type:"route.add",route:{id:"cross-unit",floorId:"floor-ground",system:"mvhr",stream:"intake",role:"Outdoor intake",ductKind:family.id,connectionInterface:family.connectionInterface,parallelRunCount:1,startAttachment:reverse?grilleEnd:unitEnd,endAttachment:reverse?unitEnd:grilleEnd,points:reverse?points.slice().reverse():points}});
  const route=p.routes[0],fromUnit=reverse?route.points.slice().reverse():route.points;
  assertAngles(route.points);
  assert.equal(fromUnit[1].x,start.x-1000);assert.equal(fromUnit[1].y,start.y-1000);
  assert.ok(fromUnit.every(p=>p.x<=start.x));
  assert.deepEqual(deserializeProject(serializeProject(p)).routes,p.routes);
 }
});
