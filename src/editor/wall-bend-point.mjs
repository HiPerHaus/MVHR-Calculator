// Adding a bend starts with an exact on-wall split. The existing move-node
// command then reshapes the shared vertex without replacing wall identities.
export function createWallMidpointCommand(project, wallId, {newNodeId,newWallId}) {
  const wall=project.walls.find(item=>item.id===wallId);
  if(!wall) throw new TypeError('Select a placed wall before adding a point');
  const start=project.wallNodes.find(item=>item.id===wall.startNodeId)?.positionMm;
  const end=project.wallNodes.find(item=>item.id===wall.endNodeId)?.positionMm;
  if(!start || !end) throw new TypeError('Wall endpoints are missing');
  return {type:'wall.split',wallId,newNodeId,newWallId,point:{x:(start.x+end.x)/2,y:(start.y+end.y)/2}};
}
