import assert from "node:assert/strict";
import test from "node:test";
import { rigidRoutePoint, updateMechanicalPointer, createMechanicalInteractionState, activateMechanicalTool, handleMechanicalCanvasClick } from "../src/editor/mechanical-controller.mjs";

test("EPP pointer and free intermediate points follow 45 degree increments without affecting other ducts",()=>{
  const state = {...createMechanicalInteractionState(),tool:"route",ductKind:"epp-rigid-dn160",routeDraft:{points:[{x:0,y:0}]}};
  const horizontal = rigidRoutePoint(state,{x:1000,y:100});
  assert.ok(Math.abs(horizontal.y)<1e-6);
  const diagonal = rigidRoutePoint(state,{x:1000,y:800});
  assert.ok(Math.abs(diagonal.x-diagonal.y)<1e-6);
  assert.deepEqual(updateMechanicalPointer(state,{x:1000,y:800}).pointer,diagonal);
  assert.deepEqual(rigidRoutePoint({...state,ductKind:"semi-rigid-radial"},{x:1000,y:800}),{x:1000,y:800});
  assert.deepEqual(state.routeDraft.points,[{x:0,y:0}]);
});


test("HRV ceiling elbow frees the first plan direction while ordinary port starts remain inline",()=>{
 for(const ceilingElbow of [false,true]) {
  const initial=activateMechanicalTool(createMechanicalInteractionState(),"route",{ductKind:"epp-rigid-dn160"});
  const {state}=handleMechanicalCanvasClick(initial,{point:{x:0,y:0},hit:{kind:"port",componentId:"unit",portId:"intake",system:"mvhr",stream:"intake",role:"Outdoor intake",interface:{family:"rigid-epp",nominalSizeMm:160},direction:{x:-1,y:0,z:0},ceilingElbow}});
  const pointer=updateMechanicalPointer(state,{x:1000,y:-1000}).pointer;
  if(ceilingElbow) {assert.ok(Math.abs(pointer.x-1000)<1e-6);assert.ok(Math.abs(pointer.y+1000)<1e-6);}
  else assert.deepEqual(pointer,{x:0,y:0});
 }
});
