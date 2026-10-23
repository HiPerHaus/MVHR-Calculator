import assert from 'node:assert/strict';
import test from 'node:test';
import {encodeStorageText,decodeStorageText,createCompactProjectStorage,compactExistingProjectStorage} from '../src/persistence/compact-storage.mjs';
import {createLocalProjectStore} from '../src/persistence/local-project-store.mjs';
import {createProject} from '../src/domain/spatial.mjs';
function memory(limit=Infinity){const m=new Map();return {get length(){return m.size;},key:i=>[...m.keys()][i],getItem:k=>m.get(k)??null,setItem(k,v){const size=[...m].reduce((n,[key,value])=>n+(key===k?0:value.length),0)+v.length;if(size>limit)throw new DOMException('The quota has been exceeded.','QuotaExceededError');m.set(k,v);},removeItem:k=>m.delete(k)};}
test('storage codec is lossless for Unicode, plan data and a saturated dictionary',()=>{
 let seed=71;const random=Array.from({length:180000},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return String.fromCharCode(32+seed%90);}).join('');
 for(const text of ['', 'plain legacy record', JSON.stringify({name:'Drawing 🏡 — café',image:'abc123+/='.repeat(100000)}),random])assert.equal(decodeStorageText(encodeStorageText(text)),text);
 assert.ok(encodeStorageText('repeated drawing data'.repeat(5000)).length<10000);
 assert.throws(()=>decodeStorageText('hiper-lzw-v1:'+String.fromCharCode(60000)));
});
test('existing projects compact without removing records or touching unrelated storage',()=>{
 const storage=memory();const text=JSON.stringify({plan:'plan-data'.repeat(10000)});
 storage.setItem('hiper-studio:test:current',text);storage.setItem('hiper-studio:test:previous',text);storage.setItem('other-app',text);
 compactExistingProjectStorage(storage);assert.equal(storage.length,3);assert.equal(storage.getItem('other-app'),text);
 const adapter=createCompactProjectStorage(storage);assert.equal(adapter.getItem('hiper-studio:test:current'),text);assert.equal(adapter.getItem('hiper-studio:test:previous'),text);
 compactExistingProjectStorage(storage);assert.equal(adapter.getItem('hiper-studio:test:current'),text);
});
test('compression permits journaled saving within a quota that rejects plain records',()=>{
 const project=createProject('quota-test');project.quoteDraft.scopeExclusions=Array.from({length:20},(_,i)=>'Example scope note '.repeat(10)+i);const size=JSON.stringify(project).length;
 const plain=createLocalProjectStore(memory(size*2));assert.equal(plain.save(project).ok,false);
 const storage=memory(size*2),store=createLocalProjectStore(createCompactProjectStorage(storage));
 assert.equal(store.save(project).ok,true);assert.equal(store.save(project).ok,true);assert.deepEqual(store.load(project.id).project,project);
});
