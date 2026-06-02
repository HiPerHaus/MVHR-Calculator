// api/ai/render-pdf.js
// POST /api/ai/render-pdf  (internal — called by upload-pdf)
//
// Downloads the original PDF from Supabase Storage, renders every page to a
// low-DPI JPEG (classification pass), generates JPEG thumbnails, uploads all
// assets back to Storage, and inserts one pdf_pages row per page.
//
// Rendering uses MuPDF via the `mupdf` npm package (WebAssembly build).
// MuPDF has no system-library dependencies and no DOM requirements — it runs
// cleanly in Vercel's Node.js serverless environment.
//
// TWO-STAGE RENDERING STRATEGY
// ─────────────────────────────
// Stage 1 (this file): All pages → 72 DPI JPEG  (fast, small, for classification)
// Stage 2 (render-hires.js): Selected floor plans only → 250 DPI PNG (analysis)
//
// Request body (JSON):
//   uploadId     uuid    — pdf_uploads.id
//   jobId        uuid    — pdf_uploads.job_id
//   storagePath  string  — "plan-uploads/temp/<uid>/<jobId>/original.pdf"
//   userId       string  — owning user id
//   projectId    uuid    — optional

import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';

// mupdf is ESM-only — use dynamic import, not require.
async function getMupdf() {
  return import('mupdf');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Constants ──────────────────────────────────────────────────────────────
const CLASSIFICATION_DPI  = 72;
const THUMBNAIL_HEIGHT    = 200;   // px
const BUCKET              = 'plan-uploads';
const RENDER_BATCH_SIZE   = 3;     // pages processed concurrently
const MAX_PAGES           = 100;

async function getSharp() {
  return (await import('sharp')).default;
}

// ── Internal auth ──────────────────────────────────────────────────────────
function validateInternalToken(req) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    const host = req.headers.host ?? '';
    return host.includes('localhost') || host.includes('vercel.internal');
  }
  return req.headers['x-internal-secret'] === secret;
}

