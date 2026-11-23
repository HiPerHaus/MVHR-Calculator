import { MAX_PLAN_WALL_PROPOSALS, MIN_WALL_MM, detectPlanWallCandidates, hasWallOverlap, joinCloseWallEnds, markOpenWallEnds, planSegmentIsInside, rankWallProposals, segmentProjection } from "./plan-wall-candidates.mjs";
import { roomPreviewScale } from "./room-test.mjs";

export function mountPlanWallProposal(host, snapshot, accept) {
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
      const outline=p.map(toPixel), existing=input.existing.map(a=>({a:toPixel(a.a),b:toPixel(a.b),classification:a.classification}));
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
      let zoom=1, active=-1, drag=null, blocked=false, paint=0;
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
      const weaker=proposals.filter(w=>!w.supported).length;
      let showWeaker=weaker===proposals.length;
      const toggle=weaker?control("",toolbar,()=>{
        showWeaker=!showWeaker;
        if(!showWeaker && !proposals[active]?.supported && !proposals[active]?.checked)active=-1;
        update();
      }):null;
      const displayed=w=>w.supported||showWeaker||w.checked;
      cancelPaint=()=>{if(paint)cancelAnimationFrame(paint);};
      const paintSoon=()=>{
        if(!paint)paint=requestAnimationFrame(()=>{paint=0;update();});
      };
      const instructions="Blue lines have more wall evidence; grey lines need closer review. Click a line to inspect it, drag its ends if needed, then tick it to add. Orange dots mark ends still open with the current selection.";
      const valid=w=>visible(w.a)&&visible(w.b)&&Math.hypot(w.a.x-w.b.x,w.a.y-w.b.y)*mmPerPixel>=MIN_WALL_MM&&
        planSegmentIsInside(w.a,w.b,outline)&&!hasWallOverlap(w,existing,tolerance);
      const applyButton=control("Add selected walls",toolbar,()=>{
        if(blocked)return;
        const approved=proposals.filter(w=>w.checked);
        if(!approved.length)return;
        if(approved.some(w=>!valid(w))) {status.textContent="Review selected walls that are too short, outside the outline or overlap an existing wall.";return;}
        for(let i=0;i<approved.length;i++){
          if(hasWallOverlap(approved[i],approved.slice(0,i),tolerance)){status.textContent="Two selected proposals overlap. Untick one before adding.";return;}
        }
        try {
          accept(input,approved.map(w=>({a:toSource(w.a),b:toSource(w.b),thicknessMm:w.thicknessMm})));
          blocked=true;dialog.close();
        } catch(e){status.textContent=e.message;}
      });
      const countText=element("strong","",list);
      const fields=[];
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
          ctx.strokeStyle=!valid(w)?"#b42318":w.checked?"#087443":w.supported?"#075e97":"#687281";
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
        ctx.setLineDash([]);
        applyButton.disabled=!approved.length||approved.some(w=>!valid(w));
        countText.textContent=approved.length+" of "+proposals.length+" selected"+
          (!showWeaker&&weaker?" · "+proposals.filter(w=>!displayed(w)).length+" hidden":"");
      }
      proposals.forEach((w,i)=>{
        const row=element("div","",list);row.style.cssText="margin:7px 0;padding:5px";
        const label=element("label","",row);label.style.cssText="display:flex;align-items:center;gap:6px";
        const check=element("input","",label);check.type="checkbox";check.style.cssText="width:auto;margin:0";
        label.append(document.createTextNode("Wall "+(i+1)));
        check.onchange=()=>{w.checked=check.checked;active=i;update();};
        control("Inspect",row,()=>{active=i;update();});
        const detail=element("small","",row);detail.style.display="block";
        fields.push({detail,row});
      });
      const pos=e=>{const rect=c.getBoundingClientRect();return {x:(e.clientX-rect.left)*c.width/rect.width,y:(e.clientY-rect.top)*c.height/rect.height};};
      c.onpointerdown=e=>{
        if(e.button!==0||drag)return;
        const p=pos(e),rect=c.getBoundingClientRect();
        const near=q=>Math.hypot((p.x-q.x)*rect.width/c.width,(p.y-q.y)*rect.height/c.height);
        if(active>=0){
          const w=proposals[active],end=near(w.a)<=near(w.b)?"a":"b";
          if(near(w[end])<=16){
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
      c.onpointerup=e=>{if(drag?.id===e.pointerId)drag=null;};
      const cancelDrag=e=>{
        if(drag?.id!==e.pointerId)return;
        drag.w[drag.end]=drag.original;drag=null;update();
      };
      c.onpointercancel=cancelDrag;
      c.onlostpointercapture=cancelDrag;
      update();
      status.textContent=proposals.length
        ? instructions+" Studio won’t turn the outline into walls or fill doorways."
        : "No clear wall strokes found inside the outline. Try a sharper, straight-on plan or use the manual Wall tool.";
    } catch (e){status.textContent=e.message;}
  };
}
