import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const syntaxRoots = ["app", "scripts", "src", "test"];
const moduleFiles = syntaxRoots
  .flatMap((directory) => collectModules(resolve(root, directory)))
  .sort();

for (const file of moduleFiles) run(process.execPath, ["--check", file]);
run(process.execPath, ["--test"]);
run("git", ["diff", "--check"]);
process.stdout.write(`Verified ${moduleFiles.length} modules, all Node tests, and git diff whitespace.\n`);

function collectModules(path) {
  if (statSync(path).isFile()) return path.endsWith(".mjs") ? [path] : [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    return entry.isDirectory() ? collectModules(child) : child.endsWith(".mjs") ? [child] : [];
  });
}

function run(command, arguments_) {
  execFileSync(command, arguments_, { cwd: root, stdio: "inherit" });
}
