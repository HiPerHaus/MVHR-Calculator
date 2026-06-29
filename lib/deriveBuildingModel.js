// lib/deriveBuildingModel.js
//
// F2 — Non-breaking derivation of a Digital Building Model (DBM) from existing
// project data. PURE: no I/O, no Supabase. Takes plain rows, returns a plan of
// rows to insert. The caller persists them (api/studio/building-model.js and
// scripts/backfill-building-models.mjs).
//
// Sources (read-only; never mutated):
//   • project_rooms                     → building_model_rooms + levels
//   • latest APPROVED                   → building_models rollups (volume/area/
//     building_volume_calculations        airtightness) + building_model_zones
//   • building_volume_zones (of that calc)
//
// Output is additive only. project_rooms and building_volume_* are untouched.

const SCHEMA_VERSION = 'dbm-1';

// Canonical level index from a free-text floor label.
function canonicalLevelIndex(floor) {
  const f = String(floor ?? '').toLowerCase();
  if (/\bground\b|\bg\b|\blower\b|\bfloor 1\b/.test(f)) return 0;
  if (/\bfirst\b|\bupper\b|\blevel 1\b|\bfloor 2\b/.test(f)) return 1;
  if (/\bsecond\b|\blevel 2\b|\bfloor 3\b/.test(f)) return 2;
  if (/\bthird\b|\blevel 3\b/.test(f)) return 3;
  return null; // unknown — caller assigns by order of appearance
}

function canonicalLevelName(index) {
  return index === 0 ? 'Ground Floor'
    : index === 1 ? 'First Floor'
    : index === 2 ? 'Second Floor'
    : index === 3 ? 'Third Floor'
    : `Floor ${index + 1}`;
}

// Zones whose name implies they sit outside the airtight envelope.
const EXCLUDED_RE = /\b(garage|carport|car\s*port|alfresco|verandah|veranda|porch|patio|balcony|deck|courtyard|terrace|shed|workshop|store\s*room|storeroom|external\s*store|roof\s*void|attic|plant\s*room|unconditioned|crawl\s*space)\b/i;

