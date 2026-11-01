# Synthetic preliminary engineering report

**Purpose:** deterministic algorithm review only  
**Status:** PRELIMINARY · REVIEW REQUIRED · NOT FOR CONSTRUCTION · NOT COMMISSIONED  
**Design option:** Synthetic Option A  
**Floor:** Synthetic Ground Floor  
**Mode:** Normal  
**Scope:** one active design option, one selected floor, one selected mode

## Declared inputs

| Input | Supply | Extract |
|---|---:|---:|
| Terminal design allocation | 10 L/s | 10 L/s |
| Route arrangement | Single | Single |
| Developed route length | 8,000 mm | 8,000 mm |
| Internal cross-section | Circular Ø90 mm | Circular Ø90 mm |
| Roughness | 0.1 mm | 0.1 mm |
| Fitting K total | 0 | 0 |
| Additional route loss | 0 Pa, explicitly evidenced for this fixture | 0 Pa, explicitly evidenced for this fixture |
| Terminal loss | 5 Pa, synthetic fixture | 5 Pa, synthetic fixture |

Declared air properties are density 1.2 kg/m³ and dynamic viscosity 0.000018 Pa·s. All inputs are synthetic and have no manufacturer applicability.

## Deterministic route result

| Result | Supply | Extract |
|---|---:|---:|
| Internal area | 0.0063617 m² | 0.0063617 m² |
| Velocity | 1.5719 m/s | 1.5719 m/s |
| Reynolds number | 9,431.4 | 9,431.4 |
| Regime / method | Turbulent / Haaland | Turbulent / Haaland |
| Darcy friction factor | 0.0327857 | 0.0327857 |
| Dynamic pressure | 1.4825 Pa | 1.4825 Pa |
| Straight-route loss | 4.3205 Pa | 4.3205 Pa |
| Terminal-side route + declared terminal loss subtotal | 9.3205 Pa | 9.3205 Pa |

Assigned design-flow balance is 10 L/s supply minus 10 L/s extract = 0 L/s. This is arithmetic equality only; it is not a compliance or balancing tolerance result.

## Blocking unknowns

- Outdoor intake and exhaust paths are not defined in this abbreviated fixture.
- Inline component and system-boundary losses are not defined.
- Exact-product external-static fan curves and filter conditions are not supplied.
- Required fan duty and fan margin are therefore **Not calculated**.
- An operating point is **Not configured**. Studio has not derived a whole-system curve from these drawn routes.
- Achieved terminal airflow, commissioning values and compliance are not predicted.

## Review boundary

The calculated route values above are hand-checkable synthetic evidence for the deterministic formulas. A real project must bind current route geometry and exact product/configuration evidence before a preliminary result can be reviewed. Any alternative design option, other floor or other operating mode requires its own evaluation and report.
