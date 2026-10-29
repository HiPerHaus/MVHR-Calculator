import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,serializeProject} from '../src/domain/spatial.mjs';
import {createWorkingSessionStore,workingTabId,workingContextKey,validateWorkingSession} from '../src/persistence/working-session.mjs';
const context={userId:'user-a',workspaceId:'workspace-a'};
function snapshot(name='Current drawing'){return {projectJson:serializeProject(createProject('current-project')),name,dirty:true,cloudRecord:{id:'cloud-a',workspace_id:'workspace-a',project_id:'current-project',save_version:7},task:'ventilation',camera:{x:20,y:40,width:1200,height:800}};}
function indexedDbFixture(){
 const values=new Map();let installed=false;
 const db={createObjectStore(){},transaction(){const tx={objectStore(){return {get(key){const r={};queueMicrotask(()=>{r.result=values.get(key);r.onsuccess?.();});return r;},put(value,key){values.set(key,structuredClone(value));},delete(key){values.delete(key);}};}};setTimeout(()=>tx.oncomplete?.(),0);return tx;}};
 return {open(){const request={};setTimeout(()=>{request.result=db;if(!installed){installed=true;request.onupgradeneeded?.();}request.onsuccess?.();},0);return request;}};
}
test('refresh restores the working draft, current view, camera and original cloud version',async()=>{
 const db=indexedDbFixture(),first=createWorkingSessionStore(db,{tabId:'tab-a'});
 await first.write(context,snapshot());
 const refreshed=createWorkingSessionStore(db,{tabId:'tab-a'}),restored=await refreshed.read(context);
 assert.equal(restored.project.id,'current-project');assert.equal(restored.dirty,true);assert.equal(restored.cloudRecord.save_version,7);assert.equal(restored.task,'ventilation');assert.equal(restored.camera.x,20);
});
test('tabs keep their own current drawings and a new tab can continue the most recent drawing',async()=>{
 const db=indexedDbFixture(),a=createWorkingSessionStore(db,{tabId:'tab-a'}),b=createWorkingSessionStore(db,{tabId:'tab-b'});
 await a.write(context,snapshot('Drawing A'));await b.write(context,snapshot('Drawing B'));
 assert.equal((await a.read(context)).name,'Drawing A');assert.equal((await b.read(context)).name,'Drawing B');assert.equal((await createWorkingSessionStore(db,{tabId:'new-tab'}).read(context)).name,'Drawing B');
 await a.write(context,snapshot('Latest A'));await a.write(context,snapshot('Newest A'));await a.flush();assert.equal((await a.read(context)).name,'Newest A');
});
test('private recovery cannot be restored signed out, in another account or with a different workspace binding',async()=>{
 const db=indexedDbFixture(),store=createWorkingSessionStore(db,{tabId:'tab-a'});await store.write(context,snapshot());
 assert.equal(await store.read({userId:null,workspaceId:null}),null);assert.equal(await store.read({userId:'user-b',workspaceId:'workspace-b'}),null);
 const stored={...snapshot(),format:'hiper-working-session-v1',contextKey:workingContextKey(context)};
 assert.throws(()=>validateWorkingSession(stored,{userId:'user-b',workspaceId:'workspace-b'}),/another account/);
 assert.throws(()=>validateWorkingSession({...stored,cloudRecord:{...stored.cloudRecord,workspace_id:'other'}},context),/cloud recovery binding/);
 assert.throws(()=>validateWorkingSession({...stored,cloudRecord:{...stored.cloudRecord,project_id:'other'}},context),/cloud recovery binding/);
});
test('tab identity survives refresh, while unavailable recovery reports a failure',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 assert.equal(workingTabId(storage,()=> 'stable-tab'),'stable-tab');assert.equal(workingTabId(storage,()=> 'replacement-tab'),'stable-tab');
 const unavailable=createWorkingSessionStore(null,{tabId:'tab-a'});await assert.rejects(unavailable.write(context,snapshot()),/unavailable/);
});
test('the 3D coordination task survives refresh without becoming project authority',async()=>{
 const db=indexedDbFixture(),store=createWorkingSessionStore(db,{tabId:'tab-3d'});
 await store.write(context,{...snapshot('3D drawing'),task:'three-d'});
 const restored=await store.read(context);
 assert.equal(restored.task,'three-d');assert.equal(restored.project.id,'current-project');assert.equal(restored.dirty,true);
});
test('design stage recovery is optional view state and rejects lifecycle labels',async()=>{
 const db=indexedDbFixture(),store=createWorkingSessionStore(db,{tabId:'tab-stage'});
 await store.write(context,{...snapshot('Route view'),designStage:'route'});
 assert.equal((await store.read(context)).designStage,'route');
 await store.write(context,{...snapshot('Invalid view'),designStage:'detailed-design'});
 await assert.rejects(store.read(context),/Invalid recovery design stage/);
});
