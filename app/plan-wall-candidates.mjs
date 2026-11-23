import { containsPlanPoint, isRoomInsideOutline } from "./room-test-boundaries.mjs";

const overlap=(a,b)=>Math.max(0,Math.min(a.end,b.end)-Math.max(a.start,b.start));
const length=a=>a.end-a.start;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export const MIN_WALL_MM=450;
export const MAX_PLAN_WALL_PROPOSALS=60;

// Clip the centreline to each inside run, not its bounding rectangle. The
// raster mask can still leave dark ink overlapping a re-entrant edge.
function insideSpans(a,b,outline){
  if(planSegmentIsInside(a,b,outline))return [[a,b]];
  const horizontal=a.y===b.y, along=horizontal?"x":"y", across=horizontal?"y":"x";
  const start=a[along],end=b[along],track=a[across],cuts=[start,end];
  for(let i=0;i<outline.length;i++){
    const c=outline[i],d=outline[(i+1)%outline.length],delta=d[across]-c[across];
    if(!delta){
      if(c[across]===track)for(const x of [c[along],d[along]])if(x>start&&x<end)cuts.push(x);
      continue;
    }
    const t=(track-c[across])/delta;
    if(t<0||t>1)continue;
    const x=c[along]+t*(d[along]-c[along]);
    if(x>start&&x<end)cuts.push(x);
  }
  cuts.sort((m,n)=>m-n);
  const point=x=>({[along]:x,[across]:track}), spans=[];
  for(let i=1;i<cuts.length;i++){
    const lo=cuts[i-1],hi=cuts[i];
    if(hi-lo<1e-7||!containsPlanPoint(outline,point((lo+hi)/2)))continue;
    if(spans.length&&spans.at(-1)[1][along]===lo)spans.at(-1)[1]=point(hi);
    else spans.push([point(lo),point(hi)]);
  }
  return spans;
}
export function planSegmentIsInside(a,b,outline) {
  return isRoomInsideOutline([a,b,a],outline);
}

// Thick ink or a matched pair of long parallel strokes is evidence, not proof of a wall.
export function detectPlanWallCandidates({data,width,height}, mmPerPixel, outline) {
  if (!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
    width*height>4_000_000||data?.length!==width*height*4||!(mmPerPixel>0)||!Number.isFinite(mmPerPixel)) {
    throw new Error("A calibrated, readable plan image is required.");
  }
  const strong=scanWallInk({data,width,height},mmPerPixel,outline,152);
  if(strong.length>=MAX_PLAN_WALL_PROPOSALS)return strong;
  // A washed-out render can obscure wall edges. Treat the lighter pass as
  // provisional evidence only; never promote a fitting because it is faint.
  const faint=scanWallInk({data,width,height},mmPerPixel,outline,202).filter(w=>
    !hasWallOverlap(w,strong,Math.max(2,50/mmPerPixel)));
  return [...strong,...faint.map(w=>({...w,faint:true}))];
}

