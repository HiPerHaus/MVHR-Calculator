import {test} from "node:test";
import assert from "node:assert/strict";
import {createCommandHistory,executeCommand,undoCommand,redoCommand} from "../src/domain/history.mjs";
import {applyCommand,createProject,identityQuaternion,knownMm,serializeProject,deserializeProject,wallConnectedComponentIds} from "../src/domain/spatial.mjs";
import {deriveRoomBoundaries,inspectRoomBoundary} from "../src/domain/rooms.mjs";
import {createSyntheticComponent} from "../src/editor/synthetic-catalogue.mjs";
import {roomVolume} from "../src/domain/room-volume.mjs";
import {applyReviewedWallProposals} from "../app/plan-wall-apply.mjs";

const floorId="floor-ground",p=(x,y)=>({x,y}),w=(a,b)=>({a,b,thicknessMm:100});
const [a,b,c,d,e,f]=[p(0,0),p(400,0),p(400,280),p(0,280),p(200,0),p(200,280)];
const perimeter=[w(a,b),w(b,c),w(c,d),w(d,a)];
const source={floorId,scale:10,reference:{transform:{rotationRad:Math.PI/9,translationMm:p(200,350)}}};
const makeHistory=()=>createCommandHistory(applyCommand(createProject("test-wall-proposals"),{
  type:"floor.add",floor:{id:floorId,name:"Ground Floor",transform:{translationMm:{...p(0,0),z:knownMm(0,"test datum")},orientation:identityQuaternion()}}
}));
test("stages source pixels as physical walls; rotation, intersections, room faces, and single-step undo work",()=>{
  const before=makeHistory();
  const {next,rooms}=applyReviewedWallProposals(before,source,[...perimeter,w(e,f)],"exact-real-commands");
  assert.equal(rooms,2);
  assert.equal(next.present.walls.length,7);
  assert.equal(next.present.wallNodes.length,6);
  assert.equal(next.past.length,1);
  assert.deepEqual(undoCommand(next).present.walls,[]);
  assert.deepEqual(redoCommand(undoCommand(next)).present.walls,next.present.walls);
});
test("a deliberately open door is not silently closed when the wall batch is committed",()=>{
  const {next,rooms}=applyReviewedWallProposals(makeHistory(),source,[...perimeter,w(e,p(200,100)),w(p(200,185),f)],"open-door");
  // Studio conservatively does not offer a room face with dangling interior walls.
  assert.equal(rooms,0);
  const result=deriveRoomBoundaries(next.present,floorId);
  assert.equal(result.candidates.length,0);
  assert.equal(result.diagnostics.filter(d=>d.code==="open-endpoint").length,2);
});
test("late invalid geometry rolls back the entire real-domain batch",()=>{
  const before=makeHistory();
  assert.throws(()=>applyReviewedWallProposals(before,source,[perimeter[0],w(a,a)],"reject-bad-batch"));
  assert.deepEqual(before.present.walls,[]);assert.deepEqual(before.past,[]);
});

test("an explicitly marked doorway closes the room without adding any physical wall across it",()=>{
 const wallPieces=[w(a,p(155,0)),w(p(240,0),b),w(b,c),w(c,d),w(d,a)];
 const door={...w(p(155,0),p(240,0)),roomOpening:true};
 const before=makeHistory();
 assert.equal(applyReviewedWallProposals(before,source,wallPieces,"no-door").rooms,0);
 // Marker may be selected before the walls; the command stages it after the jambs.
 const {next,rooms}=applyReviewedWallProposals(before,source,[door,...wallPieces],"with-door");
 assert.equal(rooms,1);
 assert.equal(next.present.walls.filter(w=>w.classification==="physical").length,5);
 assert.equal(next.present.walls.filter(w=>w.boundaryRole==="room-opening").length,1);
 const candidate=deriveRoomBoundaries(next.present,floorId).candidates[0];
 assert(Math.abs(candidate.areaMm2-11_200_000)<0.01);
 const stored=applyCommand(next.present,{type:"room.createFromBoundary",roomId:"verified-room",floorId,
   boundaryKey:candidate.key,name:"QA Room",use:"bedroom",ventilationRole:"supply"});
 const reopened=deserializeProject(serializeProject(stored));
 assert.equal(reopened.schemaVersion,30);
 assert.equal(inspectRoomBoundary(reopened,reopened.rooms[0]).status,"current");
 const doorId=reopened.walls.find(w=>w.boundaryRole==="room-opening").id;
 const changed=applyCommand(reopened,{type:"wall.delete",wallId:doorId,retainAffectedRooms:true});
 assert.equal(changed.rooms[0].boundaryState,"reassignment-required");
 assert.equal(changed.walls.length,5);
 assert.equal(undoCommand(next).present.walls.length,0);
 assert.equal(redoCommand(undoCommand(next)).present.walls.length,6);
});

