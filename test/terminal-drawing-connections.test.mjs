import assert from "node:assert/strict";
import test from "node:test";
import {applyCommand,createProject,identityQuaternion,knownMm,unknownMm,floorPortTransform,serializeProject,deserializeProject,roomTerminalPort} from "../src/domain/spatial.mjs";
import {createCatalogueComponent,routeFamilyForKind} from "../src/editor/component-catalogue.mjs";
import {terminalDrawingAnchors,lunaContinuousRimEntry} from "../src/domain/terminal-drawing-connections.mjs";
import {createCommandHistory,executeCommand,undoCommand} from "../src/domain/history.mjs";
import {pickPortAtClientPoint} from "../src/editor/port-picker.mjs";

function fixture(record) {
 let p=applyCommand(createProject("terminal-snaps"),{type:"floor.add",floor:{id:"floor-ground",name:"Ground",transform:{translationMm:{x:0,y:0,z:knownMm(0,"test")},orientation:identityQuaternion()}}});
 for(const [item,id,x] of [["generic-supply-attenuation-distribution-160","box",0],[record,"terminal",2000]])p=applyCommand(p,{type:"component.add",component:createCatalogueComponent(item,{id,floorId:"floor-ground",xMm:x,yMm:1000})});
 return p;
}
function connect(project,entryId,id="radial") {
 const box=project.components.find(c=>c.id==="box"),terminal=project.components.find(c=>c.id==="terminal");
 const a=box.ports.find(p=>p.interface.nominalSizeMm===90),b=terminal.ports[0];
 const end=terminalDrawingAnchors(terminal,b).find(e=>e.id===entryId);
 const family=routeFamilyForKind("semi-rigid-radial");
 return applyCommand(project,{type:"route.add",terminalEntrySelections:[{componentId:terminal.id,portId:b.id,entryId}],route:{id,floorId:"floor-ground",system:"mvhr",stream:"supply",role:"Dwelling supply",ductKind:family.id,connectionInterface:family.connectionInterface,parallelRunCount:1,startAttachment:{componentId:box.id,portId:a.id},endAttachment:{componentId:terminal.id,portId:b.id},points:[floorPortTransform(project,box.id,a.id).positionMm,{...end.positionMm,z:unknownMm("test")} ]}});
}

test("Luna radial routes attach to the outer rim in all eight directions",()=>{
 for(let i=0;i<8;i++) {
  const p=connect(fixture("luna-supply"),`rim-${i}`),terminal=p.components.find(c=>c.id==="terminal"),port=terminal.ports[0];
  assert.ok(Math.abs(Math.hypot(port.positionMm.x,port.positionMm.y)-65)<1e-6);
  assert.deepEqual(p.routes[0].points.at(-1),floorPortTransform(p,terminal.id,port.id).positionMm);
  assert.equal(roomTerminalPort(p,terminal.id).id,port.id);
 }
});

test("Aerofresh supports both side entries and back centre with one occupied logical connection",()=>{
 for(const entry of ["left","right","back"]) {
  const p=connect(fixture("aerofresh-magnetic-wall-grille-supply"),entry);
  const terminal=p.components.find(c=>c.id==="terminal");
  assert.equal(terminal.ports.length,1);assert.equal(terminal.ports[0].drawingEntryId,entry);
  assert.throws(()=>connect(p,entry,"second"),/already connected/);
  const reopened=deserializeProject(serializeProject(p));assert.deepEqual(reopened,p);
  const rotated=applyCommand(p,{type:"component.rotateFloorZ",componentId:terminal.id,angleRad:Math.PI/2});
  assert.deepEqual(rotated.routes[0].points.at(-1),floorPortTransform(rotated,terminal.id,terminal.ports[0].id).positionMm);
 }
});

test("screen picking resolves the rotated Aerofresh entry instead of only its default back port",()=>{
 let p=fixture("aerofresh-magnetic-wall-grille-supply");
 p=applyCommand(p,{type:"component.rotateFloorZ",componentId:"terminal",angleRad:Math.PI/2});
 const c=p.components.find(c=>c.id==="terminal"),entry=terminalDrawingAnchors(c,c.ports[0]).find(e=>e.id==="left");
 const hit=pickPortAtClientPoint(p,{x:0,y:0,width:400,height:200},{left:0,top:0,width:400,height:200},{x:entry.positionMm.x/10,y:entry.positionMm.y/10});
 assert.equal(hit.entryId,"left");assert.equal(hit.portId,c.ports[0].id);
});

test("enabling old portless symbols is undoable and keeps their pinned snapshots",()=>{
 let p=fixture("luna-supply");const c=p.components.find(c=>c.id==="terminal");c.ports=[];const snapshot=structuredClone(c.catalogueSnapshot);
 let history=createCommandHistory(p);history=executeCommand(history,{type:"terminal.enableDrawingConnections"});
 assert.equal(history.present.components.find(c=>c.id==="terminal").ports.length,1);
 assert.deepEqual(history.present.components.find(c=>c.id==="terminal").catalogueSnapshot,snapshot);
 assert.deepEqual(undoCommand(history).present,p);
});


test("continuous Luna snapping chooses any rim angle on the approaching side and persists that exact point",()=>{
 const p=fixture("luna-supply"),terminal=p.components.find(c=>c.id==="terminal"),port=terminal.ports[0];
 const approach={x:0,y:533},entry=lunaContinuousRimEntry(terminal,approach);
 const hit=pickPortAtClientPoint(p,{x:0,y:0,width:400,height:200},{left:0,top:0,width:400,height:200},{x:200,y:100},{approachPoint:approach});
 assert.equal(hit.entryId,"rim");
 assert.ok(Math.abs(Math.hypot(hit.localPositionMm.x,hit.localPositionMm.y)-65)<1e-6);
 assert.ok(Math.abs(hit.localPositionMm.x-hit.localPositionMm.y)>1);
 assert.ok((hit.positionMm.x-2000)*(approach.x-2000)+(hit.positionMm.y-1000)*(approach.y-1000)>0);
 const box=p.components.find(c=>c.id==="box"),branch=box.ports.find(p=>p.interface.nominalSizeMm===90),family=routeFamilyForKind("semi-rigid-radial");
 const command={type:"route.add",terminalEntrySelections:[{componentId:terminal.id,portId:port.id,entryId:"rim",localPositionMm:entry.localPositionMm}],route:{id:"continuous",floorId:"floor-ground",system:"mvhr",stream:"supply",role:"Dwelling supply",ductKind:family.id,connectionInterface:family.connectionInterface,parallelRunCount:1,startAttachment:{componentId:box.id,portId:branch.id},endAttachment:{componentId:terminal.id,portId:port.id},points:[floorPortTransform(p,box.id,branch.id).positionMm,{...entry.positionMm,z:unknownMm("test")}]}};
 const connected=applyCommand(p,command),reopened=deserializeProject(serializeProject(connected));
 assert.deepEqual(reopened.routes[0].points.at(-1),floorPortTransform(reopened,terminal.id,port.id).positionMm);
 const invalid=structuredClone(command);invalid.terminalEntrySelections[0].localPositionMm={x:0,y:0,z:0};
 assert.throws(()=>applyCommand(p,invalid),/rim/);
});
