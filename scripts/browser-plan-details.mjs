
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const output=resolve(root,"../tmp/install-reference-fidelity-qa");
const profile=await mkdtemp(join(tmpdir(),"studio-detail-qa-"));
const page = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:white}svg{display:block}#pages>svg{page-break-after:always}@page{size:A3 landscape;margin:0}</style><div id="pages"></div><script type="module">
import * as d from "/src/domain/spatial.mjs";
import {createConfiguredMvhrComponent} from "/src/editor/mvhr-placement.mjs";
import {createA3SheetModel,renderA3SheetSvg} from "/src/sheets/a3-sheet.mjs";
import {createSheetOutputPages} from "/src/sheets/sheet-output.mjs";
import {layoutPlanDetails,PLAN_DETAIL_REFERENCES,renderPlanDetails} from "/src/sheets/plan-details.mjs";
import {createMixedPagePdfBlob} from "/app/sheet-pdf-export.mjs";
let project=d.applyCommand(d.createProject("detail-browser"),{type:"floor.add",floor:{id:"ground",name:"Ground floor",transform:{translationMm:{x:0,y:0,z:d.knownMm(0,"test")},orientation:d.identityQuaternion()}}});
for(const [i,[model,cwSize]]of [["q350-hrv","320"],["aerofresh-450-hrv","520"],["q350-hrv","625"]].entries())project=d.applyCommand(project,{type:"component.add",component:createConfiguredMvhrComponent({model,mounting:"vertical",handing:i%2?"right":"left",layout:"unit-mounted-cw",cwSize},{id:"unit-"+i,floorId:"ground",xMm:2000+i*4000,yMm:3000})});
const meta={floorId:"ground",orientation:"landscape",includeSchedule:false,projectName:"A3 drawing details",siteName:"Synthetic verification fixture",clientName:"QA",issueDate:"2026-11-09",drawingTitle:"Mixed Q and AeroFresh references",drawingId:"V01",status:"Preliminary — not for construction",revision:"A",revisionText:"QA"};
const sheet=createA3SheetModel(project,meta),pages=createSheetOutputPages(sheet);
document.querySelector("#pages").innerHTML=pages[0].svg;
window.__pages=pages;
window.__sheet=sheet;
window.__svgText=document.querySelector("#pages").textContent;
window.__layoutEvidence=()=>[...document.querySelectorAll('[data-kind="plan-detail"]')].map(card=>{
const bounds=card.querySelector("rect").getBoundingClientRect();
const illustration=card.querySelector("[data-illustration]")?.getBoundingClientRect(),notes=card.querySelector("[data-role=detail-notes]")?.getBoundingClientRect();
return {id:card.dataset.detailId,notesOverlap:!!(illustration&&notes&&illustration.bottom>notes.top-1),overflow:[...card.querySelectorAll("text")].filter(node=>{const r=node.getBoundingClientRect();return r.left<bounds.left-1||r.right>bounds.right+1||r.top<bounds.top-1||r.bottom>bounds.bottom+1;}).map(n=>n.textContent)};});
const second=createA3SheetModel(project,{...meta,orientation:"portrait"});
window.__portraitPages=createSheetOutputPages(second);
window.__allFive=(portrait=false)=>{
const details=layoutPlanDetails({cards:Object.values(PLAN_DETAIL_REFERENCES),unmatchedComponentIds:[],hasQ:true,hasAeroFresh:true},{xMm:10,yMm:10,widthMm:portrait?202:325,heightMm:portrait?400:277});
document.querySelector("#pages").innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="'+(portrait?297:420)+'mm" height="'+(portrait?420:297)+'mm" viewBox="0 0 '+(portrait?'297 420':'420 297')+'">'+renderPlanDetails(details)+'</svg>';
};
window.__makePdf=async()=>{
const blob=await createMixedPagePdfBlob([...pages,...window.__portraitPages],{title:"Drawing detail browser QA"});
return new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(",")[1]);reader.readAsDataURL(blob);});
};
window.__renderPdf=async (data,pageNumber=1)=>{
const pdfjs=await import("/node_modules/pdfjs-dist/legacy/build/pdf.mjs");pdfjs.GlobalWorkerOptions.workerSrc="/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs";
const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
const pdf=await pdfjs.getDocument({data:bytes}).promise;window.__pdf=pdf;
const evidence=[];
for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n);evidence.push({width:p.view[2],height:p.view[3],text:(await p.getTextContent()).items.map(i=>i.str).join(" ")});}
window.__pdfEvidence=evidence;
const p=await pdf.getPage(pageNumber),viewport=p.getViewport({scale:96/72}),canvas=document.createElement("canvas");canvas.width=viewport.width;canvas.height=viewport.height;document.querySelector("#pages").replaceChildren(canvas);await p.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
};
window.__ready=true;
</script>`;
const server=createServer(async(req,res)=>{
 try{
 const path=new URL(req.url,"http://127.0.0.1").pathname;
 if(path==="/qa"){res.writeHead(200,{"Content-Type":"text/html"});res.end(page);return;}
 if(!/^\/(src|app|node_modules)\//.test(path)||path.includes(".."))throw new Error("not allowed");
 const mime={".mjs":"text/javascript",".js":"text/javascript",".css":"text/css",".png":"image/png",".wasm":"application/wasm"}[extname(path)]??"application/octet-stream";
 res.writeHead(200,{"Content-Type":mime});res.end(await readFile(resolve(root,"."+path)));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const port=server.address().port;
const chrome=spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",["--headless=new","--no-first-run","--disable-gpu","--disable-background-networking","--remote-debugging-port=0","--user-data-dir="+profile,"--window-size=1600,1200","about:blank"],{stdio:["ignore","ignore","pipe"]});
let browserLog="";chrome.stderr.on("data",b=>browserLog+=b);
let cdp;
try{
 await mkdir(output,{recursive:true});
 let debugPort;
 for(let i=0;i<200;i++){try{debugPort=Number((await readFile(join(profile,"DevToolsActivePort"),"utf8")).split("\n")[0]);break;}catch{await delay(100);}}
 assert.ok(debugPort,browserLog);
 const target=await fetch("http://127.0.0.1:"+debugPort+"/json/new?"+encodeURIComponent("http://127.0.0.1:"+port+"/qa"),{method:"PUT"}).then(r=>r.json());
 cdp=await connect(target.webSocketDebuggerUrl);
 await cdp.send("Runtime.enable");await cdp.send("Page.enable");
 await cdp.send("Emulation.setDeviceMetricsOverride",{width:1600,height:1200,deviceScaleFactor:1,mobile:false});
 const errors=[];cdp.on("Runtime.exceptionThrown",p=>errors.push(p.exceptionDetails?.text));
 for(let i=0;i<300;i++){if(await evaluate("window.__ready===true"))break;await delay(100);}
 assert.equal(await evaluate("window.__ready"),true);
 const layout=await evaluate("window.__layoutEvidence()");
 assert.deepEqual(layout.flatMap(c=>c.overflow),[],JSON.stringify(layout));
 assert.ok(layout.every(c=>!c.notesOverlap),JSON.stringify(layout));
 await capture("mixed-preview-actual-size.png",1588,1123);
 const print=await cdp.send("Page.printToPDF",{printBackground:true,preferCSSPageSize:true});
 await writeFile(join(output,"print-a3.pdf"),Buffer.from(print.data,"base64"));
 await evaluate("window.__allFive()");
 const fiveLayout=await evaluate("window.__layoutEvidence()");
 assert.deepEqual(fiveLayout.flatMap(c=>c.overflow),[],JSON.stringify(fiveLayout));
 assert.ok(fiveLayout.every(c=>!c.notesOverlap),JSON.stringify(fiveLayout));
 await capture("all-five-detail-panel.png",1588,1123);
 await evaluate("window.__allFive(true)");
 const portraitFiveLayout=await evaluate("window.__layoutEvidence()");
 assert.deepEqual(portraitFiveLayout.flatMap(c=>c.overflow),[],JSON.stringify(portraitFiveLayout));
 assert.ok(portraitFiveLayout.every(c=>!c.notesOverlap),JSON.stringify(portraitFiveLayout));
 await capture("all-five-portrait-panel.png",1123,1588);
 const pdf=await evaluate("window.__makePdf()");
 await writeFile(join(output,"mixed-a3-a4-details.pdf"),Buffer.from(pdf,"base64"));
 await evaluate("window.__renderPdf("+JSON.stringify(pdf)+")");
 const evidence=await evaluate("window.__pdfEvidence");
 const firstPartCount=await evaluate("window.__pages.length");
 assert.equal(evidence.length,firstPartCount*2);
 assert.ok(Math.abs(evidence[0].width-420*72/25.4)<.1);
 assert.ok(Math.abs(evidence[0].height-297*72/25.4)<.1);
 assert.ok(Math.abs(evidence[firstPartCount].width-297*72/25.4)<.1);
 assert.ok(Math.abs(evidence[firstPartCount].height-420*72/25.4)<.1);
 for(const i of [0,firstPartCount])for(const word of ["128","140","120","115","791","566","1414","870","650","1400","Wiring"])assert.ok(evidence[i].text.includes(word),word+" missing from PDF");
 await capture("pdf-a3-actual-size.png",1588,1123);
 await evaluate("window.__renderPdf("+JSON.stringify(pdf)+","+(firstPartCount+1)+")");
 await capture("pdf-a3-portrait-actual-size.png",1123,1588);
 assert.deepEqual(errors,[]);
 await writeFile(join(output,"evidence.json"),JSON.stringify({layout,fiveLayout,portraitFiveLayout,pageSizes:evidence.map(p=>({width:p.width,height:p.height})),errors},null,2));
 console.log(JSON.stringify({output,layout,fiveLayout,portraitFiveLayout,pages:evidence.length,errors},null,2));
}finally{
 cdp?.close();chrome.kill("SIGTERM");await delay(1000);await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
async function capture(name,width,height){const shot=await cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true,clip:{x:0,y:0,width,height,scale:1}});await writeFile(join(output,name),Buffer.from(shot.data,"base64"));}
async function evaluate(expression){const r=await cdp.send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
async function connect(url){const socket=new WebSocket(url);await new Promise((r,j)=>{socket.addEventListener("open",r,{once:true});socket.addEventListener("error",j,{once:true});});let id=0;const pending=new Map(),events=new Map();socket.addEventListener("message",e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else for(const f of events.get(m.method)??[])f(m.params);});return{send(method,params={}){const n=++id;socket.send(JSON.stringify({id:n,method,params}));return new Promise((resolve,reject)=>pending.set(n,{resolve,reject}));},on(event,f){events.set(event,[...(events.get(event)??[]),f]);},close(){socket.close();}};}
function delay(ms){return new Promise(r=>setTimeout(r,ms));}
