import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isPathInside,
  resolveStaticRequestPath,
  StaticPathError,
} from "../src/dev/static-path.mjs";
import * as authGate from "../api/auth-gate.mjs";
import { authorizeStudioRequest, loginRedirect } from "../server/studio-auth.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const host = "127.0.0.1";
const requestedPort = Number.parseInt(process.argv[2] ?? "4173", 10);
const port = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 4173;

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

const server = createServer(async (request, response) => {
  if (!request.method || !["GET", "HEAD", "POST", "DELETE"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  if (url.pathname === "/api/auth-gate") {
    const handler = authGate[request.method];
    if (!handler) {
      response.writeHead(405, { Allow: "GET, POST, DELETE" }); response.end("Method not allowed"); return;
    }
    try { return sendWebResponse(response, await handler(await webRequest(request, url))); }
    catch { response.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end('{"authenticated":false,"reason":"identity-unavailable"}'); return; }
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }); response.end("Method not allowed"); return;
  }
  if (["/app", "/app/", "/app/index.html"].includes(url.pathname)) {
    const authRequest = await webRequest(request, url);
    const access = await authorizeStudioRequest(authRequest);
    if (!access.ok) {
      response.writeHead(303, { Location: loginRedirect(authRequest, access.reason).toString(), "Cache-Control": "no-store" });
      response.end(); return;
    }
  }
  if (url.pathname === "/") {
    response.writeHead(302, { Location: "/app/" });
    response.end();
    return;
  }
  try {
    const resolved = resolveStaticRequestPath(root, url.pathname);
    let filePath = resolved.filePath;
    const details = await stat(filePath);
    if (details.isDirectory()) filePath = resolve(filePath, "index.html");
    const [realFilePath, realAllowedRoot] = await Promise.all([
      realpath(filePath),
      realpath(resolved.allowedRoot),
    ]);
    if (!isPathInside(realFilePath, realAllowedRoot)) {
      throw new StaticPathError(403, "Static symlink escaped its allowed root");
    }
    const fileDetails = await stat(realFilePath);
    response.writeHead(200, {
      "Content-Type": contentTypes.get(extname(realFilePath)) ?? "application/octet-stream",
      "Content-Length": fileDetails.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") {
      response.end();
    } else {
      createReadStream(realFilePath).pipe(response);
    }
  } catch (error) {
    const statusCode = error instanceof StaticPathError ? error.statusCode : 404;
    response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(statusCode === 404 ? "Not found" : error.message);
  }
});

async function webRequest(request, url) {
  let body;
  if (request.method === "POST" || request.method === "DELETE") {
    const chunks = []; let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 16 * 1024) throw new Error("Request body too large");
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks);
  }
  return new Request(url, { method: request.method, headers: request.headers, body });
}

async function sendWebResponse(response, result) {
  const headers = Object.fromEntries(result.headers.entries());
  const cookies = result.headers.getSetCookie?.() ?? [];
  if (cookies.length) headers["set-cookie"] = cookies;
  response.writeHead(result.status, headers);
  response.end(Buffer.from(await result.arrayBuffer()));
}

server.listen(port, host, () => {
  console.log(`HiPer Studio local shell: http://${host}:${port}/app/`);
});
