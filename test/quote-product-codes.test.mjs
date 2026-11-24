import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,applyCommand,identityQuaternion,knownMm,serializeProject,deserializeProject} from '../src/domain/spatial.mjs';
import {createCatalogueComponent} from '../src/editor/component-catalogue.mjs';
import {createConfiguredMvhrComponent} from '../src/editor/mvhr-placement.mjs';
import {componentQuoteCode,cwQuoteCodes,cwMountQuoteCode,quoteCodeEvidence,QUOTE_PRODUCT_CODES} from '../src/editor/quote-product-codes.mjs';
import {createPartsSchedule} from '../src/editor/parts-schedule.mjs';
import {partsListRows,createA4PartsListPages,renderA4PartsListSvg} from '../src/sheets/a4-parts-list.mjs';
import {createA3SheetModel} from '../src/sheets/a3-sheet.mjs';
import {createPartsCsvRows} from '../src/sheets/parts-csv-export.mjs';
import {createOsTakeoff} from '../app/os-takeoff.mjs';
function base(){return applyCommand(createProject('quote-codes'),{type:'floor.add',floor:{id:'ground',name:'Ground',transform:{translationMm:{x:0,y:0,z:knownMm(0,'test')},orientation:identityQuaternion()}}});}
function grille(size,id='grille'){return createCatalogueComponent(`generic-external-grille-combined-dn${size}`,{id,floorId:'ground',xMm:1000,yMm:1000});}
test('Rev 5E combined grille codes follow diameter and saved handing through flip, rotation and reload',()=>{
 for(const size of [125,160]){
  let p=applyCommand(base(),{type:'component.add',component:grille(size)});
  const original=structuredClone(p.components[0]);
  let line=createPartsSchedule(p,{floorId:'ground'}).componentLines[0];
  assert.equal(line.partNumber,`ZEN-GR-EXT${size}L`);assert.equal(line.productId,null);assert.equal(line.evidenceClass,'unmatched-provisional');
  assert.equal(line.partNumberSource.title,'MVHR 2026 Quote Template - Rev 5E');
  assert.deepEqual(p.components[0],original);
  p=applyCommand(p,{type:'component.setExternalGrilleHanding',componentId:'grille',handing:'right'});
  p=applyCommand(p,{type:'component.rotateFloorZ',componentId:'grille',angleRad:Math.PI/2});
  p=deserializeProject(serializeProject(p));
  line=createPartsSchedule(p,{floorId:'ground'}).componentLines[0];assert.equal(line.partNumber,`ZEN-GR-EXT${size}R`);
  p=applyCommand(p,{type:'component.add',component:grille(size,'left-grille')});
  const lines=createPartsSchedule(p,{floorId:'ground'}).componentLines;assert.equal(lines.length,2);assert.deepEqual(lines.map(l=>l.quantity),[1,1]);
 }
 assert.equal(quoteCodeEvidence('ZEN-GR-EXT160R').locator,'Price List!A87,C87');
});
test('single grille codes do not depend on air service and unknown product selections remain unknown',()=>{
 for(const size of [125,160])for(const stream of ['intake','exhaust'])assert.equal(componentQuoteCode(createCatalogueComponent(`zehnder-external-grille-${stream}-dn${size}`,{id:'single',floorId:'ground',xMm:0,yMm:0})),`ZEN-GR-EXT${size}`);
 assert.deepEqual(cwQuoteCodes('420',160),{module:'ZEN-ACWS-420',branch:null,end:null});
 assert.equal(cwQuoteCodes('625',160).end,null);
 assert.equal(cwQuoteCodes('625',200).module,'ZEN-ACWS625');
 assert.equal(cwQuoteCodes('625',200).branch,'ZEN-MPCWM625-12X90');
 assert.equal(cwQuoteCodes('625',200).end,'ZEN-EP625-200');
 assert.equal(componentQuoteCode(createCatalogueComponent('aerofresh-magnetic-wall-grille-supply',{id:'aero',floorId:'ground',xMm:0,yMm:0})),null);
 assert.ok(Object.values(QUOTE_PRODUCT_CODES).every(part=>Object.keys(part).every(key=>['name','row'].includes(key))));
});
test('CW breakdown uses exact quote spelling and model-specific mounting codes without guessing missing plates',()=>{
 let p=base();
 const c=createConfiguredMvhrComponent({model:'q350-hrv',mounting:'vertical',handing:'left',layout:'unit-mounted-cw',cwSize:'625'},{id:'q-unit',floorId:'ground',xMm:0,yMm:0});
 p=applyCommand(p,{type:'component.add',component:c});
 p=applyCommand(p,{type:'component.add',component:createCatalogueComponent('standalone-cw-220-supply-horizontal-dn125',{id:'cw-component',floorId:'ground',xMm:2000,yMm:0,allowAssemblyOnly:true})});
 const schedule=createPartsSchedule(p,{floorId:'ground'}),lines=schedule.projectAccessories.cwLines;
 for(const [code,qty] of [['ZEN-ACWS625',2],['ZEN-MPCWM625-12X90',2],['ZEN-MSCW-625',1],['ZEN-ACWS-220',1],['ZEN-MPCWM-220-4X90',1],['ZEN-EPCWP-220-125',1]])assert.equal(lines.find(l=>l.code===code)?.quantity,qty);
 assert.equal(cwMountQuoteCode({mvhrDesignIntent:{model:'aerofresh-450-hrv'}},'520'),'HRV-MSCW-A450-520');
 assert.equal(cwMountQuoteCode({mvhrDesignIntent:{model:'q600-hrv'}},'520'),'ZEN-MSCW6-520');
 assert.equal(cwMountQuoteCode({mvhrDesignIntent:{model:'aerofresh-450-hrv'}},'625'),null);
 assert.equal(schedule.projectAccessories.capQuantity,28);assert.equal(partsListRows(schedule).some(row=>row.partNumber==='ZEN-ECAP90'),false);
});
test('Fantech CW420 off-list parts stay under CW components, without inventing a full branch SKU',()=>{
 let p=base();
 const unit=createConfiguredMvhrComponent({model:'q350-hrv',mounting:'vertical',handing:'left',layout:'unit-mounted-cw',cwSize:'420'},{id:'cw420-unit',floorId:'ground',xMm:1000,yMm:1000});
 p=applyCommand(p,{type:'component.add',component:unit});
 assert.equal(cwMountQuoteCode({mvhrDesignIntent:{model:'q450-hrv'}},'420'),'ZEN-MSCW-420');
 assert.equal(cwMountQuoteCode({mvhrDesignIntent:{model:'q600-hrv'}},'420'),null);
 assert.equal(quoteCodeEvidence('ZEN-ACWS-420').supplier,'Fantech');
 const csv=createPartsCsvRows(p,{exportedAt:'2026-11-24T00:00:00.000Z'});
 const parts=csv.filter(row=>row.section==='CW components');
 for(const [code,qty] of [['ZEN-ACWS-420','2'],['ZEN-MSCW-420','1'],['990323622','2']]){
  const row=parts.find(row=>row.partNumber===code);
  assert.equal(row?.quantity,qty);
  assert.match(row.description,/Fantech/);
 }
 assert.equal(parts.find(row=>row.partNumber==='990323622').kind,'selection');
 assert.equal(csv.some(row=>row.section==='Local supply'&&/CW420/.test(row.description)),false);
 const takeoff=createOsTakeoff(csv,{id:'job',save_version:1},p.activeDesignOptionId,'centralised');
 assert.equal(takeoff.items.some(row=>row.partNumber==='990323622'),false);
 assert.ok(takeoff.issues.some(issue=>issue.includes('Fantech code to confirm')));
});
test('Aerofresh cool-white covers count per point and housing codes follow saved drawing entry',()=>{
 let p=base();
 for(const [index,entry] of ['back','left','right'].entries()){
  const component=createCatalogueComponent('aerofresh-magnetic-wall-grille-extract',{id:`aero-${index}`,floorId:'ground',xMm:index*1000,yMm:2000});
  const port=component.ports[0],selected=port.drawingEntries.find(e=>e.id===entry);port.drawingEntryId=entry;port.positionMm=selected.positionMm;port.direction=selected.direction;
  p=applyCommand(p,{type:'component.add',component});
 }
 const before=structuredClone(p),lines=createPartsSchedule(p,{floorId:'ground'}).projectAccessories.terminalLines;
 assert.equal(lines.find(l=>l.code==='AER-GR-RECT-W').quantity,3);
 assert.equal(lines.find(l=>l.code==='AER-GR-RECT-BX90R').quantity,1);
 assert.equal(lines.find(l=>l.code==='AER-GR-R-BX90E').quantity,2);
 const printed=partsListRows(createPartsSchedule(p,{floorId:'ground'}));
 const covers=printed.filter(row=>row.partNumber==='AER-GR-RECT-W');
 assert.equal(covers.length,1);assert.equal(covers[0].quantity,'3');
 assert.equal(printed[printed.indexOf(covers[0])-1].description,'Terminals');
 assert.equal(printed.some(row=>row.kind==='assembly'&&/Aerofresh/i.test(row.description)),false);
 assert.deepEqual(p,before);
});
test('AeroFresh cover prints next to Luna grilles and the matching housing is ordered once',()=>{
 const p0=base();
 const specs=[['luna-supply','luna'],['aerofresh-magnetic-wall-grille-supply','aero']];
 const project=specs.reduce((p,[catalogue,id],i)=>applyCommand(p,{type:'component.add',component:createCatalogueComponent(catalogue,{id,floorId:'ground',xMm:(i+1)*1000,yMm:1000})}),p0);
 const p=deserializeProject(serializeProject(project)),before=structuredClone(p);
 const sheet=createA3SheetModel(p,{floorId:'ground',projectName:'Parts list test',drawingTitle:'Ventilation',drawingId:'V01',revision:'A',revisionText:'Test',issueDate:'2026-11-24',status:'Preliminary — not for construction',includeSchedule:false});
 const pages=createA4PartsListPages(sheet);
 const svg=pages.map(page=>renderA4PartsListSvg(sheet,page)).join('');
 assert.doesNotMatch(svg,/supply box · magnetic cover/i);
 assert.equal((svg.match(/AER-GR-RECT-W/g)??[]).length,1);
 assert.equal((svg.match(/AER-GR-RECT-BX90R/g)??[]).length,1);
 assert.ok(svg.indexOf('AER-GR-RECT-W')<svg.indexOf('Luna supply grille'));
 assert.ok(svg.indexOf('Luna supply grille')<svg.indexOf('Terminal components'));
 assert.ok(svg.indexOf('Terminal components')<svg.indexOf('AER-GR-RECT-BX90R'));
 const csv=createPartsCsvRows(p,{exportedAt:'2026-11-24T00:00:00.000Z'});
 const parts=csv.filter(row=>row.kind==='part');
 const cover=parts.filter(row=>row.partNumber==='AER-GR-RECT-W');
 const housing=parts.filter(row=>row.partNumber==='AER-GR-RECT-BX90R');
 assert.equal(cover.length,1);assert.equal(cover[0].section,'Terminals');assert.equal(cover[0].quantity,'1');
 assert.equal(cover[0].ref,sheet.partsSchedule.componentLines.find(line=>line.componentIds.includes('aero')).ref);
 assert.equal(housing.length,1);assert.equal(housing[0].section,'Terminal components');assert.equal(housing[0].quantity,'1');
 const takeoff=createOsTakeoff(csv,{id:'job',save_version:1},p.activeDesignOptionId,'centralised');
 assert.deepEqual(takeoff.items.filter(i=>i.partNumber?.startsWith('AER-GR-RECT-')).map(i=>[i.partNumber,i.quantity]),[['AER-GR-RECT-W',1],['AER-GR-RECT-BX90R',1]]);
 assert.deepEqual(p,before);
});
test('TVA housing codes follow explicit Single or Twin, and unset stays unselected',()=>{
 let p=base();
 for(const [index,runs] of [1,2,null].entries()){
  const component=createCatalogueComponent('luna-supply',{id:`luna-${index}`,floorId:'ground',xMm:index*1000,yMm:1000});component.ductRunCount=runs;
  p=applyCommand(p,{type:'component.add',component});
 }
 const lines=createPartsSchedule(p,{floorId:'ground'}).projectAccessories.terminalLines;
 assert.equal(lines.find(l=>l.code==='ZEN-H-TVA90-300').quantity,1);
 assert.equal(lines.find(l=>l.code==='ZEN-H-TVA90-300TW').quantity,1);
 assert.ok(lines.some(l=>l.code===''&&l.description.includes('to select')));
});
test('caps supplied with pipe remain design quantities and never become a separate order across floors',()=>{
 let p=applyCommand(base(),{type:'floor.add',floor:{id:'upper',name:'Upper',transform:{translationMm:{x:0,y:0,z:knownMm(3000,'test')},orientation:identityQuaternion()}}});
 for(const floorId of ['ground','upper'])p=applyCommand(p,{type:'component.add',component:createCatalogueComponent('standalone-cw-220-supply-horizontal-dn125',{id:`cw-${floorId}`,floorId,xMm:1000,yMm:0,allowAssemblyOnly:true})});
 const ground=createPartsSchedule(p,{floorId:'ground'}),upper=createPartsSchedule(p,{floorId:'upper'});
 assert.equal(ground.projectAccessories.capQuantity,8);assert.equal(ground.radialAccessories.capQuantity,4);assert.equal(upper.radialAccessories.capQuantity,4);
 assert.equal(partsListRows(ground).some(row=>row.partNumber==='ZEN-ECAP90'),false);
 assert.equal(ground.projectAccessories.jobLines.some(line=>line.code==='ZEN-ECAP90'),false);
 assert.equal(ground.radialAccessories.stubQuantity,4);
 assert.equal(partsListRows(upper).some(row=>row.partNumber==='ZEN-ECAP90'),false);
});
