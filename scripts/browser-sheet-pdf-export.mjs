import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isPathInside, resolveStaticRequestPath } from "../src/dev/static-path.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "hiper-sheet-pdf-profile-"));
const downloadDirectory = await mkdtemp(join(tmpdir(), "hiper-sheet-pdf-download-"));
const outputDirectory = resolve(root, "../tmp/pdf-export-qa");
const outputPath = resolve(outputDirectory, "mixed-centralised-decentralised.pdf");
const debuggingPort = await reservePort();
const server = await startQaServer();
const address = server.address();
const pageUrl = `http://127.0.0.1:${address.port}/qa/sheet-pdf.html`;
const appUrl = `http://127.0.0.1:${address.port}/app/`;
const browser = spawn(chrome, [
  "--headless=new", "--no-first-run", "--disable-gpu", "--disable-background-networking",
  "--disable-component-update", `--remote-debugging-port=${debuggingPort}`, `--user-data-dir=${profileDirectory}`,
  "--window-size=1280,900", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let browserStderr = "";
browser.stderr.setEncoding("utf8");
browser.stderr.on("data", (chunk) => { browserStderr += chunk; });

try {
  await waitForDevTools(debuggingPort);
  const target = await fetch(`http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(pageUrl)}`, { method: "PUT" }).then((response) => response.json());
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  const exceptions = [];
  cdp.on("Runtime.exceptionThrown", (params) => exceptions.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "Runtime exception"));
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDirectory, eventsEnabled: true });
  await waitFor(cdp, "window.__pdfReady === true", 30_000);
  const pagePlan = await evaluate(cdp, "window.__pagePlan");
  assert.equal(pagePlan[0].widthMm, 420);
  assert.equal(pagePlan[0].heightMm, 297);
  assert.ok(pagePlan.length >= 3, `Expected drawing plus multiple parts pages, got ${pagePlan.length}`);
  assert.equal(pagePlan.slice(1).every((page) => page.widthMm === 210 && page.heightMm === 297), true);
  const supplierEvidence = await evaluate(cdp, "window.__supplierEvidence");
  assert.equal(supplierEvidence.some((row) => row.description.startsWith("Total 90 mm duct")), false);
  assert.equal(supplierEvidence.some((row) => row.description.startsWith("Total DN160 EPP")), false);
  assert.deepEqual(supplierEvidence.filter((row) => row.partNumber === "ZEN-CT90-50M").map((row) => [row.quantity, row.unit]), [["1", "coil"]]);
  assert.deepEqual(supplierEvidence.filter((row) => row.partNumber === "AER-DUC-DN160-1MSL").map((row) => [row.quantity, row.unit]), [["2", "ea"]]);
  assert.equal(supplierEvidence.some((row) => row.unit === "stock" && row.quantity === "Not set" && row.description.includes("DN150")), true);
  assert.equal(supplierEvidence.some((row) => row.unit === "m"), false);
  const grilleEvidence = await evaluate(cdp, "window.__grilleEvidence");
  assert.equal(grilleEvidence.arrowCount, 4);
  assert.deepEqual(grilleEvidence.streams.sort(), ["exhaust", "exhaust", "intake", "intake"]);
  assert.equal(grilleEvidence.fills.includes("#1769d2"), true);
  assert.equal(grilleEvidence.fills.includes("#e2342f"), true);
  assert.deepEqual(grilleEvidence.labels.sort(), ["Exhaust air out", "Exhaust air out", "Outside Air", "Outside Air"]);
  assert.equal(grilleEvidence.largeArrows, true);
  assert.equal(grilleEvidence.readableLabels, true);
  assert.equal(grilleEvidence.lunaMasks, 2,"placed Luna and key should both retain opaque duct masks");
  await evaluate(cdp, "document.querySelector('#download').click()");
  const downloaded = await waitForDownload(downloadDirectory);
  await mkdir(outputDirectory, { recursive: true });
  await copyFile(downloaded, outputPath);
  await cdp.send("Page.navigate", { url: appUrl });
  await waitFor(cdp, "document.readyState === 'complete' && !document.querySelector('.app-shell')?.hidden && document.querySelector('#draft-status')?.textContent.includes('outline')", 20_000);
  await waitFor(cdp, "document.querySelectorAll('[data-plan-graphic=\"hiper-external-grille-plan-v1\"] [data-part=\"airflow-label\"]').length === 4");
  const canvasEvidence=await evaluate(cdp, `({labels:[...document.querySelectorAll('[data-plan-graphic="hiper-external-grille-plan-v1"] [data-part="airflow-label"]')].map(node=>node.textContent),masks:[...document.querySelectorAll('[data-plan-graphic="hiper-luna-grille-v1"] [data-part="luna-duct-mask"]')].map(node=>getComputedStyle(node).fill)})`);
  assert.deepEqual(canvasEvidence.labels.sort(),["Exhaust air out","Exhaust air out","Outside Air","Outside Air"]);
  assert.deepEqual(canvasEvidence.masks,["rgb(255, 255, 255)"],"Canvas Luna terminal should keep an opaque white centre over its duct");
  assert.equal(await evaluate(cdp, "document.querySelector('#export-sheet-pdf')?.textContent"), "Export PDF");
  assert.equal(await evaluate(cdp, "document.querySelector('#print-sheet-preview')?.textContent"), "Print");
  await evaluate(cdp, `(()=>{const form=document.querySelector('#project-details-form');form.elements.name.value='QA House';form.elements.drawingTitle.value='';form.elements.drawnBy.value='QA Designer';form.elements.checkedBy.value='';form.requestSubmit();})()`);
  await evaluate(cdp, "document.querySelector('#sheets-nav').click()");
  await waitFor(cdp, "!document.querySelector('#sheet-preview-panel')?.hidden && document.querySelectorAll('#sheet-preview-host .sheet-page').length >= 2");
  const appSheetText = await evaluate(cdp, "document.querySelector('#sheet-preview-host .sheet-page')?.textContent");
  assert.match(appSheetText, /QA House - Ground Floor - Ventilation Layout/);
  assert.match(appSheetText, /DRAWN BY QA Designer · CHECKED BY —/);
  assert.equal(await evaluate(cdp, `document.querySelectorAll('#sheet-preview-host .sheet-page:first-child #drawing-content [data-part="airflow-label"]').length`),4,"Print drawing should retain all external airflow labels");
  assert.equal(await evaluate(cdp, `document.querySelectorAll('#sheet-preview-host .sheet-page:first-child [data-kind="legend-external-grille"] [data-part="airflow-label"]').length`),4,"Print key should retain the matching external airflow labels");
  assert.ok(await evaluate(cdp, `document.querySelectorAll('#sheet-preview-host .sheet-page:first-child [data-part="luna-duct-mask"]').length`)>=2,"Print preview and key should retain Luna duct masks");
  await evaluate(cdp, "document.querySelector('#export-sheet-pdf').click()");
  await waitForDownloadCount(downloadDirectory, 2);
  assert.deepEqual(exceptions, [], `Browser runtime exceptions: ${exceptions.join("; ")}`);
  cdp.close();
  process.stdout.write(`${JSON.stringify({ ok: true, outputPath, pagePlan, bytes: (await stat(outputPath)).size, appExportButton: true, separatePrintButton: true }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  if (browserStderr) process.stderr.write(`Chrome diagnostics:\n${browserStderr.slice(-3000)}\n`);
  process.exitCode = 1;
} finally {
  const exited = new Promise((resolveExit) => browser.once("exit", resolveExit));
  browser.kill("SIGTERM");
  await Promise.race([exited, delay(2000)]);
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await rm(downloadDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

async function startQaServer() {
  const index = await readFile(resolve(root, "app/index.html"), "utf8");
  const qaBootstrap = `<script type="module">\nimport { setBootAccess } from "./auth-context.mjs";\nsetBootAccess({ state:"approved", user:{ id:"pdf-qa-user", email:"pdf-qa@example.test" }, memberships:[{ role:"owner", status:"active", workspace:{ id:"pdf-qa-workspace", name:"PDF QA" } }] });\ndocument.querySelector("#app-auth-status").hidden=true;\ndocument.querySelector(".app-shell").hidden=false;\nawait import("./main.mjs");\n</script>`;
  const qaIndex = index.replace('<script type="module" src="./bootstrap.mjs"></script>', qaBootstrap);
  const page = `<!doctype html><meta charset="utf-8"><button id="download">Download</button><script type="module">
    import * as domain from "/src/domain/spatial.mjs";
    import { createConfiguredMvhrComponent } from "/src/editor/mvhr-placement.mjs";
    import { createCatalogueComponent, routeFamilyForKind } from "/src/editor/component-catalogue.mjs";
    import * as portable from "/src/persistence/portable-project.mjs";
    import { createA3SheetModel } from "/src/sheets/a3-sheet.mjs";
    import { partsListRows } from "/src/sheets/a4-parts-list.mjs";
    import { createSheetOutputPages } from "/src/sheets/sheet-output.mjs";
    import { createWorkingSessionStore, workingTabId } from "/src/persistence/working-session.mjs";
    import { setBootAccess } from "/app/auth-context.mjs";
    import { createMixedPagePdfBlob, downloadPdfBlob } from "/app/sheet-pdf-export.mjs";
    let project = domain.applyCommand(domain.createProject("pdf-browser-qa"), { type:"floor.add", floor:{ id:"floor-ground", name:"Ground Floor", transform:{ translationMm:{x:0,y:0,z:domain.knownMm(0,"QA datum")}, orientation:domain.identityQuaternion() } } });
    project = domain.applyCommand(project,{type:"project.setVentilationDesignType",ventilationDesignType:"mixed"});
    const referenceBytes = new Uint8Array(await (await fetch("/qa/sheet-plan.png")).arrayBuffer());
    const dimensions = portable.pngDimensions(referenceBytes);
    project = domain.applyCommand(project,{type:"reference.addImage",asset:{id:"qa-plan-asset",kind:"image",fileName:"sheet-plan.png",mediaType:"image/png",byteLength:referenceBytes.length,sha256:await portable.sha256Hex(referenceBytes),widthPx:dimensions.widthPx,heightPx:dimensions.heightPx,dataUrl:portable.bytesToDataUrl(referenceBytes,"image/png")},reference:{id:"qa-plan-reference",floorId:"floor-ground",assetId:"qa-plan-asset",visible:true,locked:true,opacity:.7,transform:{translationMm:{x:0,y:0},rotationRad:0,scaleMmPerPixel:domain.knownMm(10,"QA scale")},calibration:null}});
    project = domain.applyCommand(project,{type:"component.add",component:createConfiguredMvhrComponent({model:"q350-hrv",mounting:"vertical",handing:"left",layout:"unit-mounted-cw",cwSize:"320"},{id:"unit",floorId:"floor-ground",xMm:1000,yMm:1000})});
    for (const [index, catalogueItemId] of ["aerofresh-30-compact-decentralised","zehnder-comfospot-50-decentralised","zehnder-comfoair-70-decentralised","lunos-e2-60-decentralised"].entries()) project = domain.applyCommand(project,{type:"component.add",component:createCatalogueComponent(catalogueItemId,{id:\`decentralised-\${index}\`,floorId:"floor-ground",xMm:3000+index*600,yMm:2000})});
    for (const [id,catalogueItemId,x,y,angleRad] of [["grille-combined","generic-external-grille-combined-dn160",5200,1200,0],["grille-intake","generic-external-grille-intake-dn160",5200,2300,Math.PI/2],["grille-exhaust","generic-external-grille-exhaust-dn160",5200,3100,Math.PI],["luna-output","luna-supply",4500,3500,0]]) { project=domain.applyCommand(project,{type:"component.add",component:createCatalogueComponent(catalogueItemId,{id,floorId:"floor-ground",xMm:x,yMm:y})}); if(angleRad) project=domain.applyCommand(project,{type:"component.rotateFloorZ",componentId:id,angleRad}); }
    const addRoute = (id, ductKind, stream, points, parallelRunCount=1) => { const family=routeFamilyForKind(ductKind); project=domain.applyCommand(project,{type:"route.add",route:{id,floorId:"floor-ground",system:"mvhr",stream,role:stream==="extract"?"Dwelling extract":stream==="intake"?"Outdoor intake":"Dwelling supply",ductKind,connectionInterface:family.connectionInterface,parallelRunCount,startAttachment:null,endAttachment:null,points:points.map(([x,y])=>({x,y,z:domain.unknownMm("QA route elevation not set")}))}}); };
    addRoute("qa-radial","semi-rigid-radial","supply",[[500,3500],[4500,3500]]);
    addRoute("qa-epp","epp-rigid-dn160","intake",[[500,4000],[1500,4000],[1500,4500]]);
    addRoute("qa-flex","flexible-round-dn150","supply",[[2000,4500],[4200,4500]]);
    const sheet = createA3SheetModel(project,{floorId:"floor-ground",orientation:"landscape",includeSchedule:false,projectName:"PDF browser QA",siteName:"Test address",issueDate:"2026-10-30",drawingTitle:"Ventilation",drawingId:"V-QA",status:"Preliminary — not for construction",revision:"A",revisionText:"Review"});
    const seedLine = sheet.partsSchedule.componentLines[0];
    const longSheet = {...sheet,partsSchedule:{...sheet.partsSchedule,componentLines:[...sheet.partsSchedule.componentLines,...Array.from({length:70},(_,index)=>({...seedLine,ref:\`QA\${index+1}\`,catalogueItemId:\`qa-item-\${index+1}\`,itemNumber:\`QA-\${index+1}\`,description:\`QA equipment line \${index+1} with a deliberately long description for wrapping and pagination\`}))]}};
    const pages = createSheetOutputPages(longSheet);
    const drawingDocument = new DOMParser().parseFromString(pages[0].svg,"image/svg+xml");
    const grilleArrows = [...drawingDocument.querySelectorAll('#drawing-content [data-part="airflow-arrow"]')];
    const grilleLabels=[...drawingDocument.querySelectorAll('#drawing-content [data-part="airflow-label"]')];
    window.__grilleEvidence = {arrowCount:grilleArrows.length,streams:grilleArrows.map(node=>node.getAttribute("data-stream")),fills:grilleArrows.map(node=>node.getAttribute("fill")),labels:grilleLabels.map(node=>node.textContent),largeArrows:grilleArrows.every(node=>{const values=(node.getAttribute("d").match(/-?\\d+(?:\\.\\d+)?/g)||[]).map(Number);return Math.max(...values.filter((_,index)=>index%2===0))-Math.min(...values.filter((_,index)=>index%2===0))>=320;}),readableLabels:grilleLabels.every(node=>Number(node.getAttribute("font-size"))>=70),lunaMasks:drawingDocument.querySelectorAll('[data-part="luna-duct-mask"]').length};
    window.__pagePlan = pages.map(({kind,widthMm,heightMm,orientation})=>({kind,widthMm,heightMm,orientation}));
    window.__supplierEvidence = partsListRows(longSheet.partsSchedule).filter(row=>!row.section).map(({description,quantity,unit,partNumber})=>({description,quantity,unit,partNumber}));
    const blob = await createMixedPagePdfBlob(pages,{title:"PDF browser QA",subject:"Mixed centralised and decentralised",author:"HiPer Studio"});
    document.querySelector("#download").addEventListener("click",()=>downloadPdfBlob(blob,"pdf-browser-qa.pdf"));
    const access={state:"approved",user:{id:"pdf-qa-user",email:"pdf-qa@example.test"},memberships:[{role:"owner",status:"active",workspace:{id:"pdf-qa-workspace",name:"PDF QA"}}]};
    setBootAccess(access);
    const store=createWorkingSessionStore(indexedDB,{tabId:workingTabId(sessionStorage)});
    await store.write({userId:access.user.id,workspaceId:access.memberships[0].workspace.id},{projectJson:domain.serializeProject(project),name:"PDF browser QA",dirty:true,cloudRecord:null,task:"ventilation",camera:{x:0,y:0,width:20,height:20},catalogueGroup:"all"});
    await store.flush();
    window.__pdfReady = true;
  </script>`;
  const contentTypes = new Map([[".css", "text/css"], [".html", "text/html"], [".js", "text/javascript"], [".mjs", "text/javascript"], [".json", "application/json"], [".svg", "image/svg+xml"]]);
  const instance = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/qa/sheet-pdf.html") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(page);
        return;
      }
      if (url.pathname === "/app/" || url.pathname === "/app/index.html") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(qaIndex);
        return;
      }
      if (url.pathname === "/qa/sheet-plan.png") {
        response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
        response.end(await readFile(resolve(root, "test/fixtures/sheet-plan.png")));
        return;
      }
      const resolved = resolveStaticRequestPath(root, url.pathname);
      const filePath = await realpath(resolved.filePath);
      const allowedRoot = await realpath(resolved.allowedRoot);
      if (!isPathInside(filePath, allowedRoot) || !(await stat(filePath)).isFile()) throw new Error("Not found");
      response.writeHead(200, { "Content-Type": contentTypes.get(extname(filePath)) ?? "application/octet-stream", "Cache-Control": "no-store" });
      response.end(await readFile(filePath));
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    }
  });
  await new Promise((resolveListen) => instance.listen(0, "127.0.0.1", resolveListen));
  return instance;
}

