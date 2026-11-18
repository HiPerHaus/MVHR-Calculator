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
 assert.match(svg,/Test &lt;house&gt;/);assert.match(svg,/Not recorded/);assert.match(svg,/Page 5 of 8/);
});
test('airflow output preserves measured zero and warns on changed design',()=>{
 const s={...sheet,airflowReport:{...sheet.airflowReport,lines:[{name:'Bedroom',ventilationRole:'supply',designLps:12,measuredLps:0,deltaLps:-12,designChanged:true,measurement:{setting:'<setting>'}}]}};
 const svg=renderAirflowSheetSvg(s,createAirflowPages(s)[0]);
 assert.match(svg,/>0.0</);assert.match(svg,/>-12.0</);assert.match(svg,/Design changed since measurement/);assert.match(svg,/&lt;setting&gt;/);
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
