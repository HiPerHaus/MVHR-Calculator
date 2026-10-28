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
  assert.equal(await evaluate(cdp, `document.querySelector("#routing-workflow-steps")?.closest("details")?.open`), false, "Setup checklist should start collapsed");
  assert.equal(await evaluate(cdp, `document.querySelector("#add-routing-exclusion")?.closest("details")?.open`), false, "Routing coordination should start collapsed");
  assert.equal(await visible(cdp, "#view-options-toggle"), true);
  assert.equal(await evaluate(cdp, `document.querySelector(".left-panel #ventilation-visibility") === null`), true, "View-only controls must leave the left panel");

  await click(cdp, "#view-options-toggle");
  assert.equal(await evaluate(cdp, `document.querySelector("#view-options-toggle")?.getAttribute("aria-expanded")`), "true");
  assert.equal(await visible(cdp, "#view-options-popover"), true);
  assert.equal(await evaluate(cdp, `document.querySelectorAll("#ventilation-visibility input[type=checkbox]").length`), 8);
  await setChecked(cdp, `#ventilation-visibility [data-visibility-group="epp"]`, false);
  await setChecked(cdp, `#ventilation-visibility [data-visibility-group="external"]`, false);
  assert.equal(await evaluate(cdp, `document.querySelector("#view-options-hidden-count")?.textContent`), "2");
  assert.equal(await evaluate(cdp, `document.querySelector("#view-options-toggle")?.classList.contains("has-hidden")`), true);
  await click(cdp, "#show-all-ventilation");
  assert.equal(await evaluate(cdp, `[...document.querySelectorAll("#ventilation-visibility input")].every(input => input.checked)`), true);
  await pressEscape(cdp);
  assert.equal(await visible(cdp, "#view-options-popover"), false);
  assert.equal(await evaluate(cdp, `document.activeElement?.id`), "view-options-toggle", "Escape should return focus to View options");
  await click(cdp, "#view-options-toggle");
  await outsidePointerDown(cdp, "#plan-canvas");
  assert.equal(await visible(cdp, "#view-options-popover"), false, "Outside pointer action should dismiss the popover");

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
  await delay(80);
  const compact = await dimensions(cdp);
  assert.equal(compact.action.visible, true);
  assert.equal(compact.system.visible, true);
  assert.equal(compact.style.visible, true);
  assert.equal(await visible(cdp, "#tablet-tools-toggle"), true, "Tablet tools drawer control should be visible");
  await click(cdp, "#tablet-tools-toggle");
  assert.equal(await evaluate(cdp, `document.querySelector("#plan-workspace")?.classList.contains("tablet-tools-open")`), true);
  await pressEscape(cdp);
  assert.equal(await evaluate(cdp, `document.querySelector("#plan-workspace")?.classList.contains("tablet-tools-open")`), false, "Escape should close tablet drawers");

  await click(cdp, "#plan-nav");
  await click(cdp, "#tablet-tools-toggle");
  await click(cdp, "#wall-tool");
  assert.equal(await evaluate(cdp, `document.querySelector("#plan-workspace")?.classList.contains("tablet-tools-open")`), false, "Choosing a tool should return to the drawing");
  await canvasClick(cdp, 0.35, 0.4);
  assert.match(await evaluate(cdp, `document.querySelector("#draft-status")?.textContent ?? ""`), /1 draft point/u);
  assert.equal(await visible(cdp, "#tablet-draft-actions"), true);
  const draftBeforePinch = await evaluate(cdp, `document.querySelector("#draft-status")?.textContent ?? ""`);
  const cameraBeforePinch = await evaluate(cdp, `document.querySelector("#plan-canvas")?.getAttribute("viewBox")`);
  await canvasPinch(cdp);
  assert.equal(await evaluate(cdp, `document.querySelector("#draft-status")?.textContent ?? ""`), draftBeforePinch, "Two-finger navigation must preserve the active draft");
  assert.notEqual(await evaluate(cdp, `document.querySelector("#plan-canvas")?.getAttribute("viewBox")`), cameraBeforePinch, "Pinch should change only the camera");
  await click(cdp, "#tablet-draft-back");
  assert.doesNotMatch(await evaluate(cdp, `document.querySelector("#draft-status")?.textContent ?? ""`), /draft point/u);
  await canvasClick(cdp, 0.35, 0.4);
  await canvasClick(cdp, 0.55, 0.4);
  assert.equal(await evaluate(cdp, `document.querySelector("#tablet-draft-finish")?.disabled`), false);
  await click(cdp, "#tablet-draft-finish");
  assert.match(await evaluate(cdp, `document.querySelector("#draft-status")?.textContent ?? ""`), /1 walls/u);
  await click(cdp, "#undo");
  await click(cdp, "#ventilation-nav");

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 640, height: 800, deviceScaleFactor: 1, mobile: false });
  await delay(80);
  await click(cdp, "#view-options-toggle");
  const narrowPopover = await evaluate(cdp, `(() => { const box=document.querySelector("#view-options-popover")?.getBoundingClientRect(); return { left:box.left, right:box.right, bottom:box.bottom, width:box.width, viewport:innerWidth }; })()`);
  assert.ok(narrowPopover.left >= 0 && narrowPopover.right <= narrowPopover.viewport, `Narrow popover escaped the viewport: ${JSON.stringify(narrowPopover)}`);
  await pressEscape(cdp);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await delay(80);

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
  assert.equal(await routeCount(cdp), 2, "The seeded manual and label-fixture routes must remain present after reopen");

  await click(cdp, "#ventilation-nav");
  await waitFor(cdp, `!document.querySelector("#mechanical-tools-section")?.hidden`);
  const statusBeforeVisibility = await evaluate(cdp, `document.querySelector("#draft-status")?.textContent ?? ""`);
  await click(cdp, `[data-component-id="cw-browser"]`);
  assert.equal(await evaluate(cdp, `document.querySelector("#inspector-empty")?.hidden`), true, "Fixture distribution component should be selected");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 2, mobile: true });
  await delay(80);
  assert.equal(await visible(cdp, "#tablet-more-actions"), true, "Selected equipment should expose a touch More action");
  await click(cdp, "#tablet-more-actions");
  assert.equal(await visible(cdp, "#component-context-menu"), true, "More should expose rotate and configuration actions without a context click");
  await pressEscape(cdp);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await delay(80);
  await click(cdp, "#view-options-toggle");
  await setChecked(cdp, `#ventilation-visibility [data-visibility-group="distribution"]`, false);
  assert.equal(await evaluate(cdp, `document.querySelector('[data-component-id="cw-browser"]') === null`), true, "Hidden equipment must leave the drawing");
  assert.equal(await evaluate(cdp, `document.querySelector("#inspector-empty")?.hidden`), false, "Hiding the selected equipment group must clear selection");
  assert.equal(await evaluate(cdp, `document.querySelector("#draft-status")?.textContent ?? ""`), statusBeforeVisibility, "View filtering must not change project counts");
  await setChecked(cdp, `#ventilation-visibility [data-visibility-group="distribution"]`, true);
  assert.equal(await evaluate(cdp, `document.querySelector('[data-component-id="cw-browser"]') !== null`), true);
  const bendLabelsBefore = await evaluate(cdp, `document.querySelectorAll('[data-ventilation-label="bend"]').length`);
  assert.ok(bendLabelsBefore > 0, "Fixture should render at least one supported bend label");
  await setChecked(cdp, `#ventilation-visibility [data-visibility-group="bend-labels"]`, false);
  assert.equal(await evaluate(cdp, `document.querySelectorAll('[data-ventilation-label="bend"]').length`), 0);
  await setChecked(cdp, `#ventilation-visibility [data-visibility-group="bend-labels"]`, true);
  assert.ok(await evaluate(cdp, `document.querySelectorAll('[data-ventilation-label="bend"]').length`) > 0);
  await click(cdp, "#view-options-close");
  await select(cdp, "#automatic-route-system", "dn90");
  await select(cdp, "#automatic-route-style", "direct");
  await click(cdp, "#auto-route");
  assert.equal(await previewChoiceCount(cdp), 2, "Direct preview should offer the two unrouted outlets");
  assert.match(await evaluate(cdp, `document.querySelector("#automatic-radial-summary")?.textContent ?? ""`), /2 Direct routes ready/u);
  await click(cdp, "#cancel-automatic-radial");
  assert.equal(await routeCount(cdp), 2, "Cancelling a valid preview must preserve existing routes only");

  await click(cdp, "#auto-route");
  await evaluate(cdp, `(() => { const choices=[...document.querySelectorAll("#automatic-radial-results input[type=checkbox]")]; choices[1].click(); return choices.map(choice => choice.checked); })()`);
  assert.match(await evaluate(cdp, `document.querySelector("#automatic-radial-selection-status")?.textContent ?? ""`), /1 route selected/u);
  await click(cdp, "#apply-automatic-radial");
  assert.equal(await routeCount(cdp), 3, "Applying one selected Direct route must preserve existing routes");

  await select(cdp, "#automatic-route-style", "building-aligned");
  assert.equal(await evaluate(cdp, `document.querySelector("#automatic-route-axis")?.value`), "0.0");
  await click(cdp, "#auto-route");
  assert.equal(await previewChoiceCount(cdp), 1, "Building-aligned preview should regenerate only the remaining outlet");
  assert.match(await evaluate(cdp, `document.querySelector("#automatic-radial-results")?.textContent ?? ""`), /Building-aligned/u);
  await click(cdp, "#cancel-automatic-radial");
  assert.equal(await routeCount(cdp), 3, "Cancelling the aligned preview must preserve accepted and existing routes");

  await click(cdp, "#auto-route");
  await click(cdp, "#apply-automatic-radial");
  assert.equal(await routeCount(cdp), 4, "Applying the aligned route should complete the fixture without replacing its routes");
  await click(cdp, "#undo");
  assert.equal(await routeCount(cdp), 3, "Undo must remove only the aligned automatic batch");
  await click(cdp, "#auto-route");
  assert.equal(await previewChoiceCount(cdp), 1, "After undo, preview must offer the remaining connection again");
  await click(cdp, "#cancel-automatic-radial");
  assert.deepEqual(exceptions, [], `Browser runtime exceptions: ${exceptions.join("; ")}`);
  assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join("; ")}`);
  cdp.close();
  process.stdout.write(`${JSON.stringify({ ok: true, guidedSteps: 5, systems: ["DN90", "EPP"], styles: ["Direct", "Building-aligned"], tabletDrawers: true, visibleDraftActions: true, twoFingerCamera: true, touchMoreActions: true, fitOnReopen: true, validDirectPreview: true, validAlignedPreview: true, selectiveApply: true, cancelPreservesProject: true, undoAndRegenerate: true, manualRoutePreserved: true }, null, 2)}\n`);
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
async function visible(cdp, selector) { return evaluate(cdp, `(() => { const element=document.querySelector(${JSON.stringify(selector)}),box=element?.getBoundingClientRect(); return Boolean(element && !element.hidden && box.width > 0 && box.height > 0); })()`); }
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
    const manualPoints = [manual.points[0], { x: 2800, y: manual.points[0].y }, { x: 2800, y: manual.points.at(-1).y }, manual.points.at(-1)];
    project = spatial.applyCommand(project, { type: "route.add", route: { id: "route-manual-browser", floorId: "ground", system: manual.system, stream: manual.stream, role: manual.role, ductKind: family.id, connectionInterface: family.connectionInterface, parallelRunCount: 1, startAttachment: { componentId: manual.source.componentId, portId: manual.source.portId }, endAttachment: { componentId: manual.destination.componentId, portId: manual.destination.portId }, points: manualPoints.map(point => ({ ...point, z: spatial.unknownMm("browser fixture") })) } });
    const eppFamily = catalogue.routeFamilyForKind("epp-rigid-dn160");
    project = spatial.applyCommand(project, { type: "route.add", route: { id: "route-label-browser", floorId: "ground", system: "mvhr", stream: "intake", role: "Outdoor intake", ductKind: eppFamily.id, connectionInterface: eppFamily.connectionInterface, parallelRunCount: 1, startAttachment: null, endAttachment: null, points: [[400,3400],[1800,3400],[1800,3800]].map(([x,y]) => ({ x, y, z: spatial.unknownMm("browser label fixture") })) } });
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
async function click(cdp, selector) { const found = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; if (typeof element.click === "function") element.click(); else element.dispatchEvent(new MouseEvent("click",{bubbles:true})); return true; })()`); assert.equal(found, true, `Missing clickable element: ${selector}`); await delay(50); }
async function select(cdp, selector, value) { const found = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.value=${JSON.stringify(value)}; element.dispatchEvent(new Event("change",{bubbles:true})); return true; })()`); assert.equal(found, true, `Missing select: ${selector}`); await delay(50); }
async function setChecked(cdp, selector, checked) { const found = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.checked=${JSON.stringify(checked)}; element.dispatchEvent(new Event("change",{bubbles:true})); return true; })()`); assert.equal(found, true, `Missing checkbox: ${selector}`); await delay(50); }
async function pressEscape(cdp) { await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" }); await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" }); await delay(50); }
async function outsidePointerDown(cdp, selector) { const found = await evaluate(cdp, `(() => { const element=document.querySelector(${JSON.stringify(selector)}); if(!element)return false; element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerId:1,pointerType:"mouse",clientX:1,clientY:1})); return true; })()`); assert.equal(found, true, `Missing outside target: ${selector}`); await delay(50); }
async function canvasClick(cdp, xRatio, yRatio) {
  const point = await evaluate(cdp, `(() => { const box=document.querySelector("#plan-canvas").getBoundingClientRect(); return {x:box.left+box.width*${xRatio},y:box.top+box.height*${yRatio}}; })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await delay(50);
}
async function canvasPinch(cdp) {
  const box = await evaluate(cdp, `(() => { const box=document.querySelector("#plan-canvas").getBoundingClientRect(); return {left:box.left,top:box.top,width:box.width,height:box.height}; })()`);
  const centre = { x: box.left + box.width * .5, y: box.top + box.height * .5 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: centre.x - 45, y: centre.y, id: 1 }, { x: centre.x + 45, y: centre.y, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: centre.x - 85, y: centre.y - 20, id: 1 }, { x: centre.x + 85, y: centre.y + 20, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ x: centre.x - 85, y: centre.y - 20, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await delay(80);
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
