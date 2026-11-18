/** Saved design inputs are retained, but detached geometry is not a current design. */
export function spaceBoundaryNeedsReassignment(project, space) {
  return space.boundaryState === "reassignment-required" ||
    Boolean(space.parentRoomId && project.rooms.find(room => room.id === space.parentRoomId)?.boundaryState === "reassignment-required");
}
