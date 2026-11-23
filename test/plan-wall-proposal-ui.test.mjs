import {test} from "node:test";
import assert from "node:assert/strict";
import {mountPlanWallProposal} from "../app/plan-wall-proposal.mjs";
test("preview handles delayed image close, visibility toggle, pointer cancel and stale apply without writing",async()=>{
  class Node {
    constructor(tag){this.tag=tag;this.children=[];this.style={};this.clientWidth=1000;this.clientHeight=600;this.isConnected=true;}
    append(...nodes){for(const n of nodes)if(typeof n==="object")n.parent=this;this.children.push(...nodes);}
    after(node){this.parent.append(node);}
    setAttribute(){}
    getBoundingClientRect(){return {left:0,top:0,width:this.width,height:this.height};}
    setPointerCapture(){}
    scrollIntoView(){}
    showModal(){}
    close(){this.onclose();}
    remove(){this.parent.children=this.parent.children.filter(n=>n!==this);this.isConnected=false;}
    getContext(){
      return new Proxy({}, {get:(_,key)=>key==="getImageData"?()=>{
        const width=this.width,height=this.height,data=new Uint8ClampedArray(width*height*4).fill(255);
        for(const [top,bottom] of [[14,19],[44,49]]) for(let y=top;y<bottom;y++)for(let x=20;x<90;x++)data.set([0,0,0],(y*width+x)*4);
        return {width,height,data};
      }:()=>{},set:()=>true});
    }
  }
  const names=["document","Image","ResizeObserver","requestAnimationFrame","cancelAnimationFrame"], prior=names.map(k=>globalThis[k]);
  try {
    const body=new Node("body"), host=new Node("anchor");body.append(host);
    globalThis.document={body,createElement:tag=>new Node(tag),createTextNode:text=>text};
    let deferredDecode;
    globalThis.Image=class {naturalWidth=120;naturalHeight=80;async decode(){if(deferredDecode)await deferredDecode;}};
    globalThis.ResizeObserver=class {observe(){}disconnect(){}};
    let frame;
    globalThis.requestAnimationFrame=fn=>{frame=fn;return 1;};
    globalThis.cancelAnimationFrame=()=>{frame=null;};
    const snapshot={scale:20,outline:[{x:0,y:0},{x:120,y:0},{x:120,y:80},{x:0,y:80}],existing:[],dataUrl:"fixture"};
    const calls=[];
    let stale=false;
    mountPlanWallProposal(host,()=>snapshot,(s,w)=>{
      if(stale)throw new Error("The floor or plan changed. Reopen the preview before adding walls.");
      calls.push([s,w]);
    });
    const find=(node,pred)=>pred(node)?node:node.children?.map(n=>find(n,pred)).find(Boolean);
    const open=find(body,n=>n.textContent==="Propose walls from plan");
    // Closing while the image loads must not resurrect the dialog or write.
    let finishDecode;
    deferredDecode=new Promise(resolve=>{finishDecode=resolve;});
    const pending=open.onclick();
    find(body,n=>n.textContent==="Close without adding").onclick();
    finishDecode();await pending;deferredDecode=null;
    assert(!find(body,n=>n.tag==="dialog"));
    assert.deepEqual(calls,[]);

    await open.onclick();
    assert.equal(find(body,n=>n.textContent==="Add selected walls").disabled,true);
    const hide=find(body,n=>n.textContent?.startsWith("Hide less certain"));
    assert(hide);
    hide.onclick();
    assert(find(body,n=>n.textContent?.startsWith("Show less certain")));
    hide.onclick();
    find(body,n=>n.textContent==="Close without adding").onclick();
    assert.equal(calls.length,0);

    await open.onclick();
    const canvas=find(body,n=>n.tag==="canvas");
    const pointer=(x,y,id=1)=>({clientX:x,clientY:y,pointerId:id,button:0});
    canvas.onpointerdown(pointer(52,16)); // canvas selection, not a write
    canvas.onpointerdown(pointer(20,16));
    canvas.onpointermove(pointer(30,24));
    assert.equal(typeof frame,"function");
    frame();
    canvas.onpointercancel(pointer(30,24));
    const check=find(body,n=>n.type==="checkbox");check.checked=true;check.onchange();
    const add=find(body,n=>n.textContent==="Add selected walls");assert.equal(add.disabled,false);
    stale=true;add.onclick();
    assert.equal(calls.length,0);
    assert(find(body,n=>n.textContent==="The floor or plan changed. Reopen the preview before adding walls."));
    stale=false;
    add.onclick();add.onclick();
    assert.equal(calls.length,1);assert.equal(calls[0][0],snapshot);
    assert.equal(calls[0][1].length,1);
    assert.deepEqual(calls[0][1][0],{a:{x:20,y:16},b:{x:90,y:16},thicknessMm:100});
    assert(!find(body,n=>n.tag==="dialog"));
  } finally {
    names.forEach((key,i)=>{if(prior[i]===undefined)delete globalThis[key];else globalThis[key]=prior[i];});
  }
});
