import test from 'node:test';
import assert from 'node:assert/strict';
import {createAirflowProposalPages,renderAirflowProposalSheetSvg} from '../src/sheets/airflow-proposal-sheet.mjs';
import {createA3SheetModel} from '../src/sheets/a3-sheet.mjs';
import {createDesignOptionOutput} from '../src/sheets/design-option-output.mjs';
import {applyCommand,createProject,identityQuaternion,knownMm,serializeProject} from '../src/domain/spatial.mjs';
const report={optionId:'option-1',status:'incomplete',settings:{basis:'max',volumeSource:'actual-geometry',personRateM3h:30,ach:0.35,lowFactor:0.75,boostFactor:1.25},candidatesM3h:{occupancy:120,volume:null,extract:80},volumeM3:null,normalM3h:null,lowM3h:null,boostM3h:null,governingBasis:[],lines:[{id:'ground-room',floorId:'ground',name:'GROUND ONLY',ventilationRole:'supply',weight:0.125,weightSource:'explicit-supply-weight',assignedExistingM3h:36,normalM3h:null,lowM3h:null,boostM3h:null,missing:['Current boundary required']},{id:'upper-room',floorId:'upper',name:'UPPER ONLY',ventilationRole:'extract',weight:40,weightSource:'extract reference',normalM3h:null,lowM3h:null,boostM3h:null}],issues:['Volume missing'],assumptions:['Not a certified PHPP result','Supply weight is a Studio heuristic'],method:'test-provisional-v1',sourceUrls:['https://example.test/source']};
const sheet={metadata:{floorId:'ground',systemScope:'centralised',projectName:'Test & house'},printScene:{floorName:'Ground'},airflowProposal:report,airflowProposalLines:[report.lines[0]],airflowProposalScope:{floorId:'ground',optionId:'option-1',optionName:'Option A'}};
const plain=svg=>svg.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
test('chart-only exports retain provisional scope and unknowns while checks stay in report data',()=>{
 const before=structuredClone(sheet),pages=createAirflowProposalPages(sheet),svg=pages.map(page=>renderAirflowProposalSheetSvg(sheet,page)).join(''),text=plain(svg);
 assert.equal(pages.length,1);assert.ok(pages.every(page=>page.section==='outlet-chart'));
 assert.match(text,/UNAPPROVED/);assert.match(text,/CAPACITY NOT VERIFIED/);assert.match(text,/Option: Option A/);assert.match(text,/ID option-1/);assert.match(text,/THIS FLOOR ONLY/);
 assert.match(text,/Low Unknown · Normal Unknown · Boost Unknown/);assert.match(text,/Profile: legacy-studio-v1 · Basis: max/);
 assert.match(text,/GROUND ONLY/);assert.doesNotMatch(text,/UPPER ONLY|Volume missing|Current boundary required|example.test|METHOD REFERENCES|METHOD \/ ASSUMPTIONS|Existing assigned design|evidence continuation/);
 assert.doesNotMatch(text,/normal 0.0/);assert.deepEqual(sheet,before);
});
test('long schedules paginate every room without detailed assumption or source pages',()=>{
 const lines=Array.from({length:45},(_,i)=>({...report.lines[0],id:`r-${i}`,name:`Room ${i}`,normalM3h:i,lowM3h:i*.7,boostM3h:i*1.3,missing:[]}));
 const s={...sheet,airflowProposal:{...report,status:'provisional',normalM3h:120,lowM3h:84,boostM3h:156,lines,assumptions:['FINAL ASSUMPTION']},airflowProposalLines:lines};
 const pages=createAirflowProposalPages(s,{firstPageNumber:4,totalPageCount:30});assert.equal(pages.length,3);
 const output=pages.map(page=>renderAirflowProposalSheetSvg(s,page));
 for(let i=0;i<45;i++)assert.match(output.join(''),new RegExp(`data-space-id="r-${i}"`));
 assert.doesNotMatch(output.join(''),/FINAL ASSUMPTION|METHOD REFERENCES|example.test/);assert.match(output[0],/>0.0</);
 pages.forEach((page,index)=>{assert.equal(page.pageNumber,index+4);assert.equal(page.section,'outlet-chart');assert.ok(page.rows.reduce((sum,row)=>sum+row.rowHeight,0)<=128);assert.match(output[index],new RegExp(`Page ${index+4} of 30`));});
});
test('decentralised and not-applicable proposals are not exported',()=>{
 assert.deepEqual(createAirflowProposalPages({...sheet,metadata:{...sheet.metadata,systemScope:'decentralised'}}),[]);
 assert.deepEqual(createAirflowProposalPages({...sheet,airflowProposal:{...report,status:'not-applicable'}}),[]);
 assert.deepEqual(createAirflowProposalPages({...sheet,airflowProposal:null}),[]);
});
function fixture(){let p=createProject('proposal-sheet');for(const [id,z]of [['ground',0],['upper',3000]])p=applyCommand(p,{type:'floor.add',floor:{id,name:id,transform:{translationMm:{x:0,y:0,z:knownMm(z,'test')},orientation:identityQuaternion()}}});return p;}
const metadata=(floorId,airflowProposal)=>({floorId,airflowProposal,orientation:'landscape',includeSchedule:false,projectName:'Proposal',drawingTitle:'Review',drawingId:'V1',revision:'A',revisionText:'Review',status:'Preliminary — not for construction',issueDate:'2026-11-18'});
test('A3 model uses whole-option report while filtering floor rows without changing project data',()=>{
 const p=fixture(),before=serializeProject(p);const ground=createA3SheetModel(p,metadata('ground',report)),upper=createA3SheetModel(p,metadata('upper',report));
 assert.equal(ground.airflowProposal,report);assert.equal(upper.airflowProposal,report);
 assert.deepEqual(ground.airflowProposalLines.map(row=>row.id),['ground-room']);assert.deepEqual(upper.airflowProposalLines.map(row=>row.id),['upper-room']);assert.equal(serializeProject(p),before);
 const decentralised=createA3SheetModel(p,{...metadata('ground',report),systemScope:'decentralised'});assert.equal(decentralised.airflowProposal,null);
});
test('all floors receive one shared proposal per option with unique paginated output identities',()=>{
 let p=fixture();p=applyCommand(p,{type:'designOption.duplicate',id:'alternative',name:'Alternative',revision:'B',copyScopes:['plan'],activate:true});
 const seen=new Map();const result=createDesignOptionOutput(p,{optionId:null,systemScope:'centralised',createSheet:(project,option,{floorId,airflowProposal})=>{const previous=seen.get(option.id);if(previous)assert.equal(airflowProposal,previous);else seen.set(option.id,airflowProposal);return createA3SheetModel(project,metadata(floorId,airflowProposal));}});
 assert.equal(seen.size,2);const proposals=result.pages.filter(page=>page.kind==='airflow-proposal');assert.ok(proposals.length>=4);assert.equal(new Set(result.pages.map(page=>page.pageKey)).size,result.pages.length);
 for(const [index,page]of result.pages.entries())assert.match(page.svg,new RegExp(`Page ${index+1} of ${result.pages.length}`));
});

