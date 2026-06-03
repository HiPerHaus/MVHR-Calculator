// api/ai/job-status/[jobId].js
// GET /api/ai/job-status/:jobId
//
// Returns the current status of a PDF upload job and, when classification
// is complete, the list of pages with signed thumbnail URLs.
//
// Response 200:
// {
//   jobId:    string,
//   status:   'pending'|'rendering'|'classifying'|'awaiting_confirmation'
//             |'confirmed'|'analysing'|'complete'|'error',
//   pageCount: number | null,
//   pages:    [           // populated when status = awaiting_confirmation or later
//     {
//       pageId:           string,
//       pageNumber:       number,
//       pageType:         string,
//       pageRole:         string | null,
//       confidence:       number | null,
//       reason:           string | null,
//       thumbUrl:         string | null,   // signed URL, 1 h TTL
//       userSelected:     boolean,
//       floorLevel:       number | null,
//       floorName:        string | null,
//       hasFloorLevels:   boolean | null,
//       hasCeilingHeights:boolean | null,
//       hasRoofGeometry:  boolean | null,
//       hasElevationData: boolean | null,
//       hasSectionData:   boolean | null,
//     }
//   ],
//   candidatePages: number[],  // page numbers classified as floor_plan
//   errorDetail:  string | null,
// }
//
// Response 401: not authenticated
// Response 404: job not found or not owned by this user

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SIGNED_URL_EXPIRY_SECONDS = 3600; // 1 hour

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  // ── Extract jobId from path ───────────────────────────────────────────────
  // Vercel dynamic routes: req.query.jobId
  const jobId = req.query.jobId;
  if (!jobId) return res.status(400).json({ error: 'jobId is required' });

  console.log('[job-status] incoming request', {
    jobId,
    userId: user.id,
    supabaseUrl: process.env.SUPABASE_URL,
    query: `pdf_uploads.job_id = '${jobId}'`,
  });

  // ── Fetch upload row ──────────────────────────────────────────────────────
  // Use maybeSingle() — single() errors with 406 when 0 rows are returned.
  const { data: upload, error: uploadErr } = await supabase
    .from('pdf_uploads')
    .select('id, job_id, status, page_count, error_detail, user_id')
    .eq('job_id', jobId)
    .maybeSingle();

  console.log('[job-status] query result', {
    jobId,
    found: !!upload,
    status: upload?.status ?? null,
    uploadErr: uploadErr?.message ?? null,
    uploadErrCode: uploadErr?.code ?? null,
  });

  if (uploadErr) {
    console.error('[job-status] Supabase error fetching upload row', uploadErr);
    return res.status(500).json({ error: `Database error: ${uploadErr.message}` });
  }

  if (!upload) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Ownership check — users can only see their own jobs.
  if (upload.user_id !== user.id) {
    // Also allow admins.
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (profile?.role !== 'admin') {
      return res.status(404).json({ error: 'Job not found' });
    }
  }

  // ── Early return for statuses that have no pages yet ─────────────────────
  const noPageStatuses = new Set(['pending', 'rendering', 'classifying']);
  if (noPageStatuses.has(upload.status)) {
    return res.status(200).json({
      jobId:          upload.job_id,
      status:         upload.status,
      pageCount:      upload.page_count,
      pages:          [],
      candidatePages: [],
      errorDetail:    null,
    });
  }

  if (upload.status === 'error') {
    return res.status(200).json({
      jobId:          upload.job_id,
      status:         'error',
      pageCount:      upload.page_count,
      pages:          [],
      candidatePages: [],
      errorDetail:    upload.error_detail,
    });
  }

  // ── Fetch pages ───────────────────────────────────────────────────────────
  // Use select('*') so future schema additions don't require changes here.
  const { data: pages, error: pagesErr } = await supabase
    .from('pdf_pages')
    .select('*')
    .eq('pdf_upload_id', upload.id)
    .order('page_number', { ascending: true });

  if (pagesErr) {
    console.error('job-status: pages fetch error', pagesErr);
    return res.status(500).json({ error: 'Failed to fetch page data' });
  }

  // ── Generate signed thumbnail URLs ───────────────────────────────────────
  const thumbPaths = pages
    .map(p => p.thumb_path)
    .filter(Boolean);

  let signedUrlMap = {};

  if (thumbPaths.length > 0) {
    const { data: signedUrls, error: signErr } = await supabase.storage
      .from('plan-uploads')
      .createSignedUrls(
        thumbPaths.map(p => p.replace('plan-uploads/', '')),
        SIGNED_URL_EXPIRY_SECONDS
      );

    if (!signErr && signedUrls) {
      for (const su of signedUrls) {
        // Map original path back to signed URL.
        // createSignedUrls returns { path, signedUrl, error }.
        const fullPath = `plan-uploads/${su.path}`;
        signedUrlMap[fullPath] = su.signedUrl;
      }
    }
  }

  // ── Build response pages ──────────────────────────────────────────────────
  // All optional columns use ?. / ?? null so missing columns don't throw.
  const responsePages = pages.map(p => ({
    pageId:            p.id,
    pageNumber:        p.page_number,
    pageType:          p.page_type   ?? null,
    confidence:        p.classification_confidence ?? null,
    reason:            p.classification_reason     ?? null,
    thumbUrl:          p.thumb_path ? (signedUrlMap[p.thumb_path] ?? null) : null,
    userSelected:      p.user_selected ?? false,
    floorIndex:        p.floor_index   ?? null,
    floorLevel:        p.floor_level   ?? null,
    floorName:         p.floor_name    ?? null,
    hasFloorLevels:    p.has_floor_levels    ?? null,
    hasCeilingHeights: p.has_ceiling_heights ?? null,
    hasRoofGeometry:   p.has_roof_geometry   ?? null,
    hasElevationData:  p.has_elevation_data  ?? null,
    hasSectionData:    p.has_section_data    ?? null,
  }));

  const candidatePages = responsePages
    .filter(p => p.pageType === 'floor_plan')
    .map(p => p.pageNumber);

  // ── When complete, fetch analysis results via pdf_pages.analysis_log_id ───
  // analyse-plan writes analysis_log_id back to the pdf_page row after success.
  // plan_analysis_log.parsed_rooms holds the full structured result.
  let analysisResults = null;
  if (upload.status === 'complete') {
    const analysedPages = pages.filter(p => p.analysis_log_id);

    if (analysedPages.length) {
      const logIds = analysedPages.map(p => p.analysis_log_id);

      const { data: logs } = await supabase
        .from('plan_analysis_log')
        .select('id, floor_index, parsed_rooms, analysis_status, created_at')
        .in('id', logIds)
        .order('floor_index', { ascending: true });

      if (logs?.length) {
        const logMap = Object.fromEntries(logs.map(l => [l.id, l]));

        analysisResults = analysedPages
          .map(page => {
            const log = logMap[page.analysis_log_id];
            if (!log) return null;
            const parsed = log.parsed_rooms ?? {};
            return {
              logId:           log.id,
              floorIndex:      log.floor_index ?? page.floorIndex ?? 0,
              floorName:       page.floorName ?? `Floor ${log.floor_index ?? 0}`,
              // Support both storage formats:
              // - new: parsed_rooms.rooms.supply (analysisJson stores rooms nested)
              // - legacy: parsed_rooms.supply (flat top-level — old rows before this fix)
              rooms:           parsed.rooms ?? {
                supply:   parsed.supply   ?? [],
                extract:  parsed.extract  ?? [],
                transfer: parsed.transfer ?? [],
                ignore:   parsed.ignore   ?? [],
              },
              warnings:        parsed.warnings        ?? [],
              assumptions:     parsed.assumptions     ?? [],
              occupancySummary: parsed.occupancySummary ?? null,
              reviewCandidates: parsed.reviewCandidates ?? [],
              analysisStatus:  log.analysis_status   ?? 'success',
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.floorIndex - b.floorIndex);
      }
    }
  }

  return res.status(200).json({
    jobId:           upload.job_id,
    status:          upload.status,
    pageCount:       upload.page_count,
    pages:           responsePages,
    candidatePages,
    errorDetail:     null,
    analysisResults, // null unless status=complete and logs exist
  });
}
