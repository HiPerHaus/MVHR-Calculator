import { validateProject } from '../domain/spatial.mjs';
// One validation per immutable snapshot, rather than one per displayed part.
export function buildTerminalAssignmentIndex(project) {
  validateProject(project);
  const assignments = new Map();
  for (const room of project.rooms) for (const association of room.terminalAssociations) {
    assignments.set(association.componentId, {roomId:room.id,...association});
  }
  for (const zone of project.zones) for (const association of zone.terminalAssociations) {
    assignments.set(association.componentId, {zoneId:zone.id,...association});
  }
  return assignments;
}
