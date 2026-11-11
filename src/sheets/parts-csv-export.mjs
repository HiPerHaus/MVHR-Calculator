import { normalizeVentilationWorkspace, ventilationWorkspaceLabel } from "../editor/ventilation-workspace.mjs";
import { createPartsSchedule } from "../editor/parts-schedule.mjs";
import { partsListRows } from "./a4-parts-list.mjs";
import { reportFloorName } from "./a3-sheet.mjs";

export const PARTS_CSV_COLUMNS = Object.freeze([
  ["projectName", "Project"], ["projectReference", "Project reference"],
  ["optionName", "Design option"], ["revision", "Working revision"],
  ["exportedAt", "Exported at (UTC)"], ["scope", "Quantity scope"],
  ["floorName", "Floor"], ["section", "Section"], ["kind", "Row type"],
  ["ref", "Reference"], ["partNumber", "Product code / reference"],
  ["description", "Description"], ["quantity", "Quantity"], ["unit", "Unit"],
  ["basis", "Quantity / pack / allowance basis"], ["review", "Review / unresolved items"],
].map(column => Object.freeze(column)));

const BOUNDARY = "Preliminary working draft; not for construction. No prices. Product identity, availability and installation compatibility require review. Assembly references, cut pieces and measured routes are not additional purchase quantities. This is not an engineering or commissioning report.";

/** Export only the active option. All floors share project packs exactly once. */
export function createPartsCsvRows(project, { projectName, systemScope = "combined", exportedAt = new Date().toISOString() } = {}) {
  normalizeVentilationWorkspace(systemScope);
  const option = project.designOptions.find(candidate => candidate.id === project.activeDesignOptionId);
  if (!option) throw new TypeError("An active design option is required for parts export");
  const metadata = {
    projectName: projectName || project.projectDetails.name || "Untitled project",
    projectReference: project.projectDetails.projectReference || "",
    optionName: option.name, revision: option.revision, exportedAt,
  };
  const schedules = project.floors.map(floor => createPartsSchedule(project, { floorId: floor.id, systemScope }));
  const rows = [{ ...metadata, scope: `Active option / all floors / ${ventilationWorkspaceLabel(systemScope)}`, section: "Export scope", kind: "note", description: BOUNDARY, basis: "Committed model records only. Other design options and systems outside the selected export scope are excluded. The complete saved design is unchanged. Unsaved form fields are excluded." }];
  for (const schedule of schedules) {
    const floor = { ...metadata, floorName: reportFloorName(schedule.floorName) };
    let section = "";
    for (const row of partsListRows(schedule)) {
      if (row.section) { section = row.description; continue; }
      const component = schedule.componentLines.find(line => line.ref === row.ref);
      const projectScoped = ["JOB", "90", "EPP"].includes(row.ref);
      const issues = component ? schedule.unresolved.filter(item => item.ref === row.ref).map(item => item.detail) : [];
      if (/pending|not set/i.test(row.quantity)) issues.push("Quantity is incomplete; pending values are not zero.");
      if (row.kind === "selection") issues.push("Product or connection selection is required before ordering.");
      if (row.kind === "part" && (!row.partNumber || row.localSupply)) issues.push("Local supply or unmatched product reference: confirm the order code and availability.");
      if (row.ref === "EPP") {
        if (schedules.some(item => item.eppTakeoff.some(line => line.reviewRequired))) issues.push("Some EPP routes have unresolved height, run count or bend selection; review measured-route and unresolved rows.");
        if (schedules.some(item => item.eppUnitConnectionAllowances.length)) issues.push("Reconcile provisional HRV-to-ceiling allowances with the actual installation.");
      }
      rows.push({ ...floor, scope: projectScoped ? "Active option / all floors (counted once)" : "Floor", section,
        kind: row.kind, ref: row.ref, partNumber: row.partNumber, description: row.description,
        quantity: row.quantity, unit: row.unit, basis: rowBasis(row, schedule, component),
        review: issues.join(" ") || "Review product selection and installation suitability before ordering.",
      });
    }
    for (const line of schedule.routeLines) {
      rows.push({ ...floor, scope: "Floor", section: "Measured duct routes (not extra stock)", kind: "route-measurement", ref: line.ref,
        description: `${line.description} · ${line.stream}`, quantity: pendingMetres(line.knownMultipliedPlanMm, line.pendingParallelRunRouteCount), unit: "m-plan",
        basis: schedule.lengthBasis,
        review: line.pendingParallelRunRouteCount ? "Single/Twin run count unresolved; known subtotal only." : "Plan length only; stock and allowances are listed separately.",
      });
      if (line.unknownDevelopedRouteCount) {
        rows.push({ ...floor, scope: "Floor", section: "Measured duct routes (not extra stock)", kind: "route-measurement", ref: line.ref,
          description: `${line.description} · ${line.stream} · developed length`, quantity: "Pending", unit: "m-developed",
          basis: "Developed route length requires explicit elevations and Single/Twin run count for every route in this group.", review: "Unknown developed length is not zero. See unresolved items.",
        });
      } else {
        rows.push({ ...floor, scope: "Floor", section: "Measured duct routes (not extra stock)", kind: "route-measurement", ref: line.ref,
          description: `${line.description} · ${line.stream} · developed length`, quantity: metres(line.developedQuantityMm), unit: "m-developed",
          basis: "Saved 3D control-polyline length multiplied by Single/Twin count; separate from supplier stock and installation allowances.", review: "Not a cut length or fabrication schedule.",
        });
      }
    }
    const unresolved = [...schedule.unresolved,
      ...schedule.eppTakeoff.filter(line => line.reviewRequired).map(line => ({ code: "epp-allowance-review", ref: line.routeId, detail: `${line.basis}: ${line.note}` })),
      ...schedule.eppUnitConnectionAllowances.map(line => ({ code: "hrv-connection-allowance-review", ref: line.routeId, detail: line.note })),
      ...schedule.decentralisedSystems.diagnostics.map(item => ({ code: item.code, ref: item.componentId, detail: item.detail })),
    ];
    for (const issue of unresolved) rows.push({ ...floor, scope: "Floor", section: "Unresolved items", kind: "unresolved", ref: issue.ref, description: issue.detail, basis: issue.code, review: "Review required" });
  }
  return rows;
}