function categoryFromName(name) {
  const n = String(name ?? '').toLowerCase();
  if (/garage|carport/.test(n)) return 'garage';
  if (/alfresco/.test(n)) return 'alfresco';
  if (/verandah|veranda/.test(n)) return 'verandah';
  if (/roof\s*void|attic/.test(n)) return 'roof_void';
  if (/plant/.test(n)) return 'plant';
  if (/kitchen/.test(n)) return 'kitchen';
  if (/bath|ensuite|wc|toilet|laundry|wet/.test(n)) return 'wet';
  return null;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round2(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/**
 * Derive a DBM plan from existing project data.
 *
 * @param {object}   args
 * @param {object}   args.project        projects row (id, user_id, storey_count)
 * @param {object[]} args.rooms          project_rooms rows
 * @param {object|null} args.buildingVolume latest approved building_volume_calculations row (or null)
 * @param {object[]} args.zones          building_volume_zones rows for that calc
 * @param {number}   [args.version]      version number to stamp (default 1)
 * @returns {{ model: object, levels: object[], rooms: object[], zones: object[], event: object, summary: object }}
 */
export function deriveBuildingModel({ project, rooms = [], buildingVolume = null, zones = [], version = 1 }) {
  const warnings = [];

  // ── Levels ────────────────────────────────────────────────
  // Map each distinct room.floor → a level_index. Known labels get canonical
  // indices; unknown labels are assigned incrementally after the known ones.
  const floorToIndex = new Map();
  let nextUnknownIndex = 100; // park unknowns high, then compact below
  for (const r of rooms) {
    const key = r.floor ?? '__none__';
    if (floorToIndex.has(key)) continue;
    const ci = canonicalLevelIndex(r.floor);
    floorToIndex.set(key, ci != null ? ci : nextUnknownIndex++);
  }
  // Compact indices to a dense 0..n-1 order while preserving relative order.
  const ordered = [...floorToIndex.entries()].sort((a, b) => a[1] - b[1]);
  const compact = new Map();
  ordered.forEach(([key], i) => compact.set(key, i));
  for (const [key, idx] of floorToIndex) floorToIndex.set(key, compact.get(key));

  const levels = ordered.map(([key], i) => {
    const floorRooms = rooms.filter(r => (r.floor ?? '__none__') === key);
    // Most common ceiling height on this floor (fallback null).
    const heights = floorRooms.map(r => num(r.ceiling_height_m)).filter(h => h != null);
    const defaultHeight = heights.length
      ? heights.sort((a, b) => heights.filter(v => v === a).length - heights.filter(v => v === b).length).pop()
      : null;
    return {
      level_index: i,
      name: key === '__none__' ? canonicalLevelName(i) : String(key),
      elevation_m: null,
      default_ceiling_height_m: defaultHeight,
      source: 'derived',
    };
  });

  // ── Rooms ─────────────────────────────────────────────────
  const dbmRooms = rooms.map((r, i) => {
    const area = num(r.area);
    const ceil = num(r.ceiling_height_m);
    const vol = num(r.volume_m3) ?? (area != null ? round2(area * (ceil ?? 2.4)) : null);
    if (area == null) warnings.push(`Room "${r.name ?? 'unnamed'}" has no area`);
    const isIgnore = r.classification === 'ignore';
    return {
      level_index: floorToIndex.get(r.floor ?? '__none__') ?? 0,
      name: r.name ?? 'Unnamed Room',
      room_type: r.room_type ?? 'other',
      classification: ['supply', 'extract', 'transfer', 'ignore'].includes(r.classification) ? r.classification : 'supply',
      polygon: null, // PDF-derived: no vector polygon (CAD path fills this in F9)
      bbox: r.bbox ?? null,
      area_m2: area,
      ceiling_height_m: ceil,
      volume_m3: vol,
      included_in_envelope: !isIgnore,
      exclusion_reason: isIgnore ? 'classification=ignore' : null,
      bed_spaces: Number.isFinite(Number(r.bed_spaces)) ? Number(r.bed_spaces) : 0,
      confidence: num(r.confidence),
      evidence: null,
      source: 'derived',
      source_room_id: r.id ?? null,
      manually_edited: r.source === 'manual',
      sort_order: Number.isFinite(Number(r.sort_order)) ? Number(r.sort_order) : i,
      // MVHR-specific attributes preserved so building_model_rooms can stand in
      // for project_rooms when MVHR reads from the DBM (F3 step 4). These are not
      // core geometry; they live under source_json.mvhr.
      source_json: {
        mvhr: {
          floor: r.floor ?? null,
          is_confirmed: r.is_confirmed === true,
          optional_supply: r.optional_supply === true,
          optional_extract: r.optional_extract === true,
          requires_manual_review: r.requires_manual_review === true,
        },
      },
    };
  });

  // ── Zones (from building volume) ──────────────────────────
  const dbmZones = (zones ?? []).map(z => {
    const included = z.included !== false;
    return {
      zone_key: z.zone_key ?? null,
      name: z.name ?? 'Zone',
      kind: included ? 'envelope' : 'excluded',
      category: categoryFromName(z.name) ?? (EXCLUDED_RE.test(z.name ?? '') ? 'excluded' : null),
      level: z.level ?? null,
      area_m2: round2(z.area_m2),
      height_m: round2(z.height_m) || 2.4,
      volume_m3: round2(z.volume_m3),
      included,
      confidence: z.ai_confidence == null ? null : num(z.ai_confidence),
      evidence: z.evidence ?? null,
      source: 'derived',
      source_zone_id: z.id ?? null,
      source_json: {},
    };
  });

  // ── Rollups ───────────────────────────────────────────────
  const roomsAreaSum = round2(dbmRooms.filter(r => r.included_in_envelope && r.area_m2 != null)
    .reduce((s, r) => s + r.area_m2, 0));
  const roomsVolSum = round2(dbmRooms.filter(r => r.included_in_envelope && r.volume_m3 != null)
    .reduce((s, r) => s + r.volume_m3, 0));

  let conditionedFloorAreaM2 = roomsAreaSum;
  let buildingVolumeM3 = roomsVolSum;
  let airtightnessLayer = null;
  let aiConfidence = null;
  let assumptions = [];

  if (buildingVolume) {
    conditionedFloorAreaM2 = round2(buildingVolume.conditioned_floor_area_m2) || roomsAreaSum;
    buildingVolumeM3 = round2(buildingVolume.building_volume_m3) || roomsVolSum;
    airtightnessLayer = buildingVolume.airtightness_layer ?? null;
    aiConfidence = buildingVolume.ai_confidence == null ? null : num(buildingVolume.ai_confidence);
    assumptions = Array.isArray(buildingVolume.assumptions) ? buildingVolume.assumptions : [];
    if (buildingVolume.status !== 'approved') {
      warnings.push(`Building volume source is '${buildingVolume.status}', not approved`);
    }
  } else {
    warnings.push('No approved building volume calculation; volume/area derived from room schedule only');
  }

  if (rooms.length === 0) warnings.push('Project has no rooms to derive from');

  const storeyCount = num(project?.storey_count) ?? (levels.length || null);

  const model = {
    project_id: project?.id ?? null,
    user_id: project?.user_id ?? null,
    version,
    is_current: true,
    status: 'draft', // auto-derived → must be reviewed/approved before any module consumes it
    source_type: 'derived',
    schema_version: SCHEMA_VERSION,
    derived_from: {
      project_rooms: true,
      project_rooms_count: rooms.length,
      building_volume_calculation_id: buildingVolume?.id ?? null,
      building_volume_status: buildingVolume?.status ?? null,
    },
    conditioned_floor_area_m2: conditionedFloorAreaM2,
    building_volume_m3: buildingVolumeM3,
    airtightness_layer: airtightnessLayer,
    storey_count: storeyCount,
    ai_confidence: aiConfidence,
    assumptions,
    warnings,
    original_ai_json: null,
    current_json: {
      derivedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      sources: {
        projectRooms: rooms.length,
        buildingVolumeCalculationId: buildingVolume?.id ?? null,
        zones: dbmZones.length,
      },
    },
  };

  const event = {
    event_type: 'derived',
    payload: {
      source: 'F2 backfill',
      rooms: dbmRooms.length,
      zones: dbmZones.length,
      levels: levels.length,
      buildingVolumeCalculationId: buildingVolume?.id ?? null,
      warnings: warnings.length,
    },
  };

  const summary = {
    levels: levels.length,
    rooms: dbmRooms.length,
    zones: dbmZones.length,
    conditionedFloorAreaM2,
    buildingVolumeM3,
    warnings,
  };

  return { model, levels, rooms: dbmRooms, zones: dbmZones, event, summary };
}

export { SCHEMA_VERSION };