test("rejects an unsnapped doorway or a doorway that crosses a physical wall atomically",()=>{
 const before=makeHistory();
 const marked={...w(p(100,100),p(200,100)),roomOpening:true};
 assert.throws(()=>applyReviewedWallProposals(before,source,[w(p(0,100),p(100,100)),marked],"missing-jamb"));
 const parts=[w(p(0,100),p(100,100)),w(p(200,100),p(300,100)),w(p(150,80),p(150,140))];
 assert.throws(()=>applyReviewedWallProposals(before,source,[...parts,marked],"crossing-wall"),
  /clear 450–2400 mm gap/);
 assert.deepEqual(before.present.walls,[]);
});

test("the doorway is left out of connected physical deletion and becomes inactive if a jamb moves",()=>{
 const wallPieces=[w(a,p(155,0)),w(p(240,0),b),w(b,c),w(c,d),w(d,a)];
 const door={...w(p(155,0),p(240,0)),roomOpening:true};
 const {next}=applyReviewedWallProposals(makeHistory(),source,[...wallPieces,door],"moving-jamb");
 const marker=next.present.walls.find(w=>w.boundaryRole==="room-opening");
 assert.deepEqual(wallConnectedComponentIds(next.present,marker.id),[marker.id]);
 assert(!wallConnectedComponentIds(next.present,next.present.walls[0].id).includes(marker.id));
 const n=next.present.wallNodes.find(n=>n.id===marker.startNodeId);
 const moved=applyCommand(next.present,{type:"wall.moveNode",nodeId:n.id,xMm:n.positionMm.x,yMm:n.positionMm.y+2000});
 const result=deriveRoomBoundaries(moved,floorId);
 assert.equal(result.candidates.length,0);
 assert(result.diagnostics.some(d=>d.code==="unconfirmed-opening-geometry"));
 assert.equal(next.present.walls.length,6);
});


test("the browser-reproduced Bed 4 corner gap closes with one straight jamb and a perpendicular wall",()=>{
 const x=173, y=224, left=107, top=6;
 const wallPieces=[w(p(7,top),p(x,top)),w(p(7,top),p(7,y)),w(p(x,top),p(x,y)),w(p(7,y),p(left,y))];
 const marker={...w(p(left,y),p(x,y)),roomOpening:true};
 const before=makeHistory(), scaleSource={...source,scale:17.6357581844436};
 assert.equal(applyReviewedWallProposals(before,scaleSource,wallPieces,"corner-open").rooms,0);
 const {next,rooms}=applyReviewedWallProposals(before,scaleSource,[...wallPieces,marker],"corner-marked");
 assert.equal(rooms,1);
 assert.equal(next.present.walls.filter(w=>w.classification==="physical").length,4);
 const face=deriveRoomBoundaries(next.present,floorId).candidates[0];
 const confirmed=applyCommand(next.present,{type:"room.createFromBoundary",floorId,roomId:"corner-room",boundaryKey:face.key,name:"Test Bed 4",use:"bedroom",ventilationRole:"supply"});
 assert.equal(inspectRoomBoundary(deserializeProject(serializeProject(confirmed)),confirmed.rooms[0]).status,"current");
 assert.equal(undoCommand(next).present.walls.length,0);
});

test("two perpendicular wall ends alone cannot mark an arbitrary joining span",()=>{
 const parts=[w(p(100,0),p(100,100)),w(p(205,0),p(205,100))];
 const opening={...w(p(100,100),p(205,100)),roomOpening:true};
 assert.throws(()=>applyReviewedWallProposals(makeHistory(),source,[...parts,opening],"two-corners"),/at least one straight jamb/);
});


test("removing a doorway excludes stale room volume but keeps the supply grille assignment and Undo",()=>{
 const [ja,jb]=[p(155,0),p(240,0)];
 const wallPieces=[w(a,ja),w(jb,b),w(b,c),w(c,d),w(d,a)];
 const {next}=applyReviewedWallProposals(makeHistory(),source,[...wallPieces,{...w(ja,jb),roomOpening:true}],"supply-door");
 const face=deriveRoomBoundaries(next.present,floorId).candidates[0];
 let project=applyCommand(next.present,{type:"room.createFromBoundary",floorId,roomId:"room-with-supply",boundaryKey:face.key,name:"Bed 4 test",use:"bedroom",ventilationRole:"supply"});
 const terminal=createSyntheticComponent("synthetic-supply-terminal",{id:"bed-4-grille",floorId,xMm:1650,yMm:2200});
 project=applyCommand(project,{type:"component.add",component:terminal});
 project=applyCommand(project,{type:"terminal.assignRoom",roomId:"room-with-supply",componentId:terminal.id,portId:terminal.ports[0].id});
 const saved=deserializeProject(serializeProject(project));
 const stored=saved.rooms[0].terminalAssociations;
 assert.equal(stored.length,1);
 assert.equal(roomVolume(saved,saved.rooms[0]).state,"calculated");
 const door=saved.walls.find(w=>w.boundaryRole==="room-opening");
 const history=executeCommand(createCommandHistory(saved),{type:"wall.delete",wallId:door.id,retainAffectedRooms:true});
 assert.equal(history.present.rooms[0].name,"Bed 4 test");
 assert.deepEqual(history.present.rooms[0].terminalAssociations,stored);
 assert.equal(roomVolume(history.present,history.present.rooms[0]).valueM3,null);
 const undone=undoCommand(history).present;
 assert.deepEqual(undone.rooms[0].terminalAssociations,stored);
 assert.equal(inspectRoomBoundary(undone,undone.rooms[0]).status,"current");
});

