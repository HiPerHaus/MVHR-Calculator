import { resolve, sep } from "node:path";

const ALLOWED_ROOTS = Object.freeze([
  "app",
  "login",
  "src/domain",
  "src/editor",
  "src/import",
  "src/persistence",
  "src/sheets",
  "node_modules/pdfjs-dist/legacy/build",
  "node_modules/pdfjs-dist/cmaps",
  "node_modules/pdfjs-dist/standard_fonts",
  "node_modules/pdfjs-dist/wasm",
]);

export function resolveStaticRequestPath(root, encodedPathname) {
  if (typeof root !== "string" || !root) throw new TypeError("Static root is required");
  if (typeof encodedPathname !== "string") throw new TypeError("Request pathname must be a string");
  let decoded;
  try {
    decoded = decodeURIComponent(encodedPathname);
  } catch {
    throw new StaticPathError(400, "Malformed request path encoding");
  }
  if (decoded.includes("\0") || decoded.includes("\\")) {
    throw new StaticPathError(400, "Invalid request path");
  }
  const segments = decoded.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new StaticPathError(403, "Path traversal is forbidden");
  }
  const relativePath = segments.join("/");
  const allowedRelativeRoot = ALLOWED_ROOTS.find(
    (candidate) => relativePath === candidate || relativePath.startsWith(`${candidate}/`),
  );
  if (!allowedRelativeRoot) throw new StaticPathError(403, "Static path is not exposed");
  const allowedRoot = resolve(root, allowedRelativeRoot);
  const filePath = resolve(root, relativePath);
  if (!isPathInside(filePath, allowedRoot)) {
    throw new StaticPathError(403, "Static path escaped its allowed root");
  }
  return { filePath, allowedRoot, relativePath };
}

export function isPathInside(candidate, allowedRoot) {
  return candidate === allowedRoot || candidate.startsWith(`${allowedRoot}${sep}`);
}

export class StaticPathError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "StaticPathError";
    this.statusCode = statusCode;
  }
}
