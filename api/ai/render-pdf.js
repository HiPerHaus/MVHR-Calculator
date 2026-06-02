// api/ai/render-pdf.js
// POST /api/ai/render-pdf  (internal — called by upload-pdf, not by the client)
//
// Downloads the original PDF from Storage, renders every page to PNG,
// generates JPEG thumbnails, uploads all assets back to Storage, and
// inserts one pdf_pages row per page.
//
// After all pages are uploaded, calls /api/ai/classify-pages to start
// the AI page-type classification pass.
//
// This endpoint is intentionally NOT accessible directly by the client
// (no auth header required — it validates via a shared internal secret).
// It is invoked as a fire-and-forget fetch from upload-pdf.js.
//
// Request body (JSON):
//   uploadId     uuid     — pdf_uploads.id
//   jobId        uuid     — pdf_uploads.job_id
//   storagePath  string   — "plan-uploads/temp/<uid>/<jobId>/original.pdf"
//   userId       string   — the owning user id
//
// The endpoint updates pdf_uploads.status as it progresses:
//   pending → rendering → classifying
//
// Required npm packages (add to package.json):
//   pdfjs-dist   ^4.x   — PDF parsing and rendering
//   canvas       ^2.x   — Node.js canvas for pdfjs rendering
//   sharp        ^0.33  — thumbnail generation

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Constants ─────────────────────────────────────────────────────────────
const CLASSIFICATION_DPI  = 150;   // DPI for AI classification pass
const THUMBNAIL_HEIGHT    = 200;   // px — thumbnail height
const PDF_POINTS_PER_INCH = 72;    // PDF coordinate space is 72 points/inch
const BUCKET              = 'plan-uploads';
// Hard limit — PDFs exceeding this are rejected (not silently truncated).
// Prevents runaway renders on very large files.
const MAX_PAGES           = 100;

// ── Lazy-load heavy deps (avoids cold-start penalty for other routes) ─────
async function getPdfJs() {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Disable worker in Node.js — use main thread rendering.
  GlobalWorkerOptions.workerSrc = '';
  return { getDocument };
}

async function getCanvas() {
  const { createCanvas } = await import('canvas');
  return createCanvas;
}

async function getSharp() {
  const sharp = (await import('sharp')).default;
  return sharp;
}

// ── PDF rendering ─────────────────────────────────────────────────────────
class NodeCanvasFactory {
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

async function renderPageToPng(page, dpi, createCanvasFn) {
  const scale    = dpi / PDF_POINTS_PER_INCH;
  const viewport = page.getViewport({ scale });

  const factory    = new NodeCanvasFactory(createCanvasFn);
  const { canvas, context } = factory.create(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height)
  );

