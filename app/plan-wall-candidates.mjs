import { isRoomInsideOutline } from "./room-test-boundaries.mjs";

const overlap=(a,b)=>Math.max(0,Math.min(a.end,b.end)-Math.max(a.start,b.start));
const length=a=>a.end-a.start;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export const MIN_WALL_MM=450;
export function planSegmentIsInside(a,b,outline) {
  return isRoomInsideOutline([a,b,a],outline);
}

// Thick ink or a matched pair of long parallel strokes is evidence, not proof of a wall.
export function detectPlanWallCandidates({data,width,height}, mmPerPixel, outline) {
  if (!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
    width*height>4_000_000||data?.length!==width*height*4||!(mmPerPixel>0)||!Number.isFinite(mmPerPixel)) {
    throw new Error("A calibrated, readable plan image is required.");
  }
  const minRun = Math.max(10,Math.ceil(MIN_WALL_MM/mmPerPixel));
  const maxInkGap = Math.min(3,Math.floor(32/mmPerPixel));
  const minWall = Math.max(3,Math.ceil(70/mmPerPixel));
  const maxWall = Math.max(minWall,Math.floor(420/mmPerPixel));
  const dark=new Uint8Array(width*height);
  for(let i=0,j=0;i<dark.length;i++,j+=4){
    // Reject coloured markup and pale grid lines as well as the white crop mask.
    const r=data[j],g=data[j+1],b=data[j+2];
    dark[i]=data[j+3]>180 && Math.max(r,g,b)<152 && Math.max(r,g,b)-Math.min(r,g,b)<43;
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
      if ((end-start)>=minRun && planSegmentIsInside(a,b,outline)) result.push({
        a,b,thicknessMm:Math.round(Math.max(70,Math.min(420,thickness*mmPerPixel))),evidence
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
  return result.sort((a,b)=>distance(b.a,b.b)-distance(a.a,a.b)).slice(0,60);
}

function segmentProjection(p,a,b){
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
      for(const w of [...existing,...next.filter((_,j)=>j!==i)]){
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
  return walls.map((wall,i)=>({
    ...wall,
    gaps:["a","b"].filter(k=>![...existing,...walls.filter((_,j)=>j!==i)].some(w=>
      distance(wall[k],segmentProjection(wall[k],w.a,w.b))<=tolerance)).map(k=>wall[k])
  }));
}