export function createPartsCsv(project, options) {
  return serializePartsCsv(createPartsCsvRows(project, options));
}

export function serializePartsCsv(rows) {
  const records = [PARTS_CSV_COLUMNS.map(([, label]) => label), ...rows.map(row => PARTS_CSV_COLUMNS.map(([key]) => row[key] ?? ""))];
  // BOM lets Excel detect UTF-8. Quoting and CRLF preserve commas, quotes and line breaks.
  return `\uFEFF${records.map(record => record.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function partsCsvFileName(projectName, optionName) {
  const stem = `${projectName || "HiPer Studio"}-${optionName || "option"}-parts`
    .normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 120);
  return `${stem || "HiPer-Studio-parts"}.csv`;
}

function csvCell(value) {
  let text = String(value);
  // CSV quoting alone does not prevent spreadsheet formulas. Treat all untrusted text as text.
  if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/gu, '""')}"`;
}

function metres(mm) { return (mm / 1000).toFixed(3); }
function pendingMetres(mm, pending) { return pending ? (mm > 0 ? `${metres(mm)} + pending` : "Pending") : metres(mm); }

function rowBasis(row, schedule, component) {
  const a = schedule.projectAccessories;
  if (row.kind === "assembly") return "Assembly reference only. Its separately listed components carry purchase quantities; do not order the assembly again.";
  if (row.kind === "summary") return "Reference summary only; not an additional purchase quantity.";
  if (row.kind === "cut-piece") return "Unused CW branch stub; already included in the project DN90 coil total. Do not add to stock a second time.";
  if (row.kind === "decentralised-cable") return schedule.decentralisedCableLines.find(line => line.ref === row.ref)?.quantityBasis || "Marked plan route only; no installation allowance.";
  if (component) return "Persisted placed-component count on this floor. Product code/reference does not establish regional compatibility.";
  if (row.partNumber === "ZEN-CT90-50M") return `${metres(a.duct90.drawnLengthMm)} m known drawn plan length + ${metres(a.duct90.stubTotalMm)} m known unused-CW stubs = ${metres(a.duct90.knownTotalLengthMm)} m known subtotal; round up to ${a.duct90.coilLengthMm / 1000} m coils across all floors. Rises, drops and waste are not inferred.`;
  if (row.partNumber === "ZEN-OR90") return `${a.oRingQuantity} known O-rings, one per CW branch and connected 90 mm terminal duct; round up to packs of 10 across all floors${a.pendingORings ? "; some connections are pending" : ""}.`;
  if (row.partNumber === "AER-GR-FILT-DN125") return `One filter per extract point (${a.extractPointQuantity} total); round up to bags of 10 across all floors.`;
  if (row.partNumber === "ZEN-C90-CSET") return "Standard allowance of three per active design option/job; counted once across all floors.";
  if (row.ref === "EPP") return "Combine known EPP lengths across streams and floors, then round up to 1 m stock. Use developed length when known, otherwise plan only. One socket per stock length; one additional sleeve per route bend. Pair 45° halves into 90° elbow stock. Add per EPP-connected HRV port: 1 m, one 90° elbow, four sleeves. No waste, take-out or offcut optimization inferred.";
  if (row.ref === "HRV") return a.basis;
  if (row.ref === "CW") return "Derived from the selected mounted or standalone CW assembly configuration on this floor; separately listed components, not additional assemblies.";
  if (row.ref === "TERM") return "Derived terminal components; housing follows the explicit saved entry or Single/Twin selection. Pending selections remain unresolved.";
  return row.description;
}
