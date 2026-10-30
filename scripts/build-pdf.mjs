import { build } from "esbuild";
import { fileURLToPath } from "node:url";

export async function buildPdf(outDir = new URL("../app/vendor/", import.meta.url)) {
  await build({
    stdin: {
      contents: "import { jsPDF } from 'jspdf'; import 'svg2pdf.js'; export { jsPDF };",
      resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    outfile: fileURLToPath(new URL("pdf.mjs", outDir)),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildPdf();
