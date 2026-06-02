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

  // ── Fetch upload row ──────────────────────────────────────────────────────
  const { data: upload, error: uploadErr } = await supabase
    .from('pdf_uploads')
    .select('id, job_id, status, page_count, error_detail, user_id')
    .eq('job_id', jobId)
    .single();

  if (uploadErr || !upload) {
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
  const { data: pages, error: pagesErr } = await supabase
    .from('pdf_pages')
    .select(`
      id,
      page_number,
      page_type,
      page_role,
      classification_confidence,
      classification_reason,
      thumb_path,
      user_selected,
      floor_index,
      floor_level,
      floor_name,
      has_floor_levels,
      has_ceiling_heights,
      has_roof_geometry,
      has_elevation_data,
      has_section_data
    `)
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
  const responsePages = pages.map(p => ({
    pageId:           p.id,
    pageNumber:       p.page_number,
    pageType:         p.page_type,
    pageRole:         p.page_role ?? null,
    confidence:       p.classification_confidence ?? null,
    reason:           p.classification_reason ?? null,
    thumbUrl:         p.thumb_path ? (signedUrlMap[p.thumb_path] ?? null) : null,
    userSelected:     p.user_selected,
    floorIndex:       p.floor_index ?? null,
    floorLevel:       p.floor_level ?? null,
    floorName:        p.floor_name ?? null,
    hasFloorLevels:   p.has_floor_levels ?? null,
    hasCeilingHeights:p.has_ceiling_heights ?? null,
    hasRoofGeometry:  p.has_roof_geometry ?? null,
    hasElevationData: p.has_elevation_data ?? null,
    hasSectionData:   p.has_section_data ?? null,
  }));

  const candidatePages = responsePages
    .filter(p => p.pageType === 'floor_plan')
    .map(p => p.pageNumber);

  return res.status(200).json({
    jobId:          upload.job_id,
    status:         upload.status,
    pageCount:      upload.page_count,
    pages:          responsePages,
    candidatePages,
    errorDetail:    null,
  });
}
