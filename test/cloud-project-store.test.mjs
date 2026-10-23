import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudProjectStore,CloudConflictError} from '../src/persistence/cloud-project-store.mjs';
import {createAuthStorage} from '../src/persistence/auth-storage.mjs';
import {createProject,serializeProject} from '../src/domain/spatial.mjs';
function backend(){
 const rows=new Map(),files=new Map(),removed=[];let failUpload=false,ambiguous=false;
 const client={storage:{from:()=>({async upload(path,file){if(failUpload)return {error:{message:'Upload rejected'}};files.set(path,file);return {data:{path}};},async download(path){return files.has(path)?{data:files.get(path)}:{error:{message:'File missing'}};},async remove(paths){removed.push(...paths);paths.forEach(p=>files.delete(p));return {data:[]};}})},from(){let payload,mode,filters=[];const query={insert(p){payload=p;mode='insert';return query;},update(p){payload=p;mode='update';return query;},eq(k,v){filters.push([k,v]);return query;},select(){return query;},async maybeSingle(){
  const old=rows.get(payload.id);if(mode==='update' && (!old || !filters.every(([k,v])=>old[k]===v)))return {data:null,error:null};
  if(mode==='insert'&&old)return {error:{message:'Duplicate record'}};
  const row={...payload,save_version:(old?.save_version??0)+1,previous_object_path:old?.object_path??null,updated_at:'2026-10-23T00:00:00.000Z'};rows.set(row.id,row);
  if(ambiguous)throw new Error('Network response lost');return {data:structuredClone(row)};
 }};return query;}};
 let n=0;return {store:createCloudProjectStore(client,{uuid:()=>`test-${++n}`}),rows,files,removed,setFailUpload:v=>failUpload=v,setAmbiguous:v=>ambiguous=v};
}
const input=()=>({project:createProject('drawing-one'),name:'First drawing',workspaceId:'workspace-a',userId:'user-a'});
test('cloud file round trip preserves the complete authoritative document',async()=>{
 const b=backend(),args=input();const saved=await b.store.save(args),loaded=await b.store.open(saved.record);
 assert.equal(serializeProject(loaded.project),serializeProject(args.project));assert.equal(loaded.name,args.name);
 assert.ok(saved.record.object_path.startsWith('workspace-a/user-a/'));assert.equal(saved.record.save_version,1);
});
test('two tabs cannot silently overwrite a shared cloud save version',async()=>{
 const b=backend(),args=input();const initial=await b.store.save(args);
 const next=await b.store.save({...args,name:'Tab one',record:initial.record});
 await assert.rejects(()=>b.store.save({...args,name:'Tab two',record:initial.record}),CloudConflictError);
 assert.equal(b.rows.get(initial.record.id).name,'Tab one');assert.equal(next.record.save_version,2);
 assert.equal(b.removed.length,1);assert.ok(b.files.has(next.record.object_path));assert.ok(b.files.has(initial.record.object_path));
});
test('failed uploads and ambiguous acknowledgements never discard the previous cloud file',async()=>{
 const b=backend(),args=input(),initial=await b.store.save(args);b.setFailUpload(true);
 await assert.rejects(()=>b.store.save({...args,record:initial.record}),/Upload rejected/);assert.equal(b.rows.get(initial.record.id).save_version,1);
 b.setFailUpload(false);b.setAmbiguous(true);
 await assert.rejects(()=>b.store.save({...args,record:initial.record}),/Network response lost/);
 assert.equal(b.removed.length,0);assert.ok(b.files.has(b.rows.get(initial.record.id).object_path));assert.ok(b.files.has(initial.record.object_path));
});
test('imported or mismatched cloud identities are rejected before writing',async()=>{
 const b=backend(),args=input(),saved=await b.store.save(args),count=b.files.size;
 await assert.rejects(()=>b.store.save({...args,workspaceId:'workspace-b',record:saved.record}),/identity mismatch/);assert.equal(b.files.size,count);
 b.files.set(saved.record.object_path,new Blob([JSON.stringify({format:'wrong',projectId:args.project.id,projectJson:serializeProject(args.project)})]));
 await assert.rejects(()=>b.store.open(saved.record),/Invalid cloud/);
});
test('full or disabled browser storage does not block an in-memory auth session',async()=>{
 const storage=createAuthStorage(undefined);await storage.setItem('session','synthetic-token');assert.equal(await storage.getItem('session'),'synthetic-token');await storage.removeItem('session');assert.equal(await storage.getItem('session'),null);
});
