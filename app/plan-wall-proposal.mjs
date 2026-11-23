import { MAX_PLAN_WALL_PROPOSALS, MIN_WALL_MM, detectPlanWallCandidates, hasWallOverlap, joinCloseWallEnds, markOpenWallEnds, planSegmentIsInside, rankWallProposals, segmentProjection } from "./plan-wall-candidates.mjs";
import { ROOM_OPENING_MIN_MM, ROOM_OPENING_MAX_MM } from "../src/domain/rooms.mjs";
import { roomPreviewScale } from "./room-test.mjs";

export function mountPlanWallProposal(host, snapshot, accept, checkRooms) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "panel-action";
  button.textContent = "Propose walls from plan";
  host.after(button);
  button.onclick = async () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label","Review proposed plan walls");
    dialog.style.cssText = "box-sizing:border-box;max-width:none;max-height:none;width:calc(100vw - 24px);height:calc(100dvh - 24px);margin:auto;overflow:hidden;padding:12px";
    function element(tag, text, parent) {
      const el = document.createElement(tag);
      if (text) el.textContent=text;
      parent.append(el);
      return el;
    }
    function control(label, parent, action) {
      const el = element("button",label,parent);el.type="button";el.onclick=action;return el;
    }
    const layout=element("div","",dialog);
    layout.style.cssText="height:100%;min-height:0;display:flex;flex-direction:column;gap:8px";
    const toolbar=element("div","",layout);
    toolbar.style.cssText="display:flex;gap:8px;align-items:center;flex-wrap:wrap";
    control("Close without adding",toolbar,()=>dialog.close());
    const status=element("p","Preparing the scaled plan…",layout);
    status.style.margin="0";status.setAttribute("role","status");
    const work=element("div","",layout);
    work.style.cssText="display:flex;flex:1;min-height:0;min-width:0;gap:8px";
    const view=element("div","",work);
    view.style.cssText="flex:1;min-height:0;min-width:0;overflow:auto;background:white";
    const list=element("aside","",work);
    list.style.cssText="overflow:auto;min-width:0";
    list.setAttribute("aria-label","Wall proposals");
    let resize;
    dialog.onclose=()=>{
      resize?.disconnect();
      cancelPaint();
      dialog.remove();
    };
    let cancelPaint=()=>{};
    document.body.append(dialog);dialog.showModal();
    try {
      const input=snapshot();
      const img=new Image();
      img.src=input.dataUrl;
      await img.decode();
      if(!dialog.isConnected)return;
      const p=input.outline, r=input.crop;
      const x0=Math.max(0,r?.x??0,Math.floor(Math.min(...p.map(a=>a.x))));
      const y0=Math.max(0,r?.y??0,Math.floor(Math.min(...p.map(a=>a.y))));
      const w=Math.min(img.naturalWidth,r?r.x+r.width:Infinity,Math.ceil(Math.max(...p.map(a=>a.x))))-x0;
      const h=Math.min(img.naturalHeight,r?r.y+r.height:Infinity,Math.ceil(Math.max(...p.map(a=>a.y))))-y0;
      if(w<1||h<1)throw new Error("The floor outline does not overlap the visible plan.");
      const shrink=Math.min(1,1800/Math.max(w,h));
      const c=element("canvas","",view);c.setAttribute("aria-label","Wall proposal preview");c.width=Math.max(1,Math.round(w*shrink));c.height=Math.max(1,Math.round(h*shrink));
      c.style.cssText="display:block;margin:auto;max-width:none;max-height:none;touch-action:none";
      const sx=c.width/w,sy=c.height/h, toPixel=a=>({x:(a.x-x0)*sx,y:(a.y-y0)*sy});
      const toSource=a=>({x:a.x/sx+x0,y:a.y/sy+y0});
      const outline=p.map(toPixel), existing=input.existing.map(a=>({a:toPixel(a.a),b:toPixel(a.b),classification:a.classification,roomOpening:a.roomOpening}));
      const ctx=c.getContext("2d",{willReadFrequently:true});
      ctx.fillStyle="white";ctx.fillRect(0,0,c.width,c.height);
      ctx.save();ctx.beginPath();outline.forEach((a,i)=>i?ctx.lineTo(a.x,a.y):ctx.moveTo(a.x,a.y));
      ctx.closePath();ctx.clip();ctx.drawImage(img,x0,y0,w,h,0,0,c.width,c.height);ctx.restore();
      const clean=ctx.getImageData(0,0,c.width,c.height);
      const mmPerPixel=input.scale/shrink, tolerance=Math.min(10,Math.max(1,55/mmPerPixel));
      const visible=a=>a.x>=0&&a.y>=0&&a.x<=c.width&&a.y<=c.height;
      const fit=()=>{const compact=dialog.clientWidth<700;
        work.style.flexDirection=compact?"column":"row";
        list.style.flex=compact?"0 0 min(25vh,150px)":"0 0 255px";
        const scale=roomPreviewScale(c.width,c.height,view.clientWidth,view.clientHeight)*zoom;
        c.style.width=Math.floor(c.width*scale)+"px";c.style.height=Math.floor(c.height*scale)+"px";
      };
      let zoom=1, active=-1, drag=null, blocked=false, paint=0, tracing=false, start=null;
      control("Fit plan",toolbar,()=>{zoom=1;fit();});
      control("Zoom −",toolbar,()=>{zoom=Math.max(1,zoom/1.5);fit();});
      control("Zoom +",toolbar,()=>{zoom=Math.min(4,zoom*1.5);fit();});
      resize=new ResizeObserver(fit);resize.observe(view);fit();
      const raw=detectPlanWallCandidates(clean,mmPerPixel,outline);
      const distinct=[];
      const novel=raw.filter(w=>!hasWallOverlap(w,existing,tolerance));
      for(const wall of rankWallProposals(novel,existing.filter(w=>w.classification!=="virtual"),outline,mmPerPixel)){
        if(!hasWallOverlap(wall,distinct,tolerance))distinct.push(wall);
        if(distinct.length===MAX_PLAN_WALL_PROPOSALS)break;
      }
      const proposals=joinCloseWallEnds(distinct,existing,outline,tolerance).map(w=>({...w,checked:false}));
      const weaker=proposals.filter(w=>!w.supported&&!w.masonryReview).length;
      let showWeaker=weaker===proposals.length;
      const toggle=weaker?control("",toolbar,()=>{
        showWeaker=!showWeaker;
        if(!showWeaker && !proposals[active]?.supported && !proposals[active]?.masonryReview && !proposals[active]?.checked)active=-1;
        update();
      }):null;
      const displayed=w=>w.manual||w.supported||w.masonryReview||showWeaker||w.checked;
      cancelPaint=()=>{if(paint)cancelAnimationFrame(paint);};
      const paintSoon=()=>{
        if(!paint)paint=requestAnimationFrame(()=>{paint=0;update();});
      };
      const instructions="Blue lines have more wall evidence. Purple lines may be masonry; grey lines need closer review. Click a line to inspect it, drag its ends if needed, then tick it to add. Orange dots mark ends still open with the current selection.";
      const valid=w=>visible(w.a)&&visible(w.b)&&Math.hypot(w.a.x-w.b.x,w.a.y-w.b.y)*mmPerPixel>=MIN_WALL_MM&&
        (!w.roomOpening||Math.hypot(w.a.x-w.b.x,w.a.y-w.b.y)*mmPerPixel<=ROOM_OPENING_MAX_MM)&&
        planSegmentIsInside(w.a,w.b,outline)&&!hasWallOverlap(w,existing,tolerance);
      const traceButton=control("Trace missing wall",toolbar,()=>{
        tracing=tracing==="wall"?false:"wall";start=null;
        status.textContent=tracing?"Click the two ends of a visible wall. Don’t trace across door openings.":instructions;
        update();
      });
      const openingButton=control("Mark doorway boundary",toolbar,()=>{
        tracing=tracing==="opening"?false:"opening";start=null;
        status.textContent=tracing?openingInstructions:instructions;update();
      });
      const openingInstructions="Click the two physical wall ends at a visible doorway. This marks a room boundary, not a wall.";
      const gauge=element("input","",toolbar);gauge.type="number";gauge.value="100";
      gauge.min="70";gauge.max="420";gauge.step="1";gauge.setAttribute("aria-label","Traced wall thickness in mm");
      gauge.title="Traced wall thickness (mm)";gauge.style.width="76px";
      const traceLabel=element("span","Thickness (mm)",toolbar);
      const checked=()=>proposals.filter(w=>w.checked);
      function selection(){
        const approved=checked();
        if(!approved.length)throw Error("Select walls to check or add.");
        if(approved.length>MAX_PLAN_WALL_PROPOSALS)throw Error("Select at most 60 walls at once.");
        if(approved.some(w=>!valid(w)))throw Error("Review selected walls that are too short, outside the outline or overlap an existing wall.");
        for(let i=0;i<approved.length;i++){
          if(hasWallOverlap(approved[i],approved.slice(0,i),tolerance))throw Error("Two selected proposals overlap. Untick one before continuing.");
        }
        return approved.map(w=>({a:toSource(w.a),b:toSource(w.b),thicknessMm:w.thicknessMm,...(w.roomOpening?{roomOpening:true}:{})}));
      }
      const checkButton=checkRooms?control("Check rooms before adding",toolbar,()=>{
        try {
          const result=checkRooms(input,selection());
          status.textContent=result.rooms
            ? result.rooms+" new closed room "+(result.rooms===1?"boundary":"boundaries")+" with this selection. Nothing added yet."
            : "No new closed room boundaries. Check the orange ends for missing walls. For a real doorway, use Mark doorway boundary. Nothing added yet.";
        } catch(e){status.textContent=e.message;}
      }):null;
      const applyButton=control("Add selected walls",toolbar,()=>{
        if(blocked)return;
        try {accept(input,selection());blocked=true;dialog.close();}
        catch(e){status.textContent=e.message;}
      });
      const countText=element("strong","",list);
      const fields=[];
      const changed=()=>{
        status.textContent=tracing==="opening"?openingInstructions:tracing?"Click the two ends of a visible wall. Don’t trace across door openings.":instructions;
        update();
      };
      function update(){
        const approved=proposals.filter(w=>w.checked);
        const gapEvidence=markOpenWallEnds(proposals,existing,0.001/mmPerPixel);
        if(toggle){
          toggle.textContent=(showWeaker?"Hide":"Show")+" less certain ("+weaker+")";
          toggle.setAttribute("aria-pressed",String(showWeaker));
        }
        ctx.putImageData(clean,0,0);
        ctx.setLineDash([8,5]);ctx.lineWidth=3;
        proposals.forEach((w,i)=>{
          fields[i].row.hidden=!displayed(w);
          if(!displayed(w))return;
          ctx.strokeStyle=!valid(w)?"#b42318":w.roomOpening?"#006b71":w.checked?"#087443":w.supported?"#075e97":w.masonryReview?"#75459a":"#687281";
          ctx.beginPath();ctx.moveTo(w.a.x,w.a.y);ctx.lineTo(w.b.x,w.b.y);ctx.stroke();
          ctx.fillStyle="#a8500c";
          for(const a of w.checked||i===active?gapEvidence[i].gaps:[]){ctx.beginPath();ctx.arc(a.x,a.y,4,0,Math.PI*2);ctx.fill();}
          if(i===active){
            ctx.fillStyle="#075e97";
            for(const a of [w.a,w.b]){ctx.beginPath();ctx.arc(a.x,a.y,7,0,Math.PI*2);ctx.fill();}
          }
          const summary=!valid(w)?"Needs adjusting; cannot add":w.reason+" · "+w.evidence;
          fields[i].detail.textContent=summary+(w.checked||i===active?" · "+gapEvidence[i].gaps.length+" open end(s) with current selection":"");
          fields[i].row.style.outline=i===active?"2px solid #075e97":"";
        });
        if(start){
          ctx.fillStyle="#075e97";ctx.beginPath();ctx.arc(start.x,start.y,6,0,Math.PI*2);ctx.fill();
        }
        ctx.setLineDash([]);
        traceButton.setAttribute("aria-pressed",String(tracing==="wall"));
        openingButton.setAttribute("aria-pressed",String(tracing==="opening"));
        gauge.hidden=tracing!=="wall";traceLabel.hidden=gauge.hidden;
        applyButton.textContent=approved.some(w=>w.roomOpening)?"Add selected boundaries":"Add selected walls";
        applyButton.disabled=Boolean(start)||!approved.length||approved.length>MAX_PLAN_WALL_PROPOSALS||approved.some(w=>!valid(w));
        if(checkButton)checkButton.disabled=applyButton.disabled;
        countText.textContent=approved.length+" of "+proposals.length+" selected"+
          (!showWeaker&&weaker?" · "+proposals.filter(w=>!displayed(w)).length+" hidden":"");
      }
      function addRow(w,i){
        const row=element("div","",list);row.style.cssText="margin:7px 0;padding:5px";
        const label=element("label","",row);label.style.cssText="display:flex;align-items:center;gap:6px";
        const check=element("input","",label);check.type="checkbox";check.style.cssText="width:auto;margin:0";
        label.append(document.createTextNode((w.roomOpening?"Doorway boundary ":w.manual?"Traced wall ":"Wall ")+(i+1)));
        check.checked=w.checked;
        check.onchange=()=>{w.checked=check.checked;active=i;changed();};
        control("Inspect",row,()=>{active=i;update();});
        const detail=element("small","",row);detail.style.display="block";
        fields.push({detail,row});
      }
      proposals.forEach(addRow);
      const pos=e=>{const rect=c.getBoundingClientRect();return {x:(e.clientX-rect.left)*c.width/rect.width,y:(e.clientY-rect.top)*c.height/rect.height};};
      c.onpointerdown=e=>{
        if(e.button!==0||drag)return;
        const p=pos(e),rect=c.getBoundingClientRect();
        const near=q=>Math.hypot((p.x-q.x)*rect.width/c.width,(p.y-q.y)*rect.height/c.height);
        if(tracing){
          const isOpening=tracing==="opening";
          const snapWalls=[...existing,...checked()].filter(w=>!w.roomOpening&&w.classification!=="virtual");
          const radius=Math.min(120/mmPerPixel,12*Math.min(c.width/rect.width,c.height/rect.height));
          const findSnap=points=>{
            let point=null,best=radius;
            for(const q of points){
              if(start&&Math.hypot(q.x-start.x,q.y-start.y)<MIN_WALL_MM/mmPerPixel)continue;
              const dist=Math.hypot(p.x-q.x,p.y-q.y);
              if(dist<best){point=q;best=dist;}
            }
            return point;
          };
          // Prefer the actual corner to a projection just beside it, so a
          // near-corner click doesn't split off a millimetre-long wall.
          const endCandidate=findSnap(snapWalls.flatMap(w=>[w.a,w.b]));
          if(isOpening&&!endCandidate){
            status.textContent="Click near the end of a selected or existing physical wall at the doorway.";return;
          }
          const point=endCandidate||findSnap(snapWalls.map(w=>segmentProjection(p,w.a,w.b)))||p;
          if(!start){
            start=point;status.textContent=isOpening?"Click the opposite jamb.":"Click the other end of the visible wall.";update();return;
          }
          const thicknessMm=isOpening?1:Number(gauge.value);
          const draft={a:start,b:point,thicknessMm,roomOpening:isOpening,manual:true,checked:true,
            reason:isOpening?"Nonphysical room boundary":"Manually traced",evidence:isOpening?"Marked doorway":thicknessMm+" mm"};
          if(!isOpening&&(!Number.isInteger(thicknessMm)||thicknessMm<70||thicknessMm>420)){
            status.textContent="Enter a traced wall thickness between 70 and 420 mm.";return;
          }
          if(!valid(draft)||hasWallOverlap(draft,checked(),tolerance)){
            status.textContent=isOpening?`Choose a clear ${ROOM_OPENING_MIN_MM}–${ROOM_OPENING_MAX_MM} mm opening between wall ends.`:
              "That wall is too short, outside the outline, or overlaps a selected or existing wall. Choose a different end.";return;
          }
          if(proposals.filter(w=>w.manual).length>=MAX_PLAN_WALL_PROPOSALS){
            status.textContent="This preview has reached its traced-wall limit. Add the reviewed walls, then reopen.";return;
          }
          active=proposals.length;proposals.push(draft);addRow(draft,active);
          tracing=false;start=null;status.textContent=isOpening?"Doorway marked, not saved. Check rooms before adding.":"Traced wall selected, not saved. Check rooms before adding.";update();
          fields[active].row.scrollIntoView({block:"nearest"});
          return;
        }
        if(active>=0){
          const w=proposals[active],end=near(w.a)<=near(w.b)?"a":"b";
          if(!w.roomOpening&&near(w[end])<=16){
            drag={w,end,original:w[end],id:e.pointerId};
            c.setPointerCapture(e.pointerId);return;
          }
        }
        let best=12, index=-1;
        proposals.forEach((w,i)=>{
          if(!displayed(w))return;
          const d=near(segmentProjection(p,w.a,w.b));
          if(d<best){best=d;index=i;}
        });
        if(index>=0){
          active=index;update();
          fields[index].row.scrollIntoView({block:"nearest"});
        }
      };
      c.onpointermove=e=>{
        if(!drag||e.pointerId!==drag.id)return;
        const p=pos(e);
        drag.w[drag.end]={x:Math.max(0,Math.min(c.width,p.x)),y:Math.max(0,Math.min(c.height,p.y))};paintSoon();
      };
      c.onpointerup=e=>{if(drag?.id===e.pointerId){drag=null;changed();}};
      const cancelDrag=e=>{
        if(drag?.id!==e.pointerId)return;
        drag.w[drag.end]=drag.original;drag=null;update();
      };
      c.onpointercancel=cancelDrag;
      c.onlostpointercapture=cancelDrag;
      update();
      status.textContent=proposals.length
        ? instructions+" Studio won’t turn the outline into walls or fill doorways."
        : "No clear wall strokes found. Use Trace missing wall to draw visible walls over the plan without leaving this preview.";
    } catch (e){status.textContent=e.message;}
  };
}
