// api/ai/render-hires.js
// POST /api/ai/render-hires  (internal — called by auto-analyse, not by the client)
//
// Renders a single PDF page at high DPI (250) as PNG, uploads it to Storage,
// and updates pdf_pages.hires_image_path.
//
// This is Stage 2 of the two-stage rendering strategy:
//   Stage 1 (render-pdf.js):    All pages → 72 DPI JPEG  (classification)
//   Stage 2 (render-hires.js):  Selected floor plans → 250 DPI PNG (room analysis)
//
// High-res PNG is needed by Claude Vision for accurate room boundary detection.
// JPEG artefacts at low DPI can cause misidentified room types.
//
// Request body (JSON):
//   uploadId     uuid    — pdf_uploads.id
//   jobId        uuid    — pdf_uploads.job_id
//   pageId       uuid    — pdf_pages.id
//   storagePath  string  — "plan-uploads/temp/<userId>/<jobId>/original.pdf"
//   pageNumber   number  — 1-indexed page number in the PDF
//   userId       string  — owning user id
//
// Response 200:
//   { pageId, hiresPath, widthPx, heightPx, durationMs }
//
// Response 400: missing fields
// Response 403: missing / bad internal secret
// Response 500: render or upload error

import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';

const require  = createRequire(import.meta.url);
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Constants ─────────────────────────────────────────────────────────────
const HIRES_DPI           = 250;   // High enough for room boundary analysis
const PDF_POINTS_PER_INCH = 72;
const BUCKET              = 'plan-uploads';

// ── Lazy deps ─────────────────────────────────────────────────────────────
async function getCanvas() {
  const { createCanvas } = await import('@napi-rs/canvas');
  return createCanvas;
}

// ── Canvas factory (pdfjs-dist Node.js requirement) ───────────────────────
class PdfjsCanvasFactory {
  constructor(createCanvasFn) {
    this._createCanvas = createCanvasFn;
  }
  create(width, height) {
    const canvas  = this._createCanvas(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width  = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width  = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas  = null;
    canvasAndContext.context = null;
  }
}

// ── Internal auth ─────────────────────────────────────────────────────────
function validateInternalToken(req) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    console.warn('render-hires: INTERNAL_API_SECRET is not set — falling back to host check.');
    const host = req.headers.host ?? '';
    return host.includes('localhost') || host.includes('vercel.internal');
  }
  return req.headers['x-internal-secret'] === secret;
}

// ── Handler ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!validateInternalToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { uploadId, jobId, pageId, storagePath, pageNumber, userId } = req.body ?? {};

  if (!uploadId || !jobId || !pageId || !storagePath || !pageNumber || !userId) {
    return res.status(400).json({ error: 'uploadId, jobId, pageId, storagePath, pageNumber, userId required' });
  }

  const t0 = Date.now();

  try {
    // ── Load canvas ────────────────────────────────────────────────────────
    const createCanvasFn = await getCanvas();

    // ── Download PDF ───────────────────────────────────────────────────────
    const objectPath = storagePath.replace(`${BUCKET}/`, '');
    const { data: pdfBlob, error: dlErr } = await supabase.storage
      .from(BUCKET)
      .download(objectPath);

    if (dlErr || !pdfBlob) {
      throw new Error(`Failed to download PDF: ${dlErr?.message}`);
    }

    const pdfData = new Uint8Array(await pdfBlob.arrayBuffer());

    // ── Open PDF (CJS v3 legacy build — no worker) ─────────────────────────
    const pdfDoc  = await pdfjsLib.getDocument({
      data:            pdfData,
      disableWorker:   true,
      useWorkerFetch:  false,
      isEvalSupported: false,
    }).promise;
    const page    = await pdfDoc.getPage(pageNumber);

    const scale   = HIRES_DPI / PDF_POINTS_PER_INCH;
    const vp      = page.getViewport({ scale });

    const factory = new PdfjsCanvasFactory(createCanvasFn);
    const { canvas, context } = factory.create(
      Math.ceil(vp.width),
      Math.ceil(vp.height)
    );

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: context,
      viewport: vp,
      canvasFactory: factory,
    }).promise;

    const pngBuffer = await canvas.encode('png');
    factory.destroy({ canvas, context });
    page.cleanup();
    pdfDoc.destroy();

    const widthPx  = Math.ceil(vp.width);
    const heightPx = Math.ceil(vp.height);

    // ── Upload PNG ─────────────────────────────────────────────────────────
    const paddedNum  = String(pageNumber).padStart(2, '0');
    const hiresName  = `page_${paddedNum}_hires.png`;
    const hiresPath  = `temp/${userId}/${jobId}/${hiresName}`;

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(hiresPath, pngBuffer, {
        contentType:  'image/png',
        cacheControl: '60',
        upsert:       true,
      });

    if (uploadErr) {
      throw new Error(`Failed to upload hi-res PNG: ${uploadErr.message}`);
    }

    const hiresStoragePath = `${BUCKET}/${hiresPath}`;

    // ── Update pdf_pages ───────────────────────────────────────────────────
    const { error: updateErr } = await supabase
      .from('pdf_pages')
      .update({
        hires_image_path:    hiresStoragePath,
        hires_render_dpi:    HIRES_DPI,
        hires_width_px:      widthPx,
        hires_height_px:     heightPx,
      })
      .eq('id', pageId);

    if (updateErr) {
      throw new Error(`Failed to update pdf_pages: ${updateErr.message}`);
    }

    const durationMs = Date.now() - t0;

    console.log(JSON.stringify({
      event:       'render-hires:complete',
      jobId,
      pageId,
      pageNumber,
      widthPx,
      heightPx,
      dpi:         HIRES_DPI,
      durationMs,
    }));

    return res.status(200).json({
      pageId,
      hiresPath: hiresStoragePath,
      widthPx,
      heightPx,
      durationMs,
    });

  } catch (err) {
    console.error('render-hires: error', err);
    return res.status(500).json({ error: err.message });
  }
}
