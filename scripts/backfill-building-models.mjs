#!/usr/bin/env node
// scripts/backfill-building-models.mjs
//
// F2 — One-time (idempotent, re-runnable) backfill that derives a Digital
// Building Model for every existing project from project_rooms + the latest
// approved building_volume_calculations. ADDITIVE: never modifies project_rooms
// or building_volume_* — only inserts into building_model_* tables.
//
// Each run supersedes the project's prior current DBM and inserts a fresh one
// (version bumps), so re-running is safe.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-building-models.mjs [--dry-run] [--project <uuid>]
//
// Flags:
//   --dry-run            derive and print summaries; do NOT write to the DB
//   --project <uuid>     only this project (otherwise all projects)

import { createClient } from '@supabase/supabase-js';
import { deriveBuildingModel } from '../lib/deriveBuildingModel.js';
import { persistDerivedModel } from '../lib/persistBuildingModel.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyProject = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function loadAndDerive(project) {
  const { data: rooms } = await supabase
    .from('project_rooms').select('*')
    .eq('project_id', project.id)
    .order('sort_order', { ascending: true });

  const { data: bvCalc } = await supabase
    .from('building_volume_calculations').select('*')
    .eq('project_id', project.id)
    .eq('status', 'approved')
    .order('version', { ascending: false })
    .limit(1).maybeSingle();

  let zones = [];
  if (bvCalc) {
    const { data: z } = await supabase
      .from('building_volume_zones').select('*')
      .eq('calculation_id', bvCalc.id);
    zones = z ?? [];
  }

  return deriveBuildingModel({ project, rooms: rooms ?? [], buildingVolume: bvCalc ?? null, zones });
}

async function main() {
  let query = supabase.from('projects').select('id, user_id, storey_count, name');
  if (onlyProject) query = query.eq('id', onlyProject);
  const { data: projects, error } = await query;
  if (error) { console.error('Failed to list projects:', error.message); process.exit(1); }

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Backfilling DBM for ${projects.length} project(s)...\n`);

  let ok = 0, failed = 0, skippedEmpty = 0;
  for (const project of projects) {
    try {
      const plan = await loadAndDerive(project);
      const tag = `${project.name ?? 'Untitled'} (${project.id})`;

      if (plan.rooms.length === 0 && plan.zones.length === 0) {
        console.log(`  · SKIP  ${tag} — no rooms or zones to derive`);
        skippedEmpty++;
        continue;
      }

      if (dryRun) {
        console.log(`  · DRY   ${tag} — rooms=${plan.summary.rooms} zones=${plan.summary.zones} levels=${plan.summary.levels} CFA=${plan.summary.conditionedFloorAreaM2}m² V=${plan.summary.buildingVolumeM3}m³ warnings=${plan.summary.warnings.length}`);
        ok++;
        continue;
      }

      const result = await persistDerivedModel(supabase, plan);
      if (result.ok) {
        console.log(`  ✓ OK    ${tag} — model ${result.modelId} v${result.version} (rooms=${plan.summary.rooms} zones=${plan.summary.zones})`);
        ok++;
      } else {
        console.log(`  ✗ FAIL  ${tag} — ${result.error}`);
        failed++;
      }
    } catch (e) {
      console.log(`  ✗ ERROR ${project.id} — ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${ok} derived, ${skippedEmpty} skipped (empty), ${failed} failed.`);
  process.exit(failed ? 1 : 0);
}

main();
