import test from 'node:test';
import assert from 'node:assert/strict';
import {hitWallDraftPoint,inspectWallDraftAppend} from '../src/editor/wall-draft-input.mjs';
const points=[{x:0,y:0,nodeId:'a'},{x:1000,y:0,nodeId:'b'},{x:1000,y:1000,nodeId:'c'}];
test('direct draft marker hit acquires exact point without zoom/radius or competing endpoints',()=>{
 const hit=hitWallDraftPoint(points,'a');assert.deepEqual(hit,{...points[0],snapKind:'endpoint'});
 assert.equal(hitWallDraftPoint(points,'missing'),null);assert.equal(inspectWallDraftAppend(points,hit,'unused').closesLoop,true);
});
test('closing point uses original identity and never duplicates its pending wall split',()=>{
 const original=[{...points[0],split:{wallId:'existing'}},...points.slice(1)];
 const closed=inspectWallDraftAppend(original,{x:0,y:0,nodeId:'alias'},'new');
 assert.equal(closed.point.nodeId,'a');assert.equal(closed.point.split,null);assert.equal(closed.closesLoop,true);
 assert.deepEqual(original[0].split,{wallId:'existing'});
});
test('zero-length hits are rejected, open chains and two-point return stay explicit',()=>{
 assert.equal(inspectWallDraftAppend(points,{x:1000,y:1000,nodeId:'other'},'new').duplicate,true);
 assert.equal(inspectWallDraftAppend(points.slice(0,2),points[0],'new').closesLoop,false);
 const next=inspectWallDraftAppend(points,{x:0,y:1000,nodeId:null},'d');assert.equal(next.closesLoop,false);assert.equal(next.point.nodeId,'d');
});
