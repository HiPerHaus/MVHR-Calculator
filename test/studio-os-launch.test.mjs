import test from "node:test";
import assert from "node:assert/strict";
import { readOsLaunch, osProjectIdentity, matchesOsProject, openOrCreateOsProject } from "../app/studio-os-launch.mjs";
const designId="ad02853b-45d8-4f6d-9539-1a5c88a91603";
const workspaceId="36c94aff-20aa-4bd8-81df-ae550facafea";
const other="f87c06cc-36dc-4ee8-9fb4-607de83b7296";
const launch={search:`?osDesign=${designId}`,hash:"#"+new URLSearchParams({osReference:"Lockleys · Design Rev 2",quoteNumber:"Q-2026-0042",drawingRevision:"2"}),referrer:"https://app.hiper-os.au/",hasOpener:true};
test("HiPer OS launch keeps quote number and revision distinct",()=>{
  assert.deepEqual(readOsLaunch(launch),{designId,name:"Lockleys",quoteNumber:"Q-2026-0042",revision:"2"});
  const noQuote=readOsLaunch({...launch,hash:"#drawingRevision=1"});
  assert.equal(noQuote.quoteNumber,"");assert.equal(noQuote.revision,"1");
  for(const change of [{referrer:"https://app.hiper-os.au.example.org/"},{referrer:""},{hasOpener:false},{search:"?osDesign=garbage"},{hash:"#drawingRevision=0"}])
    assert.equal(readOsLaunch({...launch,...change}),null);
  assert.equal(readOsLaunch({...launch,hash:"#drawingRevision=1&quoteNumber=%0DInjected"}).quoteNumber,"");
});
test("the cloud target is deterministic and unique to the workspace and OS revision",async()=>{
  const x=await osProjectIdentity(workspaceId,designId);
  assert.deepEqual(x,await osProjectIdentity(workspaceId.toUpperCase(),designId.toUpperCase()));
  assert.notEqual(x.recordId,(await osProjectIdentity(other,designId)).recordId);
  assert.notEqual(x.recordId,(await osProjectIdentity(workspaceId,other)).recordId);
  assert.match(x.recordId,/^[a-f0-9-]{36}$/u);
});
function fixture(identity){
 const records=new Map(),models=new Map();
 records.set(other,{id:other,workspace_id:workspaceId,project_id:"pocket-house",name:"Pocket House"});
 models.set("pocket-house",{id:"pocket-house",preserved:true});
 let saves=0;
 const store={
  async find(w,id){const r=records.get(id);return r?.workspace_id===w?r:null;},
  async open(record){return {project:models.get(record.project_id),record,name:record.name};},
  async save({project,name,workspaceId,newRecordId}){
   saves++;
   if(records.has(newRecordId))throw new Error("Conflict");
   const record={id:newRecordId,workspace_id:workspaceId,project_id:project.id,name,save_version:1};
   records.set(newRecordId,record);models.set(project.id,project);return {record};
  }
 };
 const input={store,workspaceId,userId:"fixture-user",identity,name:"Lockleys",makeProject:id=>({id,quoteNumber:"Q-2026-0042"})};
 return {input,models,records,store,saves:()=>saves};
}
test("launch creates a clean project even when Pocket House is latest, and opens it on a repeat",async()=>{
 const identity=await osProjectIdentity(workspaceId,designId);
 const f=fixture(identity);
 const first=await openOrCreateOsProject(f.input);
 const again=await openOrCreateOsProject(f.input);
 assert.equal(first.created,true);assert.equal(again.created,false);
 assert.equal(first.project.quoteNumber,"Q-2026-0042");assert.equal(again.record.id,first.record.id);
 assert.deepEqual(f.models.get("pocket-house"),{id:"pocket-house",preserved:true});
 assert.equal(f.saves(),1);
 assert.equal(matchesOsProject(await f.store.open(f.records.get(other)),identity,workspaceId),false);
});
test("two simultaneous launches reuse a single winning insert",async()=>{
 const identity=await osProjectIdentity(workspaceId,designId),f=fixture(identity);
 const results=await Promise.all([openOrCreateOsProject(f.input),openOrCreateOsProject(f.input)]);
 assert.equal(results.filter(r=>r.created).length,1);
 assert.equal(f.records.size,2);assert.equal(results[0].record.id,results[1].record.id);
});
test("a stale or mismatched cloud record fails closed",async()=>{
 const identity=await osProjectIdentity(workspaceId,designId),f=fixture(identity);
 f.records.set(identity.recordId,{...f.records.get(other),id:identity.recordId});
 await assert.rejects(()=>openOrCreateOsProject(f.input),/identity did not match/);
 assert.equal(f.saves(),0);
});
test("an uncertain successful first save resolves by exact identity rather than making a copy",async()=>{
 const identity=await osProjectIdentity(workspaceId,designId),f=fixture(identity);
 const save=f.store.save;
 f.store.save=async args=>{await save(args);throw new Error("Lost response")};
 const opened=await openOrCreateOsProject(f.input);
 assert.equal(opened.record.id,identity.recordId);assert.equal(f.records.size,2);assert.equal(f.saves(),1);
});
