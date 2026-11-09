import test from 'node:test';
import assert from 'node:assert/strict';
import {createFramePreviewScheduler} from '../src/editor/frame-preview.mjs';
import {pickRoutesAtClientPoint,cycleRoutePick} from '../src/editor/route-picker.mjs';
test('pointer bursts coalesce; cancellation prevents stale frames and scheduler can restart',()=>{
 const frames=new Map();let id=0,draws=0;
 const scheduler=createFramePreviewScheduler(()=>draws++,{request:cb=>{frames.set(++id,cb);return id;},cancel:id=>frames.delete(id)});
 for(let i=0;i<100;i++)scheduler.schedule();assert.equal(frames.size,1);
 const run=()=>{const [id,cb]=frames.entries().next().value;frames.delete(id);cb();};
 run();assert.equal(draws,1);scheduler.schedule();scheduler.cancel();assert.equal(frames.size,0);assert.equal(draws,1);
 scheduler.schedule();run();assert.equal(draws,2);
});
test('overlap picker returns all candidates and cycles without mutating geometry',()=>{
 const routes=['one','two','three'].map(id=>({id,points:[{x:0,y:100},{x:1000,y:100}]}));
 const original=structuredClone(routes),point={x:50,y:10};
 const hits=pickRoutesAtClientPoint(routes,{x:0,y:0,width:100,height:100},{left:0,top:0,width:100,height:100},point);
 assert.deepEqual(hits.map(hit=>hit.routeId),['one','two','three']);let cycle=null;
 for(const expected of ['one','two','three','one']){const result=cycleRoutePick(hits,point,cycle);assert.equal(result.routeId,expected);cycle=result.cycle;}
 assert.equal(cycleRoutePick(hits,{x:60,y:10},cycle).routeId,'one');assert.equal(cycleRoutePick([],point,cycle).routeId,null);assert.deepEqual(routes,original);
});

test('zoomed twin overlaps can be picked on either drawn lane',()=>{
 const routes=['one','two'].map(id=>({id,points:[{x:0,y:0},{x:1000,y:0}]}));
 for (const y of [-72,72]) {
  const hits=pickRoutesAtClientPoint(routes,{x:0,y:-10,width:100,height:20},{left:0,top:0,width:1000,height:200},{x:500,y:y+100},{pathsForRoute:()=>[-72,72].map(y=>[{x:0,y},{x:1000,y}])});
  assert.deepEqual(hits.map(hit=>hit.routeId),['one','two']);
 }
});
