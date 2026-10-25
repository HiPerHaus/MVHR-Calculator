import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP_URL = process.argv[2] ?? "http://127.0.0.1:4199/app/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "hiper-studio-three-d-"));
const browser = spawn(CHROME, [
  "--headless=new", "--no-first-run", "--disable-gpu", "--disable-background-networking",
  "--disable-component-update", "--remote-debugging-port=0", `--user-data-dir=${profileDirectory}`,
  "--window-size=1600,1200", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let browserStderr = "";
browser.stderr.setEncoding("utf8");
browser.stderr.on("data", (chunk) => { browserStderr += chunk; });

try {
  const port = await readDevToolsPort(profileDirectory);
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(APP_URL)}`, { method: "PUT" }).then((response) => response.json());
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  const exceptions = [];
  const consoleErrors = [];
  cdp.on("Runtime.exceptionThrown", (params) => exceptions.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "Runtime exception"));
  cdp.on("Runtime.consoleAPICalled", (params) => {
    if (["error", "warning"].includes(params.type)) consoleErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
  });
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await waitFor(cdp, `document.readyState === "complete" && document.querySelector("#project-nav")`);
  const mainResponse = await evaluate(cdp, `fetch("/app/main.mjs").then(async (response) => ({ ok: response.ok, status: response.status, contentType: response.headers.get("content-type"), length: (await response.text()).length })).catch((error) => ({ ok: false, message: error.message }))`);
  assert.equal(mainResponse.ok, true, `Studio main module was not served: ${JSON.stringify(mainResponse)}`);
  const appModule = await evaluate(cdp, `import("/app/main.mjs").then(() => ({ ok: true })).catch((error) => ({ ok: false, message: error.stack || error.message }))`);
  assert.equal(appModule.ok, true, `Studio app module failed to load: ${appModule.message}`);
  await seedProject(cdp);
  const seededRecovery = await evaluate(cdp, `(async () => {
    const working = await import("/src/persistence/working-session.mjs");
    const store = working.createWorkingSessionStore(indexedDB, { tabId: "browser-three-d-fixture-tab" });
    const recovered = await store.read({ userId: null, workspaceId: null });
    return recovered ? { name: recovered.name, task: recovered.task, projectId: recovered.project.id } : null;
  })()`);
  assert.deepEqual(seededRecovery, { name: "3D Coordination Fixture", task: "project", projectId: "project-browser-three-d" });
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, `document.readyState === "complete" && document.querySelector("#cloud-projects-button")`);
  // Cloud/session startup owns recovery and settles asynchronously after the
  // document load event. Give that path a chance to restore the fixture before
  // falling back to the named browser-local checkpoint.
  await delay(2000);
  assert.deepEqual(exceptions, [], `Browser runtime exceptions during startup: ${exceptions.join("; ")}`);
  if (!await evaluate(cdp, `document.querySelector("#current-project-name")?.textContent === "3D Coordination Fixture"`)) {
    const startupState = await evaluate(cdp, `(() => ({
      currentName: document.querySelector("#current-project-name")?.textContent ?? null,
      localKeys: Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)),
      localLibraryText: document.querySelector("#project-library-list")?.textContent ?? null,
      storageLabel: document.querySelector("#storage-state-label")?.textContent ?? null,
    }))()`);
    process.stderr.write(`Startup recovery diagnostic: ${JSON.stringify(startupState)}\n`);
    await evaluate(cdp, `(() => { const button = document.querySelector("#cloud-projects-button"); button.disabled = false; button.dispatchEvent(new MouseEvent("click", { bubbles: true })); })()`);
    await waitFor(cdp, `[...document.querySelectorAll(".project-library-entry strong")].some((element) => element.textContent === "3D Coordination Fixture")`);
    await evaluate(cdp, `(() => { const row = [...document.querySelectorAll(".project-library-entry")].find((candidate) => candidate.querySelector("strong")?.textContent === "3D Coordination Fixture"); row.querySelector("button").click(); })()`);
    await delay(80);
    if (await evaluate(cdp, `document.querySelector("#open-confirm-dialog")?.open`)) await evaluate(cdp, `document.querySelector("#open-confirm-dialog").close("discard")`);
  }
  await waitFor(cdp, `document.querySelector("#current-project-name")?.textContent === "3D Coordination Fixture"`);
  await click(cdp, "#three-d-nav");
  await waitFor(cdp, `!document.querySelector("#three-d-workspace")?.hidden`);

  await setValue(cdp, "#three-d-equipment-height", "2200");
  await setValue(cdp, "#three-d-outlet-height", "2400");
  await setValue(cdp, "#three-d-duct-height", "2600");
  await submit(cdp, "#three-d-height-form");
  await waitFor(cdp, `document.querySelector("#three-d-height-status")?.textContent.includes("3 components")`);
  assert.equal(await count(cdp, "#three-d-height-items .three-d-height-item"), 4);

  await setItemHeight(cdp, "component", "outlet-supply", 2475, "known");
  await setItemHeight(cdp, "route", "route-supply", 2850, "known");
  await waitFor(cdp, `document.querySelector('[data-height-id="route-supply"] input')?.value === "2850"`);
  const initialSvg = await html(cdp, "#three-d-host svg");
  assert.match(initialSvg, /data-three-d-contract="2"/);
  assert.equal((initialSvg.match(/data-route-run=/g) ?? []).length, 2);
  assert.match(initialSvg, /data-component-port=/);
  assert.match(initialSvg, /data-manufacturer-geometry="q350-de-hrv-left"/);
  assert.match(initialSvg, /data-manufacturer-article="471502009"/);
  assert.match(initialSvg, / Q /);
  assert.match(initialSvg, /not BIM/);

  await click(cdp, '[data-three-d-view="orbit-right"]');
  const orbitedSvg = await html(cdp, "#three-d-host svg");
  assert.notEqual(orbitedSvg, initialSvg);
  await click(cdp, '[data-three-d-view="zoom-in"]');
  await click(cdp, '[data-three-d-view="reset"]');

  await delay(300);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, `document.querySelector("#current-project-name")?.textContent === "3D Coordination Fixture"`);
  await click(cdp, "#three-d-nav");
  await waitFor(cdp, `document.querySelector('[data-height-id="route-supply"] input')?.value === "2850"`);
  assert.equal(await value(cdp, '[data-height-id="outlet-supply"] input'), "2475");
  assert.equal(await value(cdp, '[data-height-id="route-supply"] select'), "known");
  assert.equal((await html(cdp, "#three-d-host svg")).match(/data-route-run=/g)?.length, 2);
  assert.match(await html(cdp, "#three-d-host svg"), /data-manufacturer-geometry="q350-de-hrv-left"/);
  assert.deepEqual(exceptions, [], `Browser runtime exceptions: ${exceptions.join("; ")}`);
  assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join("; ")}`);
  cdp.close();
  process.stdout.write(`${JSON.stringify({ ok: true, heightRows: 4, manufacturerGeometry: "q350-de-hrv-left", outletHeightMm: 2475, routeHeightMm: 2850, twinRuns: 2, controls: "orbit/tilt/zoom/pan" }, null, 2)}\n`);
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

