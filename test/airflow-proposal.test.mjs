import {createSyntheticComponent} from '../src/editor/synthetic-catalogue.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAirflowProposal,normalizeAirflowProposalSettings,reviewAirflowProposal} from '../src/domain/airflow-proposal.mjs';
import {createProject,applyCommand,knownMm,unknownMm,identityQuaternion,serializeProject,deserializeProject,airflowTargetFromInput} from '../src/domain/spatial.mjs';
import {deriveRoomBoundaries} from '../src/domain/rooms.mjs';
import {createCommandHistory,executeCommand,undoCommand,redoCommand} from '../src/domain/history.mjs';
function floor(p,id,offset=0){
 p=applyCommand(p,{type:'floor.add',floor:{id,name:id,transform:{translationMm:{x:0,y:0,z:knownMm(offset,'test')},orientation:identityQuaternion()}}});
 for(const [key,x,use,role] of [['supply',0,'bedroom','supply'],['extract',5000,'kitchen','extract']]){
  const prefix=`${id}-${key}`;p=applyCommand(p,{type:'wall.addChain',floorId:id,nodeIds:['a','b','c','d','a'].map(n=>`${prefix}-${n}`),wallIds:['ab','bc','cd','da'].map(n=>`${prefix}-${n}`),points:[[x,0],[x+4000,0],[x+4000,4000],[x,4000],[x,0]].map(([x,y])=>({x,y,z:unknownMm('test')})),splits:[],thicknessMm:140,heightMm:unknownMm('test'),referenceLine:'centreline',classification:'physical'});
  const boundary=deriveRoomBoundaries(p,id).candidates.find(c=>c.centroidMm.x===x+2000);
  p=applyCommand(p,{type:'room.createFromBoundary',roomId:prefix,floorId:id,boundaryKey:boundary.key,name:prefix,use,ventilationRole:role});
 }
 return p;
}
function fixture(){let p=floor(createProject('proposal-project'),'ground');return applyCommand(p,{type:'ventilation.setReference',reference:{tfaM2:200,occupants:4,source:'Synthetic reviewed input'}});}
function settings(p,value){return applyCommand(p,{type:'airflowProposal.setSettings',settings:value});}
test('default proposal governing max, modes, balancing and no saved-authority mutation',()=>{
 const p=fixture(),before=serializeProject(p),r=buildAirflowProposal(p);
 assert.equal(r.status,'provisional');assert.deepEqual(r.candidatesM3h,{occupancy:120,volume:150,extract:60});assert.deepEqual(r.governingBasis,['volume']);
 assert.equal(r.normalM3h,150);assert.equal(r.lowM3h,105);assert.equal(r.boostM3h,195);
 for(const role of ['supply','extract'])assert.equal(r.lines.filter(l=>l.ventilationRole===role).reduce((n,l)=>n+l.normalM3h,0),150);
 assert.equal(serializeProject(p),before);assert.equal(p.rooms[0].airflowTargets.normal.assigned.state,'unresolved');assert.match(r.assumptions.join(' '),/heuristic/);
});
test('all active-option floors share one whole-dwelling total, weighted overrides rebalance',()=>{
 let p=floor(fixture(),'upper',3000);const r=buildAirflowProposal(p);
 assert.equal(r.normalM3h,150);assert.equal(r.lines.filter(l=>l.ventilationRole==='supply').length,2);
 assert.equal(r.lines.find(l=>l.id==='ground-supply').normalM3h,75);
 p=settings(p,{supplyWeights:{'ground-supply':3,'upper-supply':1},extractRatesM3h:{'ground-extract':40,'upper-extract':20}});
 const weighted=buildAirflowProposal(p);assert.equal(weighted.lines.find(l=>l.id==='ground-supply').normalM3h,112.5);assert.equal(weighted.lines.find(l=>l.id==='upper-extract').normalM3h,50);
});
test('single basis and actual geometry are explicit separate choices',()=>{
 const p=fixture();
 assert.equal(buildAirflowProposal(settings(p,{basis:'occupancy'})).normalM3h,120);
 assert.equal(buildAirflowProposal(settings(p,{basis:'extract'})).normalM3h,60);
 const r=buildAirflowProposal(settings(p,{basis:'volume',volumeSource:'actual-geometry'}));
 assert.equal(r.volumeM3,80);assert.equal(r.normalM3h,24);assert.match(r.assumptions.join(' '),/assumed ceiling heights/);
 const taller=applyCommand(p,{type:'floor.setCeiling',floorId:'ground',ceiling:{type:'flat',heightMm:3000}});
 assert.equal(buildAirflowProposal(taller).volumeM3,500);
 assert.equal(buildAirflowProposal(settings(taller,{basis:'volume',volumeSource:'actual-geometry'})).volumeM3,96);
});
test('unknown/stale/ambiguous inputs block rates instead of becoming zero or guessed',()=>{
 let p=fixture();delete p.ventilationReference;assert.equal(buildAirflowProposal(p).normalM3h,null);
 p=fixture();p.rooms[1].use='ensuite';let r=buildAirflowProposal(p);assert.equal(r.status,'incomplete');assert.match(r.issues.join(' '),/explicit reference rate/);
 p=settings(p,{extractRatesM3h:{'ground-extract':40}});assert.equal(buildAirflowProposal(p).status,'provisional');
 p=fixture();p.rooms[0].boundaryState='reassignment-required';assert.equal(buildAirflowProposal(p).normalM3h,null);
 p=fixture();p.rooms[0].ventilationRole='unassigned';assert.equal(buildAirflowProposal(p).normalM3h,null);
 p=applyCommand(fixture(),{type:'floor.setCeiling',floorId:'ground',ceiling:{type:'unknown'}});assert.equal(buildAirflowProposal(settings(p,{volumeSource:'actual-geometry'})).normalM3h,null);
 assert.equal(buildAirflowProposal(applyCommand(fixture(),{type:'project.setVentilationDesignType',ventilationDesignType:'decentralised'})).status,'not-applicable');
});
test('settings persist option-scoped, undoable and never overwrite explicit targets/readings',()=>{
 let p=fixture();const room=p.rooms[0],targets=structuredClone(room.airflowTargets);targets.normal.assigned=airflowTargetFromInput(12,'l/s','Manual','Test');
 p=applyCommand(p,{type:'room.updateMetadata',roomId:room.id,name:room.name,use:room.use,ventilationRole:room.ventilationRole,airflowTargets:targets});
 p=applyCommand(p,{type:'commissioning.recordMeasurement',spaceId:room.id,measuredLps:11,setting:'test',notes:'',recordedAt:'2026-11-18'});
 const original=p.activeDesignOptionId,old=structuredClone(p.commissioning);
 let h=executeCommand(createCommandHistory(p),{type:'airflowProposal.setSettings',settings:{basis:'occupancy'}});
 assert.equal(buildAirflowProposal(undoCommand(h).present).settings.basis,'max');h=redoCommand(undoCommand(h));
 p=deserializeProject(serializeProject(h.present));assert.equal(buildAirflowProposal(p).settings.basis,'occupancy');assert.deepEqual(p.commissioning,old);assert.equal(p.rooms[0].airflowTargets.normal.assigned.valueLps,12);
 assert.equal(buildAirflowProposal(p).lines[0].assignedExistingM3h,43.2);
 p=applyCommand(p,{type:'designOption.duplicate',id:'other',name:'Other',copyScopes:[],activate:true});assert.equal(buildAirflowProposal(p).settings.basis,'max');
 p=applyCommand(p,{type:'designOption.switch',optionId:original});assert.equal(buildAirflowProposal(p).settings.basis,'occupancy');
});
test('invalid settings and prototype keys are rejected',()=>{
 for(const v of [NaN,Infinity,-1,0,1e99])assert.throws(()=>normalizeAirflowProposalSettings({personRateM3h:v}));
 assert.throws(()=>normalizeAirflowProposalSettings({basis:'certified'}));assert.throws(()=>normalizeAirflowProposalSettings({lowFactor:1.1}));assert.throws(()=>normalizeAirflowProposalSettings({boostFactor:.9}));
 assert.throws(()=>normalizeAirflowProposalSettings({supplyWeights:JSON.parse('{"__proto__":1}')}));
 assert.throws(()=>settings(fixture(),{extractRatesM3h:{'ground-extract':-1}}));
});
function applyReview(p,r,extra={}){return applyCommand(p,{type:'airflowProposal.apply',optionId:r.proposal.optionId,expectedFingerprint:r.fingerprint,...r.selection,...extra});}
test('review/apply is atomic assigned-only, floor-scoped and undoable',()=>{
 let p=floor(fixture(),'upper',3000);const target=structuredClone(p.rooms[0].airflowTargets);target.normal.required=airflowTargetFromInput(10,'l/s','Requirement','Test');
 p=applyCommand(p,{type:'room.updateMetadata',roomId:p.rooms[0].id,name:p.rooms[0].name,use:p.rooms[0].use,ventilationRole:'supply',airflowTargets:target});
 p=applyCommand(p,{type:'commissioning.recordMeasurement',spaceId:p.rooms[0].id,measuredLps:9,setting:'test',notes:'',recordedAt:'test'});
 const before=serializeProject(p),record=structuredClone(p.commissioning),r=reviewAirflowProposal(p,{scope:'floor',floorId:'ground'});
 assert.equal(r.changes.length,2);assert.equal(serializeProject(p),before);
 const command={type:'airflowProposal.apply',optionId:r.proposal.optionId,expectedFingerprint:r.fingerprint,...r.selection};
 const h=executeCommand(createCommandHistory(p),command),next=h.present;
 assert.equal(next.rooms.find(r=>r.id==='ground-supply').airflowTargets.normal.assigned.inputValue,75);
 assert.match(next.rooms[0].airflowTargets.normal.assigned.basis,/User-reviewed Studio proposal/);
 assert.equal(next.rooms.find(r=>r.id==='upper-supply').airflowTargets.normal.assigned.state,'unresolved');
 assert.deepEqual(next.rooms[0].airflowTargets.normal.required,target.normal.required);assert.deepEqual(next.commissioning,record);
 assert.equal(serializeProject(undoCommand(h).present),before);assert.deepEqual(redoCommand(undoCommand(h)).present,next);
});
test('fill-unset preserves manual targets, replacement needs explicit confirmation',()=>{
 let p=fixture(),target=structuredClone(p.rooms[0].airflowTargets);target.normal.assigned=airflowTargetFromInput(12,'l/s','Manual','Test');
 p=applyCommand(p,{type:'room.updateMetadata',roomId:p.rooms[0].id,name:p.rooms[0].name,use:p.rooms[0].use,ventilationRole:'supply',airflowTargets:target});
 const r=reviewAirflowProposal(p);assert.deepEqual(r.skippedIds,['ground-supply']);assert.equal(r.changes.length,1);
 const filled=applyReview(p,r);assert.equal(filled.rooms[0].airflowTargets.normal.assigned.valueLps,12);
 const replace=reviewAirflowProposal(filled,{mode:'replace-existing'}),before=serializeProject(filled);
 assert.throws(()=>applyReview(filled,replace),/explicit confirmation/);assert.equal(serializeProject(filled),before);
 assert.equal(applyReview(filled,replace,{confirmReplaceExisting:true}).rooms[0].airflowTargets.normal.assigned.inputValue,150);
});
test('stale proposal, scope/option mismatch and incomplete inputs fail without partial writes',()=>{
 const p=fixture(),r=reviewAirflowProposal(p),before=serializeProject(p);
 assert.throws(()=>applyReview(p,r,{scope:'floor',floorId:'ground'}),/scope changed/);
 assert.throws(()=>applyReview(p,r,{optionId:'wrong-option'}),/option changed/);
 assert.throws(()=>applyReview(settings(p,{basis:'occupancy'}),r),/scope changed/);
 const taller=applyCommand(p,{type:'floor.setCeiling',floorId:'ground',ceiling:{type:'flat',heightMm:2900}});
 assert.throws(()=>applyReview(taller,r),/scope changed/); // Even unchanged PHPP result cannot approve changed source evidence.
 assert.equal(serializeProject(p),before);
 const incomplete=structuredClone(p);incomplete.rooms[1].use='ensuite';const bad=reviewAirflowProposal(incomplete);
 assert.throws(()=>applyReview(incomplete,bad),/complete current proposal/);
 const other=applyCommand(p,{type:'designOption.duplicate',id:'empty-review-option',name:'Other',copyScopes:[],activate:true});assert.throws(()=>applyReview(other,r),/option changed/);
});
test('fill-unset protects explicit Normal terminal allocations and replacement does not alter them',()=>{
 let p=fixture();const component=createSyntheticComponent('synthetic-supply-terminal',{id:'proposal-terminal',floorId:'ground',xMm:2000,yMm:2000});
 p=applyCommand(p,{type:'component.add',component});p=applyCommand(p,{type:'terminal.assignRoom',roomId:'ground-supply',componentId:component.id,portId:component.ports[0].id});
 p=applyCommand(p,{type:'engineering.setNetworkDesign',design:{floorId:'ground',mode:'normal',basis:'Explicit design',source:'Test',sourceVersion:'1',occupancy:{state:'unresolved',persons:null,basis:null,source:null,reason:'Not set'},fluid:{densityKgM3:1.2,dynamicViscosityPaS:.000018,basis:'Test',source:'Test'},terminalAllocations:[{id:'review-allocation',componentId:component.id,portId:component.ports[0].id,spaceKind:'room',spaceId:'ground-supply',inputValue:36,inputUnit:'m3/h',valueLps:10,basis:'Explicit',source:'Test',terminalPressureLoss:{state:'unresolved',valuePa:null,inputValue:null,inputUnit:null,basis:null,source:null,reason:'Not set'}}],routeResistanceInputs:[],componentResistanceInputs:[],fanCurves:[],operatingPointModels:[]}});
 const allocations=structuredClone(p.engineeringInputs),r=reviewAirflowProposal(p);assert.ok(r.skippedIds.includes('ground-supply'));
 let next=applyReview(p,r);assert.equal(next.rooms[0].airflowTargets.normal.assigned.state,'unresolved');assert.deepEqual(next.engineeringInputs,allocations);
 const replace=reviewAirflowProposal(next,{mode:'replace-existing'});assert.equal(replace.changes.find(c=>c.id==='ground-supply').existingAllocationM3h,36);
 next=applyReview(next,replace,{confirmReplaceExisting:true});assert.equal(next.rooms[0].airflowTargets.normal.assigned.inputValue,150);assert.deepEqual(next.engineeringInputs,allocations);
 assert.throws(()=>applyReview(next,reviewAirflowProposal(next)),/No eligible/);
});
