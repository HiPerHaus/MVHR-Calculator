import {deserializeProject} from '../domain/spatial.mjs';
const FORMAT='hiper-working-session-v1';
export function workingContextKey(context){
 if(context?.userId&&context?.workspaceId)return `account:${context.userId}:${context.workspaceId}`;
 if(context?.userId||context?.workspaceId)throw new TypeError('A signed-in recovery needs a workspace');
 return 'device-local';
}
export function workingTabId(storage,uuid=()=>crypto.randomUUID()){
 try{let id=storage.getItem('hiper-working-tab-v1');if(!id){id=uuid();storage.setItem('hiper-working-tab-v1',id);}return id;}catch{return uuid();}
}
export function validateWorkingSession(value,context){
 if(!value||value.format!==FORMAT||value.contextKey!==workingContextKey(context))throw new TypeError('Working drawing belongs to another account');
 if(typeof value.dirty!=="boolean")throw new TypeError("Invalid recovery save state");
 const project=deserializeProject(value.projectJson);
 if(typeof value.name!=='string'||!value.name.trim()||value.name.length>120)throw new TypeError('Invalid working drawing name');
 const r=value.cloudRecord;
 if(r&&(!context.userId||r.workspace_id!==context.workspaceId||r.project_id!==project.id||typeof r.id!=='string'||!Number.isInteger(r.save_version)||r.save_version<1))throw new TypeError('Invalid cloud recovery binding');
 if(!['project','plan','ventilation','three-d','catalogue','checks','account','sheets','airflows','as-built'].includes(value.task))throw new TypeError('Invalid recovery view');
 if(value.designStage!==undefined&&!['plan','draw','place','route','check','export'].includes(value.designStage))throw new TypeError('Invalid recovery design stage');
 if(value.ventilationWorkspace!==undefined&&!['centralised','decentralised','combined'].includes(value.ventilationWorkspace))throw new TypeError('Invalid recovery ventilation workspace');
 const camera=value.camera;
 if(!camera||!['x','y','width','height'].every(k=>Number.isFinite(camera[k]))||camera.width<=0||camera.height<=0)throw new TypeError('Invalid recovery camera');
 return {...value,project};
}
export function createWorkingSessionStore(indexedDB,{tabId}={}){
 let database,tail=Promise.resolve(),queuedWrite=null;
 const open=()=>database??=new Promise((resolve,reject)=>{
  if(!indexedDB)return reject(new Error('Browser drawing recovery is unavailable'));
  const request=indexedDB.open('hiper-studio-working-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('drawings');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>{database=null;reject(request.error);};
 });
 async function access(mode,action){const db=await open();return new Promise((resolve,reject)=>{
  const tx=db.transaction('drawings',mode),store=tx.objectStore('drawings');let result;
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error??new Error('Drawing recovery failed'));tx.onabort=()=>reject(tx.error??new Error('Drawing recovery aborted'));
  try{action(store,value=>{result=value;});}catch(error){try{tx.abort();}catch{}reject(error);}
 });}
 const keys=context=>{const key=workingContextKey(context);return [`${key}:tab:${tabId}`,`${key}:last`];};
 return {
  read(context){
   // Reads are ordering barriers too: a later write must neither replace the
   // snapshot being read nor overtake the read transaction.
   queuedWrite=null;const binding={...context},[tab,last]=keys(binding);
   const pending=tail.then(()=>access('readonly',(store,done)=>{const request=store.get(tab);request.onsuccess=()=>{if(request.result){done(request.result);return;}const fallback=store.get(last);fallback.onsuccess=()=>done(fallback.result??null);};})).then(value=>value?validateWorkingSession(value,binding):null);
   tail=pending;return pending;
  },
  // Recovery snapshots carry the whole project JSON (including embedded plans).
  // A write that has not started yet is replaced by the newest snapshot, so a
  // burst of zoom/pan/edit events produces at most one in-flight and one queued
  // write instead of one multi-megabyte write per event.
  write(context,snapshot){
   const contextKey=workingContextKey(context),value={...structuredClone({...snapshot,projectJson:null}),projectJson:snapshot.projectJson,format:FORMAT,contextKey};const names=keys(context),namesKey=names.join('\n');
   if(queuedWrite&&queuedWrite.namesKey===namesKey){queuedWrite.value=value;return queuedWrite.promise;}
   const entry={namesKey,value};
   entry.promise=tail.catch(()=>{}).then(()=>{if(queuedWrite===entry)queuedWrite=null;return access('readwrite',store=>{for(const key of names)store.put(entry.value,key);});});
   queuedWrite=entry;tail=entry.promise;return entry.promise;
  },
  clear(context){queuedWrite=null;const names=keys(context);const pending=tail.catch(()=>{}).then(()=>access('readwrite',store=>{for(const key of names)store.delete(key);}));tail=pending;return pending;},
  flush(){queuedWrite=null;return tail;},
 };
}
