import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const APP_URL = process.argv[2] ?? "http://127.0.0.1:4173/app/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "hiper-studio-project-lifecycle-"));
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
  const { port } = await readDevToolsPort(profileDirectory);
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(APP_URL)}`, { method: "PUT" }).then((response) => response.json());
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  const exceptions = [];
  cdp.on("Runtime.exceptionThrown", (params) => exceptions.push(params.exceptionDetails?.text ?? "Runtime exception"));
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await waitFor(cdp, `document.readyState === "complete" && document.querySelector("#project-nav")?.classList.contains("active")`);

  const observations = [];
  observations.push(await snapshot(cdp, "fresh startup"));
  assertProjectLanding(observations.at(-1));

  await click(cdp, "#new-project");
  await setValue(cdp, "#project-name-input", "Alpha House");
  await submit(cdp, "#project-name-form");
  await waitFor(cdp, `document.querySelector("#open-confirm-dialog")?.open`);
  await click(cdp, `#open-confirm-dialog button[value="discard"]`);
  await waitFor(cdp, `document.querySelector("#current-project-name")?.textContent === "Alpha House"`);
  observations.push(await snapshot(cdp, "new Alpha project"));
  assertProjectLanding(observations.at(-1));
  await click(cdp, "#project-save");
  await waitFor(cdp, `document.querySelector("#local-state")?.dataset.state === "saved"`);
  const alphaId = await value(cdp, `document.querySelector("#current-project-id").textContent.split(" · ")[0]`);

  await click(cdp, "#plan-nav");
  await waitFor(cdp, `!document.querySelector("#plan-workspace")?.hidden`);
  await createWall(cdp, 310, 280, 560, 280);
  await waitFor(cdp, `document.querySelector("#draft-status")?.textContent.includes("1 walls")`);
  await click(cdp, "#save-local");
  await waitFor(cdp, `document.querySelector("#local-state")?.dataset.state === "saved"`);
  assert.equal(await savedWallCount(cdp, alphaId), 1, "Alpha saved wall");

  await click(cdp, "#project-nav");
  await click(cdp, "#new-project");
  await setValue(cdp, "#project-name-input", "Beta House");
  await submit(cdp, "#project-name-form");
  await waitFor(cdp, `document.querySelector("#current-project-name")?.textContent === "Beta House"`);
  observations.push(await snapshot(cdp, "new Beta project"));
  assertProjectLanding(observations.at(-1));
  await click(cdp, "#project-save");
  await waitFor(cdp, `document.querySelector("#local-state")?.dataset.state === "saved"`);
  const betaId = await currentProjectId(cdp);
  assert.notEqual(betaId, alphaId, "New project must use a new stable identity");

  await openNamedProject(cdp, "Alpha House");
  assert.equal(await currentProjectId(cdp), alphaId);
  observations.push(await snapshot(cdp, "reopened Alpha project"));
  assertProjectLanding(observations.at(-1));
  await click(cdp, "#plan-nav");
  await waitFor(cdp, `document.querySelector("#draft-status")?.textContent.includes("1 walls")`);
  await click(cdp, "#project-nav");

  await click(cdp, "#rename-project");
  await setValue(cdp, "#project-name-input", "Alpha Renamed");
  await submit(cdp, "#project-name-form");
  await waitFor(cdp, `document.querySelector("#current-project-name")?.textContent === "Alpha Renamed" && document.querySelector("#local-state")?.dataset.state === "saved"`);
  assert.equal(await currentProjectId(cdp), alphaId, "Rename must preserve project identity");

  await click(cdp, "#project-save-as");
  await setValue(cdp, "#project-name-input", "Alpha Copy");
  await submit(cdp, "#project-name-form");
  await waitFor(cdp, `document.querySelector("#current-project-name")?.textContent === "Alpha Copy"`);
  const copyId = await currentProjectId(cdp);
  assert.notEqual(copyId, alphaId, "Save As must create an independent project identity");
  assert.equal(await savedWallCount(cdp, copyId), 1, "Save As must copy plan assets");
  observations.push(await snapshot(cdp, "Save As copy"));
  assertProjectLanding(observations.at(-1));

  await click(cdp, "#plan-nav");
  await createWall(cdp, 310, 380, 560, 380);
  await waitFor(cdp, `document.querySelector("#draft-status")?.textContent.includes("2 walls")`);
  await click(cdp, "#save-local");
  await waitFor(cdp, `document.querySelector("#local-state")?.dataset.state === "saved"`);
  assert.equal(await savedWallCount(cdp, copyId), 2, "Copy receives its own edit");
  assert.equal(await savedWallCount(cdp, alphaId), 1, "Original remains independent");

  await click(cdp, "#reopen-local");
  await openNamedProject(cdp, "Alpha Renamed");
  await setScopeNotes(cdp, "Cancel-only edit");
  await openNamedProject(cdp, "Beta House", { expectGuard: true });
  await click(cdp, `#open-confirm-dialog button[value="cancel"]`);
  await waitFor(cdp, `!document.querySelector("#open-confirm-dialog")?.open`);
  assert.equal(await currentProjectId(cdp), alphaId, "Cancel keeps the current project");
  assert.equal(await currentScopeNotes(cdp), "Cancel-only edit", "Cancel keeps the current draft");
  observations.push(await snapshot(cdp, "cancelled switch"));
  assertProjectLanding(observations.at(-1));

  await openNamedProject(cdp, "Beta House", { expectGuard: true });
  await click(cdp, `#open-confirm-dialog button[value="discard"]`);
  await waitFor(cdp, `document.querySelector("#current-project-name")?.textContent === "Beta House"`);
  assert.equal(await currentProjectId(cdp), betaId);
  observations.push(await snapshot(cdp, "discarded switch"));
  assertProjectLanding(observations.at(-1));
  assert.equal(await savedScopeNotes(cdp, alphaId), "", "Discard must not update the original checkpoint");

  await setScopeNotes(cdp, "Save-before-switch edit");
  await openNamedProject(cdp, "Alpha Copy", { expectGuard: true });
  await click(cdp, `#open-confirm-dialog button[value="save"]`);
  await waitFor(cdp, `document.querySelector("#current-project-name")?.textContent === "Alpha Copy"`);
  assert.equal(await savedScopeNotes(cdp, betaId), "Save-before-switch edit", "Save guard must update the named project");
  observations.push(await snapshot(cdp, "saved switch"));
  assertProjectLanding(observations.at(-1));

  await click(cdp, "#plan-nav");
  await waitFor(cdp, `!document.querySelector("#plan-workspace")?.hidden`);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, `document.readyState === "complete" && document.querySelector("#project-nav")?.classList.contains("active")`);
  const refresh = await snapshot(cdp, "refresh landing");
  observations.push(refresh);
  assertProjectLanding(refresh);
  assert.equal(await currentProjectId(cdp), copyId, "Refresh reopens the active named project");
  assert.equal(await savedWallCount(cdp, copyId), 2, "Refresh preserves plan assets");

  await seedLegacyDraftAndReload(cdp, copyId);
  await waitFor(cdp, `document.readyState === "complete" && document.querySelector("#current-project-name")?.textContent === "Recovered project"`);
  const legacy = await snapshot(cdp, "legacy recovery");
  observations.push(legacy);
  assertProjectLanding(legacy);
  assert.equal(await value(cdp, `document.querySelectorAll(".project-library-entry").length`), 1);
  assert.equal(await savedWallCount(cdp, "project-local-wall-shell"), 2, "Legacy migration preserves plan assets");
  assert.equal(await value(cdp, `localStorage.getItem("hiper-studio:local-prototype:project-local-wall-shell:current") !== null`), true, "Legacy recovery journal remains intact");

  assert.deepEqual(exceptions, [], `Browser runtime exceptions: ${exceptions.join("; ")}`);
  cdp.close();
  process.stdout.write(`${JSON.stringify({ ok: true, observations }, null, 2)}\n`);
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

