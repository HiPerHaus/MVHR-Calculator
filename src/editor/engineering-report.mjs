import { evaluateEngineeringNetwork } from "./engineering-engine.mjs";

export function createEngineeringReport(project, floorId, mode = "normal") {
  const floor = project.floors.find(item => item.id === floorId);
  if (!floor) throw new TypeError(`Engineering report floor not found: ${floorId}`);
  const evaluation = evaluateEngineeringNetwork(project, floorId, mode);
  const option = project.designOptions.find(item => item.id === project.activeDesignOptionId);
  return deepFreeze({
    kind: "mvhr-engineering-report.v1",
    project: {
      id: project.id,
      name: project.projectDetails.name || null,
      reference: project.projectDetails.projectReference || null,
      designOptionId: project.activeDesignOptionId,
      designOptionName: option?.name ?? null,
      designOptionRevision: option?.revision ?? null,
    },
    floor: { id: floor.id, name: floor.name },
    mode,
    issue: {
      purpose: "preliminary-engineering-review",
      constructionStatus: "not-for-construction",
      commissioningStatus: "not-commissioned",
      calculationStatus: evaluation.status,
    },
    designInputs: evaluation.design,
    terminalAllocations: evaluation.allocations,
    roomAndZoneChecks: evaluation.spaceChecks.lines,
    routeResults: evaluation.routes,
    systemBoundaries: evaluation.boundaries,
    pathResults: evaluation.paths,
    criticalPathAndFanDuty: evaluation.streams,
    designFlowBalance: evaluation.balance,
    blockersAndWarnings: evaluation.diagnostics,
    assumptions: evaluation.assumptions,
    evidenceBoundary: evaluation.evidenceBoundary,
  });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
