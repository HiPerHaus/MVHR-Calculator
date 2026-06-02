// api/ai/render-pdf.js
// POST /api/ai/render-pdf  (internal — called by upload-pdf, not by the client)
//
// Downloads the original PDF from Storage, renders every page to a low-DPI JPEG
// (fast, small — used for AI classification only), generates JPEG thumbnails,
// uploads all assets back to Storage, and inserts one pdf_pages row per page.
//
// After all pages are uploaded, calls /api/ai/classify-pages to start
// the AI page-type classification pass.
//
// TWO-STAGE RENDERING STRATEGY
// ─────────────────────────────
// Stage 1 (this file): All pages → low-DPI (72) JPEG for classification.
//   Fast. Typical A3 page: ~838×1188 px, ~200 KB.
//
// Stage 2 (render-hires.js): Selected floor_plan pages only → high-DPI (250) PNG.
//   Called by auto-analyse.js before passing the image to analyse-plan.
//   Result stored in pdf_pages.hires_image_path.
//
// This approach cuts Stage 1 processing time by ~4–8× vs. the old 150-DPI PNG flow.
//
// Request body (JSON):
//   uploadId     uuid     — pdf_uploads.id
//   jobId        uuid     — pdf_uploads.job_id
//   storagePath  string   — "plan-uploads/temp/<uid>/<jobId>/original.pdf"
//   userId       string   — the owning user id
//   projectId    uuid     — optional
//
// The endpoint updates pdf_uploads.status as it progresses:
//   pending → rendering → classifying

import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Constants ─────────────────────────────────────────────────────────────
const CLASSIFICATION_DPI  = 72;    // Low DPI — just enough for page-type classification
const THUMBNAIL_HEIGHT    = 200;   // px — thumbnail height
const PDF_POINTS_PER_INCH = 72;    // PDF coordinate space is 72 points/inch
const BUCKET              = 'plan-uploads';
const RENDER_BATCH_SIZE   = 3;     // Pages to render concurrently
// Hard limit — PDFs exceeding this are rejected (not silently truncated).
const MAX_PAGES           = 100;

// ── Lazy-load heavy deps (avoids cold-start penalty for other routes) ─────
async function getPdfJs() {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Do NOT touch GlobalWorkerOptions.workerSrc — pdfjs v4 rejects both '' and false.
  // disableWorker: true on getDocument() is sufficient for Node/Vercel serverless.
  return { getDocument };
}

async function getCanvas() {
  const { createCanvas } = await import('@napi-rs/canvas');
  return createCanvas;
}

async function getSharp() {
  const sharp = (await import('sharp')).default;
  return sharp;
}

// ── PDF rendering ─────────────────────────────────────────────────────────
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

// Render one PDF page to a raw PNG buffer (later converted to JPEG by sharp).
async function renderPageToRawPng(page, dpi, createCanvasFn) {
  const scale    = dpi / PDF_POINTS_PER_INCH;
  const viewport = page.getViewport({ scale });

  const factory = new PdfjsCanvasFactory(createCanvasFn);
  const { canvas, context } = factory.create(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height)
  );

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: context,
    viewport,
    canvasFactory: factory,
  }).promise;

  const buffer = await canvas.encode('png');
  factory.destroy({ canvas, context });

  return {
    buffer,
    widthPx:  Math.ceil(viewport.width),
    heightPx: Math.ceil(viewport.height),
    widthMm:  Math.round((viewport.width  / scale) * 25.4 / 72 * 10) / 10,
    heightMm: Math.round((viewport.height / scale) * 25.4 / 72 * 10) / 10,
  };
}

// Convert raw PNG to a JPEG for classification storage.
async function toJpeg(pngBuffer, sharpFn, quality = 85) {
  return sharpFn(pngBuffer).jpeg({ quality }).toBuffer();
}

// Generate a small JPEG thumbnail.
async function makeThumbnail(pngBuffer, targetHeight, sharpFn) {
  return sharpFn(pngBuffer)
    .resize({ height: targetHeight, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}

// ── Internal auth ─────────────────────────────────────────────────────────
function validateInternalToken(req) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    console.warn('render-pdf: INTERNAL_API_SECRET is not set. Falling back to host check — set this env var in production.');
    const host = req.headers.host ?? '';
    return host.includes('localhost') || host.includes('vercel.internal');
  }
  return req.headers['x-internal-secret'] === secret;
}

