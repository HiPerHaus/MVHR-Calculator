// ============================================================
// HiPer Studio — F4: Project Overview aggregation (read-only)
// GET /api/studio/project-overview?projectId=...
//   Single call that powers the project-first workspace: project info,
//   building-model summary, MVHR module status, and workflow progress.
//
// Reuses the DBM foundations (resolveMvhrRooms). Every sub-query is tolerant:
// a missing table or empty result degrades gracefully rather than 500-ing, so
// existing/legacy projects keep working (backwards compatibility).
// Ownership enforced via requireProjectOwner.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { applyCors }          from '../../lib/cors.js';
import { requireProjectOwner } from '../../lib/requireProjectOwner.js';
import { isUuid }              from '../../lib/validateUuid.js';
import { resolveMvhrRooms, mvhrRequireApproved } from '../../lib/mvhrRoomsSource.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Count helper — returns 0 on any error/missing table (graceful for legacy projects).
async function safeCount(supabase, table, filters = {}) {
  try {
    let q = supabase.from(table).select('id', { count: 'exact', head: true });
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { count, error } = await q;
    return error ? 0 : (count ?? 0);
  } catch { return 0; }
}

async function safeMaybe(supabase, table, columns, filters = {}, order = null) {
  try {
    let q = supabase.from(table).select(columns).match(filters);
    if (order) q = q.order(order.col, { ascending: order.asc ?? false });
    q = q.limit(1).maybeSingle();
    const { data, error } = await q;
    return error ? null : data;
  } catch { return null; }
}

export default async function handler(req, res) {
  applyCors(req, res, 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase environment variables' });
  }

  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  if (!isUuid(projectId)) return res.status(400).json({ error: 'Invalid projectId: must be a UUID' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { user, project: ownedProject, errorResponse } = await requireProjectOwner(req, res, supabase, projectId);
  if (errorResponse) return;

  // ── Project detail ────────────────────────────────────────
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, client_name, site_address, suburb, address_state, postcode, building_type, ai_analysis_json, created_at, updated_at')
    .eq('id', projectId)
    .maybeSingle();

  // ── Current building model + its child counts ─────────────
  const currentModel = await safeMaybe(
    supabase, 'building_models',
    'id, version, status, conditioned_floor_area_m2, building_volume_m3, storey_count, warnings, updated_at, approved_at',
    { project_id: projectId, is_current: true }
  );
  const approvedModel = await safeMaybe(
    supabase, 'building_models',
    'id, version, approved_at',
    { project_id: projectId, status: 'approved' },
    { col: 'version', asc: false }
  );

  let levels = 0, rooms = 0;
  if (currentModel) {
    [levels, rooms] = await Promise.all([
      safeCount(supabase, 'building_model_levels', { model_id: currentModel.id }),
      safeCount(supabase, 'building_model_rooms',  { model_id: currentModel.id }),
    ]);
  }

  const currentVersion  = currentModel?.version ?? null;
  const approvedVersion = approvedModel?.version ?? null;
  const newerDraftAwaiting =
    !!approvedVersion && !!currentVersion &&
    currentModel?.status !== 'approved' && currentVersion > approvedVersion;

  // ── What MVHR will actually consume (same resolver the engine uses) ──
  const mvhr = await resolveMvhrRooms(supabase, projectId, user.id);

  // ── Workflow progress signals (each tolerant of missing data) ──
  const [pdfDocs, imgDocs, airflowDesign, ductCount] = await Promise.all([
    safeCount(supabase, 'pdf_uploads',   { project_id: projectId }),
    safeCount(supabase, 'project_images',{ project_id: projectId }),
    safeMaybe(supabase, 'airflow_designs', 'id, selected_unit_id, updated_at', { project_id: projectId }, { col: 'updated_at', asc: false }),
    safeCount(supabase, 'duct_designs',  { project_id: projectId }),
  ]);

  const aiAnalysisComplete = !!project?.ai_analysis_json ||
    !!(await safeMaybe(supabase, 'plan_analysis_log', 'id', { project_id: projectId, analysis_status: 'success' }));

  const progress = {
    documentsUploaded:   (pdfDocs + imgDocs) > 0,
    aiAnalysisComplete,
    modelGenerated:      !!currentModel,
    modelApproved:       !!approvedModel,
    mvhrStarted:         !!airflowDesign,
    mvhrComplete:        !!(airflowDesign?.selected_unit_id),
  };

  // Derived project status label (no dedicated DB column).
  const statusLabel =
    progress.mvhrComplete   ? 'MVHR design complete' :
    progress.mvhrStarted    ? 'MVHR design in progress' :
    progress.modelApproved  ? 'Building model approved' :
    progress.modelGenerated ? 'Building model in review' :
    progress.aiAnalysisComplete ? 'AI analysis complete' :
    progress.documentsUploaded  ? 'Documents uploaded' :
    'New project';

  // ── Build response ────────────────────────────────────────
  return res.status(200).json({
    project: project ? {
      id: project.id,
      name: project.name,
      clientName: project.client_name ?? null,
      siteAddress: project.site_address ?? null,
      suburb: project.suburb ?? null,
      addressState: project.address_state ?? null,
      postcode: project.postcode ?? null,
      buildingType: project.building_type ?? null,
      status: statusLabel,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
    } : { id: projectId },

    building: {
      hasModel: !!currentModel,
      modelId: currentModel?.id ?? null,
      status: currentModel?.status ?? null,
      version: currentVersion,
      conditionedFloorAreaM2: currentModel ? Number(currentModel.conditioned_floor_area_m2 ?? 0) : null,
      buildingVolumeM3: currentModel ? Number(currentModel.building_volume_m3 ?? 0) : null,
      storeyCount: currentModel?.storey_count ?? null,
      levels,
      rooms,
      warnings: currentModel?.warnings ?? [],
      approvedVersion,
      newerDraftAwaiting,
      updatedAt: currentModel?.updated_at ?? null,
      approvedAt: approvedModel?.approved_at ?? null,
    },

    modules: {
      mvhr: {
        started: progress.mvhrStarted,
        complete: progress.mvhrComplete,
        lastUpdated: airflowDesign?.updated_at ?? null,
        // geometry it consumes
        source: mvhr.source,                 // 'dbm' | 'project_rooms'
        usingVersion: mvhr.modelVersion ?? null,
        usingStatus: mvhr.modelStatus ?? null,
        roomCount: mvhr.rooms.length,
        gatingMode: mvhr.gatingMode,
        requireApproved: mvhrRequireApproved(),
        latestApprovedVersion: approvedVersion,
        currentVersion,
        newerDraftAwaiting,
      },
      airtightness: {
        // Airtightness module = approved building volume drives the envelope.
        hasApprovedVolume: !!(await safeMaybe(supabase, 'building_volume_calculations', 'id', { project_id: projectId, status: 'approved' })),
      },
      rangeHood: { available: false },       // F10 placeholder
    },

    progress,
  });
}
