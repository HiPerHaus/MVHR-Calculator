import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,applyCommand,serializeProject,deserializeProject,identityQuaternion,knownMm,floorPortTransform} from '../src/domain/spatial.mjs';
import {createConfiguredMvhrComponent} from '../src/editor/mvhr-placement.mjs';
import {createCatalogueComponent,routeFamilyForKind} from '../src/editor/component-catalogue.mjs';
import {createPartsSchedule} from '../src/editor/parts-schedule.mjs';
import {deriveRadialAccessories} from '../src/editor/radial-accessories.mjs';
import {createA3SheetModel} from '../src/sheets/a3-sheet.mjs';
import {partsListRows,createA4PartsListPages,renderA4PartsListSvg} from '../src/sheets/a4-parts-list.mjs';
function fixture(){let p=applyCommand(createProject('parts-page-test'),{type:'floor.add',floor:{id:'ground',name:'Ground floor',transform:{translationMm:{x:0,y:0,z:knownMm(0,'test')},orientation:identityQuaternion()}}});const c=createConfiguredMvhrComponent({model:'q350-hrv',mounting:'vertical',handing:'left',layout:'unit-mounted-cw',cwSize:'320'},{id:'unit-test',floorId:'ground',xMm:1000,yMm:1000});return applyCommand(p,{type:'component.add',component:c});}
function connect(p,record,stream,id){const c=p.components[0],branch=c.ports.find(port=>port.stream===stream&&port.interface.nominalSizeMm===90),terminal=createCatalogueComponent(record,{id,floorId:'ground',xMm:4000,yMm:3000});p=applyCommand(p,{type:'component.add',component:terminal});const family=routeFamilyForKind('semi-rigid-radial');return applyCommand(p,{type:'route.add',route:{id:`route-${id}`,floorId:'ground',system:'mvhr',stream,role:branch.role,ductKind:family.id,connectionInterface:family.connectionInterface,parallelRunCount:1,startAttachment:{componentId:c.id,portId:branch.id},endAttachment:{componentId:terminal.id,portId:terminal.ports[0].id},points:[floorPortTransform(p,c.id,branch.id).positionMm,floorPortTransform(p,terminal.id,terminal.ports[0].id).positionMm]}});}
const metadata={floorId:'ground',projectName:'Example project',siteName:'Example address',issueDate:'2026-10-24',drawingTitle:'Ventilation',drawingId:'V-01',status:'Preliminary — not for construction',revision:'A',revisionText:'Review'};
test('all CW branches receive an O-ring; caps and stubs follow unused saved endpoints',()=>{
 let p=fixture(),a=deriveRadialAccessories(p,{floorId:'ground'});assert.equal(a.cwPortQuantity,12);assert.equal(a.oRingQuantity,12);assert.equal(a.capQuantity,12);assert.equal(a.stubLengthMm,100);assert.equal(a.stubTotalMm,1200);
 p=connect(p,'luna-supply','supply','luna-test');a=createPartsSchedule(p,{floorId:'ground'}).radialAccessories;assert.equal(a.oRingQuantity,13);assert.equal(a.connectedTerminalQuantity,1);assert.equal(a.capQuantity,11);
 p=connect(p,'aerofresh-magnetic-wall-grille-extract','extract','aero-test');const before=structuredClone(p);a=deriveRadialAccessories(p,{floorId:'ground',stubLengthMm:150});assert.equal(a.oRingQuantity,14);assert.equal(a.stubQuantity,10);assert.equal(a.stubTotalMm,1500);assert.deepEqual(p,before);
 p=applyCommand(p,{type:'route.delete',routeId:'route-aero-test'});a=deriveRadialAccessories(p,{floorId:'ground'});assert.equal(a.oRingQuantity,13);assert.equal(a.capQuantity,11);
});
test('standalone CW capacity counts physical branches in either installation orientation',()=>{
 for(const orientation of ['vertical','horizontal']){let p=fixture();p={...p,components:[]};const c=createCatalogueComponent(`standalone-cw-220-supply-${orientation}-dn125`,{id:'cw220-test',floorId:'ground',xMm:1000,yMm:1000,allowAssemblyOnly:true});p=applyCommand(p,{type:'component.add',component:c});const a=deriveRadialAccessories(p,{floorId:'ground'});assert.equal(a.oRingQuantity,4);assert.equal(a.capQuantity,4);}
});
test('A4 page 2 prints equipment, route lengths and connection accessories without a shortened tail',()=>{
 const p=connect(fixture(),'luna-supply','supply','luna-test'),sheet=createA3SheetModel(p,metadata),pages=createA4PartsListPages(sheet),svg=pages.map(page=>renderA4PartsListSvg(sheet,page)).join('');assert.equal(pages[0].pageNumber,2);assert.equal(pages[0].widthMm,210);assert.equal(pages[0].heightMm,297);assert.match(svg,/width="210mm" height="297mm"/);assert.match(svg,/90 mm O-ring/);assert.match(svg,/11/);assert.ok(partsListRows(sheet.partsSchedule).some(row=>row.description.includes("100 mm each")));assert.match(svg,/Total 90 mm duct/);assert.match(svg,/50 m per coil, rounded up/);assert.match(svg,/Example project/);
 const many={...sheet,partsSchedule:{...sheet.partsSchedule,componentLines:Array.from({length:70},(_,i)=>({...sheet.partsSchedule.componentLines[0],ref:`P${i}`,description:`Equipment ${i} `+'long description '.repeat(14)}))}};
 const longPages=createA4PartsListPages(many);assert.ok(longPages.length>1);assert.equal(longPages.flatMap(page=>page.rows).length,partsListRows(many.partsSchedule).length);assert.ok(longPages.every(page=>65+page.rows.reduce((sum,row)=>sum+row.height,0)<=263));assert.equal(longPages.at(-1).pageNumber,longPages.at(-1).totalPageCount);
});
test('parts list separates MVHR and terminals and counts combined grille handing independently',()=>{
 let p=fixture();
 for(const id of ['grille-left','grille-right'])p=applyCommand(p,{type:'component.add',component:createCatalogueComponent('generic-external-grille-combined-dn160',{id,floorId:'ground',xMm:4000,yMm:4000})});
 p=applyCommand(p,{type:'component.setExternalGrilleHanding',componentId:'grille-right',handing:'right'});
 p=deserializeProject(serializeProject(p));
 let schedule=createPartsSchedule(p,{floorId:'ground'}),rows=partsListRows(schedule);
 assert.equal(schedule.componentLines.find(line=>line.componentIds.includes('unit-test')).section,'mvhr');
 assert.ok(rows.some(row=>row.section&&row.description==='MVHR units'));
 assert.ok(rows.some(row=>row.section&&row.description==='Terminals'));
 const grilles=schedule.componentLines.filter(line=>line.handing);
 assert.equal(grilles.length,2);assert.deepEqual(grilles.map(line=>line.quantity),[1,1]);
 assert.match(grilles.find(line=>line.handing==='left').description,/ · Left$/);
 assert.match(grilles.find(line=>line.handing==='right').description,/ · Right$/);
 // Plan rotation does not change the product handing.
 p={...p,components:p.components.map(c=>c.id==='grille-right'?{...c,orientation:{x:0,y:0,z:1,w:0}}:c)};
 assert.equal(createPartsSchedule(p,{floorId:'ground'}).componentLines.find(line=>line.componentIds.includes('grille-right')).handing,'right');
 p=applyCommand(p,{type:'component.setExternalGrilleHanding',componentId:'grille-left',handing:'right'});
 schedule=createPartsSchedule(p,{floorId:'ground'});
 assert.equal(schedule.componentLines.filter(line=>line.handing).length,1);
 assert.equal(schedule.componentLines.find(line=>line.handing==='right').quantity,2);
});

