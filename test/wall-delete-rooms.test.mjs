import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand,createProject,identityQuaternion,knownMm,unknownMm,serializeProject,deserializeProject,inspectWallDeletion,SCHEMA_VERSION} from '../src/domain/spatial.mjs';
import {createCommandHistory,executeCommand,undoCommand,redoCommand} from '../src/domain/history.mjs';
import {deriveRoomBoundaries,inspectRoomBoundary} from '../src/domain/rooms.mjs';
function fixture(){
 let p=applyCommand(createProject('delete-qa'),{type:'floor.add',floor:{id:'ground',name:'Ground',transform:{translationMm:{x:0,y:0,z:knownMm(0,'test')},orientation:identityQuaternion()}}});
 const chain=(nodes,walls,points)=>{p=applyCommand(p,{type:'wall.addChain',floorId:'ground',nodeIds:nodes,wallIds:walls,points:points.map(([x,y])=>({x,y,z:unknownMm('not measured')})),splits:[],thicknessMm:140,heightMm:unknownMm('not measured'),referenceLine:'centreline',classification:'physical'});};
 chain(['id-a','id-b','id-c','id-d','id-a'],['id-ab','id-bc','id-cd','id-da'],[[0,0],[3000,0],[3000,4000],[0,4000],[0,0]]);
 chain(['id-b','id-e','id-f','id-c'],['id-be','id-ef','id-fc'],[[3000,0],[6000,0],[6000,4000],[3000,4000]]);
 for(const [i,candidate] of deriveRoomBoundaries(p,'ground').candidates.entries())p=applyCommand(p,{type:'room.createFromBoundary',roomId:`room-${i}`,floorId:'ground',boundaryKey:candidate.key,name:`Room ${i}`,use:'living',ventilationRole:'supply'});
 return p;
}
test('delete shared wall retains both room records and other walls, invalidates geometry, undo restores all',()=>{
 const p=fixture();assert.equal(inspectWallDeletion(p,['id-bc']).rooms.length,2);
 assert.throws(()=>applyCommand(p,{type:'wall.delete',wallId:'id-bc'}),/dependent references/);
 let h=executeCommand(createCommandHistory(p),{type:'wall.delete',wallId:'id-bc',retainAffectedRooms:true});
 assert.deepEqual(h.present.walls,p.walls.filter(w=>w.id!=='id-bc'));
 assert.equal(h.present.wallNodes.length,p.wallNodes.length);
 for(let i=0;i<2;i++){
  assert.deepEqual(h.present.rooms[i],{...p.rooms[i],boundaryState:'reassignment-required'});
  assert.equal(inspectRoomBoundary(h.present,h.present.rooms[i]).status,'invalid');
 }
 const reopened=deserializeProject(serializeProject(h.present));assert.deepEqual(reopened,h.present);
 assert.deepEqual(undoCommand(h).present,p);assert.deepEqual(redoCommand(undoCommand(h)).present,h.present);
 const face=deriveRoomBoundaries(h.present,'ground').candidates[0];
 const reassigned=applyCommand(h.present,{type:'room.assignBoundary',roomId:'room-0',boundaryKey:face.key});
 assert.equal(inspectRoomBoundary(reassigned,reassigned.rooms[0]).status,'current');
 assert.equal(reassigned.rooms[1].boundaryState,'reassignment-required');
});
test('hosted equipment still blocks explicit room-safe deletion atomically',()=>{
 let p=fixture();p=applyCommand(p,{type:'component.add',component:{id:'hosted',floorId:'ground',positionMm:{x:3000,y:1000,z:unknownMm('test')},orientation:identityQuaternion(),ports:[],hostWallId:'id-bc'}});
 const before=serializeProject(p);assert.throws(()=>applyCommand(p,{type:'wall.delete',wallId:'id-bc',retainAffectedRooms:true}),/components.0.hostWallId/);assert.equal(serializeProject(p),before);
});
test('schema 27 migrates unchanged room geometry to version 28',()=>{
 const old=fixture();old.schemaVersion=27;const next=deserializeProject(JSON.stringify(old));assert.equal(next.schemaVersion,SCHEMA_VERSION);assert.deepEqual(next.rooms,old.rooms);
});
