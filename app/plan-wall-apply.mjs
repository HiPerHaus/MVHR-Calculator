import { executePlannedCommandBatch } from "../src/domain/history.mjs";
import { newlyEligibleRoomBoundaries } from "../src/domain/rooms.mjs";
import { sourcePointToWorld, unknownMm } from "../src/domain/spatial.mjs";
import { planSnappedWallChain } from "../src/editor/wall-snap.mjs";

// The preview uses image pixels; the existing wall command owns projection,
// junctions and history. No project state is published if staging throws.
export function applyReviewedWallProposals(history, source, approved, id) {
  const next = executePlannedCommandBatch(history, approved.length, (working, i) => {
    const wall = approved[i], stem = "wall-proposal-"+id+"-"+(i+1);
    const points = [wall.a,wall.b].map(p => ({
      ...sourcePointToWorld(source.reference.transform,p,source.scale),
      z:unknownMm("wall proposal elevation not confirmed"),
    }));
    return planSnappedWallChain(working,{
      type:"wall.addChain", floorId:source.floorId, points,
      nodeIds:[stem+"-start",stem+"-end"],wallIds:[stem],
      thicknessMm:wall.thicknessMm,heightMm:unknownMm("wall proposal height not confirmed"),
      classification:"physical",referenceLine:"centreline"
    },{idPrefix:stem+"-join"});
  });
  return {next, rooms:newlyEligibleRoomBoundaries(history.present,next.present,source.floorId).length};
}