test('A4 part numbers have their own column and stay out of names',()=>{
 const sheet=createA3SheetModel(fixture(),metadata),rows=partsListRows(sheet.partsSchedule),pages=createA4PartsListPages(sheet);
 const drain=rows.find(row=>row.partNumber==='HRV-DRAIN');
 assert.equal(drain.description,'40 mm waterless drain trap');
 const cw=rows.find(row=>row.partNumber==='ZEN-MPCWM-320-6X90');assert.ok(cw);assert.ok(!cw.description.includes('ZEN-'));
 const unit=rows.find(row=>row.ref==='P01');assert.equal(unit.partNumber,'ZEN-Q350HRV');assert.ok(!unit.description.includes('Code:'));
 const svg=pages.map(page=>renderA4PartsListSvg(sheet,page)).join('');
 assert.match(svg,/>PART NUMBER<\/text>/);assert.match(svg,/>NAME<\/text>/);
 assert.match(svg,/<text x="30"[^>]*>HRV-DRAIN<\/text>/);
 assert.match(svg,/<text x="70"[^>]*>40 mm waterless drain trap<\/text>/);
 assert.ok(pages.every(page=>65+page.rows.reduce((sum,row)=>sum+row.height,0)<=263));
});
test('unlisted purchasable parts move to the final Local supply section without duplicating totals or listed choices',()=>{
 let p=fixture();
 const replacement=createConfiguredMvhrComponent({model:'q350-hrv',mounting:'vertical',handing:'left',layout:'unit-mounted-cw',cwSize:'420'},{id:'unit-test',floorId:'ground',xMm:1000,yMm:1000});
 p=applyCommand(p,{type:'component.replaceDrawingConfiguration',componentId:'unit-test',component:replacement});
 p=applyCommand(p,{type:'component.add',component:createCatalogueComponent('luna-supply',{id:'luna-pending',floorId:'ground',xMm:3000,yMm:1000})});
 const schedule=createPartsSchedule(p,{floorId:'ground'}),before=structuredClone(schedule),rows=partsListRows(schedule),start=rows.findIndex(row=>row.section&&row.description==='Local supply'),local=rows.slice(start+1);
 assert.ok(start>0);assert.equal(local.length,3);assert.ok(local.every(row=>row.localSupply&&row.kind==='part'));
 assert.equal(local.find(row=>row.description.includes('attenuator module')).quantity,'2');
 assert.equal(local.find(row=>row.description.includes('branch plate')).quantity,'2');
 assert.equal(local.find(row=>row.description.includes('mounting set')).quantity,'1');
 assert.ok(rows.slice(0,start).some(row=>row.description.startsWith('Total 90 mm duct')));
 assert.ok(rows.slice(0,start).some(row=>row.kind==='selection'&&row.description.includes('TVA-P')));
 assert.ok(rows.slice(0,start).some(row=>row.kind==='cut-piece'));
 assert.ok(rows.slice(0,start).some(row=>row.partNumber==='ZEN-Q350HRV'));
 assert.equal(rows.some(row=>row.section&&row.description==='CW components'),false);
 assert.ok(rows.every((row,index)=>!row.section||(rows[index+1]&&!rows[index+1].section)));
 assert.deepEqual(schedule,before);
 const sheet=createA3SheetModel(p,metadata),pages=createA4PartsListPages(sheet);assert.match(pages.map(page=>renderA4PartsListSvg(sheet,page)).join(''),/Local supply/);
});
