import test from 'node:test';
import assert from 'node:assert/strict';
import { createAirflowPages, renderAirflowSheetSvg } from '../src/sheets/airflow-sheet.mjs';
const sheet={ metadata:{projectName:'Test <house>',drawingId:'V1',revision:'A',status:'Working draft'},printScene:{floorName:'Ground'},airflowReport:{lines:[],totals:{},record:{details:{}}}};
test('airflow pages paginate without truncation and omit decentralised scope',()=>{
 assert.deepEqual(createAirflowPages({...sheet,airflowReport:null}),[]);
 const large={...sheet,airflowReport:{...sheet.airflowReport,lines:Array.from({length:40},(_,i)=>({id:String(i),name:`Room ${i}`,ventilationRole:'supply',designLps:10,measuredLps:null}))}};
 const pages=createAirflowPages(large,{firstPageNumber:5,totalPageCount:8});
 assert.deepEqual(pages.map(p=>p.rows.length),[18,18,4]);
 assert.equal(pages[2].pageNumber,7);
 const svg=renderAirflowSheetSvg(large,pages[0]);
 assert.match(svg,/Test &lt;house&gt;/);assert.match(svg,/Not set/);assert.match(svg,/Page 5 of 8/);
});
test('live design airflows never display site readings, delta, settings or site metadata',()=>{
 const s={...sheet,airflowReport:{...sheet.airflowReport,record:{details:{engineer:'SITE ENGINEER'}},lines:[{name:'Bedroom',ventilationRole:'supply',requiredLps:10,designLps:12,terminalIds:['t1'],measuredLps:987.6,deltaLps:975.6,designChanged:true,measurement:{setting:'SECRET SITE SETTING'}}]}};
 const svg=renderAirflowSheetSvg(s,createAirflowPages(s)[0]);
 assert.match(svg,/LIVE DESIGN AIRFLOWS/);assert.match(svg,/>36.0</);assert.match(svg,/>43.2</);
 assert.doesNotMatch(svg,/MEASURED|DIFF\.|SETTING|987.6|975.6|SITE ENGINEER|SECRET SITE SETTING|Design changed since measurement/);
});

test('airflow output bounds metadata and identifies room totals and omissions',()=>{
 const s=structuredClone(sheet);
 s.metadata.drawingId='W'.repeat(4000);
 s.airflowReport.record.details={engineer:'E'.repeat(4000),date:'D'.repeat(4000)};
 s.airflowReport.unassignedTerminals=[{id:'unassigned'}];
 const svg=renderAirflowSheetSvg(s,createAirflowPages(s)[0]);
 assert.doesNotMatch(svg,/W{101}|E{66}|D{25}/);
 assert.match(svg,/Normal mode/);
 assert.match(svg,/Room totals include all terminals; no per-terminal allocation/);
 assert.match(svg,/Incomplete: 1 unassigned terminal/);
});

test('detached room design output warns without exposing historical measurements',()=>{
 const s={...sheet,airflowReport:{...sheet.airflowReport,lines:[{name:'Bedroom',ventilationRole:'supply',boundaryNeedsReassignment:true,designLps:null,measuredLps:11,deltaLps:null,designChanged:true,measurement:{setting:'Normal'}}]}};
 const svg=renderAirflowSheetSvg(s,createAirflowPages(s)[0]);
 assert.match(svg,/Boundary needs reassignment; excluded from totals/);
 assert.doesNotMatch(svg,/>11.0</);
 assert.doesNotMatch(svg,/Design changed since measurement/);
});

test('detached boundary warning has no duplicate SVG fill attribute',()=>{
 const s={...sheet,airflowReport:{...sheet.airflowReport,lines:[{name:'Pending room',ventilationRole:'supply',designLps:null,requiredLps:null,boundaryNeedsReassignment:true}]}};
 const svg=renderAirflowSheetSvg(s,createAirflowPages(s)[0]);
 for(const tag of svg.matchAll(/<text\b[^>]*>/g))assert.equal((tag[0].match(/\sfill=/g)||[]).length,1);
});


test('design rows and totals display m³/h without changing canonical L/s or filling unknowns',()=>{
 const s={...sheet,airflowReport:{...sheet.airflowReport,lines:[{name:'Room',ventilationRole:'supply',requiredLps:12.5,designLps:20,terminalIds:[]}],totals:{supply:{designLps:20,incompleteDesign:false},extract:{designLps:null,incompleteDesign:true}}}};
 const before=structuredClone(s),svg=renderAirflowSheetSvg(s,createAirflowPages(s)[0]);
 assert.match(svg,/All flows in m³\/h/);assert.match(svg,/>45.0</);assert.match(svg,/>72.0</);
 assert.match(svg,/Supply: design 72.0 m³\/h/);assert.match(svg,/Extract: design Not set \(partial\) m³\/h/);
 assert.doesNotMatch(svg,/L\/s/);assert.deepEqual(s,before);
 s.airflowReport.totals.extract={designLps:0,incompleteDesign:false};
 assert.match(renderAirflowSheetSvg(s,createAirflowPages(s)[0]),/Extract: design 0.0 m³\/h/);
});

test('design export distinguishes allocated totals, missing data and conflicting targets',()=>{
 for(const [extra,pattern] of [
  [{designSource:'explicit-terminal-allocations',designLps:15},/complete allocated outlet total, not a room target/],
  [{designSource:'unresolved',designLps:null},/No assigned target or complete normal-mode outlet allocation/],
  [{designSource:'assigned-room-target',designLps:20,allocationDisagrees:true},/Assigned target differs from outlet allocation/]
 ]){
 const s={...sheet,airflowReport:{...sheet.airflowReport,lines:[{name:'Bedroom',ventilationRole:'supply',...extra}]}};
 assert.match(renderAirflowSheetSvg(s,createAirflowPages(s)[0]),pattern);
 }
});
