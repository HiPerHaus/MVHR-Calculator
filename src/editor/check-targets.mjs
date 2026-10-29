import { inspectRoomBoundary, inspectZoneBoundary } from "../domain/rooms.mjs";

export function resolveDesignCheckTarget(project, target) {
  if (!target || !["component", "route", "room", "zone"].includes(target.kind) || typeof target.id !== "string") return null;
  if (target.kind === "component") {
    const value = project.components.find((candidate) => candidate.id === target.id);
    return value ? freezeResult(value, value.displayName ?? value.id, value.positionMm) : null;
  }
  if (target.kind === "route") {
    const value = project.routes.find((candidate) => candidate.id === target.id);
    if (!value || value.points.length === 0) return null;
    const centreMm = value.points.reduce((total, point) => ({ x: total.x + point.x / value.points.length, y: total.y + point.y / value.points.length }), { x: 0, y: 0 });
    return freezeResult(value, value.id, centreMm);
  }
  if (target.kind === "room") {
    const value = project.rooms.find((candidate) => candidate.id === target.id);
    if (!value) return null;
    const inspection = inspectRoomBoundary(project, value);
    return inspection.centroidMm ? freezeResult(value, value.name, inspection.centroidMm) : null;
  }
  const value = project.zones.find((candidate) => candidate.id === target.id);
  if (!value) return null;
  const inspection = inspectZoneBoundary(project, value);
  return inspection.centroidMm ? freezeResult(value, value.name, inspection.centroidMm) : null;
}

function freezeResult(value, label, centreMm) {
  return Object.freeze({ value, label, centreMm: Object.freeze({ x: centreMm.x, y: centreMm.y }) });
}
