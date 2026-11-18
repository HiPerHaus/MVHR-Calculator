import test from 'node:test';
import assert from 'node:assert/strict';
import {createSnapshotMemo,createTrailingViewTask} from '../src/editor/view-performance.mjs';
test('unchanged snapshots reuse computation; edits and undo/redo snapshots get correct values',()=>{
 let calls=0;const read=createSnapshotMemo(p=>{calls++;return JSON.stringify(p);});
 const a={value:1},b={value:2};assert.equal(read(a),read(a));assert.equal(calls,1);
 assert.equal(read(b),'{"value":2}');assert.equal(read(a),'{"value":1}');assert.equal(calls,2);
 assert.equal(read({...a}),'{"value":1}');assert.equal(calls,3);
});
test('view bursts save only latest view after settling; lifecycle flush saves pending work once',()=>{
 let seq=0,runs=0;const timers=new Map();const task=createTrailingViewTask(()=>runs++,{schedule:fn=>{timers.set(++seq,fn);return seq;},cancel:id=>timers.delete(id)});
 for(let i=0;i<100;i++)task.schedule();assert.equal(timers.size,1);assert.equal(runs,0);
 task.flush();assert.equal(timers.size,0);assert.equal(runs,1);task.flush();assert.equal(runs,1);
 task.schedule();const fn=[...timers.values()][0];timers.clear();fn();assert.equal(runs,2);task.flush();assert.equal(runs,2);
});
