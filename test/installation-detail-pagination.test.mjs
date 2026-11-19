import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand,createProject,identityQuaternion,knownMm} from '../src/domain/spatial.mjs';
import {createConfiguredMvhrComponent} from '../src/editor/mvhr-placement.mjs';
import {createA3SheetModel} from '../src/sheets/a3-sheet.mjs';
import {PLAN_DETAIL_REFERENCES} from '../src/sheets/plan-details.mjs';
import {createInstallationDetailPages,renderInstallationDetailSheetSvg} from '../src/sheets/installation-detail-sheet.mjs';
import {createSheetOutputPages,selectSheetOutputPages} from '../src/sheets/sheet-output.mjs';
import {createDesignOptionOutput} from '../src/sheets/design-option-output.mjs';
const equipment=['q-cw320','q-cw420','af-cw520','af300-remote'];
function project(){return applyCommand(createProject('detail-pagination'),{type:'floor.add',floor:{id:'ground',name:'Ground',transform:{translationMm:{x:0,y:0,z:knownMm(0,'test')},orientation:identityQuaternion()}}});}
function sheetFor(p,orientation='landscape',floorId='ground'){
 const sheet=createA3SheetModel(p,{floorId,orientation,includeSchedule:false,projectName:'Detail pagination',drawingTitle:'Installation reference',drawingId:'V-01',revision:'A',revisionText:'Test',status:'Preliminary — not for construction',issueDate:'2026-11-18'});
 return {...sheet,installationDetails:{...sheet.installationDetails,cards:Object.values(PLAN_DETAIL_REFERENCES).map(card=>({...card})),hasQ:true,hasAeroFresh:true,unmatchedComponentIds:[]}};
}
test('four equipment references paginate three per sheet without overflowing A3 landscape or portrait cards',()=>{
 for(const orientation of ['landscape','portrait']){
  const sheet=sheetFor(project(),orientation),pages=createInstallationDetailPages(sheet,{firstPageNumber:4,totalPageCount:9});
  assert.equal(pages.length,2);const seen=[];
  for(const [index,page] of pages.entries()){
   const svg=renderInstallationDetailSheetSvg(sheet,page);
   assert.match(svg,new RegExp(`Page ${index+4} of 9`));
   assert.match(svg,/INSTALLATION DETAILS · [12] OF 2/);
   assert.match(svg,/data-detail-id="ceiling-tva"/);assert.match(svg,/data-detail-id="wall-housing"/);assert.match(svg,/data-detail-id="insulation-concept"/);
   const ids=[...svg.matchAll(/data-detail-id="([^"]+)"/g)].map(m=>m[1]).filter(id=>equipment.includes(id));
   assert.ok(ids.length<=3);seen.push(...ids);
   for(const match of svg.matchAll(/<g data-kind="installation-detail"[^>]*><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)){
    const [x,y,w,h]=match.slice(1).map(Number);assert.ok(x>=10&&x+w<=sheet.page.widthMm-10+1e-6);assert.ok(y+h<=sheet.page.heightMm-20);
   }
   for(const match of svg.matchAll(/<g data-role="detail-notes">([\s\S]*?)<\/g>/g)){
    const ys=[...match[1].matchAll(/<text x="[^"]+" y="([\d.]+)"/g)].map(m=>Number(m[1]));assert.ok(Math.max(...ys)<sheet.page.heightMm-24,'note baselines remain above footer');
   }
  }
  assert.deepEqual(seen,equipment);
  const combined=pages.map(page=>renderInstallationDetailSheetSvg(sheet,page)).join('').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
  assert.match(combined,/824 W × 566 D × 1414 H/);assert.match(combined,/8 outlets per CW manifold/);
  assert.match(combined,/Dimensions shown are the external dimensions of the unit/);
  assert.equal([...combined.matchAll(/Allow 150 mm below the unit for the trap, 50 mm on each side in cupboards and 200 mm above/g)].length, 2);
  assert.doesNotMatch(combined,/Owner allowances/);assert.match(combined,/09, 17 and 18 Nov 2026/);
 }
});
test('detail pagination offsets airflow and parts pages and selected-page numbering',()=>{
 const sheet=sheetFor(project()),pages=createSheetOutputPages(sheet);
 assert.deepEqual(pages.filter(page=>page.kind!=='airflow-proposal').map(page=>page.kind),['drawing','installation-details','installation-details','parts-list']);
 for(const [index,page]of pages.entries()){assert.equal(page.pageNumber,index+1);assert.match(page.svg,new RegExp(`Page ${index+1} of ${pages.length}`));}
 const selected=selectSheetOutputPages(pages,[2,pages.length-1]);assert.deepEqual(selected.map(page=>page.pageNumber),[1,2]);assert.match(selected[0].svg,/Page 1 of 2/);assert.equal(selected[0].installationPageNumber,2);
});
test('multi-floor multi-option detail pages have unique identities and continuous numbering',()=>{
 let p=project();p=applyCommand(p,{type:'floor.add',floor:{id:'upper',name:'Upper',transform:{translationMm:{x:0,y:0,z:knownMm(3000,'test')},orientation:identityQuaternion()}}});
 for(const floorId of ['ground','upper']) p=applyCommand(p,{type:'component.add',component:createConfiguredMvhrComponent({model:'q350-hrv',mounting:'vertical',handing:'left',layout:'unit-mounted-cw',cwSize:'420'},{id:`original-${floorId}`,floorId,xMm:1000,yMm:1000})});
 p=applyCommand(p,{type:'designOption.duplicate',id:'alternative',name:'Alternative',revision:'B',copyScopes:['plan'],activate:true});
 for(const floorId of ['ground','upper']) p=applyCommand(p,{type:'component.add',component:createConfiguredMvhrComponent({model:'q350-hrv',mounting:'vertical',handing:'left',layout:'unit-mounted-cw',cwSize:'420'},{id:`alternative-${floorId}`,floorId,xMm:1000,yMm:1000})});
 const result=createDesignOptionOutput(p,{optionId:null,createSheet:(project,_option,{floorId})=>sheetFor(project,'landscape',floorId)});
 assert.equal(result.pages.filter(page=>page.kind==='q-series-electrical').length,0);
 assert.equal(result.pages.filter(page=>/data-role="q-electrical-source"/.test(page.svg)).length,4);
 assert.equal(result.entries.length,4);assert.equal(result.pages.filter(page=>page.kind==='installation-details').length,8);
 assert.equal(new Set(result.pages.map(page=>page.pageKey)).size,result.pages.length);
 for(const [index,page]of result.pages.entries()){assert.equal(page.pageNumber,index+1);assert.match(page.svg,new RegExp(`Page ${index+1} of ${result.pages.length}`));}
 for(const option of p.designOptions)for(const floor of p.floors){const details=result.pages.filter(page=>page.optionId===option.id&&page.floorId===floor.id&&page.kind==='installation-details');assert.deepEqual(details.map(page=>page.installationPageNumber),[1,2]);}
});


test('Q electrical source occupies its own Electrical panel, never shrunk into a one-column card',()=>{
 for(const orientation of ['landscape','portrait'])for(const count of [0,1,2,3,4]){
  const base=sheetFor(project(),orientation);
  const sheet={...base,installationDetails:{...base.installationDetails,qElectricalModels:['Q350','Q450','Q600'],cards:base.installationDetails.cards.filter(card=>!equipment.includes(card.id)).concat(base.installationDetails.cards.filter(card=>equipment.includes(card.id)).slice(0,count))}};
  const pages=createInstallationDetailPages(sheet),svgs=pages.map(page=>renderInstallationDetailSheetSvg(sheet,page));
  const withElectrical=svgs.filter(svg=>svg.includes('data-role="q-electrical-source"'));
  assert.equal(withElectrical.length,1);
  const svg=withElectrical[0];assert.match(svg,/>Electrical<\/text>/);assert.match(svg,/>Notes<\/text>/);
  const image=svg.match(/<image data-role="q-electrical-source"[^>]* x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
  assert.ok(image);const [x,y,w,h]=image.slice(1).map(Number);
  assert.ok(h>=100,`source height ${h}mm for ${orientation}/${count}`);assert.ok(x+w<=sheet.page.widthMm-10);assert.ok(y+h<=sheet.page.heightMm-30);
  const notes=svg.match(/<g data-role="coordination-notes">([\s\S]*?)<\/g>/)[1];
  const ys=[...notes.matchAll(/ y="([\d.]+)"/g)].map(match=>Number(match[1]));
  assert.ok(Math.max(...ys)<=sheet.page.heightMm-32,`notes overflow ${orientation}/${count}: ${Math.max(...ys)}`);
  const plain=svg.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
  assert.match(plain,/Q350 — 10 A GPO; Q450 \/ Q600 — 15 A GPO/);
  assert.match(plain,/AeroFresh 300 \/ 450 \/ 600 controls reference/);
  assert.match(plain,/Project insulation specification is not supplied/);
  assert.match(plain,/Boost \/ momentary switches: low-voltage 2-core cable/);
  const output=createSheetOutputPages(sheet);assert.ok(output.every(page=>page.kind!=='q-series-electrical'));
 }
});
