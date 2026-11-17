// Isolated, loopback-only synthetic drawing workspace regression runner.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Prerequisite for source-app imports: npm run predev.
await readFile(join(root, 'app/vendor/pdf.mjs')).catch(() => { throw Error('Missing app/vendor/pdf.mjs. Run npm run predev before this browser check.'); });
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = Number(process.env.DRAWING_QA_PORT ?? 4319);
assert(Number.isInteger(port) && port > 0 && port < 65536, 'Invalid DRAWING_QA_PORT');
const origin = `http://127.0.0.1:${port}`;
const screenshots = join(root, 'tmp');
const profile = await mkdtemp(join(tmpdir(), 'studio-drawing-workspaces-'));
let server, browser, cdp;
let serverOutput = '', browserOutput = '';
const exceptions = [], networkFailures = [];
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
try {
  server = spawn(process.execPath, [join(root, 'scripts/drawing-tabs-review-server.mjs'), String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => { serverOutput += chunk; });
  server.stderr.on('data', chunk => { serverOutput += chunk; });
  let serverError;
  server.on('error', error => { serverError = error; });
  await until(async () => {
    if (serverError) throw serverError;
    if (server.exitCode !== null) throw Error(`QA server exited: ${serverOutput}`);
    return serverOutput.includes(`Synthetic QA: ${origin}/`);
  }, 'isolated QA server startup');
  browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserError;
  browser.on('error', error => { browserError = error; });
  browser.stderr.on('data', chunk => { browserOutput += chunk; });
  let debugPort;
  await until(async () => {
    if (browserError) throw browserError;
    if (browser.exitCode !== null) throw Error(`Chrome exited: ${browserOutput}`);
    try { [debugPort] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'); return Boolean(debugPort); } catch { return false; }
  }, 'Chrome DevTools startup');
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' });
  assert(response.ok, 'Could not open disposable browser target');
  cdp = await connectCdp((await response.json()).webSocketDebuggerUrl);
  cdp.on('Runtime.exceptionThrown', params => exceptions.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text));
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  cdp.on('Network.loadingFailed', params => networkFailures.push(params));
  cdp.on('Network.responseReceived', params => { if (params.response.status >= 400) networkFailures.push({url:params.response.url,status:params.response.status}); });
  // The QA server also supplies CSP and stubbed auth/cloud modules.
  cdp.on('Fetch.requestPaused', params => {
    const allowed = params.request.url.startsWith(`${origin}/`)
      || /^(data:|blob:|about:)/.test(params.request.url);
    cdp.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
      requestId: params.requestId, ...(allowed ? {} : { errorReason: 'BlockedByClient' }),
    }).catch(error => exceptions.push(error.message));
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await mkdir(screenshots, { recursive: true });
  const results = [];
  for (const [name, width, height] of [['desktop', 1440, 900], ['tablet', 1024, 768]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const beforeNavigation = await evaluate('performance.timeOrigin');
    await cdp.send('Page.navigate', { url: `${origin}/app/` });
    await waitReady(beforeNavigation);
    await clickQa('Run tab checks');
    const checks = await waitResult(/^PASS /);
    await clickQa('Prepare reload');
    await waitResult(/^Reload prepared\./);
    const beforeReload = await evaluate('performance.timeOrigin');
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitReady(beforeReload);
    await clickQa('Check restored');
    const reload = await waitResult(/^PASS reload /);
    assert.deepEqual(exceptions, [], `Runtime exceptions: ${exceptions.join('; ')}`);
    const screenshot = join(screenshots, `drawing-workspaces-${name}.png`);
    const captured = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(screenshot, Buffer.from(captured.data, 'base64'));
    await clickQa('Load mixed');
    await waitResult(/^Loaded synthetic mixed/);
    const planScreenshots = [];
    for (const workspace of ['decentralised', 'centralised', 'combined']) {
      await evaluate(`document.querySelector('[data-ventilation-tab="${workspace}"]').click(); document.querySelector('#tabs-qa-results').parentElement.open = false; document.querySelector('#fit-view')?.click();`);
      await delay(150);
      const planPath = join(screenshots, `drawing-workspaces-${name}-${workspace}.png`);
      const planShot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await writeFile(planPath, Buffer.from(planShot.data, 'base64'));
      planScreenshots.push(planPath);
    }
    results.push({ name, width, height, checks, reload, screenshot, planScreenshots });
    console.log(`PASS ${name} ${width} × ${height}: tab checks and reload`);
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} catch (error) {
  console.error(error.stack ?? error);
  console.error(JSON.stringify({exceptions, networkFailures}, null, 2));
  if (cdp) { try { console.error(await evaluate(`JSON.stringify({url:location.href, ready:document.readyState, text:document.body?.innerText?.slice(-3000)})`)); } catch {} }
  if (serverOutput) console.error(`QA server: ${serverOutput.slice(-2000)}`);
  if (browserOutput) console.error(`Chrome: ${browserOutput.slice(-2000)}`);
  process.exitCode = 1;
} finally {
  cdp?.close();
  await stop(browser);
  await stop(server);
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

async function until(predicate, label, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return;
    await delay(50);
  }
  throw Error(`Timed out: ${label}`);
}
async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function waitReady(previousTimeOrigin) {
  await until(async () => {
    try { return await evaluate(`performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin)} && document.readyState === 'complete' && Boolean(document.querySelector('#tabs-qa-results'))`); }
    catch (error) { if (/context|navigat/i.test(error.message)) return false; throw error; }
  }, 'review UI ready');
}
async function clickQa(label) {
  assert.equal(await evaluate(`(() => {
    const panel = document.querySelector('#tabs-qa-results')?.parentElement;
    const button = [...(panel?.querySelectorAll('button') ?? [])].find(item => item.textContent === ${JSON.stringify(label)});
    if (!button) return false;
    document.querySelector('#tabs-qa-results').textContent = 'Running…';
    button.click(); return true;
  })()`), true, `Missing QA button ${label}`);
}
async function waitResult(pattern) {
  let output = '';
  await until(async () => {
    output = await evaluate(`document.querySelector('#tabs-qa-results')?.textContent ?? ''`);
    assert(!output.startsWith('FAIL'), output);
    return pattern.test(output);
  }, `QA result matching ${pattern}`, 60000);
  return output;
}
async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(2000)]);
  }
}
async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let next = 0;
  const pending = new Map(), handlers = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(Error(message.error.message));
      else request.resolve(message.result);
    } else for (const handler of handlers.get(message.method) ?? []) handler(message.params ?? {});
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Error('CDP connection closed')); }
    pending.clear();
  });
  return {
    send(method, params = {}) {
      const id = ++next;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 30000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, handler) { handlers.set(method, [...(handlers.get(method) ?? []), handler]); },
    close() { socket.close(); },
  };
}
