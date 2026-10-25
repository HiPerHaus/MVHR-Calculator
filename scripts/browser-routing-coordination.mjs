import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP_URL = process.argv[2] ?? "http://127.0.0.1:4199/app/";
const profileDirectory = await mkdtemp(join(tmpdir(), "hiper-routing-coordination-"));
const browser = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new","--no-first-run","--disable-gpu","--disable-background-networking","--disable-component-update","--remote-debugging-port=0",`--user-data-dir=${profileDirectory}`,"--window-size=1600,1000","about:blank"], {stdio:["ignore","ignore","pipe"]});
let stderr="";browser.stderr.setEncoding("utf8");browser.stderr.on("data",chunk=>{stderr+=chunk;});
try{
  const port=await readDevToolsPort(profileDirectory),target=await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(APP_URL)}`,{method:"PUT"}).then(response=>response.json()),cdp=await connectCdp(target.webSocketDebuggerUrl);
  const exceptions=[],consoleErrors=[];cdp.on("Runtime.exceptionThrown",params=>exceptions.push(params.exceptionDetails?.exception?.description??params.exceptionDetails?.text??"Runtime exception"));cdp.on("Runtime.consoleAPICalled",params=>{if(["error","warning"].includes(params.type))consoleErrors.push(params.args.map(arg=>arg.value??arg.description??"").join(" "));});
  await cdp.send("Page.enable");await cdp.send("Runtime.enable");await waitFor(cdp,`document.readyState==="complete"&&document.querySelector("#ventilation-nav")`);await click(cdp,"#ventilation-nav");await waitFor(cdp,`!document.querySelector("#mechanical-tools-section")?.hidden`);
  assert.equal(await visible(cdp,"#add-routing-exclusion"),true);assert.equal(await visible(cdp,"#routing-clearance-input"),true);
  await click(cdp,"#add-routing-exclusion");
  const opened=await evaluate(cdp,`(()=>{const canvas=document.querySelector("#plan-canvas"),r=canvas.getBoundingClientRect();for(const [x,y] of [[r.left+r.width*.35,r.top+r.height*.35],[r.left+r.width*.58,r.top+r.height*.58]])canvas.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:x,clientY:y}));return document.querySelector("#routing-exclusion-dialog").open;})()`);
  assert.equal(opened,true);
  await setValue(cdp,"#routing-exclusion-name","Hall beam");await setValue(cdp,"#routing-exclusion-height-mode","solid-range");await setValue(cdp,"#routing-exclusion-bottom","2200");await setValue(cdp,"#routing-exclusion-top","2550");await submit(cdp,"#routing-exclusion-form");
  await waitFor(cdp,`document.querySelectorAll("[data-routing-exclusion-id]").length===1`);
  assert.match(await evaluate(cdp,`document.querySelector("#routing-exclusion-list")?.textContent??""`),/Hall beam/);
  await setValue(cdp,"#routing-clearance-input","75");await click(cdp,"#apply-routing-clearance");assert.match(await evaluate(cdp,`document.querySelector("#routing-clearance-status")?.textContent??""`),/75 mm/);
  const editButtons=await evaluate(cdp,`document.querySelectorAll("#routing-exclusion-list button").length`);assert.equal(editButtons,2);
  await evaluate(cdp,`[...document.querySelectorAll("#routing-exclusion-list button")].find(button=>button.textContent==="Edit").click()`);assert.equal(await evaluate(cdp,`document.querySelector("#routing-exclusion-dialog")?.open`),true);await click(cdp,"#cancel-routing-exclusion");
  await evaluate(cdp,`[...document.querySelectorAll("#routing-exclusion-list button")].find(button=>button.textContent==="Remove").click()`);assert.equal(await evaluate(cdp,`document.querySelectorAll("[data-routing-exclusion-id]").length`),0);await click(cdp,"#undo");await waitFor(cdp,`document.querySelectorAll("[data-routing-exclusion-id]").length===1`);
  assert.deepEqual(exceptions,[],`Runtime exceptions: ${exceptions.join("; ")}`);assert.deepEqual(consoleErrors,[],`Console errors: ${consoleErrors.join("; ")}`);cdp.close();
  process.stdout.write(`${JSON.stringify({ok:true,exclusion:"create/edit/remove/undo",heightRange:"2200-2550 mm",clearSpacingMm:75},null,2)}\n`);
}catch(error){process.stderr.write(`${error.stack??error}\n`);if(stderr)process.stderr.write(stderr.slice(-4000));process.exitCode=1;}finally{const exited=new Promise(resolve=>browser.once("exit",resolve));browser.kill("SIGTERM");await Promise.race([exited,delay(2000)]);await rm(profileDirectory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}

async function readDevToolsPort(directory){const file=join(directory,"DevToolsActivePort");for(let attempt=0;attempt<100;attempt+=1){try{return(await readFile(file,"utf8")).trim().split("\n")[0];}catch{await delay(50);}}throw new Error("Chrome DevTools endpoint unavailable");}
async function connectCdp(url){const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});let sequence=0;const pending=new Map(),handlers=new Map();socket.addEventListener("message",event=>{const message=JSON.parse(event.data);if(message.id){const request=pending.get(message.id);pending.delete(message.id);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);return;}for(const handler of handlers.get(message.method)??[])handler(message.params??{});});return{send(method,params={}){sequence+=1;return new Promise((resolve,reject)=>{pending.set(sequence,{resolve,reject});socket.send(JSON.stringify({id:sequence,method,params}));});},on(method,handler){handlers.set(method,[...(handlers.get(method)??[]),handler]);},close(){socket.close();}};}
async function evaluate(cdp,expression){const result=await cdp.send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;}
async function waitFor(cdp,expression,timeout=6000){const started=Date.now();while(Date.now()-started<timeout){if(await evaluate(cdp,`Boolean(${expression})`))return;await delay(50);}throw new Error(`Timed out: ${expression}`);}
async function click(cdp,selector){assert.equal(await evaluate(cdp,`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return false;element.click();return true;})()`),true,`Missing ${selector}`);await delay(60);}
async function setValue(cdp,selector,value){assert.equal(await evaluate(cdp,`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return false;element.value=${JSON.stringify(value)};element.dispatchEvent(new Event("input",{bubbles:true}));element.dispatchEvent(new Event("change",{bubbles:true}));return true;})()`),true);}
async function submit(cdp,selector){assert.equal(await evaluate(cdp,`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return false;element.requestSubmit();return true;})()`),true);await delay(80);}
async function visible(cdp,selector){return evaluate(cdp,`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e?.getBoundingClientRect();return Boolean(e&&r.width&&r.height&&!e.hidden);})()`);}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
