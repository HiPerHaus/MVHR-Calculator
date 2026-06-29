// api/studio/building-volume.js
// GET  /api/studio/building-volume?projectId=... → current calculation + history
// POST /api/studio/building-volume              → save a new version

import { createClient } from '@supabase/supabase-js';
import { applyCors } from '../../lib/cors.js';
import { requireProjectOwner } from '../../lib/requireProjectOwner.js';
import { isUuid } from '../../lib/validateUuid.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STATUS_VALUES = new Set(['draft', 'needs_review', 'approved', 'superseded']);

function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function cleanText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : fallback;
}

function normaliseZone(zone, index, defaultHeightM) {
  const area = round2(zone?.areaM2 ?? zone?.area_m2);
  const height = round2(zone?.heightM ?? zone?.height_m ?? defaultHeightM ?? 2.4);
  const volume = round2(zone?.volumeM3 ?? zone?.volume_m3 ?? area * height);

  return {
    zone_key: zone?.id ? cleanText(zone.id) : `zone-${index + 1}`,
    name: cleanText(zone?.name, `Zone ${index + 1}`),
    level: cleanText(zone?.level, 'Unspecified level'),
    area_m2: area,
    height_m: height,
    volume_m3: volume,
    included: zone?.include ?? zone?.included ?? true,
    ai_confidence: zone?.confidence == null ? null : Math.max(0, Math.min(1, Number(zone.confidence))),
    height_source: cleanText(zone?.heightSource ?? zone?.height_source),
    height_method: cleanText(zone?.heightMethod ?? zone?.height_method),
    height_assumed: zone?.heightAssumed ?? zone?.height_assumed ?? false,
    needs_review: zone?.needsReview ?? zone?.needs_review ?? zone?.heightAssumed ?? false,
    warning: cleanText(zone?.warning),
    height_zones: Array.isArray(zone?.heightZones) ? zone.heightZones : (zone?.height_zones ?? []),
    evidence: cleanText(zone?.evidence),
    source_json: zone ?? {},
  };
}

function calculationResponse(row, zones = []) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    isCurrent: row.is_current,
    status: row.status ?? 'draft',
    sourceType: row.source_type,
    airtightnessLayer: row.airtightness_layer,
    defaultHeightM: row.default_ceiling_height_m,
    conditionedFloorAreaM2: Number(row.conditioned_floor_area_m2 ?? 0),
    buildingVolumeM3: Number(row.building_volume_m3 ?? 0),
    aiConfidence: row.ai_confidence == null ? null : Number(row.ai_confidence),
    assumptions: row.assumptions ?? [],
    warnings: row.warnings ?? [],
    pageClassifications: row.page_classifications ?? [],
    selectedPdfPages: row.selected_pdf_pages ?? [],
    originalAiJson: row.original_ai_json ?? null,
    currentJson: row.current_json ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    zones: zones.map(z => ({
      id: z.zone_key || z.id,
      name: z.name,
      level: z.level,
      areaM2: Number(z.area_m2 ?? 0),
      heightM: Number(z.height_m ?? 0),
      volumeM3: Number(z.volume_m3 ?? 0),
      include: z.included,
      confidence: z.ai_confidence == null ? null : Number(z.ai_confidence),
      heightSource: z.height_source ?? '',
      heightMethod: z.height_method ?? '',
      heightAssumed: z.height_assumed ?? false,
      needsReview: z.needs_review ?? false,
      warning: z.warning ?? '',
      heightZones: z.height_zones ?? [],
      evidence: z.evidence ?? '',
    })),
  };
}

