import {test} from "node:test";
import assert from "node:assert/strict";
import {createCommandHistory,undoCommand,redoCommand} from "../src/domain/history.mjs";
import {applyCommand,createProject,identityQuaternion,knownMm} from "../src/domain/spatial.mjs";
import {deriveRoomBoundaries} from "../src/domain/rooms.mjs";
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
