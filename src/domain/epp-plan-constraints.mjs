const EPS = 1e-6;
export function isEppPlanSegment(a,b) {
  const dx=Math.abs(b.x-a.x),dy=Math.abs(b.y-a.y);
  return dx<EPS || dy<EPS || Math.abs(dx-dy)<EPS;
}

// Keep exact end ports. Correct small corner offsets, otherwise insert an axial/45-degree leg.
export function constrainEppPlanPoints(points) {
  if (points.length<2) return points.map(p=>structuredClone(p));
  const result=[structuredClone(points[0])];
  for (const original of points.slice(1)) {
    const b=structuredClone(original);
    let a=result.at(-1);
    if (!isEppPlanSegment(a,b) && result.length>1) {
      const previous=result.at(-2), dx=a.x-previous.x,dy=a.y-previous.y;
      const candidates=[];
      for (const [vx,vy] of [[1,0],[0,1],[1,1],[1,-1]]) {
        const det=dx*vy-dy*vx;
        if(Math.abs(det)<EPS) continue;
        const t=((b.x-previous.x)*vy-(b.y-previous.y)*vx)/det;
        if(t<=EPS) continue;
        const p={...a,x:previous.x+t*dx,y:previous.y+t*dy};
        const distance=Math.hypot(p.x-a.x,p.y-a.y);
        if(distance<=100 && Math.hypot(p.x-b.x,p.y-b.y)>EPS) candidates.push({p,distance});
      }
      candidates.sort((u,v)=>u.distance-v.distance);
      if(candidates.length) { result[result.length-1]=candidates[0].p; a=result.at(-1); }
    }
    if (!isEppPlanSegment(a,b)) {
      const dx=b.x-a.x,dy=b.y-a.y,diagonal=Math.min(Math.abs(dx),Math.abs(dy));
      const choices=[{x:b.x,y:a.y},{x:a.x,y:b.y},
        {x:a.x+Math.sign(dx)*diagonal,y:a.y+Math.sign(dy)*diagonal},
        {x:b.x-Math.sign(dx)*diagonal,y:b.y-Math.sign(dy)*diagonal}];
      const prev=result.at(-2);
      const score=p=>{
        let penalty=0;
        if(prev) { const ux=a.x-prev.x,uy=a.y-prev.y,vx=p.x-a.x,vy=p.y-a.y;
          const dot=(ux*vx+uy*vy)/(Math.hypot(ux,uy)*Math.hypot(vx,vy));
          if(dot < -0.01) penalty=1e9;
        }
        return penalty+Math.hypot(p.x-a.x,p.y-a.y)+Math.hypot(b.x-p.x,b.y-p.y);
      };
      choices.sort((u,v)=>score(u)-score(v));
      const corner=choices[0];
      if(a.z || b.z) {
        const total=Math.hypot(corner.x-a.x,corner.y-a.y)+Math.hypot(b.x-corner.x,b.y-corner.y);
        const fraction=Math.hypot(corner.x-a.x,corner.y-a.y)/total;
        corner.z=a.z?.state!=="unknown" && b.z?.state!=="unknown" && a.z && b.z
          ? {state:"assumed",valueMm:a.z.valueMm+(b.z.valueMm-a.z.valueMm)*fraction,provenance:"interpolated EPP corner elevation"}
          : {state:"unknown",valueMm:null,reason:"EPP corner elevation not set"};
      }
      result.push(corner);
    }
    if(Math.hypot(b.x-result.at(-1).x,b.y-result.at(-1).y)>EPS || result.at(-1).z?.valueMm!==b.z?.valueMm) result.push(b);
  }
  return result.length>=2 ? result : points.map(p=>structuredClone(p));
}