function scanWallInk({data,width,height},mmPerPixel,outline,threshold) {
  const minRun = Math.max(10,Math.ceil(MIN_WALL_MM/mmPerPixel));
  const maxInkGap = Math.min(3,Math.floor(32/mmPerPixel));
  const minWall = Math.max(3,Math.ceil(70/mmPerPixel)-(threshold>152?1:0));
  const maxWall = Math.max(minWall,Math.floor(420/mmPerPixel));
  const dark=new Uint8Array(width*height);
  for(let i=0,j=0;i<dark.length;i++,j+=4){
    // Reject coloured markup and pale grid lines as well as the white crop mask.
    const r=data[j],g=data[j+1],b=data[j+2];
    dark[i]=data[j+3]>180 && Math.max(r,g,b)<threshold && Math.max(r,g,b)-Math.min(r,g,b)<43;
  }
  const result=[];
  for(const horizontal of [true,false]){
    const axis=horizontal?width:height, cross=horizontal?height:width;
    const tracks=[]; let active=[];
    for(let line=0;line<cross;line++){
      const next=[], used=new Set();
      let start=-1,last=-1;
      function flush(){
        const run={start,end:last+1};
        if(start>=0 && length(run)>=minRun){
          let previous=null,score=0;
          for(const t of active){
            if(used.has(t))continue;
            const share=overlap(t,run)/Math.max(length(t),length(run));
            if(share>=0.72 && share>score){previous=t;score=share;}
          }
          if(previous){
            used.add(previous);
            previous.to=line;
            // Use the common ink span; a crossing stroke is not an extension.
            previous.start=Math.max(previous.start,run.start);
            previous.end=Math.min(previous.end,run.end);
            next.push(previous);
          } else {
            const t={...run,from:line,to:line};
            tracks.push(t);next.push(t);
          }
        }
        start=-1;last=-1;
      }
      for(let i=0;i<axis;i++){
        if(dark[horizontal?line*width+i:i*width+line]){
          if(start<0)start=i;
          last=i;
        }else if(start>=0 && i-last>maxInkGap)flush();
      }
      flush();active=next;
    }
    const bands=tracks.filter(t=>length(t)>=minRun).map(t=>({...t,center:(t.from+t.to)/2,ink:t.to-t.from+1}));
    const add=(start,end,center,thickness,evidence)=>{
      const a=horizontal?{x:start,y:center}:{x:center,y:start};
      const b=horizontal?{x:end,y:center}:{x:center,y:end};
      for(const [from,to] of insideSpans(a,b,outline)) if(distance(from,to)>=minRun) result.push({
        a:from,b:to,thicknessMm:Math.round(Math.max(70,Math.min(420,thickness*mmPerPixel))),evidence
      });
    };
    const used=new Set();
    for(const [i,a] of bands.entries()){
      if(a.ink>=minWall && a.ink<=maxWall && length(a)>=2*a.ink){
        add(a.start,a.end,a.center,a.ink,"Solid wall-width stroke");used.add(i);
      }
    }
    for(const [i,a] of bands.entries()){
      if(used.has(i)||a.ink>=minWall)continue;
      let match=-1,score=0;
      for(let j=i+1;j<bands.length;j++){
        const b=bands[j], separation=b.center-a.center;
        if(b.from-a.from>maxWall+4)break;
        if(used.has(j)||b.ink>=minWall||separation<minWall||separation>maxWall)continue;
        const aligned=overlap(a,b)/Math.max(length(a),length(b));
        if(aligned>=0.72 && overlap(a,b)>=Math.max(minRun,2.5*separation) &&
          aligned-separation/(5*maxWall)>score){match=j;score=aligned-separation/(5*maxWall);}
      }
      if(match>=0){
        const b=bands[match];
        used.add(i);used.add(match);
        add(Math.max(a.start,b.start),Math.min(a.end,b.end),(a.center+b.center)/2,b.center-a.center,"Parallel wall edges");
      }
    }
  }
  return result.sort((a,b)=>distance(b.a,b.b)-distance(a.a,a.b)).slice(0,3*MAX_PLAN_WALL_PROPOSALS);
}

export function segmentProjection(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,m=dx*dx+dy*dy;
  const t=m?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/m)):0;
  return {x:a.x+dx*t,y:a.y+dy*t};
}

export function hasWallOverlap(wall, existing, tolerance) {
  const {a,b}=wall, len=distance(a,b);
  if(!len)return false;
  const x=(b.x-a.x)/len,y=(b.y-a.y)/len;
  return existing.some(({a:c,b:d})=>{
    const q=distance(c,d);
    if(!q||Math.abs((d.x-c.x)*y-(d.y-c.y)*x)>q*0.06)return false;
    if(Math.abs((c.x-a.x)*y-(c.y-a.y)*x)>tolerance)return false;
    const start=(c.x-a.x)*x+(c.y-a.y)*y,end=(d.x-a.x)*x+(d.y-a.y)*y;
    return Math.min(len,Math.max(start,end))-Math.max(0,Math.min(start,end))>tolerance;
  });
}

