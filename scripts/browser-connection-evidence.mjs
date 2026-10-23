import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP_URL = process.argv[2] ?? "http://127.0.0.1:4194/app/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "hiper-studio-connection-evidence-"));
const browser = spawn(CHROME, [
  "--headless=new",
  "--no-first-run",
  "--disable-gpu",
  "--disable-background-networking",
  "--disable-component-update",
  "--remote-debugging-port=0",
  `--user-data-dir=${profileDirectory}`,
  "--window-size=1440,1000",
  "about:blank",
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

  await seedEvidenceProject(cdp);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, `document.readyState === "complete" && document.querySelector("#current-project-name")?.textContent === "Evidence Review House"`);
  await click(cdp, "#checks-nav");
  await waitFor(cdp, `!document.querySelector("#checks-workspace")?.hidden`);

  const result = await evaluate(cdp, `(() => ({
    summary: document.querySelector("#checks-connection-evidence-summary")?.textContent,
    evidence: document.querySelector("#checks-connection-evidence")?.textContent,
    boundary: document.querySelector("#checks-connection-evidence-boundary")?.textContent,
    catalogueVersion: document.querySelector("#checks-schedule-summary")?.textContent,
  }))()`);
  assert.match(result.summary, /3 persisted connections inspected/);
  assert.match(result.summary, /1 drawing-only/);
  assert.match(result.summary, /2 synthetic fixture/);
  assert.match(result.evidence, /q350-to-remote/);
  assert.match(result.evidence, /drawing topology only/);
  assert.match(result.evidence, /zehnder-comfoair-q350-tr-technical-specification/);
  assert.match(result.evidence, /Q350 TR - sensible.*725 × 570 × 745 mm/);
  assert.match(result.evidence, /No accessory item or quantity has been inferred/);
  assert.match(result.boundary, /No adapter, sleeve, seal, support, clearance/);
  await click(cdp, "#catalogue-nav");
  await waitFor(cdp, `!document.querySelector("#catalogue-workspace")?.hidden`);
  await evaluate(cdp, `(() => {
    const input = document.querySelector("#catalogue-library-search");
    input.value = "current UK evidence";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitFor(cdp, `document.querySelectorAll("#catalogue-library-records .catalogue-library-card").length === 8`);
  const distributionCatalogue = await evaluate(cdp, `(() => ({
    count: document.querySelectorAll("#catalogue-library-records .catalogue-library-card").length,
    text: document.querySelector("#catalogue-library-records")?.textContent,
    buttons: document.querySelectorAll("#catalogue-library-records button").length,
  }))()`);
  assert.equal(distributionCatalogue.count, 8);
  assert.equal(distributionCatalogue.buttons, 0);
  assert.match(distributionCatalogue.text, /CW-D 320/);
  assert.match(distributionCatalogue.text, /CW-M 420 - 8 x 90/);
  assert.match(distributionCatalogue.text, /clamping strips; RapidLock applies to the semi-rigid branch sockets/);
  assert.match(distributionCatalogue.text, /installed plan footprint unresolved/);
  assert.deepEqual(exceptions, [], `Browser runtime exceptions: ${exceptions.join("; ")}`);
  cdp.close();
  process.stdout.write(`${JSON.stringify({ ok: true, ...result, distributionCatalogue }, null, 2)}\n`);
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

async function seedEvidenceProject(cdp) {
  return evaluate(cdp, `(async () => {
    const domain = await import("/src/domain/spatial.mjs");
    const catalogue = await import("/src/editor/component-catalogue.mjs");
    const assemblies = await import("/src/editor/equipment-assemblies.mjs");
    const libraryTools = await import("/src/persistence/local-project-library.mjs");
    let project = domain.applyCommand(domain.createProject("project-browser-connection-evidence"), {
      type: "floor.add",
      floor: {
        id: "floor-ground",
        name: "Ground Floor",
        transform: {
          translationMm: { x: 0, y: 0, z: domain.knownMm(0, "browser evidence datum") },
          orientation: domain.identityQuaternion(),
        },
      },
    });
    const unit = catalogue.createCatalogueComponent("zehnder-q350-hrv-left-drawing-profile", {
      id: "q350-left",
      floorId: "floor-ground",
      xMm: 1000,
      yMm: 1000,
    });
    const assemblyValue = assemblies.createEquipmentAssembly("generic-remote-supply-attenuation-set", {
      id: "supply-assembly",
      floorId: "floor-ground",
      xMm: 4000,
      yMm: 1000,
    });
    project = domain.applyCommand(project, { type: "component.add", component: unit });
    project = domain.applyCommand(project, { type: "equipmentAssembly.add", ...assemblyValue });
    const endPlate = project.components.find((component) => component.id === "supply-assembly-end-plate");
    const unitPort = unit.ports.find((port) => port.role === "Dwelling supply");
    const endPlatePort = endPlate.ports.find((port) => port.interface?.family === "rigid-epp");
    const start = domain.floorPortTransform(project, unit.id, unitPort.id).positionMm;
    const end = domain.floorPortTransform(project, endPlate.id, endPlatePort.id).positionMm;
    const family = catalogue.routeFamilyForKind("epp-rigid-dn160");
    project = domain.applyCommand(project, {
      type: "route.add",
      route: {
        id: "q350-to-remote",
        floorId: "floor-ground",
        system: "mvhr",
        stream: "supply",
        role: "Dwelling supply",
        ductKind: family.id,
        parallelRunCount: 1,
        connectionInterface: family.connectionInterface,
        startAttachment: { componentId: unit.id, portId: unitPort.id },
        endAttachment: { componentId: endPlate.id, portId: endPlatePort.id },
        points: [
          { x: start.x, y: start.y, z: domain.unknownMm("browser evidence route") },
          { x: end.x, y: end.y, z: domain.unknownMm("browser evidence route") },
        ],
      },
    });
    const saved = libraryTools.createLocalProjectLibrary(localStorage).saveProject(project, "Evidence Review House");
    if (!saved.ok) throw new Error("Evidence fixture could not be saved");
    return true;
  })()`);
}

async function readDevToolsPort(directory) {
  const file = join(directory, "DevToolsActivePort");
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const [port] = (await readFile(file, "utf8")).trim().split("\n");
      return port;
    } catch {
      await delay(50);
    }
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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