test('PHPP profile export distinguishes maximum comparison from standard normal and Studio room allocation',()=>{
 const r={...report,settings:{...report.settings,profile:'phpp-9.6a-standard-v1',basis:'max',volumeSource:'phpp-reference',personRateM3h:30,ach:.3,lowFactor:.7,boostFactor:1.3},maximumCandidatesM3h:{occupancy:120,extract:160,volume:164.956},normalM3h:126.890,lowM3h:88.823,boostM3h:164.956};
 const s={...sheet,airflowProposal:r};const text=plain(createAirflowProposalPages(s).map(p=>renderAirflowProposalSheetSvg(s,p)).join(''));
 assert.match(text,/phpp-9.6a-standard-v1/);assert.doesNotMatch(text,/maximum = max|Maximum-duty candidates/);
 assert.match(text,/Basic 88.8 · Normal 126.9 · Maximum 165.0/);assert.match(text,/Studio heuristic, not certified PHPP allocation/);
});

test('outlet charts show geometric room area, separate streams and repeated table headers',()=>{
 const longName='LONG ROOM NAME '+ 'continuation '.repeat(14);
 const rows=Array.from({length:33},(_,i)=>({...report.lines[0],id:`chart-${i}`,name:i===0?longName:`Chart room ${i}`,ventilationRole:i<17?'supply':'extract',areaM2:i===1?null:16+i,weight:999,normalM3h:i===1?null:10,lowM3h:i===1?null:7,boostM3h:i===1?null:13,missing:[]}));
 rows.push({...rows[0],id:'transfer-room',name:'Transfer only',ventilationRole:'transfer',areaM2:12,normalM3h:9999,lowM3h:9999,boostM3h:9999});
 const s={...sheet,airflowProposal:{...report,settings:{...report.settings,profile:'phpp-9.6a-standard-v1'},lines:rows,normalM3h:170,lowM3h:119,boostM3h:221},airflowProposalLines:rows};
 const pages=createAirflowProposalPages(s),charts=pages.filter(page=>page.section==='outlet-chart');
 assert.equal(charts.length,3);assert.equal(charts.reduce((sum,page)=>sum+page.rows.length,0),34);
 for(const page of charts){
  const svg=renderAirflowProposalSheetSvg(s,page),text=plain(svg);
  for(const header of ['ROOM / ZONE','TYPE','m²','BASIC','NORMAL','MAXIMUM'])assert.ok(text.includes(header));
  assert.match(text,/wall-reference area/);assert.match(text,/not verified net area or PHPP TFA/);
  assert.match(text,/This floor supply normal: 160.0 m³\/h \(partial\)/);assert.match(text,/This floor extract normal: 160.0 m³\/h/);
  assert.match(text,/separate streams, not additive/);assert.doesNotMatch(text,/9999.0/);
  assert.ok(page.rows.reduce((sum,row)=>sum+row.rowHeight,0)+107<=235);
 }
 const first=renderAirflowProposalSheetSvg(s,charts[0]);assert.match(first,/>16.0</);assert.match(first,/>Unknown</);assert.doesNotMatch(first,/>999.0</);
 const last=renderAirflowProposalSheetSvg(s,charts.at(-1));assert.match(last,/Transfer only/);assert.match(last,/>—</);
 const full=plain(pages.map(page=>renderAirflowProposalSheetSvg(s,page)).join(''));
 assert.ok(full.includes(longName.trim()));assert.doesNotMatch(full,/Existing assigned design|METHOD \/ ASSUMPTIONS \/ LIMITATIONS/);
});
