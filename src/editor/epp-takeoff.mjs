import { routeLengthSummary } from "../domain/spatial.mjs";

export const EPP_TAKEOFF_POLICY = Object.freeze({
  stockLengthMm: 1000,
  includedSocketsPerLength: 1,
  extraSleevesPerBend: 1,
  halves45PerElbow90: 2,
  angleToleranceDegrees: 0.5,
  source: "owner-EPP-socket-and-elbow-sleeve-rule-2026-10-23",
});

// A material allowance from saved control points, never extra placed fittings or pressure losses.
export function deriveEppTakeoff(routes) {
  return routes.filter(route => /^epp-rigid-dn(125|160)$/.test(route.ductKind)).map(route => {
    const size = Number(route.ductKind.match(/dn(\d+)$/)[1]);
    const length = routeLengthSummary(route);
    const developed = length.developedMm !== null;
    const points = route.points.map(p => [p.x, p.y, developed ? p.z.valueMm : 0]);
    const segments = points.slice(1).map((point, i) => point.map((v, axis) => v - points[i][axis]))
      .filter(vector => Math.hypot(...vector) > 1e-6);
    const bends = { degrees90: 0, degrees45: 0, other: 0 };
    for (let i = 1; i < segments.length; i++) {
      const a = segments[i - 1], b = segments[i];
      const cosine = a.reduce((sum, v, axis) => sum + v * b[axis], 0) / (Math.hypot(...a) * Math.hypot(...b));
      const angle = Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
      if (angle <= EPP_TAKEOFF_POLICY.angleToleranceDegrees) continue;
      if (Math.abs(angle - 90) <= EPP_TAKEOFF_POLICY.angleToleranceDegrees) bends.degrees90++;
      else if (Math.abs(angle - 45) <= EPP_TAKEOFF_POLICY.angleToleranceDegrees) bends.degrees45++;
      else bends.other++;
    }
    const centrelineMm = length.developedMm ?? length.projectedMm;
    const stockPerRun = Math.ceil(Math.max(0, centrelineMm / EPP_TAKEOFF_POLICY.stockLengthMm - 1e-9));
    const bendCount = bends.degrees90 + bends.degrees45 + bends.other;
    const runs = route.parallelRunCount;
    const count = value => runs === null || runs === undefined ? null : value * runs;
    return {
      routeId: route.id, stream: route.stream, nominalSizeMm: size,
      basis: developed ? "developed-centreline-allowance" : "plan-only-allowance",
      parallelRunCount: runs ?? null, centrelinePerRunMm: centrelineMm,
      totalCentrelineMm: count(centrelineMm), stockLengthsPerRun: stockPerRun,
      stockLengthQuantity: count(stockPerRun), includedSocketQuantity: count(stockPerRun),
      bendsPerRun: bends, bendQuantity: count(bendCount),
      elbow90Quantity: count(bends.degrees90), elbow45Quantity: count(bends.degrees45),
      otherBendQuantity: count(bends.other), extraSleeveQuantity: count(bendCount),
      productReferences: { straight: `AER-DUC-DN${size}-1MSL`, elbow90: `AER-DUC-DN${size}-B90`, sleeve: `AER-DUC-DN${size}-SL` },
      reviewRequired: !developed || bends.other > 0 || runs == null,
      note: "1 m stock lengths rounded up per route and multiplied by run count. One socket included per length; one additional sleeve allowed per bend. No elbow take-out, socket insertion, offcut reuse, waste, endpoint bends or extra adapters inferred. 45° bends are 90° elbows cut in half. Other bends require product selection. This allowance is separate from placed parts.",
    };
  });
}

export function deriveEppElbowStock(lines) {
  const groups = new Map();
  for (const line of lines) {
    if (!groups.has(line.nominalSizeMm)) groups.set(line.nominalSizeMm,{nominalSizeMm:line.nominalSizeMm,full90Quantity:0,half45Quantity:0,pendingRouteCount:0});
    const group = groups.get(line.nominalSizeMm);
    if (line.parallelRunCount === null) { group.pendingRouteCount++; continue; }
    group.full90Quantity += line.elbow90Quantity;
    group.half45Quantity += line.elbow45Quantity;
  }
  return [...groups.values()].sort((a,b)=>a.nominalSizeMm-b.nominalSizeMm).map(group=>({...group,
    elbow90StockQuantity:group.full90Quantity+Math.ceil(group.half45Quantity/2),
    spareHalfQuantity:group.half45Quantity%2,
  }));
}


