import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as pdfjs from "../node_modules/pdfjs-dist/legacy/build/pdf.mjs";

const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const server=createFixtureServer(root);
await new Promise((resolveListen,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolveListen);});
const address=server.address();
const url=`http://127.0.0.1:${address.port}/app/`;
const profile=await mkdtemp(join(tmpdir(),"hiper-studio-design-options-"));
const downloads=await mkdtemp(join(tmpdir(),"hiper-studio-design-options-downloads-"));
const chrome=spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",[
  "--headless=new","--no-first-run","--disable-gpu","--disable-background-networking","--disable-component-update","--remote-debugging-port=0",`--user-data-dir=${profile}`,"--window-size=1366,900","about:blank",
],{stdio:["ignore","ignore","pipe"]});
let stderr="";chrome.stderr.setEncoding("utf8");chrome.stderr.on("data",chunk=>{stderr+=chunk;});

try {
  const {port}=await readPort(profile);
  const target=await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,{method:"PUT"}).then(response=>response.json());
  const cdp=await connect(target.webSocketDebuggerUrl);const exceptions=[];
  cdp.on("Runtime.exceptionThrown",params=>exceptions.push(params.exceptionDetails?.text??"Runtime exception"));
  await cdp.send("Page.enable");await cdp.send("Runtime.enable");
  await cdp.send("Page.setDownloadBehavior",{behavior:"allow",downloadPath:downloads});
  await waitFor(cdp,`document.readyState==="complete"`);
  try { await waitFor(cdp,`document.querySelector("#project-nav")?.classList.contains("active")`); }
  catch(error) {
    const boot=await value(cdp,`({status:document.querySelector("#app-auth-status")?.innerText,shellHidden:document.querySelector(".app-shell")?.hidden,body:document.body.innerText.slice(0,500)})`);
    throw new Error(`${error.message}; boot=${JSON.stringify(boot)}; exceptions=${JSON.stringify(exceptions)}`);
  }
  assert.equal(await value(cdp,`document.querySelectorAll("#design-option-select option").length`),1);
  assert.equal(await value(cdp,`document.querySelector("#design-option-select option")?.textContent`),"Option A · Working");

  await click(cdp,"#duplicate-design-option");
  await waitFor(cdp,`document.querySelector("#duplicate-design-option-dialog")?.open`);
  await setValue(cdp,"#duplicate-design-option-name","Option B – Decentralised");
  await setValue(cdp,"#duplicate-design-option-revision","B1");
  await submit(cdp,"#duplicate-design-option-form");
  await waitFor(cdp,`document.querySelectorAll("#design-option-select option").length===2&&document.querySelector("#design-option-select").selectedOptions[0]?.textContent.includes("Option B")`);
  assert.equal(await value(cdp,`document.querySelector("#export-all-options-pdf")?.hidden`),false);

  await click(cdp,"#plan-nav");await waitFor(cdp,`!document.querySelector("#plan-workspace")?.hidden`);
  await click(cdp,"#wall-tool");
  await dispatchPointer(cdp,"#plan-canvas",340,300);await dispatchPointer(cdp,"#plan-canvas",620,300);
  await key(cdp,"Enter");
  await waitFor(cdp,`document.querySelector("#draft-status")?.textContent.includes("1 walls")`);

  await click(cdp,"#project-nav");
  const optionA=await value(cdp,`document.querySelector("#design-option-select option")?.value`);
  await setSelect(cdp,"#design-option-select",optionA);
  await waitFor(cdp,`document.querySelector("#design-option-select").value===${JSON.stringify(optionA)}`);
  await click(cdp,"#plan-nav");await waitFor(cdp,`!document.querySelector("#plan-workspace")?.hidden`);
  assert.equal(await value(cdp,`document.querySelector("#draft-status")?.textContent.includes("0 walls")`),true,"Option A stays independent");

  await click(cdp,"#project-nav");
  const optionB=await value(cdp,`[...document.querySelectorAll("#design-option-select option")].find(option=>option.textContent.includes("Option B"))?.value`);
  await setSelect(cdp,"#design-option-select",optionB);
  await click(cdp,"#plan-nav");await waitFor(cdp,`document.querySelector("#draft-status")?.textContent.includes("1 walls")`);

  await click(cdp,"#project-nav");await click(cdp,"#sheets-nav");
  await waitFor(cdp,`!document.querySelector("#sheet-preview-panel")?.hidden`);
  assert.match(await value(cdp,`document.querySelector("#sheet-preview-status")?.textContent`),/Option B.*B1/u);
  assert.equal(await value(cdp,`document.querySelector("#export-all-options-pdf")?.hidden`),false);
  await click(cdp,"#export-all-options-pdf");
  await waitFor(cdp, `document.querySelector("#sheet-output-dialog").open`);
  await click(cdp,"#confirm-sheet-output");
  const pdfPath=await waitForDownload(downloads);
  const pdfTask=pdfjs.getDocument({data:new Uint8Array(await readFile(pdfPath)),disableWorker:true});
  const pdf=await pdfTask.promise;
  assert.equal(pdf.numPages,6,"Two options must export separate A3 drawing, A3 details and A4 parts pages each");
  const pageWidths=[];
  for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
    const page=await pdf.getPage(pageNumber);pageWidths.push(Math.round(page.getViewport({scale:1}).width));
  }
  assert.deepEqual(pageWidths,[1191,1191,595,1191,1191,595],"All-options export keeps separate A3/A4 page sets");
  await pdfTask.destroy();
  assert.deepEqual(exceptions,[],`Browser exceptions: ${exceptions.join("; ")}`);
  cdp.close();
  process.stdout.write(JSON.stringify({ok:true,options:2,isolatedWalls:true,activePreview:"Option B · B1",pdfPages:6,pageWidths},null,2)+"\n");
} catch(error) {
  process.stderr.write(`${error.stack??error}\n`);if(stderr)process.stderr.write(stderr.slice(-4000));process.exitCode=1;
} finally {
  const exited=new Promise(resolve=>chrome.once("exit",resolve));chrome.kill("SIGTERM");await Promise.race([exited,delay(2000)]);await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});await rm(downloads,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  await new Promise(resolveClose=>server.close(resolveClose));
}

