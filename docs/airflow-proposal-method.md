# Provisional automatic airflow proposal

## Scope and authority

`buildAirflowProposal(project)` calculates one whole-dwelling proposal over the active option, all floors. It never writes room targets, terminal allocations or commissioning readings. Existing explicit values are shown separately. Proposal status is `provisional`, `incomplete` or `not-applicable`, never approved/certified. These are not achieved flows, per-unit duties or proof of sufficient fan capacity.

Two explicit, versioned profiles are supported. `legacy-studio-v1` retains the configurable Studio normal-demand policy; an absent profile always means legacy. `phpp-9.6a-standard-v1` implements the verified supplied workbook's standard single-unit maximum/normal/basic convention. Neither is a universal PHPP algorithm or certification. The PHPP profile is not validated for multi-unit systems or duty apportionment. Earlier user-provided Royston Park and Thebarton protocol room rates were manually entered; their room distributions are not evidence of an automatic allocation formula.

## Inputs and arithmetic

Standard reference candidates, all m³/h:
- Occupancy: reviewed whole-dwelling people × 30.
- Volume: reviewed TFA × 2.5 m × 0.3/h. Actual-geometry volume may instead be explicitly selected; it uses drawn parent rooms once and can include assumed heights. It is not PHPP reference volume or verified net air volume.
- Extract: selected extract spaces, using kitchen 60, bathroom 40, laundry mapped to utility 40, WC 20 and storage 20. Unsupported/ambiguous classifications require a reviewed override; ensuite, shower-only and combined kitchen/dining are not guessed.

**Legacy Studio profile (also the absent-profile default):** Normal is the maximum of the three complete candidates. Single-basis selection is configurable and explicitly does not enforce the other candidates. Low = normal × 0.7 and boost = normal × 1.3 by default. These parameters remain configurable assumptions.

**Explicit PHPP 9.6a standard profile:** Maximum = max(occupancy candidate, extract candidate, standard-volume candidate × 1.3). Standard/normal = maximum ÷ 1.3; basic = 0.7 × normal. Occupancy and extract candidates are not multiplied by 1.3 again. The profile fixes basis=max, volume source=PHPP reference, person rate=30, ACH=0.3, basic factor=0.7 and maximum factor=1.3. Omitted parameters receive these defaults; conflicting supplied values are rejected. Actual geometry and single-basis alternatives belong to the legacy profile, not this verified convention. Normal is not automatically the operating-hours-weighted energy-model average.

Reports expose `profile` and `method`, standard-reference `candidatesM3h`, separate `maximumCandidatesM3h`, and aliases `maximumM3h`/`boostM3h` and `basicM3h`/`lowM3h`. Legacy method remains `studio-provisional-residential-v1`; the PHPP method is `phpp-9.6a-standard-v1`. Occupied minimum ventilation and manufacturer limits remain separate checks.

Supply is distributed proportionally by current wall-reference room/zone area, or explicit weighting overrides. This is a Studio heuristic, not a PHI allocation rule or bedroom occupancy check. Extract is distributed proportionally by its reference weights. Each side independently sums to the same whole-dwelling duty. There is no terminal equal split. Unknown or stale active-space boundaries/roles, missing weighting inputs or selected demand inputs prevent final proposal rates. Transfer/none spaces have no mechanical proposal rate rather than an invented known zero. With zones, parent-room distribution is replaced by its zones, while actual volume counts parent geometry only once.

## Evidence and limits

