import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,serializeProject} from '../src/domain/spatial.mjs';
import {createWorkingSessionStore,workingTabId,workingContextKey,validateWorkingSession} from '../src/persistence/working-session.mjs';
const context={userId:'user-a',workspaceId:'workspace-a'};
function snapshot(name='Current drawing'){return {projectJson:serializeProject(createProject('current-project')),name,dirty:true,cloudRecord:{id:'cloud-a',workspace_id:'workspace-a',project_id:'current-project',save_version:7},task:'ventilation',camera:{x:20,y:40,width:1200,height:800}};}
function indexedDbFixture(onPut=()=>{}){
 const values=new Map();let installed=false;
 const db={createObjectStore(){},transaction(_name,mode){
  const staged=new Map(values);let aborted=false;
  const tx={abort(){aborted=true;},objectStore(){return {
   get(key){const r={};queueMicrotask(()=>{r.result=staged.get(key);r.onsuccess?.();});return r;},
   put(value,key){onPut(value,key);staged.set(key,structuredClone(value));},
   delete(key){staged.delete(key);}
  };}};
  setTimeout(()=>{if(aborted){tx.onabort?.();return;}if(mode==='readwrite'){values.clear();for(const [key,value] of staged)values.set(key,value);}tx.oncomplete?.();},0);
  return tx;
 }};
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

test('Draw workspace and selected system survive recovery without altering mixed project data',async()=>{
 const db=indexedDbFixture(),store=createWorkingSessionStore(db,{tabId:'tab-draw'});
 const source={...snapshot('Mixed drawing'),designStage:'draw',ventilationWorkspace:'decentralised',catalogueGroup:'Decentralised controls'};
 await store.write(context,source);
 const restored=await store.read(context);
 assert.equal(restored.designStage,'draw');assert.equal(restored.ventilationWorkspace,'decentralised');
 assert.equal(restored.catalogueGroup,'Decentralised controls');assert.equal(restored.projectJson,source.projectJson);
 for (const ventilationWorkspace of ['centralised','combined']) {
  await store.write(context,{...source,ventilationWorkspace});
  const choice=await store.read(context);
  assert.equal(choice.ventilationWorkspace,ventilationWorkspace);assert.equal(choice.projectJson,source.projectJson);
 }
 await store.write(context,{...source,ventilationWorkspace:'mixed'});
 await assert.rejects(store.read(context),/Invalid recovery ventilation workspace/);
});

test('a burst of recovery writes stores only the newest queued snapshot',async()=>{
 const puts=[];const db=indexedDbFixture(value=>puts.push(value.name));
 const store=createWorkingSessionStore(db,{tabId:'tab-burst'});
 const writes=[];for(let index=1;index<=20;index++)writes.push(store.write(context,snapshot(`Zoom ${index}`)));
 await Promise.all(writes);
 assert.equal((await store.read(context)).name,'Zoom 20');
 // Each stored snapshot is put under the tab key and the "last" key. None of
 // the twenty writes had started when the next arrived, so only the newest is stored.
 assert.deepEqual(puts,['Zoom 20','Zoom 20']);
});

test('a write that is already in progress is kept and the newest snapshot follows it',async()=>{
 const puts=[];const db=indexedDbFixture(value=>puts.push(value.name));
 const store=createWorkingSessionStore(db,{tabId:'tab-progress'});
 const first=store.write(context,snapshot('First edit'));await first;
 const second=store.write(context,snapshot('Second edit'));await new Promise(resolve=>setTimeout(resolve,0));
 store.write(context,snapshot('Third edit'));store.write(context,snapshot('Fourth edit'));
 await second;await store.flush();
 assert.equal((await store.read(context)).name,'Fourth edit');
 assert.equal(puts.filter(name=>name==='Third edit').length,0);
});

test('a write queued after clear is not merged into a write queued before it',async()=>{
 const db=indexedDbFixture(),store=createWorkingSessionStore(db,{tabId:'tab-clear'});
 store.write(context,snapshot('Before clear'));store.clear(context);
 await store.write(context,snapshot('After clear'));
 assert.equal((await store.read(context)).name,'After clear');
});


test('reads separate coalescing batches and observe call order',async()=>{
 const puts=[],store=createWorkingSessionStore(indexedDbFixture(value=>puts.push(value.name)),{tabId:'read-order'});
 const first=store.write(context,snapshot('Before read'));
 const reading=store.read(context);
 const second=store.write(context,snapshot('After read'));
 await first;assert.equal((await reading).name,'Before read');await second;
 assert.equal((await store.read(context)).name,'After read');
 assert.deepEqual(puts,['Before read','Before read','After read','After read']);
});

test('cross-context writes are ordered and cannot coalesce into another account',async()=>{
 const puts=[],store=createWorkingSessionStore(indexedDbFixture((value,key)=>puts.push([value.name,key])),{tabId:'contexts'});
 const local={userId:null,workspaceId:null};
 const a1=store.write(context,snapshot('Account first'));
 const b=store.write(local,{...snapshot('Local'),cloudRecord:null});
 const a2=store.write(context,snapshot('Account final'));
 await Promise.all([a1,b,a2]);
 assert.equal((await store.read(context)).name,'Account final');
 assert.equal((await store.read(local)).name,'Local');
 assert.deepEqual(puts.map(([name])=>name),['Account first','Account first','Local','Local','Account final','Account final']);
});

test('queued snapshots do not observe later caller mutations and flush is a barrier',async()=>{
 const puts=[],store=createWorkingSessionStore(indexedDbFixture(value=>puts.push(value.name)),{tabId:'immutable'});
 const input=snapshot('Original');const writing=store.write(context,input);
 input.camera.x=999;input.cloudRecord.save_version=99;
 const flushed=store.flush();const reading=store.read(context);
 const next=store.write(context,snapshot('Next'));
 await writing;await flushed;const restored=await reading;
 assert.equal(restored.camera.x,20);assert.equal(restored.cloudRecord.save_version,7);
 await next;assert.deepEqual(puts,['Original','Original','Next','Next']);
});

test('failed write aborts both recovery keys, rejects its coalesced callers and does not poison later writes',async()=>{
 let fail=false;
 const db=indexedDbFixture((_value,key)=>{if(fail&&key.endsWith(':last')){fail=false;throw new Error('Quota failure');}});
 const store=createWorkingSessionStore(db,{tabId:'failure'});
 await store.write(context,snapshot('Last good'));
 fail=true;const one=store.write(context,snapshot('Rejected first')),two=store.write(context,snapshot('Rejected latest'));
 await Promise.all([assert.rejects(one,/Quota failure/),assert.rejects(two,/Quota failure/)]);
 await assert.rejects(store.flush(),/Quota failure/);
 // A separate reader sees neither partially updated tab nor last keys.
 assert.equal((await createWorkingSessionStore(db,{tabId:'failure'}).read(context)).name,'Last good');
 assert.equal((await createWorkingSessionStore(db,{tabId:'new-reader'}).read(context)).name,'Last good');
 await store.write(context,snapshot('Recovered'));
 assert.equal((await store.read(context)).name,'Recovered');
});

test('clear is observable between writes and cannot resurrect the old queued snapshot',async()=>{
 const store=createWorkingSessionStore(indexedDbFixture(),{tabId:'clear-read'});
 const first=store.write(context,snapshot('Before'));const clearing=store.clear(context);const reading=store.read(context);
 const last=store.write(context,snapshot('After'));
 await first;await clearing;assert.equal(await reading,null);await last;
 assert.equal((await store.read(context)).name,'After');
});

test('commissioning view survives working-session recovery',async()=>{
 const db=indexedDbFixture(),store=createWorkingSessionStore(db,{tabId:'commissioning-tab'});
 await store.write(context,{...snapshot(),task:'commissioning'});
 assert.equal((await store.read(context)).task,'commissioning');
});

test('an OS launch can recover in its own tab without replacing the ordinary last drawing',async()=>{
 const db=indexedDbFixture();
 const normal=createWorkingSessionStore(db,{tabId:'regular'});
 const handoff=createWorkingSessionStore(db,{tabId:'from-os',shareLast:false});
 await normal.write(context,snapshot('Pocket House'));
 assert.equal(await handoff.read(context),null);
 await handoff.write(context,snapshot('Lockleys from OS'));
 assert.equal((await createWorkingSessionStore(db,{tabId:'from-os',shareLast:false}).read(context)).name,'Lockleys from OS');
 assert.equal((await createWorkingSessionStore(db,{tabId:'new-regular'}).read(context)).name,'Pocket House');
});