  // White background (architectural plans are typically on white paper).
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: context,
    viewport,
    canvasFactory: factory,
  }).promise;

  const buffer = canvas.toBuffer('image/png');
  factory.destroy({ canvas, context });
  return {
    buffer,
    widthPx:  Math.ceil(viewport.width),
    heightPx: Math.ceil(viewport.height),
    widthMm:  Math.round((viewport.width  / scale) * 25.4 / 72 * 10) / 10,
    heightMm: Math.round((viewport.height / scale) * 25.4 / 72 * 10) / 10,
  };
}

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
    // Warn loudly — this env var must be set in production.
    console.warn('render-pdf: INTERNAL_API_SECRET is not set. Falling back to host check — set this env var in production.');
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

  const { uploadId, jobId, storagePath, userId } = req.body ?? {};

  if (!uploadId || !jobId || !storagePath || !userId) {
    return res.status(400).json({ error: 'uploadId, jobId, storagePath, userId required' });
  }

  // ── Mark as rendering ─────────────────────────────────────────────────────
  const renderStartedAt = new Date().toISOString();
  await supabase
    .from('pdf_uploads')
    .update({ status: 'rendering', render_started_at: renderStartedAt })
    .eq('id', uploadId);

  try {
    // ── Load dependencies ─────────────────────────────────────────────────
    const [{ getDocument }, createCanvasFn, sharpFn] = await Promise.all([
      getPdfJs(),
      getCanvas(),
      getSharp(),
    ]);

    // ── Download PDF from Storage ─────────────────────────────────────────
    const objectPath = storagePath.replace(`${BUCKET}/`, '');
    const { data: pdfBlob, error: dlErr } = await supabase.storage
      .from(BUCKET)
      .download(objectPath);

    if (dlErr || !pdfBlob) {
      throw new Error(`Failed to download PDF: ${dlErr?.message}`);
    }

    const pdfArrayBuffer = await pdfBlob.arrayBuffer();
    const pdfData        = new Uint8Array(pdfArrayBuffer);

    // ── Open PDF ──────────────────────────────────────────────────────────
    const pdfDoc    = await getDocument({ data: pdfData }).promise;
    const pageCount = pdfDoc.numPages;

    // Hard reject — do not silently truncate.
    // Users with very large plan sets should split the PDF before uploading.
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

    // Update page_count now so job-status can show progress.
    await supabase
      .from('pdf_uploads')
      .update({ page_count: pageCount, pages_accepted: pageCount })
      .eq('id', uploadId);

    // ── Render pages ──────────────────────────────────────────────────────
    // Base path within the bucket: "temp/<userId>/<jobId>"
    const basePath = `temp/${userId}/${jobId}`;

    const pageRecords    = [];
    const pageDurations  = [];   // ms per page — for avg render time logging
    const renderLoopStart = Date.now();

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const pageStart = Date.now();
      const page = await pdfDoc.getPage(pageNum);

      // Render at classification DPI
      const { buffer: pngBuffer, widthPx, heightPx, widthMm, heightMm } =
        await renderPageToPng(page, CLASSIFICATION_DPI, createCanvasFn);

      // Generate thumbnail
      const thumbBuffer = await makeThumbnail(pngBuffer, THUMBNAIL_HEIGHT, sharpFn);

      // Upload page PNG
      const paddedNum   = String(pageNum).padStart(2, '0');
      const imageName   = `page_${paddedNum}.png`;
      const thumbName   = `page_${paddedNum}_thumb.jpg`;
      const imagePath   = `${basePath}/${imageName}`;
      const thumbPath   = `${basePath}/${thumbName}`;

      const [imgUpload, thumbUpload] = await Promise.all([
        supabase.storage.from(BUCKET).upload(imagePath, pngBuffer, {
          contentType:  'image/png',
          cacheControl: '60',
          upsert:       true,
        }),
        supabase.storage.from(BUCKET).upload(thumbPath, thumbBuffer, {
          contentType:  'image/jpeg',
          cacheControl: '60',
          upsert:       true,
        }),
      ]);

      if (imgUpload.error) {
        console.warn(`render-pdf: failed to upload page ${pageNum}:`, imgUpload.error.message);
      }

      pageRecords.push({
        pdf_upload_id:  uploadId,
        page_number:    pageNum,
        image_path:     imgUpload.error  ? null : `${BUCKET}/${imagePath}`,
        thumb_path:     thumbUpload.error ? null : `${BUCKET}/${thumbPath}`,
        is_temporary:   true,
        page_type:      'unknown',
        page_width_mm:  widthMm  || null,
        page_height_mm: heightMm || null,
        render_width_px:  widthPx  || null,
        render_height_px: heightPx || null,
        render_dpi:       CLASSIFICATION_DPI,
      });

      page.cleanup();
      pageDurations.push(Date.now() - pageStart);
    }

    pdfDoc.destroy();

    // ── Insert pdf_pages rows (upsert on upload+pageNumber) ───────────────
    const { error: insertErr } = await supabase
      .from('pdf_pages')
      .upsert(pageRecords, { onConflict: 'pdf_upload_id,page_number' });

    if (insertErr) {
      throw new Error(`Failed to insert pdf_pages: ${insertErr.message}`);
    }

    // ── Log render performance ────────────────────────────────────────────
    const totalRenderMs = Date.now() - renderLoopStart;
    const avgMs         = pageDurations.length
      ? Math.round(pageDurations.reduce((a, b) => a + b, 0) / pageDurations.length)
      : 0;
    const failedPages   = pageRecords.filter(p => !p.image_path).length;
    console.log(JSON.stringify({
      event:         'render-pdf:complete',
      jobId,
      uploadId,
      pageCount,
      failedPages,
      totalRenderMs,
      avgMsPerPage:  avgMs,
      minMsPerPage:  pageDurations.length ? Math.min(...pageDurations) : null,
      maxMsPerPage:  pageDurations.length ? Math.max(...pageDurations) : null,
    }));

    // ── Update status → classifying, record render completion time ─────────
    const renderCompletedAt = new Date().toISOString();
    await supabase
      .from('pdf_uploads')
      .update({ status: 'classifying', render_completed_at: renderCompletedAt })
      .eq('id', uploadId);

    // Fire-and-forget: call classify-pages to run the AI classification pass.
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    fetch(`${baseUrl}/api/ai/classify-pages`, {
      method:  'POST',
      headers: {
        'Content-Type':       'application/json',
        'x-internal-secret':  process.env.INTERNAL_API_SECRET ?? '',
      },
      body: JSON.stringify({ uploadId, jobId, userId, pageCount: pagesAccepted }),
    }).catch(e => console.error('render-pdf: classify-pages call failed:', e.message));

    return res.status(200).json({
      uploadId,
      jobId,
      pageCount,
      failedPages,
      totalRenderMs,
      avgMsPerPage: avgMs,
      status: 'classifying',
      message: `Rendered ${pageCount} pages in ${(totalRenderMs / 1000).toFixed(1)}s (avg ${avgMs}ms/page). Classification started.`,
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
