import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,applyCommand,identityQuaternion,knownMm,floorPortTransform} from '../src/domain/spatial.mjs';
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
 const p=connect(fixture(),'luna-supply','supply','luna-test'),sheet=createA3SheetModel(p,metadata),pages=createA4PartsListPages(sheet),svg=renderA4PartsListSvg(sheet,pages[0]);assert.equal(pages[0].pageNumber,2);assert.equal(pages[0].widthMm,210);assert.equal(pages[0].heightMm,297);assert.match(svg,/width="210mm" height="297mm"/);assert.match(svg,/90 mm O-ring/);assert.match(svg,/11/);assert.match(svg,/100 mm each/);assert.match(svg,/Additional 90 mm pipe for unused branch stubs/);assert.match(svg,/>1.10</);assert.match(svg,/Example project/);
 const many={...sheet,partsSchedule:{...sheet.partsSchedule,componentLines:Array.from({length:70},(_,i)=>({...sheet.partsSchedule.componentLines[0],ref:`P${i}`,description:`Equipment ${i} `+'long description '.repeat(14)}))}};
 const longPages=createA4PartsListPages(many);assert.ok(longPages.length>1);assert.equal(longPages.flatMap(page=>page.rows).length,partsListRows(many.partsSchedule).length);assert.ok(longPages.every(page=>65+page.rows.reduce((sum,row)=>sum+row.height,0)<=263));assert.equal(longPages.at(-1).pageNumber,longPages.at(-1).totalPageCount);
});
