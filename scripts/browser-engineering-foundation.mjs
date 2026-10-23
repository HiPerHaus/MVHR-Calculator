import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP_URL = process.argv[2] ?? "http://127.0.0.1:4196/app/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "hiper-studio-engineering-foundation-"));
const browser = spawn(CHROME, [
  "--headless=new", "--no-first-run", "--disable-gpu", "--disable-background-networking",
  "--disable-component-update", "--remote-debugging-port=0", `--user-data-dir=${profileDirectory}`,
  "--window-size=1440,1100", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let browserStderr = "";
browser.stderr.setEncoding("utf8");
browser.stderr.on("data", (chunk) => { browserStderr += chunk; });

try {
  const port = await readDevToolsPort(profileDirectory);
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(APP_URL)}`, { method: "PUT" }).then((response) => response.json());
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  const exceptions = [];
  cdp.on("Runtime.exceptionThrown", (params) => exceptions.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "Runtime exception"));
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await waitFor(cdp, `document.readyState === "complete" && document.querySelector("#project-nav")?.classList.contains("active")`);
  await seedProject(cdp);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, `document.querySelector("#current-project-name")?.textContent === "Engineering Evidence House"`);
  await click(cdp, "#checks-nav");
  await waitFor(cdp, `!document.querySelector("#checks-workspace")?.hidden`);

  assert.match(await text(cdp, "#checks-engineering-input-status"), /No saved Normal-mode engineering duty/);
  assert.match(await text(cdp, "#checks-engineering-unit"), /ComfoAir Q350 TR.*471502110/s);
  await setValue(cdp, "#checks-engineering-unit", "q350-unit");
  await setValue(cdp, "#checks-engineering-pressure", "200");
  await setValue(cdp, "#checks-engineering-basis", "External design duty supplied by engineer");
  await setValue(cdp, "#checks-engineering-source", "Engineer note P-01");
  await setValue(cdp, "#checks-engineering-filter", "Clean filters");
  await submit(cdp, "#checks-engineering-form");
  await waitFor(cdp, `document.querySelector("#checks-engineering-summary")?.textContent.includes("source statement alignment only")`);

  const applied = await snapshot(cdp);
  assert.match(applied.engineeringInput, /200 Pa external static.*Clean filters.*Engineer note P-01/);
  assert.match(applied.engineeringSummary, /350 m³\/h manual assigned room-target total for screening/);
  assert.match(applied.engineeringSummary, /Network pressure result: not calculated/);
  assert.match(applied.engineeringIssues, /aligns with one source statement.*not measured performance.*whole-network suitability/i);
  assert.match(applied.engineeringIssues, /No connected route network exists/i);
  assert.match(applied.engineeringBoundary, /cannot interpolate a fan curve/i);
  assert.match(applied.costingSummary, /0 priced.*total unresolved/i);
  assert.match(applied.costingLines, /ComfoAir Q350 TR.*unpriced/s);
  assert.match(applied.costingBoundary, /Unknown prices remain null, not zero/i);
  assert.match(applied.installerSummary, /working draft only.*2 blank commissioning rows/i);
  assert.match(applied.installerSections, /predicted and measured remain blank/i);
  assert.match(applied.installerBoundary, /not an issued installer document/i);

  await click(cdp, "#project-save");
  await waitFor(cdp, `document.querySelector("#local-state")?.dataset.state === "saved"`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, `document.querySelector("#current-project-name")?.textContent === "Engineering Evidence House"`);
  await click(cdp, "#checks-nav");
  assert.equal(await value(cdp, "#checks-engineering-unit"), "q350-unit");
  assert.equal(await value(cdp, "#checks-engineering-pressure"), "200");
  assert.equal(await value(cdp, "#checks-engineering-filter"), "Clean filters");
  assert.deepEqual(exceptions, [], `Browser runtime exceptions: ${exceptions.join("; ")}`);
  cdp.close();
  process.stdout.write(`${JSON.stringify({ ok: true, applied, reopenedPressurePa: 200 }, null, 2)}\n`);
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
    const rooms = await import("/src/domain/rooms.mjs");
    const catalogue = await import("/src/editor/component-catalogue.mjs");
    const synthetic = await import("/src/editor/synthetic-catalogue.mjs");
    const library = await import("/src/persistence/local-project-library.mjs");
    const point = (x, y) => ({ x, y, z: domain.unknownMm("browser engineering fixture") });
    const chain = (nodeIds, wallIds, points) => ({
      type: "wall.addChain", floorId: "floor-ground", nodeIds, wallIds, points, splits: [],
      thicknessMm: 140, heightMm: domain.unknownMm("browser engineering fixture"),
      referenceLine: "centreline", classification: "physical",
    });
    let project = domain.applyCommand(domain.createProject("project-browser-engineering"), {
      type: "floor.add",
      floor: { id: "floor-ground", name: "Ground Floor", transform: {
        translationMm: { x: 0, y: 0, z: domain.knownMm(0, "browser engineering datum") },
        orientation: domain.identityQuaternion(),
      } },
    });
    project = domain.applyCommand(project, chain(
      ["node-a", "node-b", "node-c", "node-d", "node-a"],
      ["wall-a-b", "wall-b-c", "wall-c-d", "wall-d-a"],
      [point(0, 0), point(4000, 0), point(4000, 4000), point(0, 4000), point(0, 0)],
    ));
    project = domain.applyCommand(project, chain(
      ["node-b", "node-e", "node-f", "node-c"],
      ["wall-b-e", "wall-e-f", "wall-f-c"],
      [point(4000, 0), point(8000, 0), point(8000, 4000), point(4000, 4000)],
    ));
    const faces = rooms.deriveRoomBoundaries(project, "floor-ground").candidates;
    const target = domain.airflowTargetFromInput(350, "m3/h", "Explicit manufacturer screen fixture", "Browser schedule E-01");
    project = domain.applyCommand(project, {
      type: "room.createFromBoundary", roomId: "room-supply", floorId: "floor-ground",
      boundaryKey: faces.find((face) => face.centroidMm.x < 4000).key,
      name: "Bedroom", use: "bedroom", ventilationRole: "supply",
      airflowTargets: { normal: { required: target, assigned: target } },
    });
    project = domain.applyCommand(project, {
      type: "room.createFromBoundary", roomId: "room-extract", floorId: "floor-ground",
      boundaryKey: faces.find((face) => face.centroidMm.x > 4000).key,
      name: "Bathroom", use: "bathroom", ventilationRole: "extract",
      airflowTargets: { normal: { required: target, assigned: target } },
    });
    project = domain.applyCommand(project, { type: "component.add", component: catalogue.createCatalogueComponent(
      "zehnder-q350-hrv-left-drawing-profile",
      { id: "q350-unit", floorId: "floor-ground", xMm: 4000, yMm: 5200 },
    ) });
    for (const [id, catalogueId, xMm] of [
      ["supply-terminal", "synthetic-supply-terminal", 2000],
      ["extract-terminal", "synthetic-extract-terminal", 6000],
    ]) {
      project = domain.applyCommand(project, { type: "component.add", component: synthetic.createSyntheticComponent(
        catalogueId, { id, floorId: "floor-ground", xMm, yMm: 2000 },
      ), autoAssignTerminalSpace: true });
    }
    const saved = library.createLocalProjectLibrary(localStorage).saveProject(project, "Engineering Evidence House");
    if (!saved.ok) throw new Error("Engineering fixture could not be saved");
    return true;
  })()`);
}

