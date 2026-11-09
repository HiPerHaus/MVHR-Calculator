// Loopback-only synthetic browser QA. No live auth, cloud store or customer data.
// The review UI is appended only by this server and is never copied to dist.
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPathInside, resolveStaticRequestPath } from '../src/dev/static-path.mjs';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] ?? 4309);
const mocks = {
  '/app/auth-client.mjs': 'export function getStudioClient(){return null;}',
  '/app/auth-context.mjs': 'export function getBootAccess(){return null;}',
  '/app/cloud-ui.mjs': 'export function initializeCloudUI(options){const state={loading:false,workspace:null,user:null};queueMicrotask(()=>options.onChange(state));return state;}',
};
const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'");
    if (url.pathname === '/review') {
      const width = url.searchParams.get('size') === 'ipad' ? 1024 : 1440;
      const height = width === 1024 ? 768 : 900;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(`<!doctype html><title>Studio tab QA · ${width} × ${height}</title><body style="margin:0;background:#dce4e7"><p style="margin:5px;font:12px sans-serif">Synthetic QA · ${width} × ${height} CSS pixels · <a href="/review?size=desktop">Desktop</a> · <a href="/review?size=ipad">iPad landscape</a></p><iframe title="Synthetic Studio" src="/app/" style="display:block;border:0;width:${width}px;height:${height}px;transform:scale(${width===1440 ? .8 : 1});transform-origin:top left"></iframe></body>`);
    }
    let path = url.pathname === '/app/' ? '/app/index.html' : url.pathname;
    let content = mocks[path];
    if (content === undefined) {
      const safe = resolveStaticRequestPath(root, path);
      const [file, allowed] = await Promise.all([realpath(safe.filePath), realpath(safe.allowedRoot)]);
      if (!isPathInside(file, allowed) || !(await stat(file)).isFile()) throw Error('Not found');
      content = await readFile(file);
    }
    if (path === '/app/index.html') content = String(content).replace('src="./bootstrap.mjs"', 'src="./main.mjs"').replace('<div class="app-shell" hidden', '<div class="app-shell"');
    if (path === '/app/main.mjs') content = String(content) + '\n' + await readFile(resolve(root, 'scripts/drawing-tabs-review-ui.mjs'), 'utf8');
    res.setHeader('Content-Type', ({'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[extname(path)] ?? 'application/octet-stream');
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Synthetic QA: http://127.0.0.1:${port}/review?size=desktop`));
