import { validateProject } from "../domain/spatial.mjs";
import { inspectAirflowBalance } from "./airflow-balance.mjs";
import { inspectConnectionAccessoryEvidence } from "./connection-accessory-evidence.mjs";
import { createPartsSchedule } from "./parts-schedule.mjs";
import { inspectSizingPressureEvidence } from "./sizing-pressure-evidence.mjs";

/**
 * Deterministic installer-document data foundation. It is intentionally a
 * working-draft data pack, not a released PDF or installation instruction.
 */
export function createInstallerDocumentFoundation(project, floorId) {
  validateProject(project);
  const floor = project.floors.find((candidate) => candidate.id === floorId);
  if (!floor) throw new TypeError(`Installer-document floor not found: ${String(floorId)}`);
  const airflow = inspectAirflowBalance(project, floorId);
  const schedule = createPartsSchedule(project, { floorId });
  const connections = inspectConnectionAccessoryEvidence(project, floorId);
  const sizing = inspectSizingPressureEvidence(project, floorId);
  const componentById = new Map(project.components.map((component) => [component.id, component]));

  const airflowSchedule = airflow.lines.map((line) => ({
    spaceKind: line.kind,
    spaceId: line.id,
    roomLabel: line.name,
    role: line.ventilationRole,
    required: structuredClone(line.required),
    assigned: structuredClone(line.assigned),
    terminalIds: [...line.terminalIds],
    predicted: null,
    measured: null,
  }));
  const commissioningRows = airflow.lines.flatMap((line) => line.terminalIds.map((componentId) => ({
    spaceId: line.id,
    roomLabel: line.name,
    terminalId: componentId,
    terminalLabel: componentById.get(componentId)?.displayName ?? componentId,
    issuedTargetReference: null,
    designAssignedTarget: structuredClone(line.assigned),
    measuredNormalAirflow: null,
    measuredBoostAirflow: null,
    instrumentReference: null,
    calibrationReference: null,
    measuredBy: null,
    measuredAt: null,
    result: null,
  })));
  const blockers = [
    ...(sizing.status !== "review-required" ? ["Pressure/unit-duty evidence is incomplete."] : []),
    ...(schedule.unresolved.length > 0 ? ["The materials schedule contains unresolved product or quantity evidence."] : []),
    ...(connections.summary.unresolvedRequirementCount > 0 ? ["Installation connection/accessory evidence remains unresolved."] : []),
    "No immutable design snapshot or issued drawing revision is selected for this working draft.",
  ];

  return deepFreeze({
    kind: "installer-document-foundation",
    status: "working-draft-incomplete",
    projectId: project.id,
    floorId,
    floorName: floor.name,
    sourceDesignSnapshotId: null,
    issuedDrawingRevision: null,
    airflowSchedule,
    materialsSchedule: structuredClone(schedule),
    unitDutyAndPressure: structuredClone(sizing),
    connectionEvidence: structuredClone(connections),
    commissioningRows,
    blockers,
    evidenceBoundary: "This deterministic data pack is not an issued installer document, construction instruction, technical approval or commissioning record. Predicted and measured airflow remain blank; targets are never copied into measurement fields.",
  });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