async function waitForDownload(directory, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const names = await readdir(directory);
    const pdfName = names.find((name) => name.endsWith(".pdf"));
    if (pdfName) {
      const candidate = join(directory, pdfName);
      if ((await stat(candidate)).size > 1000) return candidate;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the PDF download");
}

async function waitForDownloadCount(directory, expected, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const names = await readdir(directory);
    if (names.filter((name) => name.endsWith(".pdf")).length >= expected) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${expected} PDF downloads`);
}

async function reservePort() { const instance = createServer(); await new Promise((resolveListen) => instance.listen(0, "127.0.0.1", resolveListen)); const port = instance.address().port; await new Promise((resolveClose) => instance.close(resolveClose)); return port; }
async function waitForDevTools(port) { for (let attempt = 0; attempt < 400; attempt += 1) { try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) return; } catch {} await delay(50); } throw new Error("Chrome DevTools endpoint did not become available"); }
async function connectCdp(url) { const socket = new WebSocket(url); await new Promise((resolveOpen, reject) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", reject, { once: true }); }); let sequence = 0; const pending = new Map(), handlers = new Map(); socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); if (message.id) { const request = pending.get(message.id); pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); } else for (const handler of handlers.get(message.method) ?? []) handler(message.params); }); return { send(method, params = {}) { const id = ++sequence; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolveSend, rejectSend) => pending.set(id, { resolve: resolveSend, reject: rejectSend })); }, on(method, handler) { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(handler); }, close() { socket.close(); } }; }
async function evaluate(cdp, expression) { const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; }
async function waitFor(cdp, expression, timeoutMs = 10_000) { const started = Date.now(); while (Date.now() - started < timeoutMs) { if (await evaluate(cdp, `Boolean(${expression})`)) return; await delay(50); } throw new Error(`Timed out waiting for: ${expression}`); }
function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
