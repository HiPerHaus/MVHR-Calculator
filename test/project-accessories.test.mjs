import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,applyCommand,identityQuaternion,knownMm,unknownMm,floorPortTransform} from '../src/domain/spatial.mjs';
import {createConfiguredMvhrComponent} from '../src/editor/mvhr-placement.mjs';
import {createCatalogueComponent,routeFamilyForKind} from '../src/editor/component-catalogue.mjs';
import {deriveProjectAccessories} from '../src/editor/project-accessories.mjs';
import {createPartsSchedule} from '../src/editor/parts-schedule.mjs';
import {partsListRows} from '../src/sheets/a4-parts-list.mjs';
function base(){let p=createProject('accessory-project');for(const id of ['ground','upper'])p=applyCommand(p,{type:'floor.add',floor:{id,name:id,transform:{translationMm:{x:0,y:0,z:knownMm(0,'test')},orientation:identityQuaternion()}}});return p;}
function addUnit(p,model='q350-hrv',layout='unit-only'){return applyCommand(p,{type:'component.add',component:createConfiguredMvhrComponent({model,mounting:'vertical',handing:'left',layout,cwSize:'320'},{id:`unit-${p.components.length}`,floorId:'ground',xMm:1000,yMm:1000})});}
function addRoute(p,id,length,stream='supply',runs=1){const f=routeFamilyForKind('semi-rigid-radial');return applyCommand(p,{type:'route.add',route:{id,floorId:'ground',system:'mvhr',stream,role:stream==='supply'?'Dwelling supply':'Dwelling extract',ductKind:f.id,connectionInterface:f.connectionInterface,parallelRunCount:runs,startAttachment:null,endAttachment:null,points:[{x:0,y:0,z:unknownMm('not set')},{x:length,y:0,z:unknownMm('not set')}]}});}
test('Q350 and Aerofresh receive drain/surge; Q controls never get added to Aerofresh',()=>{
 for(const model of ['q350-hrv','aerofresh-450-hrv']){const a=deriveProjectAccessories(addUnit(base(),model),{floorId:'ground'}),codes=new Map(a.unitLines.map(l=>[l.code,l.quantity]));assert.equal(codes.get('HRV-DRAIN'),1);assert.equal(codes.get('PLU-SURGE'),1);assert.equal(codes.has('ZEN-CCPRO'),model.startsWith('q'));assert.equal(codes.has('ZEN-OPTBOX'),model.startsWith('q'));}
 for(const model of ['q450','q600']){const p=addUnit(base());p.components[0].mvhrDesignIntent.model=`${model}-hrv`;p.components[0].catalogueItemId=`zehnder-${model}-drawing-profile`;p.components[0].productId=`ZEN-${model.toUpperCase()}HRV`;const a=deriveProjectAccessories(p,{floorId:'ground'});assert.equal(a.unitLines.some(l=>l.code==='PLU-SURGE'),false);assert.ok(a.unitLines.some(l=>l.code==='ZEN-CCPRO'));}
});
test('filter bags and three-per-job ComfoSet round once across floors, not per unit or floor',()=>{
 let p=addUnit(addUnit(base()));for(let i=0;i<11;i++)p=applyCommand(p,{type:'component.add',component:createCatalogueComponent('luna-extract',{id:`extract-${i}`,floorId:i<5?'ground':'upper',xMm:2000+i*100,yMm:2000})});
 const ground=deriveProjectAccessories(p,{floorId:'ground'}),upper=deriveProjectAccessories(p,{floorId:'upper'});assert.equal(ground.extractPointQuantity,11);assert.equal(ground.filterBagQuantity,2);assert.equal(ground.jobLines.find(l=>l.code==='ZEN-C90-CSET').quantity,3);assert.equal(upper.jobLines.length,0);assert.equal(ground.unitLines.find(l=>l.code==='HRV-DRAIN').quantity,2);
 p.components.pop();assert.equal(deriveProjectAccessories(p,{floorId:'ground'}).filterBagQuantity,1);
});
test('90 mm design totals stay internal while supplier rows round 50 m coils upward exactly',()=>{
 for(const [length,expected] of [[49999,1],[50000,1],[50001,2],[100000,2],[100001,3]]){const a=deriveProjectAccessories(addRoute(base(),'route-one',length),{floorId:'ground'});assert.equal(a.duct90.coilQuantity,expected);}
 let p=addRoute(addRoute(base(),'route-supply',20000),'route-extract',15001,'extract',2);const schedule=createPartsSchedule(p,{floorId:'ground'}),rows=partsListRows(schedule);assert.equal(schedule.projectAccessories.duct90.totalLengthMm,50002);assert.equal(schedule.projectAccessories.duct90.coilQuantity,2);assert.equal(rows.some(r=>r.description.startsWith('Total 90 mm duct')),false);assert.equal(rows.filter(r=>r.description.includes('50 m coil')).length,1);assert.equal(rows.find(r=>r.description.includes('50 m coil')).quantity,'2');assert.equal(rows.some(r=>r.description.includes('Semi-rigid radial')),false);
 const pending=deriveProjectAccessories(addRoute(base(),'route-pending',10000,'supply',null),{floorId:'ground'});assert.equal(pending.duct90.totalLengthMm,null);assert.equal(pending.duct90.pendingCount,1);
});
test('unused CW stubs join total duct; eleven terminal connections and twelve CW ports require three O-ring packs',()=>{
 let p=addUnit(base(),'q350-hrv','unit-mounted-cw');const c=p.components[0],f=routeFamilyForKind('semi-rigid-radial');
 const initial=deriveProjectAccessories(p,{floorId:'ground'});assert.equal(initial.duct90.totalLengthMm,1200);assert.equal(initial.oRingPackQuantity,2);assert.equal(initial.cwLines.find(l=>l.code==='ZEN-ACWS-320').quantity,2);assert.equal(initial.cwLines.find(l=>l.code==='ZEN-MPCWM-320-6X90').quantity,2);assert.equal(initial.cwLines.find(l=>l.code==='ZEN-MSCW-320').quantity,1);
 const ports=c.ports.filter(port=>port.interface.nominalSizeMm===90).slice(0,11);
 for(const [i,port] of ports.entries()){const terminal=createCatalogueComponent(`luna-${port.stream}`,{id:`point-${i}`,floorId:'ground',xMm:5000,yMm:2000+i*100});p=applyCommand(p,{type:'component.add',component:terminal});p=applyCommand(p,{type:'route.add',route:{id:`route-${i}`,floorId:'ground',system:'mvhr',stream:port.stream,role:port.role,ductKind:f.id,connectionInterface:f.connectionInterface,parallelRunCount:1,startAttachment:{componentId:c.id,portId:port.id},endAttachment:{componentId:terminal.id,portId:terminal.ports[0].id},points:[floorPortTransform(p,c.id,port.id).positionMm,floorPortTransform(p,terminal.id,terminal.ports[0].id).positionMm]}});}
 const a=deriveProjectAccessories(p,{floorId:'ground'});assert.equal(a.oRingQuantity,23);assert.equal(a.oRingPackQuantity,3);assert.equal(a.jobLines.find(l=>l.code==='ZEN-OR90').quantity,3);assert.equal(a.duct90.stubTotalMm,100);
});
test('EPP project totals combine streams and floors before rounding metre lengths and appear once',()=>{
 let p=base();
 const add=(id,floorId,length,stream='intake',kind='epp-rigid-dn160',runs=1)=>{const family=routeFamilyForKind(kind);p=applyCommand(p,{type:'route.add',route:{id,floorId,system:'mvhr',stream,role:stream==='intake'?'Outdoor intake':'Outdoor exhaust',ductKind:kind,connectionInterface:family.connectionInterface,parallelRunCount:runs,startAttachment:null,endAttachment:null,points:[{x:0,y:0,z:unknownMm('not set')},{x:length,y:0,z:unknownMm('not set')}]}});};
 add('epp-one','ground',400);add('epp-two','upper',300,'exhaust','epp-rigid-dn160',2);add('epp-small','upper',1001,'intake','epp-rigid-dn125');
 const before=structuredClone(p),schedule=createPartsSchedule(p,{floorId:'ground'}),totals=schedule.projectAccessories.eppTotals;
 assert.deepEqual(totals.map(line=>[line.nominalSizeMm,line.totalLengthMm,line.stockLengthQuantity]),[[125,1001,2],[160,1000,1]]);
 const rows=partsListRows(schedule);assert.equal(rows.some(row=>row.description.startsWith('Total DN160 EPP')),false);
 assert.deepEqual(rows.filter(row=>/^AER-DUC-/.test(row.partNumber)).map(row=>row.partNumber),['AER-DUC-DN125-1MSL','AER-DUC-DN125-B90','AER-DUC-DN125-SL','AER-DUC-DN160-1MSL','AER-DUC-DN160-B90','AER-DUC-DN160-SL']);
 assert.equal(rows.find(row=>row.partNumber==='AER-DUC-DN160-1MSL').quantity,'1');
 assert.equal(rows.some(row=>row.description==='Other drawn duct lengths'),false);
 assert.equal(partsListRows(createPartsSchedule(p,{floorId:'upper'})).some(row=>row.description.startsWith('Total DN')),false);
 assert.deepEqual(p,before);
 add('epp-pending','upper',100,'intake','epp-rigid-dn160',null);
 const pending=createPartsSchedule(p,{floorId:'ground'}).projectAccessories.eppTotals.find(line=>line.nominalSizeMm===160);
 assert.equal(pending.totalLengthMm,null);assert.equal(pending.knownTotalLengthMm,1000);assert.equal(pending.pendingCount,1);
});
test('unmatched duct families remain visible without inventing supplier stock quantities',()=>{
 let p=base();const add=(id,kind)=>{const family=routeFamilyForKind(kind);p=applyCommand(p,{type:'route.add',route:{id,floorId:'ground',system:'mvhr',stream:'supply',role:'Dwelling supply',ductKind:kind,connectionInterface:family.connectionInterface,parallelRunCount:1,startAttachment:null,endAttachment:null,points:[{x:0,y:0,z:unknownMm('not set')},{x:3000,y:0,z:unknownMm('not set')}]}});};
 add('flex-one','flexible-round-dn150');add('flex-two','flexible-round-dn150');add('legacy-one','generic-duct');
 const rows=partsListRows(createPartsSchedule(p,{floorId:'ground'}));
 const unresolved=rows.filter(row=>row.kind==='selection'&&row.unit==='stock');
 assert.equal(unresolved.length,2);assert.ok(unresolved.every(row=>row.quantity==='Not set'));
 assert.match(unresolved.find(row=>row.description.includes('DN150')).description,/2 drawn routes retained/);
 assert.match(unresolved.find(row=>row.description.includes('Legacy generic duct')).description,/matched order code not set/);
 assert.equal(rows.some(row=>row.unit==='m'),false);
});
