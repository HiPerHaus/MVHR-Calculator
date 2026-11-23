import {test} from "node:test";
import assert from "node:assert/strict";
import {createCommandHistory,undoCommand,redoCommand} from "../src/domain/history.mjs";
import {applyCommand,createProject,identityQuaternion,knownMm,serializeProject,deserializeProject,wallConnectedComponentIds} from "../src/domain/spatial.mjs";
import {deriveRoomBoundaries,inspectRoomBoundary} from "../src/domain/rooms.mjs";
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
