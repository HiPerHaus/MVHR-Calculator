// @ts-check
// ============================================================
// HiPer Engine — MVHR unit scoring (pure function, no Supabase)
//
// Accepts a pre-fetched array of unit rows and returns them scored,
// ranked, and annotated with PHI compliance flags.
//
// PHI compliance gates (Phase 1):
//   HR ≥ 75 %  →  hr_eff >= PHI_MIN_HR_EFF
//   SFP ≤ 0.45 Wh/m³  →  sfp <= PHI_MAX_SFP
//   Boost capable (if boostM3h > 0)  →  unit.flow_max >= boostM3h
//
// Non-compliant units are included in results so the designer can
// see the full catalogue; they receive a large score penalty and carry
// ph_compliant=false + compliance_flags[] for UI gating.
// ============================================================

import { PHI_MIN_HR_EFF, PHI_MAX_SFP } from './constants.js';

/**
 * @typedef {{
 *   id:           string,
 *   manufacturer: string,
 *   model:        string,
 *   hr_eff:       number | null,
 *   sfp:          number | null,
 *   flow_min:     number,
 *   flow_max:     number,
 *   phi_cert_id:  string | null,
 *   user_id:      string | null,
 *   [key: string]: any,
 * }} MvhrUnit
 */

/**
 * Score and rank MVHR units against the design flow.
 *
 * @param {MvhrUnit[]} units              — pre-fetched from DB, already filtered to flow_max >= designM3h
 * @param {number}     designM3h          — continuous design flow
 * @param {number}     [preferredLoadPct] — target operating percentage (default 60)
 * @param {number}     [boostM3h]         — peak boost demand (0 = no boost check)
 * @returns {object[]}  scored + sorted array, most suitable first
 */
export function scoreMvhrUnits(units, designM3h, preferredLoadPct = 60, boostM3h = 0) {
  const preferredCapacityM3h = designM3h / (preferredLoadPct / 100);

  return units
    .map(u => {
      const phiCertified   = !!u.phi_cert_id;
      const actualOpPct    = Math.round((designM3h / u.flow_max) * 100);
      const deltaFromPref  = Math.abs(actualOpPct - preferredLoadPct);

      // ── PHI compliance checks ─────────────────────────────
      const hrEff   = u.hr_eff  ?? 0;
      const sfp     = u.sfp     ?? 999;

      const hrCompliant  = hrEff >= PHI_MIN_HR_EFF;
      const sfpCompliant = sfp   <= PHI_MAX_SFP;
      const boostCapable = boostM3h > 0 ? u.flow_max >= boostM3h : true; // true when no boost check

      const phCompliant = hrCompliant && sfpCompliant;

      /** @type {string[]} */
      const complianceFlags = [];
      if (!hrCompliant)  complianceFlags.push(`hr_below_${Math.round(PHI_MIN_HR_EFF * 100)}pct`);
      if (!sfpCompliant) complianceFlags.push(`sfp_above_${PHI_MAX_SFP}`);
      if (boostM3h > 0 && !boostCapable) complianceFlags.push('boost_undersized');

      // ── Scoring ───────────────────────────────────────────
      // Load fit (operating point vs preferred load)
      let loadScore;
      if (actualOpPct > 85)          loadScore = -500;   // too hard
      else if (actualOpPct < 35)     loadScore = -300;   // way oversized
      else if (deltaFromPref <= 10)  loadScore = 1000;   // sweet spot
      else if (deltaFromPref <= 20)  loadScore = 500;    // marginal
      else                           loadScore = 100;

      const phiScore  = phiCertified ? 500 : 0;
      const effScore  = hrEff * 10;
      const sfpScore  = -sfp  * 50;  // lower SFP is better

      // Boost: was a +200 bonus. Now a penalty when boost demand exists and unit can't handle it.
      // Correct boost-capable units get a small bonus; non-capable get a penalty.
      const boostScore = boostM3h > 0
        ? (boostCapable ? 200 : -400)  // undersized for boost is a real engineering problem
        : 0;

      // PHI non-compliance penalty — pushes non-compliant units to the bottom of the list.
      // They remain selectable but require an explicit override.
      const compliancePenalty = phCompliant ? 0 : -2000;

      const score = loadScore + phiScore + effScore + sfpScore + boostScore + compliancePenalty;

      // Load rating for display
      const loadRating = actualOpPct > 85  ? 'too_high'
        : actualOpPct < 35                 ? 'too_low'
        : deltaFromPref <= 10              ? 'ideal'
        : deltaFromPref <= 20              ? 'marginal'
        :                                    'outside_preference';

      return {
        ...u,
        phiCertified,
        is_custom:              u.user_id !== null,
        actual_operating_pct:   actualOpPct,
        preferred_load_pct:     preferredLoadPct,
        preferred_capacity_m3h: Math.round(preferredCapacityM3h),
        // PHI compliance
        ph_compliant:           phCompliant,
        hr_compliant:           hrCompliant,
        sfp_compliant:          sfpCompliant,
        boost_capable:          boostCapable,
        boost_required_m3h:     boostM3h || null,
        compliance_flags:       complianceFlags,
        // Scoring
        load_rating:            loadRating,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}
