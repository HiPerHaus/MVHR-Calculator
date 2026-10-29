import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isPathInside, resolveStaticRequestPath } from "../src/dev/static-path.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "hiper-terminal-placement-"));
const qaIdentity = { userId: "qa-terminal-user", workspaceId: "qa-terminal-workspace" };
const server = await startQaServer();
const address = server.address();
const appUrl = `http://127.0.0.1:${address.port}/app/`;
const browser = spawn(chrome, [
  "--headless=new", "--no-first-run", "--disable-gpu", "--disable-background-networking",
  "--disable-component-update", "--remote-debugging-port=0", `--user-data-dir=${profileDirectory}`,
  "--window-size=1024,768", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let browserStderr = "";
browser.stderr.setEncoding("utf8");
browser.stderr.on("data", (chunk) => { browserStderr += chunk; });

try {
  const port = await readDevToolsPort(profileDirectory);
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(appUrl)}`, { method: "PUT" }).then((response) => response.json());
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  const exceptions = [];
  cdp.on("Runtime.exceptionThrown", (params) => exceptions.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "Runtime exception"));
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 2, mobile: true });
  await waitFor(cdp, `document.readyState === "complete" && !document.querySelector(".app-shell")?.hidden && document.querySelector("#draft-status")?.textContent.includes("outline")`);
  await click(cdp, "#ventilation-nav");
  await click(cdp, "#tablet-tools-toggle");
  await clickByText(cdp, ".parts-category", "Terminals");
  if (!await evaluate(cdp, `document.querySelector("#plan-workspace")?.classList.contains("tablet-tools-open")`)) {
    await click(cdp, "#tablet-tools-toggle");
  }
  const terminalUi = await evaluate(cdp, `(() => ({
    drawerOpen: document.querySelector("#plan-workspace")?.classList.contains("tablet-tools-open"),
    selectedGroups: [...document.querySelectorAll(".parts-category.active")].map((element) => element.textContent.trim()),
    headings: [...document.querySelectorAll(".terminal-menu-heading")].map((element) => element.textContent),
    serviceControls: document.querySelectorAll(".terminal-service-tools").length,
    serviceDisplay: getComputedStyle(document.querySelector(".terminal-service-tools")).display,
    serviceBox: (() => { const box=document.querySelector(".terminal-service-tools")?.getBoundingClientRect(); return box ? {x:box.x,y:box.y,width:box.width,height:box.height} : null; })(),
    mechanicalHidden: document.querySelector("#mechanical-tools-section")?.hidden,
    ventilationActive: document.querySelector("#ventilation-nav")?.classList.contains("active"),
    leftTransform: getComputedStyle(document.querySelector(".left-panel")).transform,
  }))()`);
  assert.equal(await visible(cdp, ".terminal-service-tools"), true, `Terminal service controls were not visible: ${JSON.stringify(terminalUi)}`);
  assert.equal(await count(cdp, ".terminal-service-tool"), 2);
  assert.equal(await evaluate(cdp, `[...document.querySelectorAll(".terminal-service-tool")].every((button) => button.getBoundingClientRect().height >= 44)`), true);
  const controlsScreenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile("/tmp/hiper-terminal-controls.png", Buffer.from(controlsScreenshot.data, "base64"));

  await click(cdp, ".terminal-service-tool-supply");
  assert.equal(await attribute(cdp, ".terminal-service-tool-supply", "aria-pressed"), "true");
  await click(cdp, "#ventilation-nav");
  assert.equal(await attribute(cdp, ".terminal-service-tool-supply", "aria-pressed"), "true", "Clicking the active Place stage must not reset armed placement");
  assert.match(await text(cdp, ".terminal-service-tool-supply"), /Active · keep placing/u);
  await click(cdp, "#route-nav");
  assert.equal(await componentCount(cdp), 0, "Changing stage must cancel only the uncommitted placement preview");
  assert.equal(await attribute(cdp, "#select-tool", "aria-pressed"), "true");
  await click(cdp, "#ventilation-nav");
  await click(cdp, "#tablet-tools-toggle");
  await click(cdp, ".terminal-service-tool-supply");
  assert.equal(await attribute(cdp, '[data-terminal-shape="round"]', "aria-pressed"), "true");
  assert.equal(await visible(cdp, "#tablet-draft-actions"), true);
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile("/tmp/hiper-terminal-placement.png", Buffer.from(screenshot.data, "base64"));

  const beforePinch = await componentCount(cdp);
  await canvasPinch(cdp);
  assert.equal(await componentCount(cdp), beforePinch, "Two-finger navigation must not place an outlet");

  await canvasTouchTap(cdp, 0.35, 0.35);
  await canvasTouchTap(cdp, 0.55, 0.35);
  assert.equal(await componentCount(cdp), 2, "Supply mode should remain armed for repeated finger taps");
  assert.equal(await attribute(cdp, ".terminal-service-tool-supply", "aria-pressed"), "true");

  await click(cdp, "#tablet-tools-toggle");
  await click(cdp, ".terminal-service-tool-extract");
  assert.equal(await attribute(cdp, ".terminal-service-tool-extract", "aria-pressed"), "true");
  await canvasPenTap(cdp, 0.45, 0.58);
  assert.equal(await componentCount(cdp), 3, "Apple Pencil input should place the selected Extract outlet");
  assert.deepEqual(await savedTerminalRecords(cdp), ["luna-supply", "luna-supply", "luna-extract"]);

  await click(cdp, "#undo");
  assert.equal(await componentCount(cdp), 2, "Each placement should be its own undo step");
  await click(cdp, "#redo");
  assert.equal(await componentCount(cdp), 3);

  await click(cdp, "#tablet-tools-toggle");
  await click(cdp, ".terminal-service-tool-supply");
  await click(cdp, "#tablet-tools-toggle");
  await click(cdp, '[data-terminal-shape="rectangular"]');
  assert.equal(await attribute(cdp, ".terminal-service-tool-supply", "aria-pressed"), "true");
  await canvasTouchTap(cdp, 0.68, 0.58);
  assert.equal(await componentCount(cdp), 4);
  assert.deepEqual(await savedTerminalRecords(cdp), ["luna-supply", "luna-supply", "luna-extract", "aerofresh-magnetic-wall-grille-supply"]);

  await click(cdp, "#tablet-draft-cancel");
  assert.equal(await attribute(cdp, "#select-tool", "aria-pressed"), "true");
  await canvasTouchTap(cdp, 0.75, 0.35);
  assert.equal(await componentCount(cdp), 4, "Cancel must leave placement without adding another outlet");

  await click(cdp, "#tablet-tools-toggle");
  await click(cdp, ".terminal-service-tool-extract");
  await pressEscape(cdp);
  assert.equal(await attribute(cdp, "#select-tool", "aria-pressed"), "true");

  await click(cdp, "#tablet-tools-toggle");
  await click(cdp, ".terminal-service-tool-supply");
  await click(cdp, "#pan-tool");
  const viewBeforePan = await attribute(cdp, "#plan-canvas", "viewBox");
  await canvasTouchDrag(cdp, 0.45, 0.45, 0.60, 0.52);
  assert.notEqual(await attribute(cdp, "#plan-canvas", "viewBox"), viewBeforePan);
  assert.equal(await componentCount(cdp), 4, "Pan must move only the camera");
  assert.equal(await attribute(cdp, "#pan-tool", "aria-pressed"), "true");

  await delay(250);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, `document.readyState === "complete" && !document.querySelector(".app-shell")?.hidden && new Set([...document.querySelectorAll("[data-component-id]")].map((element) => element.dataset.componentId)).size === 4`);
  assert.deepEqual(await savedTerminalRecords(cdp), ["luna-supply", "luna-supply", "luna-extract", "aerofresh-magnetic-wall-grille-supply"]);
  assert.deepEqual(exceptions, [], `Browser runtime exceptions: ${exceptions.join("; ")}`);
  cdp.close();
  process.stdout.write(`${JSON.stringify({ ok: true, repeatedSupply: 2, switchedExtract: 1, rectangularSupply: 1, pinchSafe: true, panSafe: true, pencilPlaced: true, undoRedo: true, cancelAndEscapeExit: true, saveReopen: true }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  if (browserStderr) process.stderr.write(`Chrome diagnostics:\n${browserStderr.slice(-3000)}\n`);
  process.exitCode = 1;
} finally {
  const exited = new Promise((resolve) => browser.once("exit", resolve));
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

async function savedTerminalRecords(cdp) {
  await delay(100);
  return evaluate(cdp, `(async () => { const recovery=await import("/src/persistence/working-session.mjs"); const store=recovery.createWorkingSessionStore(indexedDB,{tabId:recovery.workingTabId(sessionStorage)}); const saved=await store.read({userId:${JSON.stringify(qaIdentity.userId)},workspaceId:${JSON.stringify(qaIdentity.workspaceId)}}); return saved.project.components.map((component) => component.catalogueItemId); })()`);
}
async function componentCount(cdp) { return evaluate(cdp, `new Set([...document.querySelectorAll("[data-component-id]")].map((element) => element.dataset.componentId)).size`); }
async function canvasPoint(cdp, xRatio, yRatio) { return evaluate(cdp, `(() => { const box=document.querySelector("#plan-canvas").getBoundingClientRect(); return { x:box.left+box.width*${xRatio}, y:box.top+box.height*${yRatio} }; })()`); }
async function canvasTouchTap(cdp, xRatio, yRatio) { const point=await canvasPoint(cdp,xRatio,yRatio); await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{...point,id:1}]}); await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]}); await delay(80); }
async function canvasPenTap(cdp, xRatio, yRatio) { const point=await canvasPoint(cdp,xRatio,yRatio); await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",...point,button:"left",clickCount:1,pointerType:"pen"}); await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",...point,button:"left",clickCount:1,pointerType:"pen"}); await delay(80); }
async function canvasTouchDrag(cdp, ax, ay, bx, by) { const start=await canvasPoint(cdp,ax,ay),end=await canvasPoint(cdp,bx,by); await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{...start,id:1}]}); await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{...end,id:1}]}); await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]}); await delay(80); }
async function canvasPinch(cdp) { const a=await canvasPoint(cdp,.42,.45),b=await canvasPoint(cdp,.58,.45),c=await canvasPoint(cdp,.35,.40),d=await canvasPoint(cdp,.65,.50); await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{...a,id:1},{...b,id:2}]}); await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{...c,id:1},{...d,id:2}]}); await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[{...d,id:2}]}); await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]}); await delay(80); }
async function pressEscape(cdp) { await cdp.send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape"}); await cdp.send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape"}); await delay(50); }
async function click(cdp, selector) { assert.equal(await evaluate(cdp, `(() => { const element=document.querySelector(${JSON.stringify(selector)}); if(!element)return false; element.click(); return true; })()`), true, `Missing clickable element: ${selector}`); await delay(50); }
async function clickByText(cdp, selector, value) { assert.equal(await evaluate(cdp, `(() => { const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find((candidate)=>candidate.textContent.includes(${JSON.stringify(value)})); if(!element)return false; element.click(); return true; })()`), true, `Missing ${value} in ${selector}`); await delay(50); }
async function visible(cdp, selector) { return evaluate(cdp, `(() => { const element=document.querySelector(${JSON.stringify(selector)}),box=element?.getBoundingClientRect(); return Boolean(element&&!element.hidden&&box.width>0&&box.height>0); })()`); }
async function count(cdp, selector) { return evaluate(cdp, `document.querySelectorAll(${JSON.stringify(selector)}).length`); }
async function text(cdp, selector) { return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`); }
async function attribute(cdp, selector, name) { return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? null`); }
async function readDevToolsPort(directory) { const file=join(directory,"DevToolsActivePort"); for(let attempt=0;attempt<100;attempt+=1){try{return (await readFile(file,"utf8")).trim().split("\n")[0];}catch{await delay(50);}} throw new Error("Chrome DevTools endpoint did not become available"); }
async function connectCdp(url) { const socket=new WebSocket(url); await new Promise((resolveOpen,reject)=>{socket.addEventListener("open",resolveOpen,{once:true});socket.addEventListener("error",reject,{once:true});}); let sequence=0;const pending=new Map(),handlers=new Map();socket.addEventListener("message",(event)=>{const message=JSON.parse(event.data);if(message.id){const request=pending.get(message.id);pending.delete(message.id);if(message.error)request.reject(new Error(message.error.message));else request.resolve(message.result);return;}for(const handler of handlers.get(message.method)??[])handler(message.params??{});});return{send(method,params={}){sequence+=1;return new Promise((resolveSend,reject)=>{pending.set(sequence,{resolve:resolveSend,reject});socket.send(JSON.stringify({id:sequence,method,params}));});},on(method,handler){handlers.set(method,[...(handlers.get(method)??[]),handler]);},close(){socket.close();}}; }
async function evaluate(cdp, expression) { const result=await cdp.send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value; }
async function waitFor(cdp, expression, timeoutMs=10000) { const started=Date.now();while(Date.now()-started<timeoutMs){if(await evaluate(cdp,`Boolean(${expression})`))return;await delay(50);}throw new Error(`Timed out waiting for: ${expression}`); }
function delay(ms) { return new Promise((resolveDelay)=>setTimeout(resolveDelay,ms)); }
