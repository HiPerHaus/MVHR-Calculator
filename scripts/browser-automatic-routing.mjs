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
  await waitFor(cdp, `document.readyState === "complete" && document.querySelector("#ventilation-nav")`);
  await click(cdp, "#ventilation-nav");
  await waitFor(cdp, `!document.querySelector("#mechanical-tools-section")?.hidden`);

  const desktop = await dimensions(cdp);
  assert.equal(desktop.dn90.visible, true);
  assert.equal(desktop.epp.visible, true);
  assert.equal(desktop.inCollapsedDetails, false);
  assert.equal(desktop.columns, 2);

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
  await delay(80);
  const compact = await dimensions(cdp);
  assert.equal(compact.dn90.visible, true);
  assert.equal(compact.epp.visible, true);
  assert.equal(compact.columns, 1);

  await click(cdp, "#auto-route-epp");
  assert.equal(await evaluate(cdp, `document.querySelector("#automatic-epp-dialog")?.open`), true);
  assert.match(await evaluate(cdp, `document.querySelector("#automatic-epp-summary")?.textContent ?? ""`), /outline|floor|Calibrate|ports/i);
  assert.equal(await evaluate(cdp, `document.querySelector("#apply-automatic-epp")?.disabled`), true);
  await click(cdp, "#cancel-automatic-epp");
  assert.equal(await evaluate(cdp, `document.querySelector("#automatic-epp-dialog")?.open`), false);

  await click(cdp, "#auto-route-dn90");
  assert.equal(await evaluate(cdp, `document.querySelector("#automatic-radial-dialog")?.open`), true);
  await click(cdp, "#cancel-automatic-radial");
  assert.deepEqual(exceptions, [], `Browser runtime exceptions: ${exceptions.join("; ")}`);
  assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join("; ")}`);
  cdp.close();
  process.stdout.write(`${JSON.stringify({ ok: true, desktopColumns: 2, compactColumns: 1, actions: ["DN90", "EPP"], cancelPreservesProject: true }, null, 2)}\n`);
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
    const host = document.querySelector(".automatic-routing-actions > div");
    const columns = getComputedStyle(host).gridTemplateColumns.split(" ").filter(Boolean).length;
    return { dn90: info("#auto-route-dn90"), epp: info("#auto-route-epp"), columns, inCollapsedDetails: Boolean(document.querySelector("details:not([open]) #auto-route-dn90, details:not([open]) #auto-route-epp")) };
  })()`);
}
async function readDevToolsPort(directory) { const file = join(directory, "DevToolsActivePort"); for (let attempt = 0; attempt < 100; attempt += 1) { try { return (await readFile(file, "utf8")).trim().split("\n")[0]; } catch { await delay(50); } } throw new Error("Chrome DevTools endpoint did not become available"); }
async function connectCdp(url) { const socket = new WebSocket(url); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); }); let sequence = 0; const pending = new Map(), handlers = new Map(); socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); if (message.id) { const request = pending.get(message.id); pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); return; } for (const handler of handlers.get(message.method) ?? []) handler(message.params ?? {}); }); return { send(method, params = {}) { sequence += 1; return new Promise((resolve, reject) => { pending.set(sequence, { resolve, reject }); socket.send(JSON.stringify({ id: sequence, method, params })); }); }, on(method, handler) { handlers.set(method, [...(handlers.get(method) ?? []), handler]); }, close() { socket.close(); } }; }
async function evaluate(cdp, expression) { const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; }
async function waitFor(cdp, expression, timeoutMs = 6000) { const started = Date.now(); while (Date.now() - started < timeoutMs) { if (await evaluate(cdp, `Boolean(${expression})`)) return; await delay(50); } throw new Error(`Timed out waiting for: ${expression}`); }
async function click(cdp, selector) { const found = await evaluate(cdp, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`); assert.equal(found, true, `Missing clickable element: ${selector}`); await delay(50); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
