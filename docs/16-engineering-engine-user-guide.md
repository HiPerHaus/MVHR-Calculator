# Preliminary engineering engine user guide

Status: local engineering review branch only. This capability is preliminary, deterministic and not released to production. It is not a construction design, compliance assessment or commissioning result.

## What a designer can operate

### Room requirements and design targets

1. Open the design option and floor to review.
2. In **Plan**, select a room or child zone and choose **Edit room**.
3. Enter the **Normal required** and **Normal assigned** airflow separately.
4. Choose L/s or m³/h and enter a basis and source for each known value.
5. Apply the edit. **Use required as assigned** only copies the value into the form; it does not save until Apply.

Normal room and zone targets are editable. Low and Boost are not separate room requirement presets in this version. In **Check → Engineering network**, a designer may create a Low or Boost terminal-allocation draft by entering an explicit factor against the assigned Normal target. The generated allocations remain editable and retain their source. A room with several terminals is not split automatically.

### Network calculation

1. Place and connect the relevant MVHR unit, outdoor intake, exhaust terminal, distribution components and room terminals.
2. Keep supply, extract, outdoor-air intake and exhaust connections correctly typed. Visual overlap is not a connection.
3. Open **Check → Engineering network · preliminary**.
4. Select **Normal**, **Low** or **Boost**. Enter the Low/Boost draft factor when required.
5. Choose **Create reviewed allocation draft**.
6. Review every terminal allocation. Enter a design target, basis, source and evidenced terminal loss, or leave it unresolved.
7. Open the route and component sections. Enter actual internal geometry, roughness, fitting K, additional loss and component-loss evidence. An explicit sourced zero is different from missing data.
8. Enter verified external-static fan curves only when their unit identity, handing/configuration, filter condition, source and version match the placed unit.
9. Choose **Save edited inputs**, then review errors and warnings. Upstream geometry or catalogue changes make bound evidence stale until it is reviewed and saved again.
10. Choose **Export readable report** for the preliminary review report or **Export data JSON** for the structured result.

## Calculation scope

- One active design option, one selected floor and one selected mode are evaluated at a time. There is no whole-project total across floors or options.
- Several independent units on that floor are grouped and reported separately. Their fan duties are not added together.
- Explicit terminal design allocations propagate through typed connections. They are design targets, not predicted or measured achieved airflow.
- Route velocity uses the saved internal cross-sectional area. Circular and rectangular area are calculated separately; hydraulic diameter is used for Reynolds number and friction.
- Design-flow pressure is calculated from the actual connected route network using saved route geometry and explicit resistance evidence. Shared sections are counted once on each path.
- Twin routes require either an explicit equal-flow assumption or two complete, monotonic, evidenced branch-loss curves. The unequal-branch solution conserves flow and equalizes pressure but does not replace terminal design targets.
- Supply and extract critical paths and required external static pressure are reported separately for each connected unit.
- Fan-duty screening interpolates only inside the verified external-static curve domain. It never extrapolates.
- The optional operating point is different: Studio intersects verified fan evidence with an externally calculated or tested whole-system pressure curve entered by the designer. Studio does **not** derive that optional whole-system curve from the drawn routes.
- General cyclic networks, unsupported loops, rectangular laminar flow and transitional Reynolds-number flow remain blocked rather than guessed.

## Hand-checkable synthetic demonstration

This demonstration verifies arithmetic only. It does not represent a real product.

Use one synthetic unit with one 10 L/s supply allocation and one 10 L/s extract allocation. Give each route one 8,000 mm-long circular run with 90 mm internal diameter, roughness 0.1 mm, fitting K = 0 and evidenced additional loss = 0 Pa. Use declared dry-air fixture values of density 1.2 kg/m³ and dynamic viscosity 0.000018 Pa·s.

For either route:

- Internal area = π × 0.09² / 4 = 0.0063617 m².
- Velocity = 0.010 / 0.0063617 = 1.5719 m/s.
- Reynolds number = 1.2 × 1.5719 × 0.09 / 0.000018 = 9,431.4.
- The implemented turbulent Haaland friction factor is 0.0327857.
- Dynamic pressure = 1.2 × 1.5719² / 2 = 1.4825 Pa.
- Straight-route loss = 0.0327857 × (8 / 0.09) × 1.4825 = 4.3205 Pa.
- With an independently entered 5 Pa terminal loss, that terminal-side subtotal is 9.3205 Pa.

Supply and extract assigned totals are each 10 L/s, so their arithmetic difference is 0 L/s. The result must still remain blocked if the outdoor intake/exhaust paths, inline component losses or verified fan evidence are missing. The sample in `docs/17-synthetic-preliminary-engineering-report.md` records that honest incomplete state.

## Product evidence needed next

Priority order for the present HiPer workflow:

1. **ComfoTube 90** — exact installed article/variant, verified internal diameter, pressure-loss or roughness basis, and loss evidence for bends, couplers and terminal connections. The available mixed-title 90/75 specification is not enough to generalize across current Flow 90.
2. **EPP mains** — internal diameters and configuration-specific losses for DN125/DN160 families, elbows, reducers/adapters, external grilles, filters and attenuators. Nominal size or outer diameter is not hydraulic evidence.
3. **ComfoAir Q / AeroFresh units** — applicable Australian external-static fan curves by exact unit, configuration, voltage/market, mode and filter condition. Isolated catalogue duty observations are not a complete interpolation domain.
4. **Luna terminals** — exact adjustment- and filter-specific loss curves for the installed article. A recommended maximum airflow does not define pressure loss.
5. **ComfoWell** — matching manifold and attenuator loss curves for the exact box, end plate, socket count and branch configuration. ComfoWell silencer evidence must not be applied as a universal manifold curve.
6. **Commissioning and balancing inputs** — reviewed terminal allocations, balancing-device settings and later measured results, kept separate from calculated design targets.

Every dataset needs a source, version, applicable product identity, configuration and review state. Missing product evidence remains unresolved; it is never stored as zero.

## Not implemented or not claimed

- Regulatory airflow compliance defaults or certified room-rate rules.
- Automatic per-terminal allocation for rooms with several terminals.
- A general looped-network nonlinear solver.
- Predicted achieved terminal flow from the drawn network.
- Automatic operating-point system curves derived from route calculations.
- Acoustics, noise transfer, installation clearance or fabrication validation.
- Whole-building aggregation across floors or alternative design options.
- Issued-for-construction or commissioning output.
