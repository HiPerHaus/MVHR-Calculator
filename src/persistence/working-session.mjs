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
 if(!['project','plan','ventilation','three-d','catalogue','checks','account','sheets'].includes(value.task))throw new TypeError('Invalid recovery view');
 const camera=value.camera;
 if(!camera||!['x','y','width','height'].every(k=>Number.isFinite(camera[k]))||camera.width<=0||camera.height<=0)throw new TypeError('Invalid recovery camera');
 return {...value,project};
}
export function createWorkingSessionStore(indexedDB,{tabId}={}){
 let database,tail=Promise.resolve();
 const open=()=>database??=new Promise((resolve,reject)=>{
  if(!indexedDB)return reject(new Error('Browser drawing recovery is unavailable'));
  const request=indexedDB.open('hiper-studio-working-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('drawings');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>{database=null;reject(request.error);};
 });
 async function access(mode,action){const db=await open();return new Promise((resolve,reject)=>{
  const tx=db.transaction('drawings',mode),store=tx.objectStore('drawings');let result;
  action(store,value=>{result=value;});tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error??new Error('Drawing recovery failed'));tx.onabort=()=>reject(tx.error??new Error('Drawing recovery aborted'));
 });}
 const keys=context=>{const key=workingContextKey(context);return [`${key}:tab:${tabId}`,`${key}:last`];};
 return {
  async read(context){await tail;const [tab,last]=keys(context);const value=await access('readonly',(store,done)=>{const request=store.get(tab);request.onsuccess=()=>{if(request.result){done(request.result);return;}const fallback=store.get(last);fallback.onsuccess=()=>done(fallback.result??null);};});return value?validateWorkingSession(value,context):null;},
  write(context,snapshot){const contextKey=workingContextKey(context),value={...snapshot,format:FORMAT,contextKey};const names=keys(context);const pending=tail.catch(()=>{}).then(()=>access('readwrite',store=>{for(const key of names)store.put(value,key);}));tail=pending;return pending;},
  clear(context){const names=keys(context);const pending=tail.catch(()=>{}).then(()=>access('readwrite',store=>{for(const key of names)store.delete(key);}));tail=pending;return pending;},
  flush(){return tail;},
 };
}