async function loadCalculation(supabase, calculationId) {
  if (!calculationId) return null;
  const { data: zones, error } = await supabase
    .from('building_volume_zones')
    .select('*')
    .eq('calculation_id', calculationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return zones ?? [];
}

export default async function handler(req, res) {
  applyCors(req, res, 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase environment variables' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  if (req.method === 'GET') {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    if (!isUuid(projectId)) return res.status(400).json({ error: 'Invalid projectId: must be a UUID' });

    const { errorResponse } = await requireProjectOwner(req, res, supabase, projectId);
    if (errorResponse) return;

    const { data: current, error: currentErr } = await supabase
      .from('building_volume_calculations')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_current', true)
      .maybeSingle();
    if (currentErr) return res.status(500).json({ error: currentErr.message });

    const { data: history, error: historyErr } = await supabase
      .from('building_volume_calculations')
      .select('id, version, status, source_type, airtightness_layer, conditioned_floor_area_m2, building_volume_m3, ai_confidence, created_at, is_current')
      .eq('project_id', projectId)
      .order('version', { ascending: false });
    if (historyErr) return res.status(500).json({ error: historyErr.message });

    const zones = current ? await loadCalculation(supabase, current.id) : [];
    return res.status(200).json({
      calculation: calculationResponse(current, zones),
      history: history ?? [],
    });
  }

  if (req.method === 'POST') {
    const body = req.body ?? {};
    const { projectId } = body;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    if (!isUuid(projectId)) return res.status(400).json({ error: 'Invalid projectId: must be a UUID' });

    const { user, errorResponse } = await requireProjectOwner(req, res, supabase, projectId);
    if (errorResponse) return;

    const defaultHeightM = round2(body.defaultHeightM ?? 2.4);
    const zones = Array.isArray(body.zones)
      ? body.zones.map((zone, index) => normaliseZone(zone, index, defaultHeightM))
      : [];

    if (!zones.length) return res.status(400).json({ error: 'At least one zone is required' });

    const included = zones.filter(z => z.included);
    const conditionedFloorAreaM2 = round2(body.conditionedFloorAreaM2 ?? included.reduce((sum, z) => sum + z.area_m2, 0));
    const buildingVolumeM3 = round2(body.buildingVolumeM3 ?? included.reduce((sum, z) => sum + z.volume_m3, 0));
    if (buildingVolumeM3 <= 0) return res.status(400).json({ error: 'Building volume must be greater than 0' });
    const hasReviewFlags = zones.some(z => z.needs_review || z.height_assumed) || (Array.isArray(body.warnings) && body.warnings.length > 0);
    const requestedStatus = cleanText(body.status, hasReviewFlags ? 'needs_review' : 'draft');
    const status = STATUS_VALUES.has(requestedStatus) && requestedStatus !== 'superseded'
      ? requestedStatus
      : (hasReviewFlags ? 'needs_review' : 'draft');

    const { data: latest } = await supabase
      .from('building_volume_calculations')
      .select('id, version')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (latest?.version ?? 0) + 1;

    const { data: previousCurrent } = await supabase
      .from('building_volume_calculations')
      .select('id, version')
      .eq('project_id', projectId)
      .eq('is_current', true);

    await supabase
      .from('building_volume_calculations')
      .update({ is_current: false, status: 'superseded', updated_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .eq('is_current', true);

    const currentJson = {
      zones: body.zones ?? [],
      assumptions: body.assumptions ?? [],
      warnings: body.warnings ?? [],
      pageClassifications: body.pageClassifications ?? [],
      selectedPdfPages: body.selectedPdfPages ?? [],
      status,
      editedAt: new Date().toISOString(),
    };

    const { data: calculation, error: insertErr } = await supabase
      .from('building_volume_calculations')
      .insert({
        project_id: projectId,
        user_id: user.id,
        version,
        is_current: true,
        status,
        source_type: body.sourceType ?? 'manual',
        airtightness_layer: cleanText(body.airtightnessLayer, 'plasterboard'),
        default_ceiling_height_m: defaultHeightM,
        conditioned_floor_area_m2: conditionedFloorAreaM2,
        building_volume_m3: buildingVolumeM3,
        ai_confidence: body.aiConfidence == null ? null : Math.max(0, Math.min(1, Number(body.aiConfidence))),
        assumptions: body.assumptions ?? [],
        warnings: body.warnings ?? [],
        page_classifications: body.pageClassifications ?? [],
        selected_pdf_pages: body.selectedPdfPages ?? [],
        original_ai_json: body.originalAiJson ?? null,
        current_json: currentJson,
      })
      .select('*')
      .single();

    if (insertErr) return res.status(500).json({ error: insertErr.message });

    const zoneRows = zones.map(zone => ({ ...zone, calculation_id: calculation.id }));
    const { data: savedZones, error: zoneErr } = await supabase
      .from('building_volume_zones')
      .insert(zoneRows)
      .select('*');
    if (zoneErr) return res.status(500).json({ error: zoneErr.message });

    const events = [
      ...(previousCurrent ?? []).map(row => ({
        calculation_id: row.id,
        user_id: user.id,
        event_type: 'superseded',
        payload: { supersededBy: calculation.id, previousVersion: row.version, newVersion: version },
      })),
      {
        calculation_id: calculation.id,
        user_id: user.id,
        event_type: version === 1 ? 'created' : 'edited',
        payload: { version, status, sourceType: body.sourceType ?? 'manual' },
      },
    ];
    await supabase
      .from('building_volume_calculation_events')
      .insert(events);

    return res.status(201).json({
      calculation: calculationResponse(calculation, savedZones ?? []),
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
