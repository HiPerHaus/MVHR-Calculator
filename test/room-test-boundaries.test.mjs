import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyLabelSuggestions, containsPlanPoint, findRoomMarker, isRoomInsideOutline} from '../app/room-test-boundaries.mjs';
const poly=(...pts)=>pts.map(([x,y])=>({x,y}));
const rectangle=poly([0,0],[100,0],[100,80],[0,80]);
const cutout=poly([0,0],[100,0],[100,80],[60,80],[60,30],[40,30],[40,80],[0,80]);
test('allows shared outline walls and rejects an excluded room',()=>{
  assert(isRoomInsideOutline(poly([0,0],[30,0],[30,30],[0,30]),rectangle));
  assert(!isRoomInsideOutline(poly([101,0],[130,0],[130,30],[101,30]),rectangle));
});
test('rejects edges that cross a garage notch even if all vertices are within the outline',()=>{
  const across=poly([10,10],[90,10],[90,65],[10,65]);
  assert(across.every(p=>containsPlanPoint(cutout,p)));
  assert(!isRoomInsideOutline(across,cutout));
  assert(isRoomInsideOutline(poly([0,0],[40,0],[40,65],[0,65]),cutout));
});
test('marker is inside a concave room',()=>{
  assert(containsPlanPoint(cutout,findRoomMarker(cutout)));
});
test('AI supplies names only; room geometry stays unchanged and missing names require review',()=>{
  const rooms=[{id:1,corners:rectangle},{id:2,corners:cutout}];
  const labels=[{id:1,label:' Bed 1 ',corners:poly([0,0],[1,0],[1,1])}];
  const result=applyLabelSuggestions(rooms,labels);
  assert.equal(result[0].corners,rectangle);
  assert.equal(result[0].label,'Bed 1');
  assert.equal(result[1].label,'');
  assert.equal(rooms[0].label,undefined);
});
test('rejects duplicate and unknown AI identifiers or obsolete server payloads',()=>{
  for(const invalid of [[{id:9,label:'Wrong room'}],[{id:1,label:'A'},{id:1,label:'B'}],undefined]){
    assert.throws(()=>applyLabelSuggestions([{id:1,corners:rectangle}],invalid));
  }
});
