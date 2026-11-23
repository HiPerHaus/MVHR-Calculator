import {test} from "node:test";
import assert from "node:assert/strict";
import {mountPlanWallProposal} from "../app/plan-wall-proposal.mjs";
test("preview does not write on open or close and applies only explicitly selected walls",async()=>{
  class Node {
    constructor(tag){this.tag=tag;this.children=[];this.style={};this.clientWidth=1000;this.clientHeight=600;this.isConnected=true;}
    append(...nodes){for(const n of nodes)if(typeof n==="object")n.parent=this;this.children.push(...nodes);}
    after(node){this.parent.append(node);}
    setAttribute(){}
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
  const names=["document","Image","ResizeObserver"], prior=names.map(k=>globalThis[k]);
  try {
    const body=new Node("body"), host=new Node("anchor");body.append(host);
    globalThis.document={body,createElement:tag=>new Node(tag),createTextNode:text=>text};
    globalThis.Image=class {naturalWidth=120;naturalHeight=80;async decode(){}};
    globalThis.ResizeObserver=class {observe(){}disconnect(){}};
    const snapshot={scale:20,outline:[{x:0,y:0},{x:120,y:0},{x:120,y:80},{x:0,y:80}],existing:[],dataUrl:"fixture"};
    const calls=[];
    mountPlanWallProposal(host,()=>snapshot,(s,w)=>calls.push([s,w]));
    const find=(node,pred)=>pred(node)?node:node.children?.map(n=>find(n,pred)).find(Boolean);
    const open=find(body,n=>n.textContent==="Propose walls from plan");
    await open.onclick();
    assert.equal(find(body,n=>n.textContent==="Add selected walls").disabled,true);
    find(body,n=>n.textContent==="Close without adding").onclick();
    assert.equal(calls.length,0);
    await open.onclick();
    const check=find(body,n=>n.type==="checkbox");check.checked=true;check.onchange();
    const add=find(body,n=>n.textContent==="Add selected walls");assert.equal(add.disabled,false);
    add.onclick();
    assert.equal(calls.length,1);assert.equal(calls[0][0],snapshot);
    assert.equal(calls[0][1].length,1);
    assert.deepEqual(calls[0][1][0],{a:{x:20,y:16},b:{x:90,y:16},thicknessMm:100});
    assert(!find(body,n=>n.tag==="dialog"));
  } finally {
    names.forEach((key,i)=>{if(prior[i]===undefined)delete globalThis[key];else globalThis[key]=prior[i];});
  }
});
