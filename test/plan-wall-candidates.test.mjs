import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {detectPlanWallCandidates,hasWallOverlap,joinCloseWallEnds,markOpenWallEnds,planSegmentIsInside} from "../app/plan-wall-candidates.mjs";
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
test("rejects the portion crossing a concave carport exclusion",()=>{
 const f=pixels(); f.ink(10,71,170,5);
 const cut=[p(0,0),p(200,0),p(200,120),p(130,120),p(130,50),p(70,50),p(70,120),p(0,120)];
 assert.equal(detectPlanWallCandidates(f,20,cut).length,0);
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
test("batch undo is one step and a late error leaves the starting history intact",async()=>{
 const source=readFileSync(new URL("../src/domain/history.mjs",import.meta.url),"utf8").replace(/^import .*$/m,
 'const validateProject = p=>p; const applyCommand = (p,c)=>{ if(c.invalid)throw Error("invalid"); return {...p,walls:[...p.walls,c.wall]}; };');
 const {createCommandHistory,executePlannedCommandBatch,undoCommand,redoCommand}=await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
 const history=createCommandHistory({walls:["old"]});
 assert.throws(()=>executePlannedCommandBatch(history,2,(_,i)=>i===1?{invalid:true}:{wall:"draft"}));
 assert.deepEqual(history.present.walls,["old"]);
 const next=executePlannedCommandBatch(history,2,(p)=>({wall:"wall"+p.walls.length}));
 assert.equal(next.past.length,1);
 assert.deepEqual(next.present.walls,["old","wall1","wall2"]);
 const undo=undoCommand(next);
 assert.deepEqual(undo.present.walls,["old"]);
 assert.deepEqual(redoCommand(undo).present.walls,next.present.walls);
});