async function snapshot(cdp) {
  return evaluate(cdp, `(() => ({
    engineeringInput: document.querySelector("#checks-engineering-input-status")?.textContent ?? "",
    engineeringSummary: document.querySelector("#checks-engineering-summary")?.textContent ?? "",
    engineeringIssues: document.querySelector("#checks-engineering-issues")?.textContent ?? "",
    engineeringBoundary: document.querySelector("#checks-engineering-boundary")?.textContent ?? "",
    costingSummary: document.querySelector("#checks-costing-summary")?.textContent ?? "",
    costingLines: document.querySelector("#checks-costing-lines")?.textContent ?? "",
    costingBoundary: document.querySelector("#checks-costing-boundary")?.textContent ?? "",
    installerSummary: document.querySelector("#checks-installer-summary")?.textContent ?? "",
    installerSections: document.querySelector("#checks-installer-sections")?.textContent ?? "",
    installerBoundary: document.querySelector("#checks-installer-boundary")?.textContent ?? "",
  }))()`);
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
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const handlers = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    for (const handler of handlers.get(message.method) ?? []) handler(message.params ?? {});
  });
  return {
    send(method, params = {}) {
      sequence += 1;
      return new Promise((resolve, reject) => {
        pending.set(sequence, { resolve, reject });
        socket.send(JSON.stringify({ id: sequence, method, params }));
      });
    },
    on(method, handler) { handlers.set(method, [...(handlers.get(method) ?? []), handler]); },
    close() { socket.close(); },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(cdp, expression, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(cdp, `Boolean(${expression})`)) return;
    await delay(40);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function click(cdp, selector) {
  const found = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`);
  assert.equal(found, true, `Missing clickable element: ${selector}`);
  await delay(30);
}

async function setValue(cdp, selector, nextValue) {
  const found = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.value = ${JSON.stringify(nextValue)}; element.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  assert.equal(found, true, `Missing input: ${selector}`);
}

async function submit(cdp, selector) {
  const found = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.requestSubmit(); return true; })()`);
  assert.equal(found, true, `Missing form: ${selector}`);
  await delay(30);
}

function text(cdp, selector) {
  return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`);
}

function value(cdp, selector) {
  return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.value`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