export function alignEppPortApproaches(points,startDirection,endDirection,stubMm=320) {
  points=trimEndpointClick(points,endDirection,stubMm*1.5,false);
  points=trimEndpointClick(points.slice().reverse(),startDirection,stubMm*1.5,false).reverse();
  const direction = d => {
    const n=Math.hypot(d?.x??0,d?.y??0);
    if(n<1e-6) return null;
    const unit={x:d.x/n,y:d.y/n};
    if(!isEppPlanSegment({x:0,y:0},unit)) throw new TypeError("EPP connection orientation must be horizontal, vertical or 45 degrees");
    return unit;
  };
  const start=points[0],end=points.at(-1),sd=direction(startDirection),ed=direction(endDirection);
  const inline=(p,port,d)=>!d || (Math.abs((p.x-port.x)*d.y-(p.y-port.y)*d.x)<1e-6 && (p.x-port.x)*d.x+(p.y-port.y)*d.y>1e-6);
  const addStart=sd && !inline(points[1],start,sd),addEnd=ed && !inline(points.at(-2),end,ed);
  if(!addStart&&!addEnd) return constrainEppPlanPoints(points);
  const first=addStart ? {...start,x:start.x+sd.x*stubMm,y:start.y+sd.y*stubMm} : start;
  const last=addEnd ? {...end,x:end.x+ed.x*stubMm,y:end.y+ed.y*stubMm} : end;
  let aligned=constrainEppPlanPoints([...(addStart?[structuredClone(start)]:[]),first,...points.slice(1,-1),last,...(addEnd?[structuredClone(end)]:[])]);
  aligned=repairEndTurn(aligned,stubMm);
  aligned=repairEndTurn(aligned.slice().reverse(),stubMm).reverse();
  return aligned;
}

function repairEndTurn(points,stubMm) {
  if(points.length<3)return points;
  const a=points.at(-3),b=points.at(-2),end=points.at(-1);
  const ux=b.x-a.x,uy=b.y-a.y,vx=end.x-b.x,vy=end.y-b.y;
  if(ux*vx+uy*vy>=-1e-6)return points;
  const n=Math.hypot(vx,vy);if(n<1e-6)return points;
  const candidates=[-1,1].map(sign=>{
    const ox=-vy/n*stubMm*sign,oy=vx/n*stubMm*sign;
    return constrainEppPlanPoints([...points.slice(0,-2),{...a,x:a.x+ox,y:a.y+oy},{...b,x:b.x+ox,y:b.y+oy},b,end]);
  });
  const badTurns=ps=>ps.slice(1,-1).reduce((sum,p,i)=>sum+((p.x-ps[i].x)*(ps[i+2].x-p.x)+(p.y-ps[i].y)*(ps[i+2].y-p.y)<-1e-6?1:0),0);
  candidates.sort((a,b)=>badTurns(a)-badTurns(b));return candidates[0];
}


// Remove only nearby terminal click points when they fight the final port approach.
// Known elevation transitions are never discarded as redundant plan clicks.
function trimEndpointClick(input,direction,radius,force) {
  const points=input.map(point=>structuredClone(point));
  if(points.length<3)return points;
  const end=points.at(-1),last=points.at(-2);
  const dx=direction?.x??0,dy=direction?.y??0;
  const alreadyInline=Math.hypot(dx,dy)<EPS || (Math.abs((last.x-end.x)*dy-(last.y-end.y)*dx)<EPS && (last.x-end.x)*dx+(last.y-end.y)*dy>EPS);
  if(!force && alreadyInline)return points;
  while(points.length>2) {
    const near=points.at(-2),previous=points.at(-3);
    if(Math.hypot(near.x-end.x,near.y-end.y)>radius)break;
    const measurements=[previous.z,near.z,end.z];
    const known=measurements.filter(z=>z && z.state!=="unknown");
    if(known.length && (known.length!==3 || known.some(z=>Math.abs(z.valueMm-known[0].valueMm)>EPS)))break;
    points.splice(points.length-2,1);
  }
  return points;
}

export function realignEppPlanConnections(points,startDirection,endDirection,stubMm=320) {
  let compact=trimEndpointClick(points,endDirection,stubMm*2,true);
  compact=trimEndpointClick(compact.slice().reverse(),startDirection,stubMm*2,true).reverse();
  return alignEppPortApproaches(compact,startDirection,endDirection,stubMm);
}

// HRV EPP routes rise to a ceiling elbow before following the drawn plan run.
// Its outlet follows the route; the unit's schematic side direction is not a plan constraint.
export function hasHrvCeilingElbow(component, port) {
  if (port?.system !== "mvhr" || ![125,160].includes(port.interface?.nominalSizeMm)) return false;
  const roles=new Set((component?.ports??[]).filter(p=>p.system==="mvhr").map(p=>p.role));
  return ["Dwelling supply","Dwelling extract","Outdoor intake","Outdoor exhaust"].every(role=>roles.has(role));
}
