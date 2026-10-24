import {mountedCwDrawingLayout,mountedCwDrawingParts} from '../domain/mounted-cw-drawing-connections.mjs';

// Material allowances from saved endpoints; these do not create duct geometry.
export function deriveRadialAccessories(project,{floorId,stubLengthMm=null}={}){
 if(stubLengthMm!==null&&(!Number.isFinite(stubLengthMm)||stubLengthMm<=0))throw new TypeError('CW stub length must be positive or unknown');
 const usage=new Map(),terminalUsage=new Map();
 const key=e=>`${e.componentId}\u0000${e.portId}`;
 for(const route of project.routes){
  if(route.ductKind!=='semi-rigid-radial')continue;
  for(const e of [route.startAttachment,route.endAttachment].filter(Boolean)){
   usage.set(key(e),true);terminalUsage.set(key(e),route.parallelRunCount??null);
  }
 }
 for(const connection of project.connections)for(const e of [connection.from,connection.to])usage.set(key(e),true);
 let cwPortQuantity=0,unusedCwPortQuantity=0,connectedTerminalQuantity=0,pendingTerminalRunCount=0;
 for(const c of project.components.filter(c=>c.floorId===floorId)){
  const symbol=c.displaySymbol??c.catalogueSnapshot?.symbol,record=c.catalogueItemId??c.catalogueSnapshot?.recordId??'';
  const mounted=mountedCwDrawingParts(mountedCwDrawingLayout(c)).branches;
  const cw=Boolean(symbol?.cwProfile||mounted.length||/remote-radial-plate$/.test(record));
  const ports=mounted.length?mounted.map(b=>({id:`${c.id}-port-${b.key}`})):c.ports.filter(p=>p.interface?.family==='semi-rigid-pe'&&p.interface.nominalSizeMm===90);
  if(cw){for(const p of ports){cwPortQuantity++;if(!usage.has(key({componentId:c.id,portId:p.id})))unusedCwPortQuantity++;}continue;}
  if(!['luna-grille','wall-grille'].includes(symbol?.shape)&&!/tva/i.test(record))continue;
  for(const p of ports){const endpoint=key({componentId:c.id,portId:p.id});
   if(terminalUsage.has(endpoint)){const runs=terminalUsage.get(endpoint);if(runs===null)pendingTerminalRunCount++;else connectedTerminalQuantity+=runs;}
   else if(usage.has(endpoint))connectedTerminalQuantity++;
  }
 }
 return {cwPortQuantity,unusedCwPortQuantity,connectedTerminalQuantity,pendingTerminalRunCount,
  oRingQuantity:cwPortQuantity+connectedTerminalQuantity,capQuantity:unusedCwPortQuantity,stubQuantity:unusedCwPortQuantity,
  stubLengthMm,stubTotalMm:stubLengthMm===null?null:stubLengthMm*unusedCwPortQuantity,
  basis:'One O-ring per CW branch, used or unused; one per connected 90 mm TVA/Luna or Aerofresh duct. Unused CW branches each receive one pipe stub and cap. CW usage follows distinct saved branch endpoints. Stub duct length is additional to drawn routes.'};
}