async function seedProject(cdp) {
  return evaluate(cdp, `(async () => {
    const domain = await import("/src/domain/spatial.mjs");
    const catalogue = await import("/src/editor/component-catalogue.mjs");
    const cwProfile = await import("/src/editor/standalone-cw.mjs");
    const compact = await import("/src/persistence/compact-storage.mjs");
    const libraryTools = await import("/src/persistence/local-project-library.mjs");
    const working = await import("/src/persistence/working-session.mjs");
    let project = domain.applyCommand(domain.createProject("project-browser-three-d"), {
      type: "floor.add", floor: { id: "floor-ground", name: "Ground Floor", transform: {
        translationMm: { x: 0, y: 0, z: domain.knownMm(0, "browser 3D datum") }, orientation: domain.identityQuaternion(),
      } },
    });
    const cw = catalogue.createCatalogueComponent(cwProfile.standaloneCwRecordId({ size: "320", orientation: "vertical", stream: "supply" }), { id: "cw-supply", floorId: "floor-ground", xMm: 1000, yMm: 1500, allowAssemblyOnly: true });
    const outlet = catalogue.createCatalogueComponent("luna-supply", { id: "outlet-supply", floorId: "floor-ground", xMm: 4500, yMm: 2600 });
    const q350 = catalogue.createCatalogueComponent("zehnder-q350-de-hrv-left-bim-profile", { id: "q350-bim", floorId: "floor-ground", xMm: 2600, yMm: 700 });
    project = domain.applyCommand(project, { type: "component.add", component: cw });
    project = domain.applyCommand(project, { type: "component.add", component: outlet });
    project = domain.applyCommand(project, { type: "component.add", component: q350 });
    const source = cw.ports.find((port) => port.interface.family === "semi-rigid-pe");
    const destination = outlet.ports[0];
    const family = catalogue.routeFamilyForKind("semi-rigid-radial");
    project = domain.applyCommand(project, { type: "route.add", route: {
      id: "route-supply", floorId: "floor-ground", system: "mvhr", stream: "supply", role: source.role,
      ductKind: family.id, connectionInterface: family.connectionInterface, parallelRunCount: 2,
      startAttachment: { componentId: cw.id, portId: source.id }, endAttachment: { componentId: outlet.id, portId: destination.id },
      points: [domain.floorPortTransform(project, cw.id, source.id).positionMm, { x: 3000, y: 1800, z: domain.unknownMm("browser route height") }, domain.floorPortTransform(project, outlet.id, destination.id).positionMm],
    } });
    const saved = libraryTools.createLocalProjectLibrary(compact.createCompactProjectStorage(localStorage)).saveProject(project, "3D Coordination Fixture");
    if (!saved.ok) throw new Error("3D fixture could not be saved to the device project library");
    const fixtureTabId = "browser-three-d-fixture-tab";
    sessionStorage.setItem("hiper-working-tab-v1", fixtureTabId);
    const store = working.createWorkingSessionStore(indexedDB, { tabId: fixtureTabId });
    await store.write({ userId: null, workspaceId: null }, {
      projectJson: domain.serializeProject(project), name: "3D Coordination Fixture", dirty: true, cloudRecord: null,
      task: "project", camera: { x: -500, y: -500, width: 6000, height: 4000 },
    });
    await store.flush();
    return true;
  })()`);
}

