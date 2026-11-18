import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommissioningPages, renderCommissioningSheetSvg } from '../src/sheets/commissioning-sheet.mjs';
import {createProject,applyCommand,identityQuaternion,knownMm} from '../src/domain/spatial.mjs';
import {createA3SheetModel} from '../src/sheets/a3-sheet.mjs';
import {createSheetOutputDocument,selectSheetOutputPages} from '../src/sheets/sheet-output.mjs';
const sheet={metadata:{projectName:'Site <house>',drawingId:'V1',revision:'A',status:'Working draft'},printScene:{floorName:'Ground'},airflowReport:{lines:[],totals:{},record:{details:{},measurements:{}}}};
function recorded(){return {...sheet,airflowReport:{...sheet.airflowReport,lines:[{id:'room',name:'Bedroom',ventilationRole:'supply',requiredLps:10,designLps:12,measuredLps:0,deltaLps:-12,designChanged:true,measurement:{setting:'<setting>'}}]}};}
test('commissioning records retain measured zero, current design comparison and stale warning',()=>{
 const s=recorded(),svg=renderCommissioningSheetSvg(s,createCommissioningPages(s)[0]);
 assert.match(svg,/COMMISSIONING \/ SITE RECORD/);assert.match(svg,/DESIGN NOW/);assert.match(svg,/>0.0</);assert.match(svg,/>-43.2</);assert.match(svg,/Design changed since measurement/);assert.match(svg,/&lt;setting&gt;/);
});
test('only floor-relevant measurements or nonempty option details produce commissioning pages',()=>{
 assert.deepEqual(createCommissioningPages(sheet),[]);
 assert.deepEqual(createCommissioningPages({...sheet,airflowReport:null}),[]);
 const other={...sheet,airflowReport:{...sheet.airflowReport,record:{details:{engineer:'  '},measurements:{'other-floor-room':{measuredLps:42}}}}};
 assert.deepEqual(createCommissioningPages(other),[]);
 const details={...sheet,airflowReport:{...sheet.airflowReport,record:{details:{engineer:'Site engineer'}}}};
 assert.equal(createCommissioningPages(details).length,1);
 assert.match(renderCommissioningSheetSvg(details,createCommissioningPages(details)[0]),/Site engineer/);
});
test('blank design and measurements stay unknown; detached site evidence is marked excluded',()=>{
 const s=recorded();Object.assign(s.airflowReport.lines[0],{designLps:null,measuredLps:11,deltaLps:null,boundaryNeedsReassignment:true});
 s.airflowReport.totals={supply:{designLps:null,measuredLps:null,incompleteDesign:true,incompleteMeasured:true}};
 const svg=renderCommissioningSheetSvg(s,createCommissioningPages(s)[0]);
 assert.match(svg,/Boundary needs reassignment; excluded from totals/);assert.match(svg,/>39.6</);assert.match(svg,/design Not set/);assert.match(svg,/measured Not recorded/);assert.doesNotMatch(svg,/Design changed since measurement/);
});
test('commissioning pagination and mixed-floor global numbering preserve separate design and site pages',()=>{
 const p=applyCommand(createProject('split-export'),{type:'floor.add',floor:{id:'ground',name:'Ground',transform:{translationMm:{x:0,y:0,z:knownMm(0,'test')},orientation:identityQuaternion()}}});
 const model=createA3SheetModel(p,{floorId:'ground',orientation:'landscape',includeSchedule:false,projectName:'Split export',drawingTitle:'Review',drawingId:'V1',revision:'A',revisionText:'Review',status:'Preliminary — not for construction',issueDate:'2026-11-18'});
 const active=recorded().airflowReport;
 active.lines=Array.from({length:40},(_,i)=>({...active.lines[0],id:`room-${i}`,name:`Room ${i}`}));
 const pages=createCommissioningPages({...model,airflowReport:active},{firstPageNumber:7,totalPageCount:20});
 assert.deepEqual(pages.map(page=>page.rows.length),[18,18,4]);assert.equal(pages[2].pageNumber,9);
 const other={...model,airflowReport:{...active,lines:[],record:{details:{},measurements:{'room-1':{measuredLps:99}}}}};
 const output=createSheetOutputDocument([{...model,airflowReport:active},other]);
 assert.equal(output.filter(page=>page.kind==='commissioning').length,3);
 assert.equal(output.filter(page=>page.kind==='airflows').length,0);
 for(const [i,page]of output.entries()){assert.equal(page.pageNumber,i+1);assert.match(page.svg,new RegExp(`Page ${i+1} of ${output.length}`));}
 const selected=selectSheetOutputPages(output,output.flatMap((page,index)=>page.kind==='commissioning'?[index]:[]));
 assert.deepEqual(selected.map(page=>page.commissioningPageNumber),[1,2,3]);assert.match(selected[2].svg,/Page 3 of 3/);
});

test('warning SVG text has no duplicate attributes and stays parseable for PDF export',()=>{
 const s=recorded();
 for(const detached of [false,true]){
 s.airflowReport.lines[0].boundaryNeedsReassignment=detached;
 const svg=renderCommissioningSheetSvg(s,createCommissioningPages(s)[0]);
 for(const tag of svg.matchAll(/<text\b[^>]*>/g))assert.equal((tag[0].match(/\sfill=/g)||[]).length,1);
 }
});


test('site rows, signed differences and totals display m³/h without mutating recorded L/s',()=>{
 const s=recorded();Object.assign(s.airflowReport.lines[0],{designLps:10,measuredLps:12.5,deltaLps:2.5});
 s.airflowReport.totals={supply:{designLps:10,measuredLps:12.5,incompleteDesign:false,incompleteMeasured:false},extract:{designLps:null,measuredLps:0,incompleteDesign:true,incompleteMeasured:false}};
 const before=structuredClone(s),svg=renderCommissioningSheetSvg(s,createCommissioningPages(s)[0]);
 assert.match(svg,/All flows in m³\/h/);assert.match(svg,/>36.0</);assert.match(svg,/>45.0</);assert.match(svg,/>\+9.0</);
 assert.match(svg,/Supply: design 36.0 · measured 45.0 m³\/h/);
 assert.match(svg,/Extract: design Not set \(partial\) · measured 0.0 m³\/h/);
 assert.doesNotMatch(svg,/L\/s/);assert.deepEqual(s,before);
});
