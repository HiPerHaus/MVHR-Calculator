export function createDesignCheckSummary(audit, airflow) {
  const errors = [];
  const warnings = [];
  const notCalculated = [];
  for (const item of audit.diagnostics) {
    const normalized = normalizeAuditDiagnostic(item);
    if (item.severity === "error") errors.push(normalized);
    else if (item.severity === "warning") warnings.push(normalized);
    else notCalculated.push(normalized);
  }

  const linesById = new Map(airflow.lines.map((line) => [line.id, line]));
  for (const id of airflow.missingAssignedTargetSpaceIds) {
    const line = linesById.get(id);
    warnings.push(spaceIssue("assigned-target-unresolved", "Assigned target is not set", line, "Enter an explicit Normal assigned design target. No airflow is inferred."));
  }
  for (const id of airflow.targetWithoutTerminalSpaceIds) {
    const line = linesById.get(id);
    warnings.push(spaceIssue("target-without-terminal", "Assigned target has no terminal", line, "Associate a matching supply or extract terminal, or review the service assignment."));
  }
  for (const id of airflow.terminalWithoutTargetSpaceIds) {
    const line = linesById.get(id);
    warnings.push(spaceIssue("terminal-without-target", "Associated terminal has no assigned target", line, "Enter an explicit Normal assigned design target. No allocation is inferred."));
  }
  for (const terminal of airflow.unassignedTerminals) {
    warnings.push(Object.freeze({
      id: `terminal-association:${terminal.componentId}`,
      code: "terminal-association-missing",
      severity: "warning",
      title: "Terminal is not associated with a room or zone",
      detail: `${terminal.componentName} needs a reviewed room or zone association.`,
      target: Object.freeze({ kind: "component", id: terminal.componentId }),
    }));
  }

  notCalculated.push(Object.freeze({
    id: "network-pressure:not-calculated",
    code: "network-pressure-not-calculated",
    severity: "info",
    title: "Network pressure is not calculated",
    detail: "The current milestone records evidence and explicit inputs only; it does not solve network pressure loss.",
    target: null,
  }));

  if (audit.parts.componentCount === 0 && audit.routes.routeCount === 0) {
    warnings.unshift(Object.freeze({
      id: "ventilation-model:empty",
      code: "ventilation-model-empty",
      severity: "warning",
      title: "No ventilation model to assess",
      detail: "Place typed equipment, terminals and routes before connection coverage can be assessed.",
      target: null,
    }));
  }

  return deepFreeze({
    groups: { errors, warnings, notCalculated },
    counts: { errors: errors.length, warnings: warnings.length, notCalculated: notCalculated.length },
    status: errors.length > 0 ? "errors" : warnings.length > 0 ? "warnings" : "review-only",
    evidenceBoundary: "Grouped presentation of existing model audits and explicit room targets only. It is not a compliance, pressure, airflow-delivery, product-fit or installation verdict.",
  });
}

function normalizeAuditDiagnostic(item) {
  return Object.freeze({
    id: item.id,
    code: item.code,
    severity: item.severity,
    title: item.title,
    detail: item.detail,
    target: targetFromDiagnostic(item),
  });
}

function targetFromDiagnostic(item) {
  if (item.componentId) return Object.freeze({ kind: "component", id: item.componentId });
  if (item.routeId) return Object.freeze({ kind: "route", id: item.routeId });
  return null;
}

function spaceIssue(code, title, line, detail) {
  const kind = line?.kind === "zone" ? "zone" : "room";
  return Object.freeze({
    id: `${code}:${line?.id ?? "missing"}`,
    code,
    severity: "warning",
    title,
    detail: `${line?.name ?? "Unknown space"}: ${detail}`,
    target: line ? Object.freeze({ kind, id: line.id }) : null,
  });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
