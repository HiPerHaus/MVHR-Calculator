import { buildAuth } from "./build-auth.mjs";
import { buildPdf } from "./build-pdf.mjs";

await Promise.all([buildAuth(), buildPdf()]);