test("two adjoining bedrooms with independent doorway boundaries stay separate through reopen and deletion",()=>{
 const vertices=[[0,0,800,0],[800,0,800,350],[800,350,0,350],[0,350,0,0],
   [400,0,400,350],[0,220,145,220],[233,220,400,220],[400,220,550,220],[638,220,800,220]];
 const walls=vertices.map(([a,b,c,d])=>w(p(a,b),p(c,d)));
 const left={...w(p(145,220),p(233,220)),roomOpening:true};
 const right={...w(p(550,220),p(638,220)),roomOpening:true};
 const before=makeHistory();
 const near=applyReviewedWallProposals(before,source,[...walls,left],"adjacent-one");
 const next=applyReviewedWallProposals(before,source,[...walls,left,right],"adjacent-both").next;
 const openings=next.present.walls.filter(w=>w.boundaryRole==="room-opening");
 const candidates=deriveRoomBoundaries(next.present,floorId).candidates;
 assert.equal(openings.length,2);
 assert.equal(next.present.walls.filter(w=>w.classification==="physical").length,
   near.next.present.walls.filter(w=>w.classification==="physical").length);
 assert(next.present.walls.filter(w=>w.classification==="physical").every(w=>w.thicknessMm===100));
 const beds=candidates.filter(c=>c.areaMm2>8_799_999&&c.areaMm2<8_800_001);
 assert.equal(beds.length,2);
 const used=bed=>bed.boundary.map(e=>e.wallId).filter(id=>openings.some(w=>w.id===id));
 assert.deepEqual(beds.map(b=>used(b).length),[1,1]);
 assert.notEqual(used(beds[0])[0],used(beds[1])[0]);
 assert.equal(deriveRoomBoundaries(near.next.present,floorId).candidates.filter(c=>Math.abs(c.areaMm2-8_800_000)<1).length,1);
 let live=next.present;
 for(const [i,bed] of beds.entries())live=applyCommand(live,{type:"room.createFromBoundary",floorId,roomId:"qa-bed-"+i,boundaryKey:bed.key,name:"Bedroom "+i,use:"bedroom",ventilationRole:"supply"});
 const reopened=deserializeProject(serializeProject(live));
 const staged=executeCommand(createCommandHistory(reopened),{type:"wall.delete",wallId:used(beds[0])[0],retainAffectedRooms:true});
 const volumes=staged.present.rooms.map(r=>roomVolume(staged.present,r).valueM3);
 assert.equal(volumes[0],null);
 assert(Math.abs(volumes[1]-22)<1e-8);
 const restored=undoCommand(staged).present;
 assert(restored.rooms.every(r=>inspectRoomBoundary(restored,r).status==="current"));
});

test("ordinary saves retain format 29 but current and inactive doorway designs are stored as 30",()=>{
 const before=makeHistory();
 assert.equal(before.present.schemaVersion,30);
 const initialSave=serializeProject(before.present);
 assert.equal(JSON.parse(initialSave).schemaVersion,29);
 assert.deepEqual(deserializeProject(initialSave),before.present);
 const walls=[w(a,p(155,0)),w(p(240,0),b),w(b,c),w(c,d),w(d,a)];
 const withDoor=applyReviewedWallProposals(before,source,[...walls,{...w(p(155,0),p(240,0)),roomOpening:true}],"format-door").next.present;
 assert.equal(JSON.parse(serializeProject(withDoor)).schemaVersion,30);
 const originalOption=withDoor.activeDesignOptionId;
 const switched=applyCommand(withDoor,{type:"designOption.duplicate",id:"option-no-door",name:"Blank alternate",copyScopes:[]});
 assert.equal(switched.walls.length,0);
 assert.equal(JSON.parse(serializeProject(switched)).schemaVersion,30);
 const reopened=deserializeProject(serializeProject(switched));
 const recovered=applyCommand(reopened,{type:"designOption.switch",optionId:originalOption});
 assert.equal(recovered.walls.filter(w=>w.boundaryRole==="room-opening").length,1);
});
