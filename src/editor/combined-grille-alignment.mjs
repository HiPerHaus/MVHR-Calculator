function localPortTransform(component,port){
  const q=component.orientation;
  const rotate=p=>{const tx=2*(q.y*p.z-q.z*p.y),ty=2*(q.z*p.x-q.x*p.z),tz=2*(q.x*p.y-q.y*p.x);return {x:p.x+q.w*tx+q.y*tz-q.z*ty,y:p.y+q.w*ty+q.z*tx-q.x*tz,z:p.z+q.w*tz+q.x*ty-q.y*tx};};
  const p=rotate(port.positionMm);
  return {positionMm:{x:component.positionMm.x+p.x,y:component.positionMm.y+p.y},direction:rotate(port.direction)};
}

// Magnetic alignment of both typed air paths; optional placement facing selection. Never creates a duct.
export function findCombinedGrilleAlignment(project,grille,point,{toleranceMm=100,allowHandingChange=false,allowRotation=false}={}){
  if(grille.catalogueItemId!=="generic-external-grille-combined-dn160")return null;
  const connectedUnits=new Set((project.routes??[]).flatMap(route=>route.startAttachment?.componentId===grille.id?[route.endAttachment?.componentId]:route.endAttachment?.componentId===grille.id?[route.startAttachment?.componentId]:[]).filter(Boolean));
  const baseHanding=grille.externalGrilleHanding??"left",candidates=[];
  for(const angle of allowRotation?[0,Math.PI/2,Math.PI,3*Math.PI/2]:[0])for(const flipped of allowHandingChange?[false,true]:[false]){
    const candidate=structuredClone(grille);candidate.positionMm.x=point.x;candidate.positionMm.y=point.y;
    if(angle){const q=candidate.orientation,c=Math.cos(angle/2),s=Math.sin(angle/2);candidate.orientation={w:c*q.w-s*q.z,x:c*q.x-s*q.y,y:c*q.y+s*q.x,z:c*q.z+s*q.w};}
    if(flipped){for(const port of candidate.ports){port.positionMm.y=-port.positionMm.y;port.direction.y=-port.direction.y;}candidate.externalGrilleHanding=baseHanding==="left"?"right":"left";}
    const intake=candidate.ports.find(p=>p.stream==="intake"),exhaust=candidate.ports.find(p=>p.stream==="exhaust");
    const a=localPortTransform(candidate,intake),b=localPortTransform(candidate,exhaust);
    const magnitude=Math.hypot(a.direction.x,a.direction.y);if(magnitude<1e-8)continue;
    const d={x:a.direction.x/magnitude,y:a.direction.y/magnitude},n={x:-d.y,y:d.x};
    for(const unit of project.components){
      if(unit.id===grille.id || unit.floorId!==grille.floorId || (connectedUnits.size && !connectedUnits.has(unit.id)))continue;
      const roles=new Set(unit.ports.map(p=>p.role));if(!["Dwelling supply","Dwelling extract","Outdoor intake","Outdoor exhaust"].every(role=>roles.has(role)))continue;
      const up=unit.ports.find(p=>p.stream==="intake"&&p.interface?.nominalSizeMm===160),vp=unit.ports.find(p=>p.stream==="exhaust"&&p.interface?.nominalSizeMm===160);if(!up||!vp)continue;
      const u=localPortTransform(unit,up).positionMm,v=localPortTransform(unit,vp).positionMm;
      const correction=(u.x-a.positionMm.x)*n.x+(u.y-a.positionMm.y)*n.y;
      const second=(v.x-b.positionMm.x)*n.x+(v.y-b.positionMm.y)*n.y;
      if(Math.abs(correction-second)>1e-5 || Math.abs(correction)>toleranceMm)continue;
      // The grille's rear connections must face toward the HRV.
      const forward=(u.x-a.positionMm.x)*d.x+(u.y-a.positionMm.y)*d.y;
      if(forward<160)continue;
      const position={x:point.x+n.x*correction,y:point.y+n.y*correction};
      candidate.positionMm.x=position.x;candidate.positionMm.y=position.y;
      candidates.push({point:position,component:structuredClone(candidate),unitId:unit.id,unitName:unit.displayName??unit.id,handing:candidate.externalGrilleHanding??baseHanding,
        correctionMm:Math.abs(correction),score:Math.abs(correction)+forward*1e-7,
        guides:[{stream:"intake",from:u,to:{x:a.positionMm.x+n.x*correction,y:a.positionMm.y+n.y*correction}},{stream:"exhaust",from:v,to:{x:b.positionMm.x+n.x*correction,y:b.positionMm.y+n.y*correction}}]});
    }
  }
  candidates.sort((a,b)=>a.score-b.score || a.unitId.localeCompare(b.unitId));
  return candidates[0]??null;
}
