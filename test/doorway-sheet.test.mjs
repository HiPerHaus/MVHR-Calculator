import {test} from "node:test";
import assert from "node:assert/strict";
import {applyReviewedWallProposals} from "../app/plan-wall-apply.mjs";
import {createCommandHistory} from "../src/domain/history.mjs";
import {createProject,applyCommand,knownMm,identityQuaternion} from "../src/domain/spatial.mjs";
import {createSyntheticComponent} from "../src/editor/synthetic-catalogue.mjs";
import {deriveRoomBoundaries} from "../src/domain/rooms.mjs";
import {createA3SheetModel,renderA3SheetSvg,ISSUE_STATUSES} from "../src/sheets/a3-sheet.mjs";

test("engineering SVG and parts lists do not treat doorway room boundaries as walls",()=>{
 const floorId="test-floor",p=(x,y)=>({x,y}),w=(a,b)=>({a,b,thicknessMm:100});
 let start=applyCommand(createProject("fixture"),{type:"floor.add",floor:{id:floorId,name:"Ground Floor",transform:{translationMm:{x:0,y:0,z:knownMm(0,"QA")},orientation:identityQuaternion()}}});
 start=applyCommand(start,{type:"component.add",component:createSyntheticComponent("synthetic-supply-terminal",{id:"qa-outlet",floorId,xMm:1200,yMm:1000})});
 const source={floorId,scale:10,reference:{transform:{rotationRad:0,translationMm:p(0,0)}}};
 const [a,b,c,d,e,f]=[p(0,0),p(400,0),p(400,300),p(0,300),p(155,0),p(241,0)];
 const pieces=[w(a,e),w(f,b),w(b,c),w(c,d),w(d,a)];
 const base=applyReviewedWallProposals(createCommandHistory(start),source,pieces,"walls").next;
 const closing=applyReviewedWallProposals(base,source,[{...w(e,f),roomOpening:true}],"opening").next.present;
 const face=deriveRoomBoundaries(closing,floorId).candidates[0];assert.equal(face.areaMm2,12_000_000);
 const room=applyCommand(closing,{type:"room.createFromBoundary",floorId,roomId:"qa-room",name:"QA Bedroom",use:"bedroom",ventilationRole:"supply",boundaryKey:face.key});
 const marker=room.walls.find(w=>w.boundaryRole==="room-opening");
 const md={floorId,issueDate:"2026-11-23",projectName:"Doorway QA",drawingTitle:"QA plan",drawingId:"QA-01",status:ISSUE_STATUSES[0],revision:"QA",revisionText:"Test only",includeSchedule:true};
 for(const systemScope of ["combined","centralised","decentralised"]){
   const before=createA3SheetModel(base.present,{...md,systemScope});
   const after=createA3SheetModel(room,{...md,systemScope});
   assert.deepEqual(after.printScene.walls,before.printScene.walls);
   assert.equal(after.printScene.walls.length,5);
   assert.deepEqual(after.printScene.modelBoundsMm,before.printScene.modelBoundsMm);
   assert.deepEqual(after.partsSchedule.componentLines,before.partsSchedule.componentLines);
   if(systemScope==="combined")assert(after.printScene.components.some(c=>c.id==="qa-outlet"));
   assert.deepEqual(after.partsSchedule.routeLines,before.partsSchedule.routeLines);
   const svg=renderA3SheetSvg(after);
   assert.equal((svg.match(/data-kind="wall"/g)||[]).length,5);
   assert(!svg.includes(marker.id));
   assert(!svg.includes('data-wall-classification="virtual"'));
 }
});
