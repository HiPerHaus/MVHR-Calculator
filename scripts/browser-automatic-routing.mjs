import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP_URL = process.argv[2] ?? "http://127.0.0.1:4199/app/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "hiper-studio-auto-routing-"));
const browser = spawn(CHROME, [
  "--headless=new", "--no-first-run", "--disable-gpu", "--disable-background-networking",
  "--disable-component-update", "--remote-debugging-port=0", `--user-data-dir=${profileDirectory}`,
  "--window-size=1600,1000", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let browserStderr = "";
browser.stderr.setEncoding("utf8");
browser.stderr.on("data", (chunk) => { browserStderr += chunk; });

try {
  const port = await readDevToolsPort(profileDirectory);
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(APP_URL)}`, { method: "PUT" }).then((response) => response.json());
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  const exceptions = [], consoleErrors = [];
  cdp.on("Runtime.exceptionThrown", (params) => exceptions.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "Runtime exception"));
  cdp.on("Runtime.consoleAPICalled", (params) => { if (["error", "warning"].includes(params.type)) consoleErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")); });
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await waitFor(cdp, `document.readyState === "complete" && !document.querySelector(".app-shell")?.hidden && document.querySelector("#draft-status")?.textContent.includes("outline")`, 15000);
  await click(cdp, "#ventilation-nav");
  await waitFor(cdp, `!document.querySelector("#mechanical-tools-section")?.hidden`);

  const desktop = await dimensions(cdp);
  assert.equal(desktop.action.visible, true);
  assert.equal(desktop.system.visible, true);
  assert.equal(desktop.style.visible, true);
  assert.equal(desktop.inCollapsedDetails, false);
  assert.equal(desktop.steps, 5);

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
  await delay(80);
  const compact = await dimensions(cdp);
  assert.equal(compact.action.visible, true);
  assert.equal(compact.system.visible, true);
  assert.equal(compact.style.visible, true);

  await select(cdp, "#automatic-route-system", "epp");
  await click(cdp, "#auto-route");
  assert.equal(await evaluate(cdp, `document.querySelector("#automatic-epp-dialog")?.open`), true);
  assert.match(await evaluate(cdp, `document.querySelector("#automatic-epp-summary")?.textContent ?? ""`), /outline|floor|Calibrate|ports/i);
  assert.equal(await evaluate(cdp, `document.querySelector("#apply-automatic-epp")?.disabled`), true);
  await click(cdp, "#cancel-automatic-epp");
  assert.equal(await evaluate(cdp, `document.querySelector("#automatic-epp-dialog")?.open`), false);

  await select(cdp, "#automatic-route-system", "dn90");
  await click(cdp, "#auto-route");
  assert.equal(await evaluate(cdp, `document.querySelector("#automatic-radial-dialog")?.open`), true);
  await click(cdp, "#cancel-automatic-radial");

  await seedSyntheticProject(cdp);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, `document.readyState === "complete" && !document.querySelector(".app-shell")?.hidden && document.querySelector("#draft-status")?.textContent.includes("outline")`, 15000);
  await waitFor(cdp, `document.querySelector("#mode-prompt")?.textContent.includes("Drawing fitted after loading")`);
  const fittedView = await evaluate(cdp, `document.querySelector("#plan-canvas")?.getAttribute("viewBox")`);
  assert.ok(Number(fittedView.split(/\s+/u)[2]) > 600, `Reopened drawing did not fit horizontally: ${fittedView}`);
  assert.equal(await routeCount(cdp), 1, "The seeded manual route must remain present after reopen");

  await click(cdp, "#ventilation-nav");
  await waitFor(cdp, `!document.querySelector("#mechanical-tools-section")?.hidden`);
  await select(cdp, "#automatic-route-system", "dn90");
  await select(cdp, "#automatic-route-style", "direct");
  await click(cdp, "#auto-route");
  assert.equal(await previewChoiceCount(cdp), 2, "Direct preview should offer the two unrouted outlets");
  assert.match(await evaluate(cdp, `document.querySelector("#automatic-radial-summary")?.textContent ?? ""`), /2 Direct routes ready/u);
  await click(cdp, "#cancel-automatic-radial");
  assert.equal(await routeCount(cdp), 1, "Cancelling a valid preview must preserve the manual route only");

  await click(cdp, "#auto-route");
  await evaluate(cdp, `(() => { const choices=[...document.querySelectorAll("#automatic-radial-results input[type=checkbox]")]; choices[1].click(); return choices.map(choice => choice.checked); })()`);
  assert.match(await evaluate(cdp, `document.querySelector("#automatic-radial-selection-status")?.textContent ?? ""`), /1 route selected/u);
  await click(cdp, "#apply-automatic-radial");
  assert.equal(await routeCount(cdp), 2, "Applying one selected Direct route must preserve the manual route");

  await select(cdp, "#automatic-route-style", "building-aligned");
  assert.equal(await evaluate(cdp, `document.querySelector("#automatic-route-axis")?.value`), "0.0");
  await click(cdp, "#auto-route");
  assert.equal(await previewChoiceCount(cdp), 1, "Building-aligned preview should regenerate only the remaining outlet");
  assert.match(await evaluate(cdp, `document.querySelector("#automatic-radial-results")?.textContent ?? ""`), /Building-aligned/u);
  await click(cdp, "#cancel-automatic-radial");
  assert.equal(await routeCount(cdp), 2, "Cancelling the aligned preview must preserve accepted and manual routes");

  await click(cdp, "#auto-route");
  await click(cdp, "#apply-automatic-radial");
  assert.equal(await routeCount(cdp), 3, "Applying the aligned route should complete the three-route fixture");
  await click(cdp, "#undo");
  assert.equal(await routeCount(cdp), 2, "Undo must remove only the aligned automatic batch");
  await click(cdp, "#auto-route");
  assert.equal(await previewChoiceCount(cdp), 1, "After undo, preview must offer the remaining connection again");
  await click(cdp, "#cancel-automatic-radial");
  assert.deepEqual(exceptions, [], `Browser runtime exceptions: ${exceptions.join("; ")}`);
  assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join("; ")}`);
  cdp.close();
  process.stdout.write(`${JSON.stringify({ ok: true, guidedSteps: 5, systems: ["DN90", "EPP"], styles: ["Direct", "Building-aligned"], fitOnReopen: true, validDirectPreview: true, validAlignedPreview: true, selectiveApply: true, cancelPreservesProject: true, undoAndRegenerate: true, manualRoutePreserved: true }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  if (browserStderr) process.stderr.write(`Chrome diagnostics:\n${browserStderr.slice(-4000)}\n`);
  process.exitCode = 1;
} finally {
  const exited = new Promise((resolve) => browser.once("exit", resolve));
  browser.kill("SIGTERM");
  await Promise.race([exited, delay(2000)]);
  await rm(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

async function dimensions(cdp) {
  return evaluate(cdp, `(() => {
    const info = (selector) => { const element = document.querySelector(selector), box = element?.getBoundingClientRect(); return { visible: Boolean(element && box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden"), width: box?.width ?? 0 }; };
    return { action: info("#auto-route"), system: info("#automatic-route-system"), style: info("#automatic-route-style"), steps: document.querySelectorAll("#routing-workflow-steps li").length, inCollapsedDetails: Boolean(document.querySelector("details:not([open]) #auto-route")) };
  })()`);
}
async function previewChoiceCount(cdp) { return evaluate(cdp, `document.querySelectorAll("#automatic-radial-results input[type=checkbox]").length`); }
async function routeCount(cdp) {
  const status = await evaluate(cdp, `document.querySelector("#draft-status")?.textContent ?? ""`);
  const match = status.match(/(\d+) routes/u);
  assert.ok(match, `Route count was not rendered: ${status}`);
  return Number(match[1]);
}
async function seedSyntheticProject(cdp) {
  await evaluate(cdp, `(async () => {
    const spatial = await import("/src/domain/spatial.mjs");
    const catalogue = await import("/src/editor/component-catalogue.mjs");
    const standalone = await import("/src/editor/standalone-cw.mjs");
    const automatic = await import("/src/editor/automatic-radial-routing.mjs");
    const recovery = await import("/src/persistence/working-session.mjs");
    let project = spatial.createProject("browser-routing-acceptance");
    project = spatial.applyCommand(project, { type: "floor.add", floor: { id: "ground", name: "Ground", transform: { translationMm: { x: 0, y: 0, z: spatial.knownMm(0, "floor datum") }, orientation: spatial.identityQuaternion() } } });
    project = spatial.applyCommand(project, { type: "floorArea.create", outline: { id: "outline", floorId: "ground", name: "Building outline", geometrySource: "manual-floor-area-outline", purpose: "preliminary-quoting", areaConvention: "closed-plan-outline", measurementBasis: "floor-local-plan-mm", holes: [], vertices: [{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}].map((point,index) => ({ id: \`v-\${index+1}\`, positionMm: { ...point, z: spatial.knownMm(0, "plan") } })) } });
    project = spatial.applyCommand(project, { type: "reference.addImage", asset: { id: "asset", kind: "image", fileName: "fixture.png", mediaType: "image/png", byteLength: 3, sha256: "0".repeat(64), widthPx: 1000, heightPx: 500, dataUrl: "data:image/png;base64,AAAA" }, reference: { id: "reference", floorId: "ground", assetId: "asset", visible: true, locked: true, opacity: 0.5, transform: { translationMm: { x: 0, y: 0 }, rotationRad: 0, scaleMmPerPixel: spatial.knownMm(10, "fixture scale") }, calibration: null } });
    project = spatial.applyCommand(project, { type: "reference.calibrate", referenceId: "reference", sourcePointApx: { x: 0, y: 0 }, sourcePointBpx: { x: 1000, y: 0 }, knownDistanceMm: 10000, inputUnit: "m", acceptedAtUtc: "2026-10-26T00:00:00.000Z", previewScaleMmPerPixel: 10, rescaleFloorModel: false });
    const source = catalogue.createCatalogueComponent(standalone.standaloneCwRecordId({ size: "320", orientation: "vertical", stream: "supply" }), { id: "cw-browser", floorId: "ground", xMm: 1000, yMm: 2000, allowAssemblyOnly: true });
    const outlets = [1200, 2200, 3200].map((y, index) => catalogue.createCatalogueComponent("luna-supply", { id: \`outlet-browser-\${index+1}\`, floorId: "ground", xMm: 5000, yMm: y }));
    project = spatial.applyCommand(project, { type: "component.add", component: source });
    for (const outlet of outlets) project = spatial.applyCommand(project, { type: "component.add", component: outlet });
    const manual = automatic.inspectAutomaticRadialRouting(project, "ground", { routingStyle: "direct", gridSpacingMm: 100 }).proposals.find(proposal => proposal.destination.componentId === outlets[0].id);
    const family = catalogue.routeFamilyForKind("semi-rigid-radial");
    project = spatial.applyCommand(project, { type: "route.add", route: { id: "route-manual-browser", floorId: "ground", system: manual.system, stream: manual.stream, role: manual.role, ductKind: family.id, connectionInterface: family.connectionInterface, parallelRunCount: 1, startAttachment: { componentId: manual.source.componentId, portId: manual.source.portId }, endAttachment: { componentId: manual.destination.componentId, portId: manual.destination.portId }, points: manual.points.map(point => ({ ...point, z: spatial.unknownMm("browser fixture") })) } });
    const tabId = recovery.workingTabId(sessionStorage);
    const store = recovery.createWorkingSessionStore(indexedDB, { tabId });
    await store.write({}, { projectJson: spatial.serializeProject(project), name: "Routing browser fixture", dirty: true, cloudRecord: null, task: "ventilation", camera: { x: 0, y: 0, width: 20, height: 20 }, catalogueGroup: "all" });
    await store.flush();
    return true;
  })()`);
}
async function readDevToolsPort(directory) { const file = join(directory, "DevToolsActivePort"); for (let attempt = 0; attempt < 100; attempt += 1) { try { return (await readFile(file, "utf8")).trim().split("\n")[0]; } catch { await delay(50); } } throw new Error("Chrome DevTools endpoint did not become available"); }
async function connectCdp(url) { const socket = new WebSocket(url); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); }); let sequence = 0; const pending = new Map(), handlers = new Map(); socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); if (message.id) { const request = pending.get(message.id); pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); return; } for (const handler of handlers.get(message.method) ?? []) handler(message.params ?? {}); }); return { send(method, params = {}) { sequence += 1; return new Promise((resolve, reject) => { pending.set(sequence, { resolve, reject }); socket.send(JSON.stringify({ id: sequence, method, params })); }); }, on(method, handler) { handlers.set(method, [...(handlers.get(method) ?? []), handler]); }, close() { socket.close(); } }; }
async function evaluate(cdp, expression) { const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; }
async function waitFor(cdp, expression, timeoutMs = 6000) { const started = Date.now(); while (Date.now() - started < timeoutMs) { if (await evaluate(cdp, `Boolean(${expression})`)) return; await delay(50); } throw new Error(`Timed out waiting for: ${expression}`); }
async function click(cdp, selector) { const found = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`); assert.equal(found, true, `Missing clickable element: ${selector}`); await delay(50); }
async function select(cdp, selector, value) { const found = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.value=${JSON.stringify(value)}; element.dispatchEvent(new Event("change",{bubbles:true})); return true; })()`); assert.equal(found, true, `Missing select: ${selector}`); await delay(50); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
