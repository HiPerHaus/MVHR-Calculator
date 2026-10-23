export function terminalDrawingPortDefinition(symbol) {
  if(!["luna-grille","wall-grille"].includes(symbol?.shape))return null;
  const stream=symbol.stream;
  if(!["supply","extract"].includes(stream))return null;
  const entry=(id,label,x,y,dx,dy)=>({id,label,positionMm:{x,y,z:0},direction:{x:dx,y:dy,z:0}});
  const entries=symbol.shape==="luna-grille"
    ? Array.from({length:8},(_,i)=>{const a=i*Math.PI/4,r=symbol.widthMm*.21+2;return entry(`rim-${i}`,"Circle rim",Math.cos(a)*r,Math.sin(a)*r,Math.cos(a),Math.sin(a));})
    : [entry("left","Left side entry",-symbol.widthMm/2,symbol.heightMm*.32,-1,0),entry("right","Right side entry",symbol.widthMm/2,symbol.heightMm*.32,1,0),entry("back","Back entry",0,symbol.heightMm/2,0,1)];
  const selected=entries[symbol.shape==="luna-grille"?0:2];
  return {key:"duct",system:"mvhr",stream,role:stream==="supply"?"Dwelling supply":"Dwelling extract",
    positionMm:structuredClone(selected.positionMm),direction:structuredClone(selected.direction),
    interface:{family:"semi-rigid-pe",nominalSizeMm:90,boreMm:null,outsideDiameterMm:null,verificationStatus:"owner-approved-drawing-connection",installationCompatibilityStatus:"unverified"},
    drawingEntries:entries,drawingEntryId:selected.id,drawingConnectionVersion:1};
}
export function terminalDrawingAnchors(component,port) {
  const q=component.orientation;
  return (port.drawingEntries??[]).map(entry=>{
    const p=entry.positionMm,tx=2*(q.y*p.z-q.z*p.y),ty=2*(q.z*p.x-q.x*p.z),tz=2*(q.x*p.y-q.y*p.x);
    return {...entry,positionMm:{x:component.positionMm.x+p.x+q.w*tx+q.y*tz-q.z*ty,y:component.positionMm.y+p.y+q.w*ty+q.z*tx-q.x*tz}};
  });
}
export function enableTerminalDrawingConnection(component) {
  if(component.ports.length)return false;
  const definition=terminalDrawingPortDefinition(component.displaySymbol??component.catalogueSnapshot?.symbol);
  if(!definition)return false;
  component.ports=[{...definition,id:`${component.id}-port-duct`,definitionId:`${component.catalogueItemId}-drawing-dn90-v1`}];
  component.terminalDrawingConnectionVersion=1;
  return true;
}
export function selectTerminalDrawingEntry(project,selection) {
  const component=project.components.find(c=>c.id===selection.componentId);
  const port=component?.ports.find(p=>p.id===selection.portId);
  let entry=port?.drawingEntries?.find(e=>e.id===selection.entryId);
  const symbol=component?.displaySymbol??component?.catalogueSnapshot?.symbol;
  if(selection.entryId === "rim" && symbol?.shape === "luna-grille" && port?.drawingEntries) {
    const p=selection.localPositionMm,r=symbol.widthMm*.21+2;
    if(!Number.isFinite(p?.x)||!Number.isFinite(p?.y)||Math.abs(Math.hypot(p.x,p.y)-r)>1e-4)throw new TypeError("Luna connection must lie on the circle rim");
    entry={id:"rim",positionMm:{x:p.x,y:p.y,z:0},direction:{x:p.x/r,y:p.y/r,z:0}};
  }
  if(!entry)throw new TypeError("Unknown terminal drawing entry");
  const sameEndpoint=e=>e?.componentId===component.id&&e.portId===port.id;
  if(project.routes.some(r=>sameEndpoint(r.startAttachment)||sameEndpoint(r.endAttachment))||project.connections.some(c=>sameEndpoint(c.from)||sameEndpoint(c.to)))throw new TypeError("Terminal already connected; remove the existing route before changing entry");
  port.positionMm=structuredClone(entry.positionMm);port.direction=structuredClone(entry.direction);port.drawingEntryId=entry.id;
}

export function lunaContinuousRimEntry(component,referencePoint) {
  const symbol=component.displaySymbol??component.catalogueSnapshot?.symbol,r=symbol.widthMm*.21+2;
  const dx=referencePoint.x-component.positionMm.x,dy=referencePoint.y-component.positionMm.y;
  const n=Math.hypot(dx,dy),ux=n>1e-8?dx/n:1,uy=n>1e-8?dy/n:0;
  const q=component.orientation,angle=Math.atan2(2*(q.w*q.z+q.x*q.y),1-2*(q.y*q.y+q.z*q.z));
  const c=Math.cos(angle),s=Math.sin(angle);
  return {id:"rim",label:"Circle rim",localPositionMm:{x:(c*ux+s*uy)*r,y:(-s*ux+c*uy)*r,z:0},positionMm:{x:component.positionMm.x+ux*r,y:component.positionMm.y+uy*r}};
}
