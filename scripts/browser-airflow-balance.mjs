import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP_URL = process.argv[2] ?? "http://127.0.0.1:4195/app/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "hiper-studio-airflow-balance-"));
const browser = spawn(CHROME, [
  "--headless=new",
  "--no-first-run",
  "--disable-gpu",
  "--disable-background-networking",
  "--disable-component-update",
  "--remote-debugging-port=0",
  `--user-data-dir=${profileDirectory}`,
  "--window-size=1440,1100",
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

  await seedAirflowProject(cdp);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, `document.readyState === "complete" && document.querySelector("#current-project-name")?.textContent === "Airflow Review House"`);
  await click(cdp, "#checks-nav");
  await waitFor(cdp, `!document.querySelector("#checks-workspace")?.hidden`);

  const initial = await airflowSnapshot(cdp);
  assert.match(initial.summary, /assigned supply 0 L\/s/);
  assert.match(initial.summary, /assigned extract 12 L\/s \(43\.2 m³\/h\)/);
  assert.match(initial.summary, /difference -12 L\/s/);
  assert.match(initial.summary, /Incomplete/);
  assert.match(initial.spaces, /Bedroom.*Required 54 m³\/h.*Project brief R1.*Assigned unresolved/s);
  assert.match(initial.spaces, /Bathroom.*Assigned 12 L\/s.*Designer manual entry/s);
  assert.match(initial.issues, /Assigned target unresolved/);
  assert.match(initial.issues, /Terminal has no assigned target/);
  assert.match(initial.issues, /Target has no terminal/);
  assert.match(initial.issues, /Terminal is not assigned to a room or zone/);
  assert.match(initial.issues, /Explicit action available — not applied/);
  assert.match(initial.boundary, /no regulatory rate.*balance tolerance.*compliance verdict/i);

  await click(cdp, "#plan-nav");
  await waitFor(cdp, `!document.querySelector("#plan-workspace")?.hidden && document.querySelector('[data-room-id="room-bedroom"]')`);
  await click(cdp, '[data-room-id="room-bedroom"]');
  await waitFor(cdp, `!document.querySelector("#room-inspector")?.hidden`);
  const inspector = await textContent(cdp, "#room-airflow-value");
  assert.match(inspector, /required 54 m³\/h.*Project brief R1.*assigned unresolved/i);

  await click(cdp, "#edit-room");
  await waitFor(cdp, `document.querySelector("#room-dialog")?.open`);
  assert.equal(await inputValue(cdp, "#room-required-airflow"), "54");
  assert.equal(await inputValue(cdp, "#room-required-airflow-unit"), "m3/h");
  assert.equal(await inputValue(cdp, "#room-assigned-airflow"), "");
  await click(cdp, "#adopt-required-airflow");
  assert.equal(await inputValue(cdp, "#room-assigned-airflow"), "54");
  assert.match(await textContent(cdp, "#room-dialog-error"), /project is unchanged until Apply/i);
  await click(cdp, "#cancel-room");
  await click(cdp, "#edit-room");
  assert.equal(await inputValue(cdp, "#room-assigned-airflow"), "", "Cancelling the copied suggestion must not mutate the project");
  await click(cdp, "#adopt-required-airflow");
  await submit(cdp, "#room-form");
  await waitFor(cdp, `!document.querySelector("#room-dialog")?.open`);

  await click(cdp, "#checks-nav");
  const applied = await airflowSnapshot(cdp);
  assert.match(applied.summary, /assigned supply 15 L\/s \(54 m³\/h\)/);
  assert.match(applied.summary, /difference \+3 L\/s/);
  assert.doesNotMatch(applied.issues, /Explicit action available — not applied/);
  assert.deepEqual(exceptions, [], `Browser runtime exceptions: ${exceptions.join("; ")}`);
  cdp.close();
  process.stdout.write(`${JSON.stringify({ ok: true, initial, applied }, null, 2)}\n`);
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

async function seedAirflowProject(cdp) {
  return evaluate(cdp, `(async () => {
    const domain = await import("/src/domain/spatial.mjs");
    const roomTools = await import("/src/domain/rooms.mjs");
    const catalogue = await import("/src/editor/synthetic-catalogue.mjs");
    const libraryTools = await import("/src/persistence/local-project-library.mjs");
    const point = (x, y) => ({ x, y, z: domain.unknownMm("browser airflow fixture") });
    const wallChain = (nodeIds, wallIds, points) => ({
      type: "wall.addChain",
      floorId: "floor-ground",
      nodeIds,
      wallIds,
      points,
      splits: [],
      thicknessMm: 140,
      heightMm: domain.unknownMm("browser airflow fixture"),
      referenceLine: "centreline",
      classification: "physical",
    });
    let project = domain.applyCommand(domain.createProject("project-browser-airflow-balance"), {
      type: "floor.add",
      floor: {
        id: "floor-ground",
        name: "Ground Floor",
        transform: {
          translationMm: { x: 0, y: 0, z: domain.knownMm(0, "browser airflow datum") },
          orientation: domain.identityQuaternion(),
        },
      },
    });
    project = domain.applyCommand(project, wallChain(
      ["node-a", "node-b", "node-c", "node-d", "node-a"],
      ["wall-a-b", "wall-b-c", "wall-c-d", "wall-d-a"],
      [point(0, 0), point(4000, 0), point(4000, 4000), point(0, 4000), point(0, 0)],
    ));
    project = domain.applyCommand(project, wallChain(
      ["node-b", "node-e", "node-f", "node-c"],
      ["wall-b-e", "wall-e-f", "wall-f-c"],
      [point(4000, 0), point(8000, 0), point(8000, 4000), point(4000, 4000)],
    ));
    const boundaries = roomTools.deriveRoomBoundaries(project, "floor-ground").candidates;
    const left = boundaries.find((candidate) => candidate.centroidMm.x < 4000);
    const right = boundaries.find((candidate) => candidate.centroidMm.x > 4000);
    project = domain.applyCommand(project, {
      type: "room.createFromBoundary",
      roomId: "room-bedroom",
      floorId: "floor-ground",
      boundaryKey: left.key,
      name: "Bedroom",
      use: "bedroom",
      ventilationRole: "supply",
      airflowTargets: {
        normal: {
          required: domain.airflowTargetFromInput(54, "m3/h", "Owner-selected design basis", "Project brief R1"),
          assigned: domain.unresolvedAirflowTarget("assigned normal airflow not provided"),
        },
      },
    });
    project = domain.applyCommand(project, {
      type: "room.createFromBoundary",
      roomId: "room-bathroom",
      floorId: "floor-ground",
      boundaryKey: right.key,
      name: "Bathroom",
      use: "bathroom",
      ventilationRole: "extract",
      airflowTargets: {
        normal: {
          required: domain.airflowTargetFromInput(14, "l/s", "Owner-selected design basis", "Project brief R1"),
          assigned: domain.airflowTargetFromInput(12, "l/s", "Designer manual entry", "Design note 7"),
        },
      },
    });
    project = domain.applyCommand(project, {
      type: "component.add",
      component: catalogue.createSyntheticComponent("synthetic-supply-terminal", {
        id: "supply-terminal",
        floorId: "floor-ground",
        xMm: 2000,
        yMm: 2000,
      }),
      autoAssignTerminalSpace: true,
    });
    project = domain.applyCommand(project, {
      type: "component.add",
      component: catalogue.createSyntheticComponent("synthetic-extract-terminal", {
        id: "loose-extract-terminal",
        floorId: "floor-ground",
        xMm: 9000,
        yMm: 2000,
      }),
      autoAssignTerminalSpace: true,
    });
    const saved = libraryTools.createLocalProjectLibrary(localStorage).saveProject(project, "Airflow Review House");
    if (!saved.ok) throw new Error("Airflow fixture could not be saved");
    return true;
  })()`);
}

async function airflowSnapshot(cdp) {
  return evaluate(cdp, `(() => ({
    summary: document.querySelector("#checks-airflow-summary")?.textContent ?? "",
    spaces: document.querySelector("#checks-airflow-spaces")?.textContent ?? "",
    issues: document.querySelector("#checks-airflow-issues")?.textContent ?? "",
    boundary: document.querySelector("#checks-airflow-boundary")?.textContent ?? "",
  }))()`);
}

async function readDevToolsPort(directory) {
  const file = join(directory, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
  const found = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    if (typeof element.click === "function") element.click();
    else element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);
  assert.equal(found, true, `Missing clickable element: ${selector}`);
  await delay(30);
}

async function submit(cdp, selector) {
  const found = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.requestSubmit(); return true; })()`);
  assert.equal(found, true, `Missing form: ${selector}`);
  await delay(30);
}

function inputValue(cdp, selector) {
  return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.value`);
}

function textContent(cdp, selector) {
  return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
