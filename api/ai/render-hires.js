// api/ai/render-hires.js
// POST /api/ai/render-hires  (internal — called by auto-analyse)
//
// Renders a single PDF page at high DPI (250) as PNG for room-analysis.
// Uses MuPDF WebAssembly — no native deps, no DOM requirements.
//
// Request body:
//   uploadId, jobId, pageId, storagePath, pageNumber (1-indexed), userId
//
// Response 200: { pageId, hiresPath, widthPx, heightPx, durationMs }

import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';

const require  = createRequire(import.meta.url);
const mupdf    = require('mupdf');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const HIRES_DPI = 250;
const BUCKET    = 'plan-uploads';

function validateInternalToken(req) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    const host = req.headers.host ?? '';
    return host.includes('localhost') || host.includes('vercel.internal');
  }
  return req.headers['x-internal-secret'] === secret;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!validateInternalToken(req)) return res.status(403).json({ error: 'Forbidden' });

  const { uploadId, jobId, pageId, storagePath, pageNumber, userId } = req.body ?? {};
  if (!uploadId || !jobId || !pageId || !storagePath || !pageNumber || !userId) {
    return res.status(400).json({ error: 'uploadId, jobId, pageId, storagePath, pageNumber, userId required' });
  }

  const t0 = Date.now();

  try {
    // ── Download PDF ───────────────────────────────────────────────────────
    const objectPath = storagePath.replace(`${BUCKET}/`, '');
    const { data: pdfBlob, error: dlErr } = await supabase.storage
      .from(BUCKET).download(objectPath);

    if (dlErr || !pdfBlob) throw new Error(`Failed to download PDF: ${dlErr?.message}`);

    const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());

    // ── Render with MuPDF ──────────────────────────────────────────────────
    const doc    = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
    const page   = doc.loadPage(pageNumber - 1); // 0-indexed
    const bounds = page.getBounds();             // [x0, y0, x1, y1] in points

    const x0 = bounds[0], y0 = bounds[1], x1 = bounds[2], y1 = bounds[3];
    const scale   = HIRES_DPI / 72;
    const pixmap  = page.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceRGB, false);
    const pngData = pixmap.asPNG();

    pixmap.destroy();
    page.destroy();
    doc.destroy();

    const pngBuffer = Buffer.from(pngData);
    const widthPx   = Math.round((x1 - x0) * scale);
    const heightPx  = Math.round((y1 - y0) * scale);

    // ── Upload PNG ────────────────────────────────────────────────────────
    const paddedNum  = String(pageNumber).padStart(2, '0');
    const hiresPath  = `temp/${userId}/${jobId}/page_${paddedNum}_hires.png`;

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET).upload(hiresPath, pngBuffer, {
        contentType: 'image/png', cacheControl: '60', upsert: true,
      });

    if (uploadErr) throw new Error(`Failed to upload hi-res PNG: ${uploadErr.message}`);

    const hiresStoragePath = `${BUCKET}/${hiresPath}`;

    // ── Update pdf_pages ──────────────────────────────────────────────────
    await supabase.from('pdf_pages').update({
      hires_image_path: hiresStoragePath,
      hires_render_dpi: HIRES_DPI,
      hires_width_px:   widthPx,
      hires_height_px:  heightPx,
    }).eq('id', pageId);

    const durationMs = Date.now() - t0;
    console.log(JSON.stringify({ event: 'render-hires:complete', jobId, pageId, pageNumber, widthPx, heightPx, durationMs }));

    return res.status(200).json({ pageId, hiresPath: hiresStoragePath, widthPx, heightPx, durationMs });

  } catch (err) {
    console.error('render-hires: error', err);
    return res.status(500).json({ error: err.message });
  }
}