function createFixtureServer(rootDirectory){
  const contentTypes=new Map([[".css","text/css; charset=utf-8"],[".html","text/html; charset=utf-8"],[".js","text/javascript; charset=utf-8"],[".mjs","text/javascript; charset=utf-8"],[".svg","image/svg+xml"]]);
  return createServer(async(request,response)=>{
    try{
      const requestUrl=new URL(request.url??"/","http://127.0.0.1");
      if(requestUrl.pathname==="/app/"||requestUrl.pathname==="/app/index.html"){
        const source=await readFile(join(rootDirectory,"app/index.html"),"utf8");
        const bootstrap=`<script type="module">const nativeFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=(input,init)=>{const target=new URL(typeof input==="string"?input:input.url,location.href);return target.origin===location.origin?nativeFetch(input,init):Promise.resolve(new Response("[]",{status:200,headers:{"Content-Type":"application/json"}}));};const {setBootAccess}=await import("./auth-context.mjs");setBootAccess({state:"approved",user:{id:"qa-user",email:"qa@example.test"},memberships:[{role:"designer",workspace:{id:"qa-workspace",name:"QA workspace"}}]});document.querySelector("#app-auth-status").hidden=true;document.querySelector(".app-shell").hidden=false;await import("./main.mjs");</script>`;
        const body=source.replace('<script type="module" src="./bootstrap.mjs"></script>',bootstrap);
        response.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});response.end(body);return;
      }
      const relative=decodeURIComponent(requestUrl.pathname).replace(/^\/+/,"");
      if(!["app/","src/","node_modules/"].some(prefix=>relative.startsWith(prefix)))throw new Error("Blocked fixture path");
      const filePath=resolve(rootDirectory,relative);
      if(!filePath.startsWith(`${rootDirectory}/`))throw new Error("Blocked fixture path");
      const details=await stat(filePath);if(!details.isFile())throw new Error("Not a file");
      response.writeHead(200,{"Content-Type":contentTypes.get(extname(filePath))??"application/octet-stream","Content-Length":details.size,"Cache-Control":"no-store"});response.end(await readFile(filePath));
    }catch{response.writeHead(404,{"Content-Type":"text/plain"});response.end("Not found");}
  });
}

async function readPort(directory){for(let attempt=0;attempt<200;attempt++){try{const [port]=String(await readFile(join(directory,"DevToolsActivePort"),"utf8")).trim().split("\n");return {port};}catch{await delay(50);}}throw new Error("Chrome DevTools endpoint unavailable");}
async function connect(socketUrl){const socket=new WebSocket(socketUrl);await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});let sequence=0;const pending=new Map(),handlers=new Map();socket.addEventListener("message",event=>{const message=JSON.parse(event.data);if(message.id){const request=pending.get(message.id);pending.delete(message.id);if(message.error)request.reject(new Error(message.error.message));else request.resolve(message.result);return;}for(const handler of handlers.get(message.method)??[])handler(message.params??{});});return {send(method,params={}){sequence++;return new Promise((resolve,reject)=>{pending.set(sequence,{resolve,reject});socket.send(JSON.stringify({id:sequence,method,params}));});},on(method,handler){handlers.set(method,[...(handlers.get(method)??[]),handler]);},close(){socket.close();}};}
async function evaluate(cdp,expression){const result=await cdp.send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;}
function value(cdp,expression){return evaluate(cdp,expression);}
async function waitFor(cdp,expression){for(let attempt=0;attempt<200;attempt++){if(await evaluate(cdp,expression))return;await delay(50);}throw new Error(`Timed out: ${expression}`);}
async function click(cdp,selector){await evaluate(cdp,`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw new Error("Missing ${selector}");element.click();return true;})()`);}
async function setValue(cdp,selector,next){await evaluate(cdp,`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.value=${JSON.stringify(next)};element.dispatchEvent(new Event("input",{bubbles:true}));return true;})()`);}
async function setSelect(cdp,selector,next){await evaluate(cdp,`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.value=${JSON.stringify(next)};element.dispatchEvent(new Event("change",{bubbles:true}));return true;})()`);}
async function submit(cdp,selector){await evaluate(cdp,`(()=>{document.querySelector(${JSON.stringify(selector)}).requestSubmit();return true;})()`);}
async function dispatchPointer(cdp,selector,x,y){await evaluate(cdp,`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:${x},clientY:${y},pointerId:1,pointerType:"mouse",button:0}));element.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:${x},clientY:${y},pointerId:1,pointerType:"mouse",button:0}));element.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:${x},clientY:${y},button:0}));return true;})()`);}
async function key(cdp,keyValue){await cdp.send("Input.dispatchKeyEvent",{type:"keyDown",key:keyValue,code:keyValue});await cdp.send("Input.dispatchKeyEvent",{type:"keyUp",key:keyValue,code:keyValue});}
function delay(milliseconds){return new Promise(resolve=>setTimeout(resolve,milliseconds));}
async function waitForDownload(directory){for(let attempt=0;attempt<200;attempt++){const files=(await readdir(directory)).filter(name=>name.endsWith(".pdf")&&!name.endsWith(".crdownload"));if(files.length)return join(directory,files[0]);await delay(50);}throw new Error("All-options PDF did not download");}
