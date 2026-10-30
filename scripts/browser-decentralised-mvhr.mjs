import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isPathInside, resolveStaticRequestPath } from "../src/dev/static-path.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "hiper-decentralised-mvhr-"));
const debuggingPort = await reservePort();
const qaIdentity = { userId: "qa-decentralised-user", workspaceId: "qa-decentralised-workspace" };
const server = await startQaServer();
const address = server.address();
const appUrl = `http://127.0.0.1:${address.port}/app/`;
const browser = spawn(chrome, [
  "--headless=new", "--no-first-run", "--disable-gpu", "--disable-background-networking",
  "--disable-component-update", `--remote-debugging-port=${debuggingPort}`, `--user-data-dir=${profileDirectory}`,
  "--window-size=1180,820", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let browserStderr = "";
browser.stderr.setEncoding("utf8");
browser.stderr.on("data", (chunk) => { browserStderr += chunk; });

try {
  await waitForDevTools(debuggingPort);
  const target = await fetch(`http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(appUrl)}`, { method: "PUT" }).then((response) => response.json());
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  const exceptions = [];
  cdp.on("Runtime.exceptionThrown", (params) => exceptions.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "Runtime exception"));
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 2, mobile: true });
  await waitFor(cdp, `document.readyState === "complete" && !document.querySelector(".app-shell")?.hidden && document.querySelector("#draft-status")?.textContent.includes("outline")`);
  assert.equal(await text(cdp,"#current-project-type"),"Unclassified");
  await setValue(cdp,"#project-ventilation-type","decentralised");
  assert.equal(await text(cdp,"#current-project-type"),"Decentralised");
  await click(cdp, "#ventilation-nav");
  await click(cdp, "#tablet-tools-toggle");
  assert.match(await text(cdp,"#ventilation-project-type-context"),/Decentralised project/u);
  assert.match(await text(cdp,".parts-category"),/Decentralised/u,"Decentralised tools should be the first project-type default");
  await clickByText(cdp, ".parts-category", "Decentralised");
  assert.equal(await count(cdp, '[data-catalogue-item-id$="-decentralised"]'), 4);

  await click(cdp, '[data-catalogue-item-id="aerofresh-30-compact-decentralised"]');
  await canvasTouchTap(cdp, 0.36, 0.38);
  await canvasTouchTap(cdp, 0.58, 0.38);
  assert.equal(await count(cdp, '[data-system="decentralised-mvhr"]'), 2, `Expected two placed markers; status: ${await text(cdp, "#tool-status")} / ${await text(cdp, "#draft-status")}`);
  assert.equal(await savedDecentralised(cdp).then((items) => items.length), 2, "Placement mode should stay armed for repeated touch taps");
  assert.equal(await attribute(cdp, '[data-catalogue-item-id="aerofresh-30-compact-decentralised"]', "aria-pressed"), "true");

  await click(cdp, "#select-tool");
  await selectLatestComponent(cdp);
  assert.equal(await visible(cdp, "#decentralised-system-field"), true);
  assert.equal(await visible(cdp, "#decentralised-pair-label"), true);
  assert.equal(await visible(cdp, "#decentralised-controller-label"), true);
  await setValue(cdp, "#decentralised-pair-group", "Pair 1");
  await setValue(cdp, "#decentralised-controller-reference", "sMove 1");
  await click(cdp, "#apply-decentralised-configuration");
  await click(cdp, "#rotate-component");

  await selectFirstComponent(cdp);
  await setValue(cdp, "#decentralised-pair-group", "Pair 1");
  await setValue(cdp, "#decentralised-controller-reference", "sMove 1");
  await click(cdp, "#apply-decentralised-configuration");
  let records = await savedDecentralised(cdp);
  assert.deepEqual(records.map((item) => item.pairGroupId), ["Pair 1", "Pair 1"]);
  assert.deepEqual(records.map((item) => item.controllerReference), ["sMove 1", "sMove 1"]);

  await click(cdp, "#tablet-tools-toggle");
  await click(cdp, '[data-catalogue-item-id="zehnder-comfospot-50-decentralised"]');
  await canvasTouchTap(cdp, 0.48, 0.62);
  await click(cdp, "#select-tool");
  await selectLatestComponent(cdp);
  assert.equal(await visible(cdp, "#decentralised-pair-label"), false, "Continuous-balanced units must not request a pair");
  assert.match(await text(cdp, "#decentralised-operating-mode"), /Continuous-balanced/u);

  const schedule = await scheduleSummary(cdp);
  assert.deepEqual(schedule, { unitCount: 3, pairGroupCount: 1, controllerReferenceCount: 1, scheduleQuantity: 3, routeCount: 0 });
  assert.equal(await evaluate(cdp, `document.querySelectorAll('[data-system="decentralised-mvhr"]').length >= 3`), true);

  await click(cdp,"#project-nav");
  await setValue(cdp,"#project-ventilation-type","centralised");
  await waitFor(cdp,`document.querySelector("#project-type-conflict-dialog")?.open`);
  assert.match(await text(cdp,"#project-type-conflict-message"),/decentralised ventilation objects/u);
  await click(cdp,'#project-type-conflict-dialog button[value="mixed"]');
  assert.equal(await text(cdp,"#current-project-type"),"Mixed");
  assert.equal((await savedDecentralised(cdp)).length,3,"Changing project type must preserve placed units");
  await evaluate(cdp,`document.querySelector("#cloud-projects-dialog").showModal()`);
  await setValue(cdp,"#project-type-filter","mixed");
  const filterHeight=await evaluate(cdp,`document.querySelector("#project-type-filter").getBoundingClientRect().height`);
  assert.ok(filterHeight>=40,`Expected touch-usable type filter, got ${filterHeight}`);
  await evaluate(cdp,`document.querySelector("#cloud-projects-dialog").close()`);

  await waitForValue(() => savedProjectType(cdp), "mixed");
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, `document.readyState === "complete" && !document.querySelector(".app-shell")?.hidden && document.querySelectorAll('[data-system="decentralised-mvhr"]').length >= 3`);
  records = await savedDecentralised(cdp);
  assert.equal(records.length, 3);
  assert.equal(records.filter((item) => item.pairGroupId === "Pair 1").length, 2);
  assert.equal(await savedProjectType(cdp),"mixed");
  assert.equal(await text(cdp,"#current-project-type"),"Mixed");
  assert.deepEqual(exceptions, [], `Browser runtime exceptions: ${exceptions.join("; ")}`);
  cdp.close();
  process.stdout.write(`${JSON.stringify({ ok: true, physicalUnits: 3, projectType: "mixed", conflictReview: true, typeFilterTouchHeight: filterHeight, persistentTouchPlacement: true, alternatingPairAndController: true, continuousBalancedUnpaired: true, rotated: true, centralRoutes: 0, saveReopen: true }, null, 2)}\n`);
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
}