- PHI residential volume guidance confirms TFA × 2.5 irrespective of actual height and the 0.3/h reference: https://passipedia.org/planning/building_services/ventilation/differentiation_between_vv_and_vn50_values
- PHI discusses 30 m³/h/person as a practical reference and warns against excessive ventilation: https://passipedia.org/planning/building_services/ventilation/basics/air_volumes
- PHI final-protocol example presents 60/40/20 extract categories and 180 m³/h nominal with 234 m³/h peak: https://passipedia.org/_media/picopen/final_protocol_worksheets_ventilation_example.pdf
- A different PHI PHPP 9.6 example has normal 117, extract reference 140 and maximum 152 m³/h. This demonstrates why maximum/normal conventions must not be silently conflated: https://cms.passivehouse.com/media/filer_public/f1/fb/f1fb15ce-c1a3-487e-9aa3-23c3d42cdff0/europhit_d24_balancingtoolforsbsretrofits_en_phi.pdf (PDF pp. 21–22).

The verified supplied PHPP 9.6a workbook's `Ventilation` sheet has `N65 = MAX(N59,N63,N9*0.3*1.3)` for maximum. `P72 = N72*$N$65`, N72 approximately 1/1.3, gives Standard; `P73 = N73*$N$65`, N73 approximately 0.7/1.3, gives Basic. P76 is a separate operating-hours-weighted average. Additional Vent allocations were inactive, so Studio room distributions are not workbook-validated. Report assumptions include this provenance without redistributing the workbook.

The final-protocol example's base 138.5 = 180/1.3 is only 23.1% below normal despite a 30%-below label. Studio deliberately calculates the requested minus 30% as 0.7×normal, not that inconsistent example arithmetic. Local requirements, climate, bedroom occupants, transfer paths, noise, pressure, moisture and multiple-unit distribution need review. No regulatory or certification conclusion is made.

## Persistence and tests

Settings remain in `project.airflowProposalSettingsByOption[optionId]`. Missing settings or absent `profile` mean legacy, with no silent profile selection or numerical change. Schema 29 is required: schema 28 migrates by changing only the schema number, preserving all stored targets, allocations, readings and absent-profile fields. Older clients reject schema 29 rather than misreading the PHPP profile as the legacy normal-demand rule. Save/export a backup before refreshing and avoid using old clients with updated work.

The `airflowProposal.setSettings` command is undoable. Switching options restores their own profile/settings; a newly duplicated option receives legacy defaults, avoiding invalid copied per-space weight identifiers. Selecting a profile does not apply its calculated targets. Calculated results are not persisted as approved targets.

The exact reviewed workbook fixture uses TFA 169.186135 m², occupants 4 and extract references kitchen60 + two bathrooms40 + WC20 =160 m³/h. Expected reference volume is 422.9653375 m³; maximum164.956481625, standard/normal126.88960125 and basic88.822720875 m³/h. Independent occupancy-governing and extract-governing tests catch an incorrect extra 1.3 multiplier. Tests cover schema migration, unknown/profile validation, manual/site preservation and review invalidation.

Legacy synthetic tests independently check 200 m² TFA / 4 people / one kitchen: candidates 150, 120 and 60; normal 150, low 105, boost 195. Two floors share that total, not 150 per floor. Tests cover actual volume, overrides, invalid inputs, stale/ambiguous spaces, option isolation, undo/reopen and no mutation of manual targets/readings.

## Explicit review and apply

`reviewAirflowProposal(project, selection)` is read-only and returns exact before/after room rates plus skipped existing inputs. The separate `airflowProposal.apply` command requires the reviewed option, selection and exact source-snapshot fingerprint. It refuses incomplete proposals, stale geometry/settings/targets, changed options/scopes and empty batches. Default fill-unset skips both known assigned room targets and any existing Normal terminal allocations, including partial allocations. Replacing existing room targets is a separate mode requiring explicit confirmation. It never rewrites terminal allocations, required targets or measurements; any retained terminal-allocation mismatch still needs review. Only Normal assigned targets receive the reviewed rates with proposal provenance; proposed low/boost duties do not become physical fan settings.

Apply is one undoable atomic command. Tests verify current-floor and whole-option scope, stale/replacement guards, no partial mutation and preserved measured evidence/terminal allocations. A newly applied target makes subsequent live-design schedules and the existing engineering-input workflow see that target, but does not certify the system or automatically split multi-terminal flows.
