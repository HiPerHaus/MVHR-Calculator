import test from "node:test";
import assert from "node:assert/strict";
import {createCloudAutosave} from "../src/persistence/cloud-autosave.mjs";

function harness() {
  let now=0, key=1, count=0;
  const jobs=new Map();
  const scheduler=createCloudAutosave({
    read:()=>key, save:()=>{count++;scheduler.didStartSave(key);},
    now:()=>now, idleMs:30, intervalMs:300,
    setTimer:(fn,ms)=>{const id=Symbol();jobs.set(id,{fn,due:now+ms});return id;},
    clearTimer:id=>jobs.delete(id),
  });
  const tick=ms=>{
    const end=now+ms;
    while(jobs.size) {
      const [id, {due,fn}]=[...jobs].sort((a,b)=>a[1].due-b[1].due)[0];
      if(due>end)break;
      now=due;jobs.delete(id);fn();
    }
    now=end;
  };
  scheduler.resetIfChanged(key);
  return {scheduler,tick,count:()=>count,setKey:value=>{key=value;}};
}
test("cloud autosave coalesces editing and applies a per-drawing minimum save interval",()=>{
  const {scheduler,tick,count}=harness();
  scheduler.schedule();tick(29);assert.equal(count(),0);
  scheduler.schedule();tick(29);assert.equal(count(),0);
  tick(1);assert.equal(count(),1);
  scheduler.schedule();tick(299);assert.equal(count(),1);
  tick(1);assert.equal(count(),2);
});
test("stale timer cannot autosave a different drawing or a disallowed state",()=>{
  const {scheduler,tick,count,setKey}=harness();
  scheduler.schedule();setKey(2);tick(30);assert.equal(count(),0);
  scheduler.resetIfChanged(2);scheduler.schedule();setKey(null);tick(30);assert.equal(count(),0);
  scheduler.schedule();tick(30);assert.equal(count(),0);
});
test("explicit Save cancels timer and a new drawing does not inherit that cooldown",()=>{
  const {scheduler,tick,count,setKey}=harness();
  scheduler.schedule();scheduler.didStartSave(1);tick(30);assert.equal(count(),0);
  scheduler.schedule();setKey(2);scheduler.resetIfChanged(2);scheduler.schedule();
  tick(30);assert.equal(count(),1);
});
