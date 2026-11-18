# Provisional automatic airflow proposal

## Scope and authority

`buildAirflowProposal(project)` calculates one whole-dwelling proposal over the active option, all floors. It never writes room targets, terminal allocations or commissioning readings. Existing explicit values are shown separately. Proposal status is `provisional`, `incomplete` or `not-applicable`, never approved/certified. These are not achieved flows, per-unit duties or proof of sufficient fan capacity.

This is a named Studio policy informed by Passive House principles, not a reproduction of a universal PHPP algorithm. Earlier user-provided Royston Park and Thebarton protocol room rates were manually entered; their room distributions are not evidence of an automatic allocation formula.

## Inputs and arithmetic

Default candidates, all m³/h:
- Occupancy: reviewed whole-dwelling people × 30.
- Volume: reviewed TFA × 2.5 m × 0.3/h. Actual-geometry volume may instead be explicitly selected; it uses drawn parent rooms once and can include assumed heights. It is not PHPP reference volume or verified net air volume.
- Extract: selected extract spaces, using kitchen 60, bathroom 40, laundry mapped to utility 40, WC 20 and storage 20. Unsupported/ambiguous classifications require a reviewed override; ensuite, shower-only and combined kitchen/dining are not guessed.

The default normal duty is the maximum of all three complete candidates. Single-basis selection is configurable and explicitly does not enforce the other candidates. Low = normal × 0.7 and boost = normal × 1.3 by default. These factors are configurable assumptions; occupied minimum ventilation and manufacturer limits remain separate checks.

Supply is distributed proportionally by current wall-reference room/zone area, or explicit weighting overrides. This is a Studio heuristic, not a PHI allocation rule or bedroom occupancy check. Extract is distributed proportionally by its reference weights. Each side independently sums to the same whole-dwelling duty. There is no terminal equal split. Unknown or stale active-space boundaries/roles, missing weighting inputs or selected demand inputs prevent final proposal rates. Transfer/none spaces have no mechanical proposal rate rather than an invented known zero. With zones, parent-room distribution is replaced by its zones, while actual volume counts parent geometry only once.

## Evidence and limits

- PHI residential volume guidance confirms TFA × 2.5 irrespective of actual height and the 0.3/h reference: https://passipedia.org/planning/building_services/ventilation/differentiation_between_vv_and_vn50_values
- PHI discusses 30 m³/h/person as a practical reference and warns against excessive ventilation: https://passipedia.org/planning/building_services/ventilation/basics/air_volumes
- PHI final-protocol example presents 60/40/20 extract categories and 180 m³/h nominal with 234 m³/h peak: https://passipedia.org/_media/picopen/final_protocol_worksheets_ventilation_example.pdf
- A different PHI PHPP 9.6 example has normal 117, extract reference 140 and maximum 152 m³/h. This demonstrates why maximum/normal conventions must not be silently conflated: https://cms.passivehouse.com/media/filer_public/f1/fb/f1fb15ce-c1a3-487e-9aa3-23c3d42cdff0/europhit_d24_balancingtoolforsbsretrofits_en_phi.pdf (PDF pp. 21–22).

The final-protocol example's base 138.5 = 180/1.3 is only 23.1% below normal despite a 30%-below label. Studio deliberately calculates the requested minus 30% as 0.7×normal, not that inconsistent example arithmetic. Local requirements, climate, bedroom occupants, transfer paths, noise, pressure, moisture and multiple-unit distribution need review. No regulatory or certification conclusion is made.

## Persistence and tests

Optional `project.airflowProposalSettingsByOption[optionId]` settings preserve old projects without migration; missing settings mean the labelled provisional defaults. The `airflowProposal.setSettings` command is undoable. Switching options restores their own settings; a newly duplicated option receives defaults, avoiding invalid copied per-space weight identifiers. Older clients may retain the optional map but cannot interpret it. Calculated results are not persisted as approved targets.

Synthetic tests independently check 200 m² TFA / 4 people / one kitchen: candidates 150, 120 and 60; normal 150, low 105, boost 195. Two floors share that total, not 150 per floor. Tests cover actual volume, overrides, invalid inputs, stale/ambiguous spaces, option isolation, undo/reopen and no mutation of manual targets/readings.

## Explicit review and apply

`reviewAirflowProposal(project, selection)` is read-only and returns exact before/after room rates plus skipped existing inputs. The separate `airflowProposal.apply` command requires the reviewed option, selection and exact source-snapshot fingerprint. It refuses incomplete proposals, stale geometry/settings/targets, changed options/scopes and empty batches. Default fill-unset skips both known assigned room targets and any existing Normal terminal allocations, including partial allocations. Replacing existing room targets is a separate mode requiring explicit confirmation. It never rewrites terminal allocations, required targets or measurements; any retained terminal-allocation mismatch still needs review. Only Normal assigned targets receive the reviewed rates with proposal provenance; proposed low/boost duties do not become physical fan settings.

Apply is one undoable atomic command. Tests verify current-floor and whole-option scope, stale/replacement guards, no partial mutation and preserved measured evidence/terminal allocations. A newly applied target makes subsequent live-design schedules and the existing engineering-input workflow see that target, but does not certify the system or automatically split multi-terminal flows.