export function joinCloseWallEnds(walls,existing,outline,tolerance){
  const next=walls.map(w=>({...w,a:{...w.a},b:{...w.b}}));
  next.forEach((wall,i)=>{
    for(const end of ["a","b"]){
      const from=wall[end],other=wall[end==="a"?"b":"a"];
      let closest=null,best=tolerance;
      for(const w of [...existing,...next.filter((peer,j)=>j!==i&&peer.supported!==false)]){
        const ux=from.x-other.x,uy=from.y-other.y,vx=w.b.x-w.a.x,vy=w.b.y-w.a.y;
        const axes=Math.hypot(ux,uy)*Math.hypot(vx,vy);
        const parallel=axes&&Math.abs(ux*vy-uy*vx)<0.2*axes;
        // Do not pull a proposal sideways onto a neighbouring parallel line.
        if(parallel&&Math.abs(ux*(w.a.y-from.y)-uy*(w.a.x-from.x))/Math.hypot(ux,uy)>tolerance/4)continue;
        const cand=segmentProjection(from,w.a,w.b), gap=distance(cand,from);
        if(gap<best && distance(other,cand)>tolerance*2 &&
          planSegmentIsInside(cand,other,outline)){closest=cand;best=gap;}
      }
      if(closest)wall[end]=closest;
    }
  });
  return next;
}

export function markOpenWallEnds(walls,existing,tolerance) {
  return walls.map((wall,i)=>{
    const peers=[...existing,...walls.filter((w,j)=>j!==i && w.checked!==false)];
    return {...wall,gaps:["a","b"].filter(k=>!peers.some(w=>
      distance(wall[k],segmentProjection(wall[k],w.a,w.b))<=tolerance)).map(k=>wall[k])};
  });
}


// Separate ink evidence from useful context. A traced outline can corroborate
// a candidate, but is deliberately never copied or used as a snap target.
export function rankWallProposals(walls, existing, outline, mmPerPixel) {
  const context=110/mmPerPixel, perimeter=220/mmPerPixel;
  const edges=outline.map((a,i)=>({a,b:outline[(i+1)%outline.length]}));
  const gap=(p,w)=>distance(p,segmentProjection(p,w.a,w.b));
  const near=(a,b)=>[a.a,a.b].some(p=>gap(p,b)<=context)||[b.a,b.b].some(p=>gap(p,a)<=context);
  const meta=walls.map(w=>{
    const ends=[w.a,w.b];
    const perimeterRun=edges.some(e=>[...ends,{x:(w.a.x+w.b.x)/2,y:(w.a.y+w.b.y)/2}]
      .every(p=>gap(p,e)<=perimeter));
    return {perimeterRun,confirmed:existing.some(e=>near(w,e)),
      outlineEnds:ends.filter(p=>edges.some(e=>gap(p,e)<=perimeter)).length,
      adjacent:[]};
  });
  const linked=(a,b)=>{
    const ux=a.b.x-a.a.x,uy=a.b.y-a.a.y,vx=b.b.x-b.a.x,vy=b.b.y-b.a.y;
    // Parallel cabinet edges do not independently corroborate each other.
    return Math.abs(ux*vy-uy*vx)>0.5*Math.hypot(ux,uy)*Math.hypot(vx,vy)&&near(a,b);
  };
  for(let i=0;i<walls.length;i++)for(let j=i+1;j<walls.length;j++){
    if(linked(walls[i],walls[j])){meta[i].adjacent.push(j);meta[j].adjacent.push(i);}
  }
  return walls.map((wall,i)=>{
    const {perimeterRun,confirmed,outlineEnds,adjacent}=meta[i];
    const mm=distance(wall.a,wall.b)*mmPerPixel;
    const anchoredPeers=adjacent.filter(j=>meta[j].confirmed||meta[j].outlineEnds||meta[j].perimeterRun).length;
    const attachedToPerimeterAtBothEnds=outlineEnds===2&&mm>=1200;
    const supported=confirmed||perimeterRun&&mm>=1200||attachedToPerimeterAtBothEnds||
      (wall.faint ? mm>=3000&&anchoredPeers>=2 : (outlineEnds===1&&mm>=2350) ||
        (anchoredPeers>=1&&mm>=2400) || (adjacent.length>=2&&mm>=2700));
    const reason=confirmed?"Connects to a Studio wall":perimeterRun&&supported?"Follows the traced perimeter":
      outlineEnds&&supported?"Reaches the traced perimeter":supported?"Joins other long wall strokes":
      !adjacent.length&&!outlineEnds?"Isolated stroke; check for fittings":"Unconfirmed link; check against plan";
    const score=Number(supported)*100 + Number(confirmed)*30 + Number(perimeterRun)*12 +
      outlineEnds*8 + Math.min(anchoredPeers,2)*6 + Math.min(10,mm/500);
    return {...wall,supported,reason:reason+(wall.faint?" · Faint ink":""),score};
  }).sort((a,b)=>b.score-a.score);
}
