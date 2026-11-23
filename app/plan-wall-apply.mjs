import { executePlannedCommandBatch } from "../src/domain/history.mjs";
import { newlyEligibleRoomBoundaries } from "../src/domain/rooms.mjs";
import { sourcePointToWorld, unknownMm } from "../src/domain/spatial.mjs";
import { planSnappedWallChain } from "../src/editor/wall-snap.mjs";

// The preview uses image pixels; the existing wall command owns projection,
// junctions and history. No project state is published if staging throws.
export function applyReviewedWallProposals(history, source, approved, id) {
  const ordered=[...approved.filter(w=>!w.roomOpening),...approved.filter(w=>w.roomOpening)];
  const next = executePlannedCommandBatch(history, approved.length, (working, i) => {
    const wall = ordered[i], stem = "wall-proposal-"+id+"-"+(i+1);
    const points = [wall.a,wall.b].map(p => ({
      ...sourcePointToWorld(source.reference.transform,p,source.scale),
      z:unknownMm("wall proposal elevation not confirmed"),
    }));
    if(wall.roomOpening){
      const nodeAt=p=>working.wallNodes.find(n=>n.floorId===source.floorId&&
        Math.hypot(n.positionMm.x-p.x,n.positionMm.y-p.y)<1e-5);
      const [a,b]=points.map(nodeAt);
      if(!a||!b)throw new TypeError("Select the physical walls on both sides of the doorway first.");
      return {type:"wall.addRoomOpening",floorId:source.floorId,wallId:stem,startNodeId:a.id,endNodeId:b.id};
    }
    return planSnappedWallChain(working,{
      type:"wall.addChain", floorId:source.floorId, points,
      nodeIds:[stem+"-start",stem+"-end"],wallIds:[stem],
      thicknessMm:wall.thicknessMm,heightMm:unknownMm("wall proposal height not confirmed"),
      classification:"physical",referenceLine:"centreline"
    },{idPrefix:stem+"-join"});
  });
  const boundaries=newlyEligibleRoomBoundaries(history.present,next.present,source.floorId);
  return {next, rooms:boundaries.length, boundaries};
}