// ── Process one page ──────────────────────────────────────────────────────
// Renders, converts to JPEG, generates thumbnail, uploads both, returns a
// record ready for upsert into pdf_pages.
// Returns { record, durationMs, encodeMs, uploadMs }.
async function processPage({ pdfDoc, pageNum, basePath, uploadId, createCanvasFn, sharpFn }) {
  const t0 = Date.now();

  const page = await pdfDoc.getPage(pageNum);

  // Render to raw PNG in memory
  const tRender = Date.now();
  const { buffer: pngBuffer, widthPx, heightPx, widthMm, heightMm } =
    await renderPageToRawPng(page, CLASSIFICATION_DPI, createCanvasFn);
  const renderMs = Date.now() - tRender;

  // Convert PNG → JPEG (classification image) and thumbnail — in parallel
  const tEncode = Date.now();
  const [jpegBuffer, thumbBuffer] = await Promise.all([
    toJpeg(pngBuffer, sharpFn, 85),
    makeThumbnail(pngBuffer, THUMBNAIL_HEIGHT, sharpFn),
  ]);
  const encodeMs = Date.now() - tEncode;

  // Upload classification JPEG + thumbnail JPEG in parallel
  const paddedNum = String(pageNum).padStart(2, '0');
  const imageName = `page_${paddedNum}.jpg`;
  const thumbName = `page_${paddedNum}_thumb.jpg`;
  const imagePath = `${basePath}/${imageName}`;
  const thumbPath = `${basePath}/${thumbName}`;

  const tUpload = Date.now();
  const [imgUpload, thumbUpload] = await Promise.all([
    supabase.storage.from(BUCKET).upload(imagePath, jpegBuffer, {
      contentType:  'image/jpeg',
      cacheControl: '60',
      upsert:       true,
    }),
    supabase.storage.from(BUCKET).upload(thumbPath, thumbBuffer, {
      contentType:  'image/jpeg',
      cacheControl: '60',
      upsert:       true,
    }),
  ]);
  const uploadMs = Date.now() - tUpload;

  if (imgUpload.error) {
    console.warn(`render-pdf: failed to upload page ${pageNum}:`, imgUpload.error.message);
  }

  page.cleanup();

  const record = {
    pdf_upload_id:    uploadId,
    page_number:      pageNum,
    image_path:       imgUpload.error   ? null : `${BUCKET}/${imagePath}`,
    thumb_path:       thumbUpload.error ? null : `${BUCKET}/${thumbPath}`,
    is_temporary:     true,
    page_type:        'unknown',
    page_width_mm:    widthMm  || null,
    page_height_mm:   heightMm || null,
    render_width_px:  widthPx  || null,
    render_height_px: heightPx || null,
    render_dpi:       CLASSIFICATION_DPI,
  };

  return { record, durationMs: Date.now() - t0, renderMs, encodeMs, uploadMs };
}

