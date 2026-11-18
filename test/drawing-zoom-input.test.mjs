import test from 'node:test';
import assert from 'node:assert/strict';
import {bindDrawingZoomInput,drawingWheelZoomFactor} from '../src/editor/drawing-zoom-input.mjs';
function fixture(){
 const handlers=new Map(), calls=[];let active=true,pinching=false;
 const canvas={addEventListener:(name,fn,options)=>{assert.equal(options.passive,false);handlers.set(name,fn);},removeEventListener:name=>handlers.delete(name)};
 const dispose=bindDrawingZoomInput(canvas,{enabled:()=>active,touchPinching:()=>pinching,zoom:(...args)=>calls.push(args),fit:()=>calls.push('fit')});
 const fire=(name,values={})=>{const e={target:canvas,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...values};handlers.get(name)?.(e);return e;};
 return {canvas,calls,fire,dispose,handlers,setActive:v=>active=v,setPinching:v=>pinching=v};
}
test('trackpad pinch magnitude is smooth, bounded and symmetric; zero cannot zoom',()=>{
 assert.equal(drawingWheelZoomFactor({deltaY:0,ctrlKey:true}),1);
 assert.equal(drawingWheelZoomFactor({deltaY:NaN}),1);
 const a=drawingWheelZoomFactor({deltaY:2,ctrlKey:true});assert.ok(a>1&&a<1.15);
 assert.ok(Math.abs(a*drawingWheelZoomFactor({deltaY:-2,ctrlKey:true})-1)<1e-12);
 assert.equal(drawingWheelZoomFactor({deltaY:1,deltaMode:1,ctrlKey:true}),Math.exp(.16));
 assert.equal(drawingWheelZoomFactor({deltaY:10000,ctrlKey:true}),Math.exp(.5));
});
test('wheel remains drawing-local and is not consumed while hidden or modal',()=>{
 const f=fixture();assert.equal(f.fire('wheel',{deltaY:-3,ctrlKey:true,clientX:12,clientY:34}).prevented,true);
 assert.deepEqual(f.calls[0][1],{x:12,y:34});f.setActive(false);
 assert.equal(f.fire('wheel',{deltaY:2}).prevented,false);assert.equal(f.calls.length,1);
 f.dispose();assert.equal(f.handlers.size,0);
});
test('Safari gesture scale is incremental, blocks page zoom and avoids duplicate wheel/touch zoom',()=>{
 const f=fixture();assert.equal(f.fire('gesturestart',{scale:1}).prevented,true);
 f.fire('gesturechange',{scale:2});assert.equal(f.calls[0][0],.5);
 f.fire('gesturechange',{scale:4});assert.equal(f.calls[1][0],.5);
 f.fire('wheel',{deltaY:-1,ctrlKey:true});assert.equal(f.calls.length,2);
 f.setPinching(true);f.fire('gesturechange',{scale:5});assert.equal(f.calls.length,2);
 f.fire('gestureend');f.setPinching(false);f.fire('wheel',{deltaY:1});assert.equal(f.calls.length,3);
});
test('keyboard/keypad zoom only when drawing focused; typing and accessibility elsewhere preserved',()=>{
 const f=fixture();for(const key of ['+','=','-']) {const e=f.fire('keydown',{key,metaKey:true});assert.ok(e.prevented&&e.stopped);}
 assert.equal(f.fire('keydown',{key:'0'}).prevented,true);assert.equal(f.calls.at(-1),'fit');
 for(const values of [{key:'+',target:{}},{key:'-',isComposing:true},{key:'+',altKey:true},{key:'a'}]) assert.equal(f.fire('keydown',values).prevented,false);
 f.setActive(false);assert.equal(f.fire('keydown',{key:'+'}).prevented,false);
});
