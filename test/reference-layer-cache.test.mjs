import test from 'node:test';
import assert from 'node:assert/strict';
import {createKeyedReferenceLayer,rasterReferenceDescriptor} from '../src/editor/reference-layer-cache.mjs';
class Node {
  constructor(tag, attrs={}) {this.tag=tag;this.attrs=new Map(Object.entries(attrs).map(([k,v])=>[k,String(v)]));this.children=[];this.parent=null;this.writes=0;this.moves=0;}
  getAttribute(k){return this.attrs.get(k)??null;} hasAttribute(k){return this.attrs.has(k);}
  setAttribute(k,v){this.attrs.set(k,String(v));this.writes++;} removeAttribute(k){this.attrs.delete(k);this.writes++;}
  append(...nodes){for(const node of nodes)this.insertBefore(node,null);}
  insertBefore(node,before){node.remove();const i=before?this.children.indexOf(before):this.children.length;this.children.splice(i,0,node);node.parent=this;this.moves++;}
  remove(){if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}}
  replaceWith(node){const parent=this.parent;if(parent){parent.insertBefore(node,this);this.remove();}}
}
const svg=(tag,attrs)=>new Node(tag,attrs);
const reference={id:'ref-1',opacity:0.8,cropSourceRectPx:{x:10,y:20,width:100,height:200}};
const asset={dataUrl:'data:image/png;base64,test',widthPx:400,heightPx:600};
const descriptor=(r=reference,a=asset,transform='translate(1 2)',editingCrop=false)=>rasterReferenceDescriptor({reference:r,asset:a,transform,editingCrop},svg);
const image=layer=>layer.children[0].children.find(node=>node.tag==='image');
test('unchanged redraws preserve attached raster nodes and perform no URL or DOM writes',()=>{
 const layer=new Node('g'),render=createKeyedReferenceLayer(layer);render([descriptor()]);
 const original=image(layer),writes=original.writes,moves=layer.moves,group=layer.children[0];
 for(let i=0;i<100;i++)render([descriptor({...reference},{...asset})]);
 assert.equal(layer.children[0],group);assert.equal(image(layer),original);assert.equal(original.writes,writes);assert.equal(layer.moves,moves);
});
test('transform, opacity and crop changes preserve image identity and URL',()=>{
 const layer=new Node('g'),render=createKeyedReferenceLayer(layer);render([descriptor()]);const original=image(layer);
 const url=original.getAttribute('href');
 render([descriptor({...reference,opacity:0.5},asset,'translate(9 8)',true)]);
 assert.equal(image(layer),original);assert.equal(original.getAttribute('href'),url);assert.equal(original.getAttribute('clip-path'),null);
 assert.equal(original.getAttribute('opacity'),'0.36');assert.equal(layer.children[0].getAttribute('transform'),'translate(9 8)');
 render([descriptor({...reference,cropSourceRectPx:null})]);assert.equal(image(layer),original);assert.equal(original.getAttribute('clip-path'),null);
 render([descriptor(reference,{...asset,dataUrl:'data:image/png;base64/replacement'})]);assert.equal(image(layer),original);assert.equal(original.getAttribute('href'),'data:image/png;base64/replacement');
});
test('hidden, deleted and off-floor references prune nodes and cache; order remains explicit',()=>{
 const layer=new Node('g'),render=createKeyedReferenceLayer(layer);const a=descriptor(),b=descriptor({...reference,id:'other'});
 render([a,b]);const [first,second]=layer.children;render([b,a]);assert.deepEqual(layer.children,[second,first]);
 render([a]);assert.deepEqual(layer.children,[first]);assert.equal(second.parent,null);
 render([]);assert.equal(first.parent,null);render([a]);assert.notEqual(layer.children[0],first);
 assert.throws(()=>render([a,a]),/Duplicate/);
});
test('CAD-style immutable geometry groups rebuild only when projection or presentation changes',()=>{
 const layer=new Node('g'),render=createKeyedReferenceLayer(layer);let creates=0;
 const desc=signature=>({key:'cad:1',signature,create:()=>{creates++;return new Node('g');}});
 const projection={};render([desc([projection,0.5,false])]);const group=layer.children[0];
 render([desc([projection,0.5,false])]);assert.equal(creates,1);assert.equal(layer.children[0],group);
 render([desc([{},0.5,false])]);assert.equal(creates,2);assert.notEqual(layer.children[0],group);
});
