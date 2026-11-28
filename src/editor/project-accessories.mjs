import {cwQuoteCodes,cwMountQuoteCode,quoteCodeEvidence,quotedCode,CW420_BRANCH_ARTICLE} from "./quote-product-codes.mjs";
import {mountedCwDrawingLayout} from "../domain/mounted-cw-drawing-connections.mjs";
import {routeLengthSummary} from "../domain/spatial.mjs";
import {deriveEppProjectTotals} from './epp-takeoff.mjs';
import {deriveRiserTakeoff} from './riser-takeoff.mjs';
import {deriveRadialAccessories} from './radial-accessories.mjs';

export function deriveProjectAccessories(project,{floorId,stubLengthMm}={}){
 const unit=c=>{const roles=new Set(c.ports.filter(p=>p.system==='mvhr').map(p=>p.role));return ['Dwelling supply','Dwelling extract','Outdoor intake','Outdoor exhaust'].every(r=>roles.has(r));};
 const identity=c=>[c.mvhrDesignIntent?.model,c.catalogueItemId,c.catalogueSnapshot?.recordId,c.productId].filter(Boolean).join(' ');
 const localUnits=project.components.filter(c=>c.floorId===floorId&&unit(c));
 const qSeries=localUnits.filter(c=>/(?:^|[-\s])q(?:350|450|600)|ZEN-Q(?:350|450|600)/i.test(identity(c)));
 const surge=localUnits.filter(c=>!/(?:^|[-\s])q(?:450|600)|ZEN-Q(?:450|600)/i.test(identity(c)));
 const cwGroups=new Map();
 const cwAdd=(code,description,quantity,{manufacturerArticle=null}={})=>{
  const key=code||description,existing=cwGroups.get(key),codeSource=quoteCodeEvidence(code);
  if(existing)existing.quantity+=quantity;
  else cwGroups.set(key,{code,description:`${description}${codeSource?.supplier?' · '+codeSource.supplier:''}`,quantity,unit:'ea',codeSource,...(manufacturerArticle?{manufacturerArticle}:{})});
 };
 const cwBranch=(size,count,code,quantity)=>{
  const description=`CW${size} branch plate · ${count} × 90 mm`;
  if(Number(size)===420&&count===8){
   cwAdd('',`${description} · Fantech code to confirm`,quantity,{manufacturerArticle:CW420_BRANCH_ARTICLE});
  }else cwAdd(code??'',`${description}${code?'':' · product code to select'}`,quantity);
 };
 for(const component of localUnits){
  const layout=mountedCwDrawingLayout(component);if(!layout)continue;
  const {size,branchCount}=layout.mountedCw,codes=cwQuoteCodes(size);
  cwAdd(codes.module??'',`CW${size} attenuator module${codes.module?'':' · product code to select'}`,2);
  cwBranch(size,branchCount,codes.branch,2);
  const mounting=cwMountQuoteCode(component,size);
  if(mounting)cwAdd(mounting,`CW${size} mounting set · ${/aerofresh/i.test(identity(component))?'Aerofresh 450 / 600':/q600/i.test(identity(component))?'Q600':'Q350 / Q450'}`,1);
  else cwAdd('',`CW${size} mounting set · product code to select`,1);
 }
 for(const component of project.components.filter(c=>c.floorId===floorId)){
  const profile=(component.displaySymbol??component.catalogueSnapshot?.symbol)?.cwProfile;if(!profile)continue;
  const {size,mainSize,count}=profile,codes=cwQuoteCodes(size,mainSize);
  cwAdd(codes.module??'',`CW${size} attenuator module${codes.module?'':' · product code to select'}`,1);
  cwBranch(size,count,codes.branch,1);
  cwAdd(codes.end??'',`CW${size} end plate · DN${mainSize}${codes.end?'':' · product code to select'}`,1);
 }
 const cwLines=[...cwGroups.values()];
 const terminalGroups=new Map();
 const terminalAdd=(code,description,componentId,role='housing',manufacturerArticle=null)=>{
  const key=code||description;
  const previous=terminalGroups.get(key);
  if(previous){previous.quantity++;previous.componentIds.push(componentId);}
  else terminalGroups.set(key,{code,description,quantity:1,unit:'ea',codeSource:quoteCodeEvidence(code),role,componentIds:[componentId],...(manufacturerArticle ? {manufacturerArticle} : {})});
 };
 for(const component of project.components.filter(c=>c.floorId===floorId)){
  const shape=(component.displaySymbol??component.catalogueSnapshot?.symbol)?.shape;
  if(shape==='linear-grille'){
   const spec=component.catalogueSnapshot?.terminalSpecification?.linea;
   if(!spec)continue;
   terminalAdd('',`Zehnder ComfoGrid Linea ${spec.size} white face · AU availability/code to confirm`,component.id,'cover',spec.faceArticle);
   terminalAdd('',`Zehnder ComfoCase CSB-P ${spec.size} · ${spec.feedCount} × DN90 · AU availability/code to confirm`,component.id,'housing',spec.housingArticle);
  } else if(shape==='wall-grille'){
   terminalAdd('AER-GR-RECT-W','AeroFresh magnetic cover · cool white',component.id,'cover');
   const entry=component.ports.find(p=>p.interface?.nominalSizeMm===90)?.drawingEntryId;
   const code=entry==='back'?'AER-GR-RECT-BX90R':['left','right'].includes(entry)?'AER-GR-R-BX90E':null;
   terminalAdd(code??'',code?`Aerofresh grille housing · ${entry==='back'?'rear entry':'side entry'}`:'Aerofresh grille housing · entry to select',component.id);
  } else if(shape==='luna-grille'){
   const routes=project.routes.filter(r=>r.ductKind==='semi-rigid-radial'&&[r.startAttachment,r.endAttachment].some(e=>e?.componentId===component.id));
   const counts=new Set(routes.map(r=>r.parallelRunCount??null));
   const runs=routes.length?(counts.size===1?[...counts][0]:null):component.ductRunCount;
   const code=quotedCode(runs===1?'ZEN-H-TVA90-300':runs===2?'ZEN-H-TVA90-300TW':'');
   terminalAdd(code??'',`TVA-P 90 housing · 300 mm · ${runs===1?'single connection':runs===2?'twin connection':'Single / Twin to select'}`,component.id);
  }
 }
 const terminalLines=[...terminalGroups.values()];
 const unitLines=[
  {code:'HRV-DRAIN',description:'40 mm waterless drain trap',quantity:localUnits.length,unit:'ea'},
  {code:'PLU-SURGE',description:'10 A surge protector · excludes Q450 / Q600',quantity:surge.length,unit:'ea'},
  {code:'ZEN-CCPRO',description:'ComfoConnect Pro · Q-series only',quantity:qSeries.length,unit:'ea'},
  {code:'ZEN-OPTBOX',description:'ComfoAir Q option box · Q-series only',quantity:qSeries.length,unit:'ea'},
 ].filter(line=>line.quantity>0);
 const designFloors=new Set([...project.components.filter(c=>c.ports.some(p=>p.system==='mvhr')).map(c=>c.floorId),...project.routes.filter(r=>r.system==='mvhr').map(r=>r.floorId)]);
 const owner=project.floors.find(f=>designFloors.has(f.id));
 const extractPoints=project.components.filter(c=>{
  const symbol=c.displaySymbol??c.catalogueSnapshot?.symbol;
  return symbol?.shape!=='linear-grille'&&!unit(c)&&(c.ports.length===1||['luna-grille','wall-grille'].includes(symbol?.shape))&&c.ports.some(p=>p.system==='mvhr'&&p.stream==='extract'&&p.interface?.nominalSizeMm===90);
 });
 const radial=project.floors.map(f=>deriveRadialAccessories(project,{floorId:f.id,stubLengthMm}));
 const oRingQuantity=radial.reduce((sum,a)=>sum+a.oRingQuantity,0),pendingORings=radial.reduce((sum,a)=>sum+a.pendingTerminalRunCount,0);
 const radialRoutes=project.routes.filter(route=>route.ductKind==='semi-rigid-radial');
 const drawnLengthMm=radialRoutes.reduce((sum,route)=>sum+(route.parallelRunCount==null?0:routeLengthSummary(route).projectedMm*route.parallelRunCount),0);
 const stubTotalMm=radial.reduce((sum,a)=>sum+(a.stubTotalMm??0),0);
 const risers=deriveRiserTakeoff(project);
 const radialRisers=risers.filter(riser=>riser.nominalSizeMm===90);
 const riserLengthMm=radialRisers.reduce((sum,riser)=>sum+(riser.lengthMm??0),0);
 const pendingDuctCount=radialRisers.filter(riser=>riser.lengthMm===null).length+radialRoutes.filter(route=>route.parallelRunCount==null).length+radial.filter(a=>a.stubQuantity>0&&a.stubTotalMm===null).length;
 const knownTotalLengthMm=drawnLengthMm+stubTotalMm+riserLengthMm,coilLengthMm=50000;
 const duct90={drawnLengthMm,stubTotalMm,riserLengthMm,knownTotalLengthMm,totalLengthMm:pendingDuctCount?null:knownTotalLengthMm,coilLengthMm,coilQuantity:Math.ceil(knownTotalLengthMm/coilLengthMm),pendingCount:pendingDuctCount,showOnThisFloor:owner?.id===floorId};
 const capQuantity=radial.reduce((sum,a)=>sum+a.capQuantity,0);
 const lineaFilterReferences=[...new Set(project.components.filter(c=>c.ports.some(p=>p.system==='mvhr'&&p.stream==='extract'))
  .map(c=>c.catalogueSnapshot?.terminalSpecification?.linea).filter(Boolean).map(spec=>spec.filterArticle))];
 const filterBagQuantity=Math.ceil(extractPoints.length/10),oRingPackQuantity=Math.ceil(oRingQuantity/10);
 const jobLines=owner?.id===floorId?[
  {code:'ZEN-C90-CSET',description:'ComfoSet 90',quantity:3,unit:'ea'},
  ...(filterBagQuantity?[{code:'AER-GR-FILT-DN125',description:`Extract vent filters · ${extractPoints.length} ${extractPoints.length===1?'point':'points'}, 10 filters per bag`,quantity:filterBagQuantity,unit:'bag'}]:[]),
  ...(oRingPackQuantity||pendingORings?[{code:'ZEN-OR90',description:`90 mm O-rings · ${oRingQuantity} required${pendingORings?' + pending connections':''}, 10 per pack`,quantity:pendingORings?`${oRingPackQuantity} + pending`:oRingPackQuantity,unit:'pack'}]:[]),
 ]:[];
 return {unitLines,cwLines,terminalLines,jobLines,lineaFilterReferences:owner?.id===floorId?lineaFilterReferences:[],jobOwnerFloorId:owner?.id??null,jobOwnerFloorName:owner?.name??null,extractPointQuantity:extractPoints.length,filterBagQuantity,capQuantity,oRingQuantity,oRingPackQuantity,pendingORings,duct90,eppTotals:deriveEppProjectTotals(project,risers),
  basis:'Drain trap and eligible surge protector per HRV; Q-series controls per Q-series unit. Three ComfoSet 90 per job. One standard filter per applicable round/AeroFresh extract point, supplied in bags of ten; Linea requires its own housing-specific filter selection. Project packs appear once on the first floor with ventilation.'};
}
