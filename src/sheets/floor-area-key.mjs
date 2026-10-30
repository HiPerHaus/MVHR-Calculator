import { inspectFloorAreaOutline } from "../domain/floor-area.mjs";
import { inspectRoomBoundary } from "../domain/rooms.mjs";

export function inspectSheetFloorArea(project, floorId) {
  const outline = project.floorAreaOutlines.find((candidate) => candidate.floorId === floorId);
  if (outline) {
    const areaMm2 = inspectFloorAreaOutline(outline).areaMm2;
    return freezeSummary({
      status: "known",
      source: "floor-outline",
      areaMm2,
      heading: "Floor area",
      basisLabel: "Preliminary closed-plan outline",
      outlineId: outline.id,
      roomCount: 0,
      unresolvedRoomCount: 0,
    });
  }

  const rooms = project.rooms.filter((room) => room.floorId === floorId);
  const inspections = rooms.map((room) => inspectRoomBoundary(project, room));
  const known = inspections.filter((inspection) => inspection.status === "current");
  const unresolvedRoomCount = inspections.length - known.length;
  if (known.length) {
    const areaMm2 = known.reduce((total, inspection) => total + inspection.areaMm2, 0);
    const unresolved = unresolvedRoomCount
      ? ` · ${unresolvedRoomCount} unresolved room${unresolvedRoomCount === 1 ? "" : "s"} excluded`
      : "";
    return freezeSummary({
      status: unresolvedRoomCount ? "partial" : "known",
      source: "confirmed-rooms",
      areaMm2,
      heading: "Known room area",
      basisLabel: `${known.length} confirmed wall-face room${known.length === 1 ? "" : "s"}${unresolved}`,
      outlineId: null,
      roomCount: known.length,
      unresolvedRoomCount,
    });
  }

  return freezeSummary({
    status: "not-set",
    source: "none",
    areaMm2: null,
    heading: "Floor area",
    basisLabel: rooms.length
      ? "Room boundaries unresolved; no closed floor-area outline"
      : "No closed floor-area outline or confirmed rooms",
    outlineId: null,
    roomCount: 0,
    unresolvedRoomCount: rooms.length,
  });
}

export function floorAreaValueLabel(summary) {
  return summary.areaMm2 === null ? "Not set" : `${formatSquareMetres(summary.areaMm2)} m²`;
}

function formatSquareMetres(areaMm2) {
  const value = areaMm2 / 1_000_000;
  return value.toFixed(2).replace(/\.00$/u, "").replace(/(\.\d)0$/u, "$1");
}

function freezeSummary(value) {
  return Object.freeze({
    ...value,
    areaM2: value.areaMm2 === null ? null : value.areaMm2 / 1_000_000,
  });
}
