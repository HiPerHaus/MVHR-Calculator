import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand,createProject,identityQuaternion,knownMm,unknownMm,serializeProject,deserializeProject} from '../src/domain/spatial.mjs';
import {createCommandHistory,executeCommand,undoCommand,redoCommand} from '../src/domain/history.mjs';
import {deriveRoomBoundaries,inspectRoomBoundary} from '../src/domain/rooms.mjs';
import {createWallMidpointCommand} from '../src/editor/wall-bend-point.mjs';
function fixture(){
 let p=applyCommand(createProject('bend-qa'),{type:'floor.add',floor:{id:'ground',name:'Ground',transform:{translationMm:{x:0,y:0,z:knownMm(0,'test')},orientation:identityQuaternion()}}});
 p=applyCommand(p,{type:'wall.addChain',floorId:'ground',nodeIds:['node-a','node-b','node-c','node-d','node-a'],wallIds:['wall-ab','wall-bc','wall-cd','wall-da'],points:[[0,0],[6000,0],[6000,4000],[0,4000],[0,0]].map(([x,y])=>({x,y,z:unknownMm('not measured')})),splits:[],thicknessMm:140,heightMm:unknownMm('not measured'),referenceLine:'centreline',classification:'physical'});
 return applyCommand(p,{type:'room.createFromBoundary',roomId:'room',floorId:'ground',boundaryKey:deriveRoomBoundaries(p,'ground').candidates[0].key,name:'Living',use:'living',ventilationRole:'supply'});
}
test('wall midpoint can bend while preserving identities, room enclosure, undo/redo and persistence',()=>{
 const p=fixture();let h=createCommandHistory(p);
 h=executeCommand(h,createWallMidpointCommand(p,'wall-ab',{newNodeId:'bend',newWallId:'bend-b'}));
 assert.equal(h.present.walls.length,5);assert.equal(h.present.rooms[0].boundary.length,5);
 assert.equal(h.present.walls.find(w=>w.id==='wall-ab').endNodeId,'bend');
 h=executeCommand(h,{type:'wall.moveNode',nodeId:'bend',xMm:3000,yMm:-1000});
 assert.equal(h.present.rooms[0].id,'room');assert.equal(inspectRoomBoundary(h.present,h.present.rooms[0]).status,'current');
 assert.equal(deriveRoomBoundaries(h.present,'ground').candidates.length,1);
 assert.equal(h.present.wallNodes.find(n=>n.id==='node-a').positionMm.x,0);
 assert.equal(h.present.walls.find(w=>w.id==='bend-b').thicknessMm,140);
 const restored=deserializeProject(serializeProject(h.present));assert.equal(inspectRoomBoundary(restored,restored.rooms[0]).status,'current');
 const undone=undoCommand(h);assert.equal(undone.present.wallNodes.find(n=>n.id==='bend').positionMm.y,0);
 assert.deepEqual(redoCommand(undone).present,h.present);
 assert.deepEqual(undoCommand(undone).present,p);
});
test('repeat insertion works and hosted items block unsafe split without alteration',()=>{
 let p=fixture();p=applyCommand(p,createWallMidpointCommand(p,'wall-ab',{newNodeId:'bend',newWallId:'bend-b'}));
 p=applyCommand(p,createWallMidpointCommand(p,'wall-ab',{newNodeId:'bend2',newWallId:'bend2-b'}));assert.equal(p.rooms[0].boundary.length,6);
 p=applyCommand(p,{type:'component.add',component:{id:'hosted-opening-placeholder',floorId:'ground',positionMm:{x:4500,y:0,z:unknownMm('test')},orientation:identityQuaternion(),ports:[],hostWallId:'bend-b'}});
 const before=serializeProject(p);
 assert.throws(()=>applyCommand(p,createWallMidpointCommand(p,'bend-b',{newNodeId:'unsafe',newWallId:'unsafe-wall'})),/blocked by dependent references/);
 assert.equal(serializeProject(p),before);
 assert.throws(()=>createWallMidpointCommand(p,'missing',{newNodeId:'n',newWallId:'w'}),/Select a placed wall/);
});