// ── Handler ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Log immediately — confirms the function was invoked at all.
  console.log('[render-pdf] invoked', {
    method:  req.method,
    body:    req.body,
    host:    req.headers.host,
  });

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!validateInternalToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { uploadId, jobId, storagePath, userId, projectId } = req.body ?? {};

  if (!uploadId || !jobId || !storagePath || !userId) {
    return res.status(400).json({ error: 'uploadId, jobId, storagePath, userId required' });
  }

  // ── Mark as rendering ──────────────────────────────────────────────────────
  const renderStartedAt = new Date().toISOString();
  await supabase
    .from('pdf_uploads')
    .update({ status: 'rendering', render_started_at: renderStartedAt })
    .eq('id', uploadId);

  try {
    // ── Load dependencies ────────────────────────────────────────────────────
    const [{ getDocument }, createCanvasFn, sharpFn] = await Promise.all([
      getPdfJs(),
      getCanvas(),
      getSharp(),
    ]);

    // ── Download PDF from Storage ──────────────────────────────────────────
    const objectPath = storagePath.replace(`${BUCKET}/`, '');
    const { data: pdfBlob, error: dlErr } = await supabase.storage
      .from(BUCKET)
      .download(objectPath);

    if (dlErr || !pdfBlob) {
      throw new Error(`Failed to download PDF: ${dlErr?.message}`);
    }

    const pdfArrayBuffer = await pdfBlob.arrayBuffer();
    const pdfData        = new Uint8Array(pdfArrayBuffer);

    // ── Open PDF ─────────────────────────────────────────────────────────────
    const pdfDoc    = await getDocument({
      data:            pdfData,
      disableWorker:   true,
      useWorkerFetch:  false,
      isEvalSupported: false,
    }).promise;
    const pageCount = pdfDoc.numPages;

    if (pageCount > MAX_PAGES) {
      pdfDoc.destroy();
      const msg = `PDF has ${pageCount} pages (maximum is ${MAX_PAGES}). Split the PDF and upload one section at a time.`;
      console.error(`render-pdf: rejected — ${msg}`);
      await supabase
        .from('pdf_uploads')
        .update({ status: 'error', error_detail: msg })
        .eq('id', uploadId);
      return res.status(422).json({ error: msg });
    }

    await supabase
      .from('pdf_uploads')
      .update({ page_count: pageCount, pages_accepted: pageCount })
      .eq('id', uploadId);

    // ── Render pages in parallel batches ──────────────────────────────────
    const basePath       = `temp/${userId}/${jobId}`;
    const pageRecords    = new Array(pageCount);
    const pageDurations  = [];
    const renderLoopStart = Date.now();

    // Build page number list and process in batches of RENDER_BATCH_SIZE
    const pageNums = Array.from({ length: pageCount }, (_, i) => i + 1);

    for (let i = 0; i < pageNums.length; i += RENDER_BATCH_SIZE) {
      const batch = pageNums.slice(i, i + RENDER_BATCH_SIZE);

      const results = await Promise.all(
        batch.map(pageNum =>
          processPage({ pdfDoc, pageNum, basePath, uploadId, createCanvasFn, sharpFn })
        )
      );

      for (const { record, durationMs, renderMs, encodeMs, uploadMs } of results) {
        pageRecords[record.page_number - 1] = record;
        pageDurations.push(durationMs);
        console.log(JSON.stringify({
          event:      'render-pdf:page',
          jobId,
          pageNumber: record.page_number,
          durationMs,
          renderMs,
          encodeMs,
          uploadMs,
        }));
      }
    }

    pdfDoc.destroy();

    // ── Insert pdf_pages rows ──────────────────────────────────────────────
    const { error: insertErr } = await supabase
      .from('pdf_pages')
      .upsert(pageRecords, { onConflict: 'pdf_upload_id,page_number' });

    if (insertErr) {
      throw new Error(`Failed to insert pdf_pages: ${insertErr.message}`);
    }

    // ── Log render performance ─────────────────────────────────────────────
    const totalRenderMs = Date.now() - renderLoopStart;
    const avgMs         = pageDurations.length
      ? Math.round(pageDurations.reduce((a, b) => a + b, 0) / pageDurations.length)
      : 0;
    const failedPages   = pageRecords.filter(p => !p.image_path).length;

    console.log(JSON.stringify({
      event:          'render-pdf:complete',
      jobId,
      uploadId,
      pageCount,
      failedPages,
      totalRenderMs,
      avgMsPerPage:   avgMs,
      minMsPerPage:   pageDurations.length ? Math.min(...pageDurations) : null,
      maxMsPerPage:   pageDurations.length ? Math.max(...pageDurations) : null,
      batchSize:      RENDER_BATCH_SIZE,
      classificationDpi: CLASSIFICATION_DPI,
    }));

    // ── Update status → classifying ───────────────────────────────────────
    const renderCompletedAt = new Date().toISOString();
    await supabase
      .from('pdf_uploads')
      .update({ status: 'classifying', render_completed_at: renderCompletedAt })
      .eq('id', uploadId);

    // ── Hand off to classify-pages via waitUntil ──────────────────────────
    const host    = req.headers.host ?? '';
    const proto   = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = `${proto}://${host}`;

    const classifyPayload = JSON.stringify({ uploadId, jobId, userId, pageCount, projectId: projectId ?? null });

    console.log(JSON.stringify({
      event:    'render-pdf:handoff',
      target:   'classify-pages',
      uploadId,
      jobId,
      pageCount,
    }));

    waitUntil(
      fetch(`${baseUrl}/api/ai/classify-pages`, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '',
        },
        body: classifyPayload,
      }).then(async (r) => {
        const body = await r.text().catch(() => '');
        console.log(JSON.stringify({
          event:  'render-pdf:handoff-response',
          target: 'classify-pages',
          status: r.status,
          body:   body.slice(0, 200),
        }));
        if (!r.ok) {
          await supabase
            .from('pdf_uploads')
            .update({ status: 'error', error_detail: `classify-pages handoff failed (HTTP ${r.status}): ${body.slice(0, 300)}` })
            .eq('id', uploadId);
        }
      }).catch(async (err) => {
        console.error(JSON.stringify({
          event:  'render-pdf:handoff-error',
          target: 'classify-pages',
          error:  err.message,
        }));
        await supabase
          .from('pdf_uploads')
          .update({ status: 'error', error_detail: `classify-pages handoff error: ${err.message}` })
          .eq('id', uploadId);
      })
    );

    return res.status(200).json({
      uploadId,
      jobId,
      pageCount,
      failedPages,
      totalRenderMs,
      avgMsPerPage: avgMs,
      status: 'classifying',
      message: `Rendered ${pageCount} pages in ${(totalRenderMs / 1000).toFixed(1)}s (avg ${avgMs}ms/page, ${RENDER_BATCH_SIZE} concurrent). Classification started.`,
    });

  } catch (err) {
    console.error('render-pdf: fatal error', err);

    await supabase
      .from('pdf_uploads')
      .update({ status: 'error', error_detail: err.message })
      .eq('id', uploadId);

    return res.status(500).json({ error: err.message });
  }
}
