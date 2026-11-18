import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isPathInside, resolveStaticRequestPath } from "../src/dev/static-path.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const qaIdentity = { userId: "qa-airflow-user", workspaceId: "qa-airflow-workspace" };
const qaServer = process.argv[2] ? null : await startQaServer();
const APP_URL = process.argv[2] ?? `http://127.0.0.1:${qaServer.address().port}/app/`;
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
  await click(cdp,"#airflows-nav");
  assert.equal(await evaluate(cdp,'document.querySelector(".airflow-proposal").dataset.proposalStatus'),'incomplete');
  await evaluate(cdp,'(()=>{const form=document.querySelector("[data-proposal-form]");form.querySelector("[data-proposal-field=basis]").value="extract";const preset=form.querySelector("[data-proposal-space=room-bathroom] select");preset.value="40";preset.dispatchEvent(new Event("change",{bubbles:true}));if(form.querySelector("[data-proposal-space=room-bathroom] input").value!=="40")throw new Error("Reference picker did not populate custom input");form.requestSubmit();})()');
  await waitFor(cdp,'document.querySelector(".airflow-proposal").dataset.proposalStatus === "provisional"');
  const proposed=await evaluate(cdp,'document.querySelector(".airflow-proposal").textContent');
  assert.match(proposed,/Low 28 · Normal 40 · Boost 52 m³\/h/);
  assert.match(proposed,/Existing assigned target: 43.2 m³\/h \(unchanged\)/);
  await evaluate(cdp,'(()=>{const input=document.querySelector("[data-proposal-field=personRateM3h]");input.value="31";input.dispatchEvent(new Event("input",{bubbles:true}));})()');
  assert.equal(await evaluate(cdp,'document.querySelector("[data-proposal-review]").disabled'),true);
  await evaluate(cdp,'document.querySelector("[data-proposal-form]").requestSubmit()');
  await click(cdp,"[data-proposal-review]");
  const fillReview=await evaluate(cdp,'document.querySelector(".proposal-review").textContent');
  assert.match(fillReview,/1 proposed change/);assert.match(fillReview,/Bedroom/);assert.match(fillReview,/Bathroom/);
  await click(cdp,"[data-proposal-apply]");
  let live=await evaluate(cdp,'document.querySelector(".design-airflow-section").textContent');
  assert.match(live,/Assigned design target: 40 m³\/h/);assert.match(live,/Assigned design target: 43.2 m³\/h/);
  await evaluate(cdp,'(()=>{const select=document.querySelector("[data-proposal-field=applyMode]");select.value="replace-existing";select.dispatchEvent(new Event("change"));})()');
  await click(cdp,"[data-proposal-review]");
  assert.match(await evaluate(cdp,'document.querySelector(".proposal-review").textContent'),/2 proposed change/);
  await evaluate(cdp,'window.__confirmMessages=[];window.confirm=message=>{window.__confirmMessages.push(message);return false;}');
  await click(cdp,"[data-proposal-apply]");
  assert.match(await evaluate(cdp,'document.querySelector(".design-airflow-section").textContent'),/Assigned design target: 43.2 m³\/h/);
  assert.match(await evaluate(cdp,'window.__confirmMessages[0]'),/Bathroom.*43.2.*40/s);
  await cdp.send("Emulation.setDeviceMetricsOverride",{width:768,height:1100,deviceScaleFactor:1,mobile:false});
  await evaluate(cdp,'document.querySelector(".proposal-apply").scrollIntoView({block:"start"})');
  await writeFile("/tmp/hiper-airflow-proposal-review-768.png",Buffer.from((await cdp.send("Page.captureScreenshot",{format:"png",fromSurface:true})).data,"base64"));
  await evaluate(cdp,'window.confirm=message=>{window.__confirmMessages.push(message);return true;}');
  await click(cdp,"[data-proposal-apply]");
  live=await evaluate(cdp,'document.querySelector(".design-airflow-section").textContent');
  assert.doesNotMatch(live,/Assigned design target: 43.2 m³\/h/);
  assert.equal((live.match(/Assigned design target: 40 m³\/h/g)||[]).length,2);
  await click(cdp,"#commissioning-nav");
  assert.equal(await evaluate(cdp,'document.querySelector("#commissioning-workspace .field-airflow-row:last-child input[type=number]").value'),'32.4');
  await click(cdp,"#airflows-nav");
  for(const width of [1440,1024,768,390]){
   await cdp.send("Emulation.setDeviceMetricsOverride",{width,height:1100,deviceScaleFactor:1,mobile:false});
   const shot=await cdp.send("Page.captureScreenshot",{format:"png",fromSurface:true});
   await writeFile("/tmp/hiper-airflow-proposal-"+width+".png",Buffer.from(shot.data,"base64"));
   assert.equal(await evaluate(cdp,'document.querySelector(".airflow-proposal").scrollWidth <= document.querySelector(".airflow-proposal").clientWidth'),true);
   assert.equal(await evaluate(cdp,'[...document.querySelectorAll(".airflow-proposal input,.airflow-proposal select,.airflow-proposal button")].every(n=>n.getBoundingClientRect().height>=44)'),true);
  }
  await evaluate(cdp,'(()=>{const form=document.querySelector("[data-proposal-form]");form.querySelector("[data-proposal-space=room-bathroom] input").value="";form.requestSubmit();})()');
  await waitFor(cdp,'document.querySelector(".airflow-proposal").dataset.proposalStatus === "incomplete"');
  assert.match(await evaluate(cdp,'document.querySelector(".airflow-proposal").textContent'),/reviewed extract reference/);
  assert.equal(await evaluate(cdp,'document.querySelector("[data-proposal-review]").disabled'),true);
  await evaluate(cdp,'(()=>{const form=document.querySelector("[data-proposal-form]");const preset=form.querySelector("[data-proposal-space=room-bathroom] select");preset.value="40";preset.dispatchEvent(new Event("change",{bubbles:true}));if(form.querySelector("[data-proposal-space=room-bathroom] input").value!=="40")throw new Error("Reference picker did not populate custom input");form.requestSubmit();})()');
  await waitFor(cdp,'document.querySelector(".airflow-proposal").dataset.proposalStatus === "provisional"');
  assert.equal(await evaluate(cdp,'document.querySelector("[data-proposal-field=profile]").value'),'legacy-studio-v1');
  await evaluate(cdp,'(()=>{const form=document.querySelector("[data-proposal-form]"),profile=form.querySelector("[data-proposal-field=profile]");profile.value="phpp-9.6a-standard-v1";profile.dispatchEvent(new Event("change",{bubbles:true}));form.querySelector("[data-proposal-space=room-bathroom] input").value="160";form.requestSubmit();})()');
  await waitFor(cdp,'document.querySelector(".proposal-duty").textContent.includes("Maximum 164.96")');
  const phppText=await evaluate(cdp,'document.querySelector(".airflow-proposal").textContent');
  assert.match(phppText,/Basic 88.82 · Normal 126.89 · Maximum 164.96/);
  assert.match(phppText,/Occupancy maximum candidate: 120/);assert.match(phppText,/Extract maximum candidate: 160/);
  assert.match(phppText,/Normal volume reference .*126.89/);
  assert.equal(await evaluate(cdp,'["basis","volumeSource","personRateM3h","ach","lowFactor","boostFactor"].every(key=>document.querySelector(`[data-proposal-field=${key}]`).disabled)'),true);
  await click(cdp,"[data-proposal-review]");
  assert.match(await evaluate(cdp,'document.querySelector(".proposal-review").textContent'),/existing design value/);
  await cdp.send("Emulation.setDeviceMetricsOverride",{width:768,height:1100,deviceScaleFactor:1,mobile:false});
  assert.equal(await evaluate(cdp,'document.querySelector(".airflow-proposal").scrollWidth<=document.querySelector(".airflow-proposal").clientWidth'),true);
  await evaluate(cdp,'document.querySelector(".airflow-proposal").scrollIntoView({block:"start"})');
  await writeFile("/tmp/hiper-airflow-phpp-profile-768.png",Buffer.from((await cdp.send("Page.captureScreenshot",{format:"png",fromSurface:true})).data,"base64"));
  await evaluate(cdp,'document.querySelector(".proposal-actions button[type=button]").click()');
  await waitFor(cdp,'!document.querySelector("#sheet-preview-panel").hidden');
  assert.equal(await evaluate(cdp,'document.querySelector("#airflows-workspace").hidden'),true);
  assert.deepEqual(exceptions,[]);cdp.close();process.stdout.write(JSON.stringify({ok:true,proposed})+"\n");
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  if (browserStderr) process.stderr.write(`Chrome diagnostics:\n${browserStderr.slice(-4000)}\n`);
  process.exitCode = 1;
} finally {
  const exited = new Promise((resolve) => browser.once("exit", resolve));
  browser.kill("SIGTERM");
  await Promise.race([exited, delay(2000)]);
  await rm(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (qaServer) await new Promise((resolveClose) => qaServer.close(resolveClose));
}

async function seedAirflowProject(cdp, withAllocation=false) {
  return evaluate(cdp, `(async () => {
    const domain = await import("/src/domain/spatial.mjs");
    const roomTools = await import("/src/domain/rooms.mjs");
    const catalogue = await import("/src/editor/synthetic-catalogue.mjs");
    const componentCatalogue = await import("/src/editor/component-catalogue.mjs");
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
    let project = domain.applyCommand(domain.createProject(${JSON.stringify(withAllocation ? "project-browser-proposal-ambiguous" : "project-browser-airflow-balance")}), {
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
      use: "other",
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
      type: "route.add",
      route: {
        id: "qa-free-dn90",
        floorId: "floor-ground",
        system: "mvhr",
        stream: "supply",
        role: "Dwelling supply",
        ductKind: "semi-rigid-radial",
        connectionInterface: componentCatalogue.routeFamilyForKind("semi-rigid-radial").connectionInterface,
        startAttachment: null,
        endAttachment: null,
        points: [point(1000, 500), point(3000, 500)],
      },
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
    if(${JSON.stringify(withAllocation)}){
      const a=project.rooms.find(r=>r.id==="room-bedroom").terminalAssociations[0];
      const terminalAllocations=[{id:"allocation-1",componentId:a.componentId,portId:a.portId,spaceKind:"room",spaceId:"room-bedroom",inputValue:54,inputUnit:"m3/h",valueLps:15,basis:"Explicit design",source:"Test",terminalPressureLoss:{state:"unresolved",valuePa:null,inputValue:null,inputUnit:null,basis:null,source:null,reason:"Unknown"}}];
      project=domain.applyCommand(project,{type:"engineering.setNetworkDesign",design:{floorId:"floor-ground",mode:"normal",basis:"Explicit design",source:"Test",sourceVersion:"1",occupancy:{state:"unresolved",persons:null,basis:null,source:null,reason:"Not set"},fluid:{densityKgM3:1.2,dynamicViscosityPaS:0.000018,basis:"Test",source:"Test"},terminalAllocations,routeResistanceInputs:[],componentResistanceInputs:[],fanCurves:[],operatingPointModels:[]}});
    }
    project=domain.applyCommand(project,{type:"commissioning.recordMeasurement",spaceId:"room-bedroom",measuredLps:9,recordedAt:"2026-11-18T00:00:00Z"});
    project=domain.applyCommand(project,{type:"ventilation.setReference",reference:{tfaM2:169.186,occupants:4,source:"Synthetic PHPP 9.6a workbook reference"}});
    const saved = libraryTools.createLocalProjectLibrary(localStorage).saveProject(project, ${JSON.stringify(withAllocation ? "Ambiguous Airflow House" : "Airflow Review House")});
    if (!saved.ok) throw new Error("Airflow fixture could not be saved");
    return true;
  })()`);
}

async function airflowSnapshot(cdp) {
  return evaluate(cdp, `(() => ({
    summary: document.querySelector("#checks-airflow-summary")?.textContent ?? "",
    spaces: document.querySelector("#checks-airflow-table")?.textContent ?? "",
    issues: document.querySelector("#checks-airflow-issues")?.textContent ?? "",
    boundary: document.querySelector("#checks-airflow-boundary")?.textContent ?? "",
  }))()`);
}

async function stageMutationSnapshot(cdp) {
  return evaluate(cdp, `(() => ({ state: document.querySelector("#local-state-label")?.textContent, undoDisabled: document.querySelector("#undo")?.disabled, lifecycle: document.querySelector("#workflow-stage-pill")?.textContent }))()`);
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

function attribute(cdp, selector, name) {
  return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.getAttribute(${JSON.stringify(name)}) ?? null`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