// ── Render one page via MuPDF ─────────────────────────────────────────────
// Returns { jpegBuffer, thumbBuffer, widthPx, heightPx, widthMm, heightMm }
async function renderPage(doc, pageIndex, dpi, sharpFn, mupdf) {
  const page   = doc.loadPage(pageIndex); // 0-indexed
  const bounds = page.getBounds();        // [x0, y0, x1, y1] in PDF points (72pt/in)

  const x0 = bounds[0], y0 = bounds[1], x1 = bounds[2], y1 = bounds[3];
  const scale  = dpi / 72;

  // toPixmap(matrix, colorspace, alpha)
  // matrix = [a, b, c, d, e, f] affine — for uniform scale: [s,0,0,s,0,0]
  const pixmap = page.toPixmap(
    [scale, 0, 0, scale, 0, 0],
    mupdf.ColorSpace.DeviceRGB,
    false   // no alpha
  );

  const pngData = pixmap.asPNG();   // Uint8Array of a PNG-encoded image
  pixmap.destroy();
  page.destroy();

  const pngBuffer = Buffer.from(pngData);
  const widthPx   = Math.round((x1 - x0) * scale);
  const heightPx  = Math.round((y1 - y0) * scale);
  const widthMm   = Math.round((x1 - x0) / 72 * 25.4 * 10) / 10;
  const heightMm  = Math.round((y1 - y0) / 72 * 25.4 * 10) / 10;

  const [jpegBuffer, thumbBuffer] = await Promise.all([
    sharpFn(pngBuffer).jpeg({ quality: 85 }).toBuffer(),
    sharpFn(pngBuffer)
      .resize({ height: THUMBNAIL_HEIGHT, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer(),
  ]);

  return { jpegBuffer, thumbBuffer, widthPx, heightPx, widthMm, heightMm };
}

// ── Process one page: render + upload + build record ─────────────────────
async function processPage({ doc, pageIndex, pageNum, basePath, uploadId, sharpFn, mupdf }) {
  const t0 = Date.now();

  const { jpegBuffer, thumbBuffer, widthPx, heightPx, widthMm, heightMm } =
    await renderPage(doc, pageIndex, CLASSIFICATION_DPI, sharpFn, mupdf);

  const paddedNum = String(pageNum).padStart(2, '0');
  const imagePath = `${basePath}/page_${paddedNum}.jpg`;
  const thumbPath = `${basePath}/page_${paddedNum}_thumb.jpg`;

  const tUpload = Date.now();
  const [imgUpload, thumbUpload] = await Promise.all([
    supabase.storage.from(BUCKET).upload(imagePath, jpegBuffer, {
      contentType: 'image/jpeg', cacheControl: '60', upsert: true,
    }),
    supabase.storage.from(BUCKET).upload(thumbPath, thumbBuffer, {
      contentType: 'image/jpeg', cacheControl: '60', upsert: true,
    }),
  ]);
  const uploadMs = Date.now() - tUpload;

  if (imgUpload.error) {
    console.warn(`render-pdf: upload failed for page ${pageNum}:`, imgUpload.error.message);
  }

  const durationMs = Date.now() - t0;
  console.log(JSON.stringify({
    event: 'render-pdf:page', jobId: null, pageNum, durationMs, uploadMs,
    widthPx, heightPx,
  }));

  return {
    record: {
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
    },
    durationMs,
  };
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  console.log('[render-pdf] invoked', { method: req.method, body: req.body, host: req.headers.host });

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!validateInternalToken(req)) return res.status(403).json({ error: 'Forbidden' });

  const { uploadId, jobId, storagePath, userId, projectId } = req.body ?? {};
  if (!uploadId || !jobId || !storagePath || !userId) {
    return res.status(400).json({ error: 'uploadId, jobId, storagePath, userId required' });
  }

  const renderStartedAt = new Date().toISOString();
  await supabase
    .from('pdf_uploads')
    .update({ status: 'rendering', render_started_at: renderStartedAt })
    .eq('id', uploadId);

  try {
    const [mupdf, sharpFn] = await Promise.all([getMupdf(), getSharp()]);

    // ── Download PDF ─────────────────────────────────────────────────────────
    // Normalise: strip leading "plan-uploads/" prefix from legacy rows where
    // storage_path was stored as "plan-uploads/temp/..." instead of "temp/...".
    const rawStoragePath       = storagePath;
    const normalisedStoragePath = storagePath.startsWith(`${BUCKET}/`)
      ? storagePath.slice(BUCKET.length + 1)
      : storagePath;

    console.log(JSON.stringify({
      event:               'render-pdf:download',
      storageBucket:       BUCKET,
      rawStoragePath,
      normalisedStoragePath,
      jobId,
    }));

    const { data: pdfBlob, error: dlErr } = await supabase.storage
      .from(BUCKET).download(normalisedStoragePath);

    if (dlErr || !pdfBlob) {
      console.error(JSON.stringify({
        event:               'render-pdf:download-error',
        storageBucket:       BUCKET,
        normalisedStoragePath,
        error:               dlErr?.message ?? 'no blob returned',
        jobId,
      }));
      throw new Error(`Failed to download PDF: ${dlErr?.message}`);
    }

    const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());

    // ── Open with MuPDF ───────────────────────────────────────────────────────
    const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
    const pageCount = doc.countPages();

    if (pageCount > MAX_PAGES) {
      doc.destroy();
      const msg = `PDF has ${pageCount} pages (maximum ${MAX_PAGES}). Split and re-upload.`;
      await supabase.from('pdf_uploads').update({ status: 'error', error_detail: msg }).eq('id', uploadId);
      return res.status(422).json({ error: msg });
    }

    await supabase.from('pdf_uploads')
      .update({ page_count: pageCount, pages_accepted: pageCount })
      .eq('id', uploadId);

    // ── Render in parallel batches ────────────────────────────────────────────
    const basePath      = `temp/${userId}/${jobId}`;
    const pageRecords   = new Array(pageCount);
    const pageDurations = [];
    const loopStart     = Date.now();

    const pageNums = Array.from({ length: pageCount }, (_, i) => i + 1);

    for (let i = 0; i < pageNums.length; i += RENDER_BATCH_SIZE) {
      const batch = pageNums.slice(i, i + RENDER_BATCH_SIZE);
      const results = await Promise.all(
        batch.map(pageNum =>
          processPage({ doc, pageIndex: pageNum - 1, pageNum, basePath, uploadId, sharpFn, mupdf })
        )
      );
      for (const { record, durationMs } of results) {
        pageRecords[record.page_number - 1] = record;
        pageDurations.push(durationMs);
      }
    }

    doc.destroy();

    // ── Upsert pdf_pages ──────────────────────────────────────────────────────
    // Defensive: ensure every record explicitly carries pdf_upload_id and page_number
    // so they cannot be null even if a prior broken upsert left null-linked rows.
    const safeRecords = pageRecords.map(r => ({
      ...r,
      pdf_upload_id: uploadId,   // always override — never trust inherited value
      upload_id:     uploadId,   // populate alias column if schema uses both names
      page_number:   r.page_number,
    }));

    console.log(JSON.stringify({
      event:       'render-pdf:upsert',
      uploadId,
      recordCount: safeRecords.length,
      sample:      safeRecords.slice(0, 2).map(r => ({
        pdf_upload_id: r.pdf_upload_id,
        upload_id:     r.upload_id,
        page_number:   r.page_number,
      })),
    }));

    const { error: insertErr } = await supabase
      .from('pdf_pages')
      .upsert(safeRecords, { onConflict: 'pdf_upload_id,page_number' });

    if (insertErr) throw new Error(`Failed to insert pdf_pages: ${insertErr.message}`);

    // ── Verify rows are linked to this upload ─────────────────────────────────
    const { data: verify } = await supabase
      .from('pdf_pages')
      .select('id')
      .eq('pdf_upload_id', uploadId);

    if (!verify?.length) {
      throw new Error(`pdf_pages insert failed: no rows linked to upload ${uploadId}`);
    }

    console.log(JSON.stringify({
      event:        'render-pdf:verify',
      uploadId,
      verifiedRows: verify.length,
    }));

    const renderedCount = verify.length;
    const totalRenderMs = Date.now() - loopStart;
    const avgMs = pageDurations.length
      ? Math.round(pageDurations.reduce((a, b) => a + b, 0) / pageDurations.length) : 0;
    const failedPages = pageRecords.filter(p => !p.image_path).length;

    console.log(JSON.stringify({
      event: 'render-pdf:complete', jobId, uploadId, pageCount, renderedCount, failedPages,
      totalRenderMs, avgMsPerPage: avgMs, batchSize: RENDER_BATCH_SIZE,
    }));

    const renderCompletedAt = new Date().toISOString();
    await supabase.from('pdf_uploads')
      .update({
        status:               'classifying',
        stage:                'rendered',
        page_count:           renderedCount,
        pages_rendered:       renderedCount,
        render_completed_at:  renderCompletedAt,
      })
      .eq('id', uploadId);

    // ── Hand off to classify-pages ─────────────────────────────────────────
    const host     = req.headers.host ?? '';
    const proto    = host.includes('localhost') ? 'http' : 'https';
    const baseUrl  = `${proto}://${host}`;
    const classifyPayload = JSON.stringify({ uploadId, jobId, userId, pageCount, projectId: projectId ?? null });

    console.log(JSON.stringify({ event: 'render-pdf:handoff', target: 'classify-pages', uploadId, jobId }));

    waitUntil(
      fetch(`${baseUrl}/api/ai/classify-pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' },
        body: classifyPayload,
      }).then(async (r) => {
        const text = await r.text().catch(() => '');
        console.log('[render-pdf] classify-pages response', r.status, text.slice(0, 200));
        if (!r.ok) {
          await supabase.from('pdf_uploads')
            .update({ status: 'error', error_detail: `classify-pages handoff failed (HTTP ${r.status}): ${text.slice(0, 300)}` })
            .eq('id', uploadId);
        }
      }).catch(async (err) => {
        console.error('[render-pdf] classify-pages handoff failed', err.message);
        await supabase.from('pdf_uploads')
          .update({ status: 'error', error_detail: `classify-pages handoff error: ${err.message}` })
          .eq('id', uploadId);
      })
    );

    return res.status(200).json({
      uploadId, jobId, pageCount, failedPages, totalRenderMs, avgMsPerPage: avgMs,
      status: 'classifying',
      message: `Rendered ${pageCount} pages in ${(totalRenderMs / 1000).toFixed(1)}s. Classification started.`,
    });

  } catch (err) {
    console.error('render-pdf: fatal error', err);
    await supabase.from('pdf_uploads')
      .update({ status: 'error', error_detail: err.message })
      .eq('id', uploadId);
    return res.status(500).json({ error: err.message });
  }
}