async function readDevToolsPort(directory) {
  const file = join(directory, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const [port, websocketPath] = (await readFile(file, "utf8")).trim().split("\n");
      return { port, websocketPath };
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
    on(method, handler) {
      handlers.set(method, [...(handlers.get(method) ?? []), handler]);
    },
    close() { socket.close(); },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function value(cdp, expression) {
  return evaluate(cdp, expression);
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

async function setValue(cdp, selector, text) {
  const found = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.value = ${JSON.stringify(text)}; element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  assert.equal(found, true, `Missing input: ${selector}`);
}

async function submit(cdp, selector) {
  const found = await evaluate(cdp, `(() => { const form = document.querySelector(${JSON.stringify(selector)}); if (!form) return false; form.requestSubmit(); return true; })()`);
  assert.equal(found, true, `Missing form: ${selector}`);
  await delay(40);
}

async function snapshot(cdp, label) {
  return evaluate(cdp, `({
    label: ${JSON.stringify(label)},
    name: document.querySelector("#current-project-name")?.textContent,
    id: document.querySelector("#current-project-id")?.textContent?.split(" · ")[0],
    projectActive: document.querySelector("#project-nav")?.classList.contains("active"),
    projectHidden: document.querySelector("#project-workspace")?.hidden,
    planHidden: document.querySelector("#plan-workspace")?.hidden,
    state: document.querySelector("#local-state")?.dataset.state,
    projectCount: document.querySelectorAll(".project-library-entry").length
  })`);
}

function assertProjectLanding(snapshotValue) {
  assert.equal(snapshotValue.projectActive, true, `${snapshotValue.label}: Project task active`);
  assert.equal(snapshotValue.projectHidden, false, `${snapshotValue.label}: Project workspace visible`);
  assert.equal(snapshotValue.planHidden, true, `${snapshotValue.label}: Plan workspace hidden`);
}

async function currentProjectId(cdp) {
  return value(cdp, `document.querySelector("#current-project-id").textContent.split(" · ")[0]`);
}

async function createWall(cdp, x1, y1, x2, y2) {
  await click(cdp, "#wall-tool");
  await evaluate(cdp, `(() => {
    const canvas = document.querySelector("#plan-canvas");
    for (const point of [{ x: ${x1}, y: ${y1} }, { x: ${x2}, y: ${y2} }]) {
      canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: point.x, clientY: point.y, button: 0 }));
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
  })()`);
  await delay(80);
}

async function openNamedProject(cdp, name, options = {}) {
  const opened = await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll(".project-library-entry")].find((candidate) => candidate.querySelector("strong")?.textContent === ${JSON.stringify(name)});
    if (!row) return false;
    row.querySelector("button")?.click();
    return true;
  })()`);
  assert.equal(opened, true, `Missing named project: ${name}`);
  if (options.expectGuard) {
    await waitFor(cdp, `document.querySelector("#open-confirm-dialog")?.open`);
  } else {
    await waitFor(cdp, `document.querySelector("#current-project-name")?.textContent === ${JSON.stringify(name)}`);
  }
}

async function setScopeNotes(cdp, note) {
  await setValue(cdp, "#quote-exclusions", note);
  await evaluate(cdp, `(() => { const input = document.querySelector("#quote-scope-reviewed"); input.checked = true; input.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await submit(cdp, "#quote-input-form");
  await waitFor(cdp, `document.querySelector("#local-state")?.dataset.state === "unsaved"`);
}

async function currentScopeNotes(cdp) {
  return value(cdp, `document.querySelector("#quote-exclusions").value`);
}

async function savedWallCount(cdp, projectId) {
  return savedProjectValue(cdp, projectId, "project.walls.length");
}

async function savedScopeNotes(cdp, projectId) {
  return savedProjectValue(cdp, projectId, `project.quoteDraft.scopeExclusions.join("\\n")`);
}

async function savedProjectValue(cdp, projectId, expression) {
  return value(cdp, `(() => {
    const index = JSON.parse(localStorage.getItem("hiper-studio:device-project-library:v1:current"));
    const metadata = index.projects.find((entry) => entry.id === ${JSON.stringify(projectId)});
    const prefix = "hiper-studio:named-project:v1:" + encodeURIComponent(metadata.id);
    const candidates = ["current", "previous"].map((suffix) => localStorage.getItem(prefix + ":" + suffix)).filter(Boolean).map(JSON.parse);
    const record = candidates.find((candidate) => candidate.localSaveNumber === metadata.localSaveNumber);
    const project = JSON.parse(record.projectJson);
    return ${expression};
  })()`);
}

async function seedLegacyDraftAndReload(cdp, sourceProjectId) {
  await evaluate(cdp, `(() => {
    const index = JSON.parse(localStorage.getItem("hiper-studio:device-project-library:v1:current"));
    const metadata = index.projects.find((entry) => entry.id === ${JSON.stringify(sourceProjectId)});
    const sourcePrefix = "hiper-studio:named-project:v1:" + encodeURIComponent(metadata.id);
    const records = ["current", "previous"].map((suffix) => localStorage.getItem(sourcePrefix + ":" + suffix)).filter(Boolean).map(JSON.parse);
    const source = records.find((record) => record.localSaveNumber === metadata.localSaveNumber);
    const project = JSON.parse(source.projectJson);
    project.id = "project-local-wall-shell";
    const legacy = {
      adapterVersion: 1,
      format: "hiper-studio-local-working-draft",
      localSaveNumber: 1,
      projectId: project.id,
      projectJson: JSON.stringify(project),
      savedAtUtc: "2026-10-20T12:00:00.000Z",
      storageScope: "device-local-prototype"
    };
    localStorage.clear();
    localStorage.setItem("hiper-studio:local-prototype:project-local-wall-shell:current", JSON.stringify(legacy));
    location.reload();
  })()`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