export const HRV_EPP_CONNECTION_ALLOWANCE_POLICY = Object.freeze({
  ductLengthMm: 1000, elbow90Quantity: 1, sleeveQuantity: 4,
  basis: "provisional-unit-to-ceiling-allowance",
  source: "owner-HRV-port-ceiling-allowance-2026-10-23",
});

// Count each connected physical unit port once, independently of route vertices/run count.
// This does not supply missing installation elevations or add fictitious route geometry.
export function deriveHrvEppConnectionAllowances(routes, components) {
  const units = new Map(components.filter(component => {
    const roles = new Set(component.ports.filter(port => port.system === "mvhr").map(port => port.role));
    return ["Dwelling supply", "Dwelling extract", "Outdoor intake", "Outdoor exhaust"].every(role => roles.has(role));
  }).map(component => [component.id, component]));
  const allowances = new Map();
  for (const route of routes.filter(route => /^epp-rigid-dn(125|160)$/.test(route.ductKind))) {
    const size = Number(route.ductKind.match(/dn(\d+)$/)[1]);
    for (const endpoint of [route.startAttachment, route.endAttachment].filter(Boolean)) {
      const unit = units.get(endpoint.componentId);
      const port = unit?.ports.find(port => port.id === endpoint.portId);
      if (!port || port.system !== "mvhr" || port.interface?.nominalSizeMm !== size) continue;
      const key = `${unit.id}\u0000${port.id}`;
      if (allowances.has(key)) continue;
      allowances.set(key, {
        componentId: unit.id, componentName: unit.displayName ?? unit.id, portId: port.id,
        portRole: port.role, routeId: route.id, stream: port.stream, nominalSizeMm: size,
        basis: HRV_EPP_CONNECTION_ALLOWANCE_POLICY.basis, parallelRunCount: 1,
        ductLengthMm: HRV_EPP_CONNECTION_ALLOWANCE_POLICY.ductLengthMm,
        stockLengthQuantity: 1, includedSocketQuantity: 1,
        elbow90Quantity: HRV_EPP_CONNECTION_ALLOWANCE_POLICY.elbow90Quantity, elbow45Quantity: 0,
        extraSleeveQuantity: HRV_EPP_CONNECTION_ALLOWANCE_POLICY.sleeveQuantity,
        reviewRequired: true,
        note: "Additional allowance per EPP-connected HRV/ERV port: 1 m duct, one 90° elbow and four loose sleeves. The length includes its own socket. Four sleeves are the complete port allowance; no fifth sleeve is added for this allowance elbow. Replace/reconcile this allowance when actual equipment and ceiling heights are designed; it is not measured route geometry.",
      });
    }
  }
  return [...allowances.values()];
}

// Project purchasing totals combine streams and floors before rounding stock.
export function deriveEppProjectTotals(project) {
  const lines = [...deriveEppTakeoff(project.routes), ...deriveHrvEppConnectionAllowances(project.routes, project.components)];
  const elbows = deriveEppElbowStock(lines);
  return [...new Set(lines.map(line => line.nominalSizeMm))].sort((a,b) => a-b).map(nominalSizeMm => {
    const group = lines.filter(line => line.nominalSizeMm === nominalSizeMm);
    const known = group.filter(line => line.parallelRunCount !== null);
    const knownTotalLengthMm = known.reduce((sum,line) => sum + (line.totalCentrelineMm ?? line.ductLengthMm ?? 0), 0);
    const pendingCount = group.length - known.length;
    return {
      nominalSizeMm, knownTotalLengthMm, totalLengthMm: pendingCount ? null : knownTotalLengthMm, pendingCount,
      stockLengthQuantity: Math.ceil(knownTotalLengthMm / EPP_TAKEOFF_POLICY.stockLengthMm),
      elbow90StockQuantity: elbows.find(line => line.nominalSizeMm === nominalSizeMm)?.elbow90StockQuantity ?? 0,
      extraSleeveQuantity: known.reduce((sum,line) => sum + line.extraSleeveQuantity, 0),
      otherBendQuantity: known.reduce((sum,line) => sum + (line.otherBendQuantity ?? 0), 0),
    };
  });
}