async function startQaServer() {
  const index = await readFile(resolve(root, "app/index.html"), "utf8");
  const qaBootstrap = `<script type="module">\nimport { setBootAccess } from "./auth-context.mjs";\nsetBootAccess({ state: "approved", user: { id: "${qaIdentity.userId}", email: "qa@example.test" }, memberships: [{ role: "owner", status: "active", workspace: { id: "${qaIdentity.workspaceId}", name: "Isolated QA" } }] });\ndocument.querySelector("#app-auth-status").hidden = true;\ndocument.querySelector(".app-shell").hidden = false;\nawait import("./main.mjs");\n</script>`;
  const qaIndex = index.replace('<script type="module" src="./bootstrap.mjs"></script>', qaBootstrap);
  const contentTypes = new Map([[".css", "text/css"], [".html", "text/html"], [".js", "text/javascript"], [".mjs", "text/javascript"], [".json", "application/json"], [".svg", "image/svg+xml"]]);
  const instance = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/app/" || url.pathname === "/app/index.html") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(qaIndex);
        return;
      }
      const resolved = resolveStaticRequestPath(root, url.pathname);
      const filePath = await realpath(resolved.filePath);
      const allowedRoot = await realpath(resolved.allowedRoot);
      if (!isPathInside(filePath, allowedRoot) || !(await stat(filePath)).isFile()) throw new Error("Not found");
      const bytes = await readFile(filePath);
      response.writeHead(200, { "Content-Type": contentTypes.get(extname(filePath)) ?? "application/octet-stream", "Cache-Control": "no-store" });
      response.end(bytes);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    }
  });
  await new Promise((resolveListen) => instance.listen(0, "127.0.0.1", resolveListen));
  return instance;
}

