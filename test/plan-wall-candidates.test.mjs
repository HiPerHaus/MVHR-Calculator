import {test} from "node:test";
import assert from "node:assert/strict";
import {detectPlanWallCandidates,hasWallOverlap,joinCloseWallEnds,markOpenWallEnds,planSegmentIsInside,rankWallProposals} from "../app/plan-wall-candidates.mjs";
const p=(x,y)=>({x,y});
const outline=[p(0,0),p(200,0),p(200,120),p(0,120)];
const wall=(a,b)=>({a,b});
function pixels(){
 const width=200,height=120,data=new Uint8ClampedArray(width*height*4).fill(255);
 const ink=(x,y,w,h,color=[0,0,0])=>{for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)data.set(color,4*(j*width+i));};
 return {width,height,data,ink};
}
test("detects a long paired wall and a solid wall while ignoring single strokes and markup",()=>{
 const f=pixels();
 f.ink(12,15,70,1);f.ink(12,21,70,1);  // 120 mm paired horizontal
 f.ink(144,37,5,58);                     // 100 mm solid vertical
 f.ink(20,70,68,1);                      // single thin dimension
 f.ink(20,90,80,6,[219,42,25]);          // coloured annotation
 const out=detectPlanWallCandidates(f,20,outline);
 assert.equal(out.length,2);
 assert(out.some(a=>a.a.y===18&&a.thicknessMm===120));
 assert(out.some(a=>a.a.x===146&&a.thicknessMm===100));
});
test("leaves a doorway gap unfilled and reports open ends",()=>{
 const f=pixels();f.ink(10,41,50,5);f.ink(100,41,64,5);
 const out=detectPlanWallCandidates(f,20,outline);
 assert.equal(out.length,2);
 assert(out.every(w=>w.b.x<=60||w.a.x>=100));
 assert(markOpenWallEnds(joinCloseWallEnds(out,[],outline,3),[],1).every(w=>w.gaps.length===2));
});
test("clips to both inside portions of a concave carport exclusion",()=>{
 const f=pixels(); f.ink(10,71,170,5);
 const cut=[p(0,0),p(200,0),p(200,120),p(130,120),p(130,50),p(70,50),p(70,120),p(0,120)];
 const clipped=detectPlanWallCandidates(f,20,cut);
 assert.equal(clipped.length,2);
 assert(clipped.every(w=>w.b.x<=70||w.a.x>=130));
 assert(!planSegmentIsInside(p(10,73),p(180,73),cut));
});
test("joins only short clear gaps, without moving existing geometry or filling doorways",()=>{
 const original=[wall(p(40,12),p(40,100))];
 const walls=[wall(p(12,45),p(39,45)),wall(p(70,45),p(110,45))];
 const after=joinCloseWallEnds(walls,original,outline,3);
 assert.deepEqual(after[0].b,p(40,45));
 assert.deepEqual(after[1],walls[1]);
 assert.deepEqual(walls[0].b,p(39,45));
 assert.deepEqual(original[0].a,p(40,12));
 assert.equal(markOpenWallEnds(after,original,0.5)[0].gaps.length,1);
});
test("blocks an overlapping wall, not a T junction or nearby parallel wall",()=>{
 const existing=[wall(p(10,15),p(150,15))];
 assert(hasWallOverlap(wall(p(20,16),p(60,16)),existing,3));
 assert(!hasWallOverlap(wall(p(20,22),p(60,22)),existing,3));
 assert(!hasWallOverlap(wall(p(45,15),p(45,95)),existing,3));
});
test("a real partition leads the list while an isolated island and a perimeter cupboard stay in review",()=>{
 const perimeter={...wall(p(5,3),p(195,3)),structuralInk:true,thicknessMm:180};
 const partition={...wall(p(80,3),p(80,105)),structuralInk:true,thicknessMm:110};
 const island=[wall(p(105,49),p(155,49)),wall(p(105,49),p(105,69)),wall(p(155,49),p(155,69))];
 const cupboard=wall(p(95,103),p(195,103));
 const ranked=rankWallProposals([cupboard,...island,perimeter,partition],[],outline,30);
 assert.deepEqual(ranked.filter(w=>w.supported).map(w=>w.a),[perimeter.a,partition.a]);
 assert.equal(ranked.length,6);
});
test("faint render recovers corroborated perimeter without promoting an isolated fitting",()=>{
 const f=pixels();f.ink(10,2,170,8,[187,185,182]);f.ink(75,60,50,5,[187,185,182]);
 const ranked=rankWallProposals(detectPlanWallCandidates(f,20,outline),[],outline,20);
 assert.equal(ranked.length,2);
 assert.equal(ranked[0].supported,true);assert.equal(ranked[0].faint,true);
 assert.equal(ranked[1].supported,false);assert.equal(ranked[1].faint,true);
});
test("opening indicators reflect selected or already placed walls rather than unselected suggestions",()=>{
 const a=wall(p(20,15),p(160,15));
 const b=wall(p(60,15),p(60,100));
 const stale=markOpenWallEnds([{...a,checked:false},{...b,checked:true}],[],0.001);
 assert.deepEqual(stale[1].gaps,[b.a,b.b]);
 assert.deepEqual(markOpenWallEnds([{...a,checked:true},{...b,checked:true}],[],0.001)[1].gaps,[b.b]);
 assert.deepEqual(markOpenWallEnds([{...b,checked:true}],[a],0.001)[0].gaps,[b.b]);
});
test("snap does not shift onto a neighbouring parallel stroke",()=>{
 const a=wall(p(12,30),p(90,30));
 const b=wall(p(90,32),p(160,32));
 assert.deepEqual(joinCloseWallEnds([a,b],[],outline,4),[a,b]);
});
test("a blank imported plan does not turn the traced outline into walls",()=>{
 assert.deepEqual(detectPlanWallCandidates(pixels(),20,outline),[]);
});
test("a low-confidence fitting cannot pull a likely wall endpoint out of place",()=>{
 const a={...wall(p(12,30),p(90,30)),supported:true};
 const b={...wall(p(92,20),p(92,70)),supported:false};
 assert.deepEqual(joinCloseWallEnds([a,b],[],outline,4)[0],a);
});
test("perimeter glazing lines and a long cupboard with a short return both stay unconfirmed",()=>{
 const f=pixels();
 for(const y of [4,9,15])f.ink(12,y,128,1);
 const glazing=detectPlanWallCandidates(f,15,outline).filter(w=>w.a.y<20);
 assert(glazing.length);
 const cupboard={...wall(p(120,60),p(199,60)),thicknessMm:384,evidence:"Parallel wall edges"};
 const returnLeg=wall(p(120,60),p(120,82));
 const ranked=rankWallProposals([...glazing,cupboard,returnLeg],[],outline,30);
 assert(ranked.every(w=>!w.supported));
 assert(ranked.some(w=>w.reason.includes("glazing")));
});
test("a hatched masonry band is found in faint ink without bridging a doorway",()=>{
 const f=pixels();
 for(const [x,w] of [[12,65],[122,65]]){
   for(const y of [38,50])f.ink(x,y,w,1,[175,175,175]);
   for(let n=0;n<w;n++)for(let y=39;y<50;y++)
     if((n+y)%6<2)f.ink(x+n,y,1,1,[175,175,175]);
 }
 const ranked=rankWallProposals(detectPlanWallCandidates(f,20,outline),[],outline,20);
 const hatched=ranked.filter(w=>w.hatched);
 assert.equal(hatched.length,2);
 assert(hatched.every(w=>w.b.x<=77||w.a.x>=122));
 const narrow={...hatched[0],thicknessMm:90};
 const review=rankWallProposals([narrow],[],outline,20)[0];
 assert.equal(review.supported,false);
 assert.equal(review.masonryReview,true);
});
test("a long narrow partition can rank ahead without elevating both lips of a cupboard",()=>{
 const part={...wall(p(75,3),p(75,105)),thicknessMm:95,evidence:"Parallel wall edges"};
 const outer={...wall(p(101,55),p(196,55)),thicknessMm:95,evidence:"Parallel wall edges"};
 const inner={...wall(p(101,78),p(196,78)),thicknessMm:95,evidence:"Parallel wall edges",faint:true};
 const ranked=rankWallProposals([part,outer,inner],[],outline,30);
 assert.equal(ranked.filter(w=>w.supported).length,1);
 assert.deepEqual(ranked[0].a,part.a);
 assert.match(ranked[0].reason,/Long narrow partition/);
});
test("a continuous nearby dimension line does not create one masonry proposal across an opening",()=>{
 const f=pixels(), segments=[[12,63],[119,69]];
 f.ink(10,32,180,1,[175,175,175]);f.ink(10,53,180,1,[175,175,175]);
 for(const [x,w] of segments){
   f.ink(x,39,w,1,[175,175,175]);f.ink(x,47,w,1,[175,175,175]);
   for(let n=0;n<w;n++)for(let y=40;y<47;y++)
     if((n+y)%7<2)f.ink(x+n,y,1,1,[175,175,175]);
 }
 const out=detectPlanWallCandidates(f,20,outline);
 assert(out.some(w=>w.hatched&&w.b.x<80));
 assert(out.some(w=>w.hatched&&w.a.x>115));
 assert(!out.some(w=>w.a.x<70&&w.b.x>125&&w.a.y>35&&w.a.y<50));
});
