// Direct hits on visible draft markers are explicit intent, independent of
// zoom-dependent snap distances and competing committed endpoints.
export function hitWallDraftPoint(points, nodeId) {
  if (!nodeId) return null;
  const point = points.find(candidate => candidate.nodeId === nodeId);
  return point ? { ...point, snapKind: 'endpoint' } : null;
}
export function inspectWallDraftAppend(points, resolved, fallbackNodeId) {
  const equal = (a,b) => a && b && Math.hypot(a.x-b.x,a.y-b.y) <= 1e-6;
  const previous = points.at(-1), first = points[0];
  if (previous && ((resolved.nodeId && previous.nodeId===resolved.nodeId) || equal(previous,resolved))) return {duplicate:true,closesLoop:false,point:null};
  const closesLoop = points.length>=3 && (resolved.nodeId===first.nodeId || equal(first,resolved));
  // Canonicalise an exactly coincident endpoint instead of creating two IDs.
  const point = closesLoop ? {...first,snapKind:'endpoint',split:null} : {...resolved,nodeId:resolved.nodeId ?? fallbackNodeId};
  return {duplicate:false,closesLoop,point};
}
