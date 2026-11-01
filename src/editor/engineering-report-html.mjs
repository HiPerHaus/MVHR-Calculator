import { createEngineeringReport } from "./engineering-report.mjs";

export function createEngineeringReportHtml(project, floorId, mode = "normal") {
  const report = createEngineeringReport(project, floorId, mode);
  const title = `${report.project.name ?? "HiPer Studio project"} · ${report.floor.name} · ${titleCase(mode)} engineering review`;
  const routeRows = report.routeResults.map(route => row([
    route.routeId,
    titleCase(route.stream),
    route.state,
    route.flowLps === 0 ? "0" : numberOrNotSet(route.flowLps),
    numberOrNotSet(route.velocityMps),
    numberOrNotSet(route.pressureLossPa),
    route.crossSection ? formatSection(route.crossSection) : "Not set",
    route.frictionRegime ?? "Not set",
    route.branchResults
      ? `${route.branchResults.map(branch => `${branch.id}: ${formatNumber(branch.flowLps)} L/s at ${formatNumber(branch.pressureLossPa)} Pa`).join("; ")}${route.parallelResistanceModel?.scope === "complete-branch-pressure-loss" ? " · complete branch curves" : ""}`
      : (route.parallelRunCount === 2 ? route.parallelFlowAssumption : "Single run"),
  ])).join("");
  const allocationRows = report.terminalAllocations.map(allocation => row([
    allocation.id,
    titleCase(allocation.stream),
    `${formatNumber(allocation.inputValue)} ${allocation.inputUnit === "m3/h" ? "m³/h" : "L/s"}`,
    `${formatNumber(allocation.valueLps)} L/s`,
    allocation.basis,
    allocation.source,
  ])).join("");
  const streamRows = Object.values(report.unitEngineering ?? {}).flatMap(unit => Object.values(unit.streams).map(stream => row([
    unit.unitComponentId,
    titleCase(stream.stream),
    `${formatNumber(stream.designFlowLps)} L/s`,
    `${formatNumber(stream.designFlowM3h)} m³/h`,
    numberOrNotSet(stream.requiredExternalStaticPressurePa),
    stream.fanDuty.state.replaceAll("-", " "),
    numberOrNotSet(stream.fanDuty.marginPa),
  ]))).join("");
  const operatingRows = Object.values(report.unitEngineering ?? {}).flatMap(unit => Object.values(unit.operatingPoints).map(result => row([
    unit.unitComponentId, titleCase(result.stream), result.state.replaceAll("-", " "),
    numberOrNotSet(result.airflowLps), numberOrNotSet(result.airflowM3h), numberOrNotSet(result.pressurePa),
    numberOrNotSet(result.residualPa), result.systemCurve?.basis ?? "Not configured", result.systemCurve?.source ?? "Not configured",
  ]))).join("");
  const balance = report.designFlowBalance ?? {};
  const balanceRows = row([
    titleCase(balance.state ?? "unresolved"),
    numberOrNotSet(balance.supplyLps),
    numberOrNotSet(balance.extractLps),
    numberOrNotSet(balance.differenceLps),
    balance.state === "arithmetically-balanced"
      ? "Arithmetic equality only; no compliance tolerance inferred"
      : "Review required; no compliance tolerance inferred",
  ]);
  const unitBalanceRows = Object.values(report.unitEngineering ?? {}).map(unit => row([
    unit.unitComponentId,
    titleCase(unit.balance.state),
    numberOrNotSet(unit.balance.supplyLps),
    numberOrNotSet(unit.balance.extractLps),
    numberOrNotSet(unit.balance.differenceLps),
    unit.balance.state === "arithmetically-balanced" ? "Arithmetic equality only" : "Review required",
  ])).join("");
  const boundaryRows = Object.values(report.systemBoundaries ?? {}).map(boundary => row([
    boundary.unitComponentId, titleCase(boundary.stream), boundary.role, boundary.state,
    boundary.routeIds.join(", ") || "Not resolved", boundary.componentIds.join(", ") || "None",
  ])).join("");
  const pathRows = (report.pathResults ?? []).map(path => row([
    path.allocationId, titleCase(path.stream), path.state,
    path.routeIds.join(", ") || "Not resolved", path.componentPassages?.map(item => `${item.componentId}/${item.passageId}`).join(", ") || path.inlineComponentIds?.join(", ") || "None",
    numberOrNotSet(path.pressureLossPa),
  ])).join("");
  const componentRows = (report.designInputs?.componentResistanceInputs ?? []).map(input => row([
    input.componentId, numberOrNotSet(input.pressureLoss?.valuePa), input.basis, input.source,
    input.componentConfigurationFingerprint ?? "Not bound — review required",
  ])).join("");
  const fanRows = (report.designInputs?.fanCurves ?? []).map(curve => row([
    curve.unitComponentId ?? "Not set", titleCase(curve.stream), curve.state,
    curve.pressureConvention ?? "Not set", curve.filterCondition ?? "Not set",
    curve.points.map(point => `${formatNumber(point.airflowM3h)} m³/h : ${formatNumber(point.externalStaticPressurePa)} Pa`).join("; ") || "No verified points",
    curve.basis ?? curve.reason, curve.source ?? "Not set",
  ])).join("");
  const blockers = report.blockersAndWarnings.length
    ? `<ol>${report.blockersAndWarnings.map(item => `<li><strong>${escapeHtml(item.code.replaceAll("-", " "))}</strong> — ${escapeHtml(item.message)}</li>`).join("")}</ol>`
    : "<p>No calculation blocker remains in the saved evidence. Technical review is still required.</p>";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
@page{size:A4 portrait;margin:15mm}body{font:12px/1.45 system-ui,sans-serif;color:#18323a;margin:0}header{border-bottom:3px solid #214f4b;margin-bottom:16px;padding-bottom:10px}h1{font-size:22px;margin:0 0 5px}h2{font-size:15px;margin:20px 0 7px}p{margin:5px 0}.status{border:2px solid #9b632b;background:#fff6e9;padding:10px;font-weight:700}.boundary{border-left:4px solid #55767c;padding:8px 10px;background:#f2f6f7}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #aebdc2;padding:5px;text-align:left;vertical-align:top}th{background:#e9f0f1}tr{break-inside:avoid}footer{margin-top:24px;border-top:1px solid #aebdc2;padding-top:8px;font-size:9px;color:#4f666e}@media print{button{display:none}}
</style></head><body>
<header><h1>${escapeHtml(title)}</h1><p>${escapeHtml(report.project.designOptionName ?? "Option")} · revision ${escapeHtml(report.project.designOptionRevision ?? "Working")}</p></header>
<p class="status">PRELIMINARY · REVIEW REQUIRED · NOT FOR CONSTRUCTION · NOT COMMISSIONED</p>
<h2>Calculation scope</h2><p>Mode: ${escapeHtml(titleCase(mode))}. Status: ${escapeHtml(report.issue.calculationStatus.replaceAll("-", " "))}.</p><p class="boundary">${escapeHtml(report.evidenceBoundary)}</p>
<p>Network basis: ${escapeHtml(report.designInputs?.basis ?? "Not set")} · source: ${escapeHtml(report.designInputs?.source ?? "Not set")} · version: ${escapeHtml(report.designInputs?.sourceVersion ?? "Not set")}.</p>
<h2>Terminal design allocations</h2><table><thead>${row(["Allocation", "Stream", "Declared input", "Canonical", "Basis", "Source"], "th")}</thead><tbody>${allocationRows || row(["No explicit allocations", "", "", "", "", ""])}</tbody></table>
<h2>Route design-flow results</h2><table><thead>${row(["Route", "Stream", "State", "Flow L/s", "Velocity m/s", "Loss Pa", "Cross-section", "Regime", "Parallel detail"], "th")}</thead><tbody>${routeRows || row(["No routes", "", "", "", "", "", "", "", ""])}</tbody></table>
<h2>Assigned design-flow balance</h2><table><thead>${row(["State", "Supply L/s", "Extract L/s", "Difference L/s", "Interpretation"], "th")}</thead><tbody>${balanceRows}</tbody></table>
<h2>Per-unit assigned design-flow balance</h2><table><thead>${row(["Unit", "State", "Supply L/s", "Extract L/s", "Difference L/s", "Interpretation"], "th")}</thead><tbody>${unitBalanceRows || row(["No unit groups", "", "", "", "", ""])}</tbody></table>
<h2>Per-unit critical path and fan-duty screening</h2><table><thead>${row(["Unit", "Stream", "Flow L/s", "Flow m³/h", "Required Pa", "Fan screening", "Margin Pa"], "th")}</thead><tbody>${streamRows || row(["Not calculated", "", "", "", "", "", ""])}</tbody></table>
<h2>Optional evidenced operating-point intersection</h2><p>This is separate from the prescribed design-flow evaluation. It is calculated only from current unit-bound fan evidence and a separately evidenced whole-system pressure curve with a shared bounded domain.</p><table><thead>${row(["Unit", "Stream", "State", "Flow L/s", "Flow m³/h", "Pressure Pa", "Residual Pa", "System basis", "System source"], "th")}</thead><tbody>${operatingRows || row(["Not configured", "", "", "", "", "", "", "", ""])}</tbody></table>
<h2>Outdoor system boundaries</h2><table><thead>${row(["Unit", "Stream", "Boundary", "State", "Routes", "Components"], "th")}</thead><tbody>${boundaryRows || row(["Not calculated", "", "", "", "", ""])}</tbody></table>
<h2>Path composition</h2><table><thead>${row(["Allocation", "Stream", "State", "Routes counted once", "Inline components", "Loss Pa"], "th")}</thead><tbody>${pathRows || row(["Not calculated", "", "", "", "", ""])}</tbody></table>
<h2>Component loss evidence</h2><table><thead>${row(["Component", "Loss Pa", "Basis", "Source", "Configuration binding"], "th")}</thead><tbody>${componentRows || row(["No component-loss inputs", "", "", "", ""])}</tbody></table>
<h2>Fan evidence</h2><table><thead>${row(["Unit", "Stream", "State", "Convention", "Filter condition", "Verified points", "Basis", "Source"], "th")}</thead><tbody>${fanRows || row(["No fan evidence", "", "", "", "", "", "", ""])}</tbody></table>
<h2>Assumptions</h2><p>Air density: ${numberOrNotSet(report.assumptions?.densityKgM3)} kg/m³. Dynamic viscosity: ${numberOrNotSet(report.assumptions?.dynamicViscosityPaS)} Pa·s.</p><p>${escapeHtml(report.assumptions?.basis ?? "Not set")} · source: ${escapeHtml(report.assumptions?.source ?? "Not set")}</p>
<h2>Blocking unknowns and review items</h2>${blockers}
<footer>Generated from the current working project state, which may include unsaved draft edits. Prescribed design-flow results do not predict achieved airflow. Any separately shown operating point is only the bounded intersection of the stated evidenced fan and whole-system curves; it is not terminal-flow prediction, compliance or commissioning.</footer>
</body></html>`;
}

function formatSection(section) {
  return section.shape === "circular"
    ? `Circular Ø${formatNumber(section.internalDiameterMm)} mm`
    : `Rectangular ${formatNumber(section.internalWidthMm)} × ${formatNumber(section.internalHeightMm)} mm`;
}
function row(values, tag = "td") { return `<tr>${values.map(value => `<${tag}>${escapeHtml(String(value ?? ""))}</${tag}>`).join("")}</tr>`; }
function numberOrNotSet(value) { return value === null || value === undefined ? "Not calculated" : formatNumber(value); }
function formatNumber(value) { return Number(value.toFixed(3)).toLocaleString("en-AU"); }
function titleCase(value) { return String(value).replaceAll("-", " ").replace(/\b\w/gu, letter => letter.toUpperCase()); }
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