async function setItemHeight(cdp, kind, id, height, basis) {
  const result = await evaluate(cdp, `(() => {
    const row = document.querySelector(${JSON.stringify(`[data-height-kind="${kind}"][data-height-id="${id}"]`)});
    if (!row) return false;
    const input = row.querySelector("input"), select = row.querySelector("select");
    input.value = ${JSON.stringify(String(height))};
    select.value = ${JSON.stringify(basis)};
    [...row.querySelectorAll("button")].find((button) => button.textContent === "Apply")?.click();
    return true;
  })()`);
  assert.equal(result, true, `Missing height row ${kind}/${id}`);
  await delay(60);
}

async function readDevToolsPort(directory) {
  const file = join(directory, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { return (await readFile(file, "utf8")).trim().split("\n")[0]; } catch { await delay(50); }
  }
  throw new Error("Chrome DevTools endpoint did not become available");
}
async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const pending = new Map(), handlers = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) { const request = pending.get(message.id); pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); return; }
    for (const handler of handlers.get(message.method) ?? []) handler(message.params ?? {});
  });
  return {
    send(method, params = {}) { sequence += 1; return new Promise((resolve, reject) => { pending.set(sequence, { resolve, reject }); socket.send(JSON.stringify({ id: sequence, method, params })); }); },
    on(method, handler) { handlers.set(method, [...(handlers.get(method) ?? []), handler]); },
    close() { socket.close(); },
  };
}
async function evaluate(cdp, expression) { const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; }
async function waitFor(cdp, expression, timeoutMs = 6000) { const started = Date.now(); while (Date.now() - started < timeoutMs) { if (await evaluate(cdp, `Boolean(${expression})`)) return; await delay(50); } throw new Error(`Timed out waiting for: ${expression}`); }
async function click(cdp, selector) { const found = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`); assert.equal(found, true, `Missing clickable element: ${selector}`); await delay(50); }
async function submit(cdp, selector) { const found = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.requestSubmit(); return true; })()`); assert.equal(found, true, `Missing form: ${selector}`); await delay(50); }
async function setValue(cdp, selector, nextValue) { const found = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.value = ${JSON.stringify(nextValue)}; element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`); assert.equal(found, true, `Missing input: ${selector}`); }
async function value(cdp, selector) { return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.value ?? ""`); }
async function html(cdp, selector) { return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.outerHTML ?? ""`); }
async function count(cdp, selector) { return evaluate(cdp, `document.querySelectorAll(${JSON.stringify(selector)}).length`); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
