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
import {createEngineeringNetworkDraft} from '../src/editor/engineering-network-draft.mjs';
import {buildCommissioningReport} from '../src/editor/commissioning-report.mjs';
import {createA3SheetModel} from '../src/sheets/a3-sheet.mjs';
import {createSheetOutputPages} from '../src/sheets/sheet-output.mjs';
function terminal(p,id,role,roomId,x){
 const component=createSyntheticComponent(role==='supply'?'synthetic-supply-terminal':'synthetic-extract-terminal',{id,floorId:'ground',xMm:x,yMm:2000});
 p=applyCommand(p,{type:'component.add',component});
 return applyCommand(p,{type:'terminal.assignRoom',roomId,componentId:id,portId:component.ports[0].id});
}
test('reviewed proposal feeds live schedule/export and explicit single-terminal engineering draft',()=>{
 let p=terminal(terminal(fixture(),'supply-1','supply','ground-supply',2000),'extract-1','extract','ground-extract',7000);
 p=applyCommand(p,{type:'commissioning.recordMeasurement',spaceId:'ground-supply',measuredLps:11,recordedAt:'2026-11-18'});
 const originalReadings=structuredClone(p.commissioning);
 const review=reviewAirflowProposal(p,{scope:'floor',floorId:'ground',mode:'fill-unset'});
 p=applyCommand(p,{type:'airflowProposal.apply',optionId:p.activeDesignOptionId,expectedFingerprint:review.fingerprint,...review.selection});
 assert.deepEqual(p.commissioning,originalReadings);
 const report=buildCommissioningReport(p,'ground');assert.ok(Math.abs(report.totals.supply.designLps*3.6-150)<1e-9);
 const line=report.lines.find(l=>l.id==='ground-supply');assert.equal(line.measuredLps,11);assert.equal(line.designChanged,true);
 const sheet=createA3SheetModel(p,{floorId:'ground',orientation:'landscape',includeSchedule:false,projectName:'Proposal integration',issueDate:'2026-11-18',drawingTitle:'Ventilation',drawingId:'V01',status:'Preliminary — not for construction',revision:'A',revisionText:'Test'});
 assert.ok(Math.abs(sheet.airflowReport.lines.find(l=>l.id==='ground-supply').designLps*3.6-150)<1e-9);
 assert.equal(createSheetOutputPages(sheet).some(page=>page.kind==='airflows'),false);
 const draft=createEngineeringNetworkDraft(p,'ground');
 assert.equal(draft.unresolved.length,0);assert.equal(draft.design.terminalAllocations.length,2);
 for(const allocation of draft.design.terminalAllocations){assert.equal(allocation.inputUnit,'m3/h');assert.equal(allocation.inputValue,150);}
 assert.deepEqual(p.engineeringInputs.networkDesigns,[],'draft generation does not save engineering inputs');
 p=terminal(p,'supply-2','supply','ground-supply',2500);
 const multiple=createEngineeringNetworkDraft(p,'ground');
 assert.ok(multiple.unresolved.some(item=>item.spaceId==='ground-supply'&&item.code==='allocation-required'));
 assert.equal(multiple.design.terminalAllocations.filter(a=>a.spaceId==='ground-supply').length,0);
});

test('reviewed PHPP normal, not design maximum, feeds assigned schedule and engineering draft',()=>{
 let p=terminal(terminal(fixture(),'supply-1','supply','ground-supply',2000),'extract-1','extract','ground-extract',7000);
 p=applyCommand(p,{type:'ventilation.setReference',reference:{tfaM2:169.186135,occupants:4,source:'PHPP9.6a workbook test'}});
 p=settings(p,{profile:'phpp-9.6a-standard-v1',extractRatesM3h:{'ground-extract':160}});
 const proposal=buildAirflowProposal(p),review=reviewAirflowProposal(p,{scope:'floor',floorId:'ground',mode:'fill-unset'});
 p=applyCommand(p,{type:'airflowProposal.apply',optionId:p.activeDesignOptionId,expectedFingerprint:review.fingerprint,...review.selection});
 const normal=169.186135*2.5*.3;
 assert.ok(Math.abs(proposal.normalM3h-normal)<1e-8);assert.ok(Math.abs(proposal.boostM3h-normal*1.3)<1e-8);
 assert.ok(Math.abs(buildCommissioningReport(p,'ground').totals.supply.designLps*3.6-normal)<1e-8);
 const draft=createEngineeringNetworkDraft(p,'ground');for(const allocation of draft.design.terminalAllocations)assert.ok(Math.abs(allocation.inputValue-normal)<1e-8);
 const sheet=createA3SheetModel(p,{floorId:'ground',orientation:'landscape',includeSchedule:false,projectName:'PHPP integration',issueDate:'2026-11-18',drawingTitle:'Ventilation',drawingId:'V01',status:'Preliminary — not for construction',revision:'A',revisionText:'Test'});
 const pages=createSheetOutputPages(sheet);assert.equal(pages.some(page=>page.kind==='airflows'),false);
 assert.match(pages.filter(page=>page.kind==='airflow-proposal').map(page=>page.svg).join(''),/maximum 165.0/);
});
