import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  isPathInside,
  resolveStaticRequestPath,
  StaticPathError,
} from "../src/dev/static-path.mjs";

const ROOT = "/synthetic/hiper-studio-root";

test("development static paths are confined to explicit application roots", () => {
  assert.deepEqual(resolveStaticRequestPath(ROOT, "/app/main.mjs"), {
    filePath: resolve(ROOT, "app/main.mjs"),
    allowedRoot: resolve(ROOT, "app"),
    relativePath: "app/main.mjs",
  });
  assert.deepEqual(resolveStaticRequestPath(ROOT, "/login/index.html"), {
    filePath: resolve(ROOT, "login/index.html"),
    allowedRoot: resolve(ROOT, "login"),
    relativePath: "login/index.html",
  });
  assert.deepEqual(resolveStaticRequestPath(ROOT, "/src/editor/mechanical-controller.mjs"), {
    filePath: resolve(ROOT, "src/editor/mechanical-controller.mjs"),
    allowedRoot: resolve(ROOT, "src/editor"),
    relativePath: "src/editor/mechanical-controller.mjs",
  });
  assert.deepEqual(resolveStaticRequestPath(ROOT, "/src/sheets/a3-sheet.mjs"), {
    filePath: resolve(ROOT, "src/sheets/a3-sheet.mjs"),
    allowedRoot: resolve(ROOT, "src/sheets"),
    relativePath: "src/sheets/a3-sheet.mjs",
  });
  assert.deepEqual(resolveStaticRequestPath(ROOT, "/src/import/dxf-reference.mjs"), {
    filePath: resolve(ROOT, "src/import/dxf-reference.mjs"),
    allowedRoot: resolve(ROOT, "src/import"),
    relativePath: "src/import/dxf-reference.mjs",
  });
  assert.deepEqual(resolveStaticRequestPath(ROOT, "/node_modules/pdfjs-dist/build/pdf.mjs"), {
    filePath: resolve(ROOT, "node_modules/pdfjs-dist/build/pdf.mjs"),
    allowedRoot: resolve(ROOT, "node_modules/pdfjs-dist/build"),
    relativePath: "node_modules/pdfjs-dist/build/pdf.mjs",
  });

  for (const path of [
    "/AGENTS.md",
    "/.git/config",
    "/reference-documents/HiPer_Studio_Master_Specification.pdf",
    "/app-malicious/secret.txt",
    "/node_modules/pdfjs-dist/package.json",
    "/node_modules/other-package/index.js",
  ]) {
    assert.throws(
      () => resolveStaticRequestPath(ROOT, path),
      (error) => error instanceof StaticPathError && error.statusCode === 403,
    );
  }
});

test("encoded traversal, malformed escapes, nulls and backslashes are rejected", () => {
  for (const path of [
    "/app/%2e%2e/AGENTS.md",
    "/src/editor/%2E%2E/domain/spatial.mjs",
    "/app/%00main.mjs",
    "/app/%5c..%5cAGENTS.md",
  ]) {
    assert.throws(() => resolveStaticRequestPath(ROOT, path), StaticPathError);
  }
  assert.throws(
    () => resolveStaticRequestPath(ROOT, "/app/%E0%A4%A"),
    (error) => error instanceof StaticPathError && error.statusCode === 400,
  );
});

test("real-path containment rejects sibling prefixes and symlink escape targets", () => {
  const allowed = resolve(ROOT, "app");
  assert.equal(isPathInside(resolve(ROOT, "app/index.html"), allowed), true);
  assert.equal(isPathInside(resolve(ROOT, "app"), allowed), true);
  assert.equal(isPathInside(resolve(ROOT, "app-malicious/index.html"), allowed), false);
  assert.equal(isPathInside(resolve(ROOT, "AGENTS.md"), allowed), false);
});
