// api/ai/upload-pdf.js
// POST /api/ai/upload-pdf
//
// Registers a PDF that the client has already uploaded to Supabase Storage.
// Returns a jobId immediately; rendering and page classification happen
// asynchronously (triggered via a Supabase Edge Function or background worker).
//
// Request body (JSON):
//   storagePath  string   required — "plan-uploads/temp/<userId>/<jobId>/original.pdf"
//   projectId    uuid     optional — associates the upload with a project
//   testMode     boolean  optional — admin-only; skips project requirement
//
// Response 202:
//   { jobId, status: "pending", message }
//
// Response 400: missing / invalid fields
// Response 401: not authenticated
// Response 404: storagePath not found in Storage
// Response 500: DB error

import { createClient } from '@supabase/supabase-js';
import { rateLimit, applyRateLimit } from '../../lib/rate-limit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 5 upload registrations per minute per IP
const limiter = rateLimit({ windowMs: 60_000, max: 5 });

function isUuid(v) {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!applyRateLimit(req, res, { limiter })) return;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  // ── Parse body ────────────────────────────────────────────────────────────
  const {
    storagePath,
    projectId   = null,
    testMode    = false,
  } = req.body ?? {};

  if (!storagePath || typeof storagePath !== 'string') {
    return res.status(400).json({ error: 'storagePath is required' });
  }

  // storagePath format: "plan-uploads/temp/<userId>/<jobId>/original.pdf"
  // Validate it looks right and belongs to this user.
  const pathParts = storagePath.split('/');
  if (
    pathParts.length < 5 ||
    pathParts[0] !== 'plan-uploads' ||
    pathParts[1] !== 'temp' ||
    pathParts[2] !== user.id
  ) {
    return res.status(400).json({
      error: 'storagePath must be plan-uploads/temp/<your-userId>/<jobId>/original.pdf',
    });
  }

  const jobId = pathParts[3];
  if (!isUuid(jobId)) {
    return res.status(400).json({ error: 'jobId segment of storagePath must be a valid UUID' });
  }

  if (projectId && !isUuid(projectId)) {
    return res.status(400).json({ error: 'projectId must be a valid UUID' });
  }

  // ── Admin check for testMode ──────────────────────────────────────────────
  if (testMode) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (profile?.role !== 'admin') {
      return res.status(403).json({ error: 'testMode requires admin role' });
    }
  }

  // ── Verify the file actually exists in Storage ────────────────────────────
  // storagePath includes the bucket prefix; Storage client needs path without bucket.
  const bucket      = 'plan-uploads';
  const objectPath  = storagePath.slice('plan-uploads/'.length); // "temp/<uid>/<jobId>/original.pdf"

  const { data: fileList, error: listErr } = await supabase.storage
    .from(bucket)
    .list(`temp/${user.id}/${jobId}`, { search: 'original.pdf' });

  if (listErr || !fileList?.length) {
    return res.status(404).json({
      error: 'File not found in Storage. Upload the PDF to Storage before calling this endpoint.',
      storagePath,
    });
  }

  const fileInfo    = fileList[0];
  const fileSizeBytes = fileInfo.metadata?.size ?? null;
  const originalName  = fileInfo.name ?? 'original.pdf';

  // ── Create pdf_uploads row ────────────────────────────────────────────────
  const { data: uploadRow, error: insertErr } = await supabase
    .from('pdf_uploads')
    .insert({
      job_id:           jobId,
      user_id:          user.id,
      project_id:       projectId,
      storage_path:     storagePath,
      original_name:    originalName,
      file_size_bytes:  fileSizeBytes,
      status:           'pending',
    })
    .select('id, job_id, status')
    .single();

  if (insertErr) {
    // Duplicate job_id means this job was already registered.
    if (insertErr.code === '23505') {
      const { data: existing } = await supabase
        .from('pdf_uploads')
        .select('job_id, status')
        .eq('job_id', jobId)
        .single();
      return res.status(200).json({
        jobId:   existing.job_id,
        status:  existing.status,
        message: 'Job already registered.',
      });
    }
    console.error('upload-pdf: insert error', insertErr);
    return res.status(500).json({ error: 'Failed to register upload' });
  }

  // ── Update projects.current_job_id if projectId provided ─────────────────
  if (projectId) {
    await supabase
      .from('projects')
      .update({ current_job_id: uploadRow.id })
      .eq('id', projectId)
      .eq('user_id', user.id); // safety: only update own projects
  }

  // ── Fire-and-forget: invoke render-pdf ───────────────────────────────────
  // render-pdf runs synchronously on a separate Vercel function invocation.
  // We don't await it — upload-pdf returns immediately with jobId.
  // The client polls /job-status to track progress.
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  fetch(`${baseUrl}/api/ai/render-pdf`, {
    method:  'POST',
    headers: {
      'Content-Type':       'application/json',
      'x-internal-secret':  process.env.INTERNAL_API_SECRET ?? '',
    },
    body: JSON.stringify({
      uploadId:    uploadRow.id,
      jobId:       uploadRow.job_id,
      storagePath,
      userId:      user.id,
    }),
  }).catch(e => console.error('upload-pdf: render-pdf call failed:', e.message));

  return res.status(202).json({
    jobId:   uploadRow.job_id,
    status:  'pending',
    message: 'PDF registered. Rendering started.',
  });
}