async function savedDecentralised(cdp) {
  await delay(220);
  return evaluate(cdp, `(async () => { const recovery=await import("/src/persistence/working-session.mjs"); const store=recovery.createWorkingSessionStore(indexedDB,{tabId:recovery.workingTabId(sessionStorage)}); const saved=await store.read({userId:${JSON.stringify(qaIdentity.userId)},workspaceId:${JSON.stringify(qaIdentity.workspaceId)}}); return (saved?.project?.components??[]).filter((component)=>component.decentralisedMvhr).map((component)=>({id:component.id,pairGroupId:component.decentralisedMvhr.pairGroupId,controllerReference:component.decentralisedMvhr.controllerReference,operatingMode:component.decentralisedMvhr.operatingMode,orientation:component.orientation})); })()`);
}
async function savedProjectType(cdp) { return evaluate(cdp, `(async () => { const recovery=await import("/src/persistence/working-session.mjs"); const store=recovery.createWorkingSessionStore(indexedDB,{tabId:recovery.workingTabId(sessionStorage)}); const saved=await store.read({userId:${JSON.stringify(qaIdentity.userId)},workspaceId:${JSON.stringify(qaIdentity.workspaceId)}}); return saved?.project?.ventilationDesignType; })()`); }
async function scheduleSummary(cdp) { return evaluate(cdp, `(async () => { const recovery=await import("/src/persistence/working-session.mjs"); const store=recovery.createWorkingSessionStore(indexedDB,{tabId:recovery.workingTabId(sessionStorage)}); const saved=await store.read({userId:${JSON.stringify(qaIdentity.userId)},workspaceId:${JSON.stringify(qaIdentity.workspaceId)}}); const module=await import("/src/editor/parts-schedule.mjs"); const schedule=module.createPartsSchedule(saved.project,{floorId:"floor-ground"}); return {unitCount:schedule.decentralisedSystems.unitCount,pairGroupCount:schedule.decentralisedSystems.pairGroupCount,controllerReferenceCount:schedule.decentralisedSystems.controllerReferenceCount,scheduleQuantity:schedule.componentLines.filter((line)=>line.section==="decentralised").reduce((sum,line)=>sum+line.quantity,0),routeCount:schedule.routeLines.length}; })()`); }
async function selectLatestComponent(cdp) { return evaluate(cdp, `(() => { const items=[...document.querySelectorAll('[data-system="decentralised-mvhr"]')]; const element=items.at(-1); if(!element)return false; element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:element.getBoundingClientRect().x+3,clientY:element.getBoundingClientRect().y+3,pointerType:"mouse"})); element.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:element.getBoundingClientRect().x+3,clientY:element.getBoundingClientRect().y+3,pointerType:"mouse"})); element.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:element.getBoundingClientRect().x+3,clientY:element.getBoundingClientRect().y+3})); return true; })()`); }
async function selectFirstComponent(cdp) { return evaluate(cdp, `(() => { const element=document.querySelector('[data-system="decentralised-mvhr"]'); if(!element)return false; const box=element.getBoundingClientRect(); element.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:box.x+3,clientY:box.y+3})); return true; })()`); }
async function canvasPoint(cdp, xRatio, yRatio) { return evaluate(cdp, `(() => { const box=document.querySelector("#plan-canvas").getBoundingClientRect(); return { x:box.left+box.width*${xRatio}, y:box.top+box.height*${yRatio} }; })()`); }
async function canvasTouchTap(cdp, xRatio, yRatio) { const point=await canvasPoint(cdp,xRatio,yRatio); await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{...point,id:1}]}); await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]}); await delay(120); }
async function setValue(cdp, selector, value) { await evaluate(cdp, `(() => { const element=document.querySelector(${JSON.stringify(selector)}); element.value=${JSON.stringify(value)}; element.dispatchEvent(new Event("input",{bubbles:true})); element.dispatchEvent(new Event("change",{bubbles:true})); return true; })()`); await delay(80); }
async function click(cdp, selector) { assert.equal(await evaluate(cdp, `(() => { const element=document.querySelector(${JSON.stringify(selector)}); if(!element)return false; element.click(); return true; })()`), true, `Missing clickable element: ${selector}`); await delay(80); }
async function clickByText(cdp, selector, value) { assert.equal(await evaluate(cdp, `(() => { const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find((candidate)=>candidate.textContent.includes(${JSON.stringify(value)})); if(!element)return false; element.click(); return true; })()`), true, `Missing ${value} in ${selector}`); await delay(80); }
async function visible(cdp, selector) { return evaluate(cdp, `(() => { const element=document.querySelector(${JSON.stringify(selector)}),box=element?.getBoundingClientRect(); return Boolean(element&&!element.hidden&&box.width>0&&box.height>0); })()`); }
async function count(cdp, selector) { return evaluate(cdp, `document.querySelectorAll(${JSON.stringify(selector)}).length`); }
async function text(cdp, selector) { return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`); }
async function attribute(cdp, selector, name) { return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? null`); }
async function reservePort() { const instance=createServer(); await new Promise((resolveListen)=>instance.listen(0,"127.0.0.1",resolveListen)); const port=instance.address().port; await new Promise((resolveClose)=>instance.close(resolveClose)); return port; }
async function waitForDevTools(port) { for(let attempt=0;attempt<160;attempt+=1){try{const response=await fetch(`http://127.0.0.1:${port}/json/version`);if(response.ok)return;}catch{}await delay(50);}throw new Error("Chrome DevTools endpoint did not become available"); }
async function connectCdp(url) { const socket=new WebSocket(url); await new Promise((resolveOpen,reject)=>{socket.addEventListener("open",resolveOpen,{once:true});socket.addEventListener("error",reject,{once:true});}); let sequence=0;const pending=new Map(),handlers=new Map();socket.addEventListener("message",(event)=>{const message=JSON.parse(event.data);if(message.id){const request=pending.get(message.id);pending.delete(message.id);if(message.error)request.reject(new Error(message.error.message));else request.resolve(message.result);}else for(const handler of handlers.get(message.method)??[])handler(message.params);});return {send(method,params={}){const id=++sequence;socket.send(JSON.stringify({id,method,params}));return new Promise((resolveSend,rejectSend)=>pending.set(id,{resolve:resolveSend,reject:rejectSend}));},on(method,handler){if(!handlers.has(method))handlers.set(method,[]);handlers.get(method).push(handler);},close(){socket.close();}}; }
async function evaluate(cdp, expression) { const result=await cdp.send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value; }
async function waitFor(cdp, expression, timeoutMs=10000) { const started=Date.now();while(Date.now()-started<timeoutMs){if(await evaluate(cdp,`Boolean(${expression})`))return;await delay(50);}throw new Error(`Timed out waiting for: ${expression}`); }
async function waitForValue(read, expected, timeoutMs=10000) { const started=Date.now();let actual;while(Date.now()-started<timeoutMs){actual=await read();if(actual===expected)return;await delay(50);}throw new Error(`Timed out waiting for ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}`); }
function delay(ms) { return new Promise((resolveDelay)=>setTimeout(resolveDelay,ms)); }
