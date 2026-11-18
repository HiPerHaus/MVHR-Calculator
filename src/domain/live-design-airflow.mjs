/** Resolve explicit Normal design inputs only. No rates, equal splits or achieved flows inferred. */
export function liveDesignAirflow(project, space, kind = space.parentRoomId ? 'zone' : 'room') {
  const stale=space.boundaryState==='reassignment-required'||Boolean(space.parentRoomId&&project.rooms.find(r=>r.id===space.parentRoomId)?.boundaryState==='reassignment-required');
  const unresolved={valueLps:null,source:'unresolved',allocatedLps:null,allocationComplete:false,allocationDisagrees:false};
  if(stale)return {...unresolved,source:'boundary-reassignment-required'};
  const assigned=space.airflowTargets?.normal?.assigned;
  const associations=space.terminalAssociations??[];
  const design=project.engineeringInputs?.networkDesigns?.find(d=>d.floorId===space.floorId&&d.mode==='normal');
  const allocations=(design?.terminalAllocations??[]).filter(a=>a.spaceId===space.id&&a.spaceKind===kind);
  const endpoint=a=>`${a.componentId}\u0000${a.portId}`;
  const complete=associations.length>0&&allocations.length===associations.length&&associations.every(a=>{
    const matches=allocations.filter(x=>endpoint(x)===endpoint(a));
    const component=project.components.find(c=>c.id===a.componentId&&c.floorId===space.floorId);
    const port=component?.ports.find(p=>p.id===a.portId);
    return matches.length===1&&port?.stream===space.ventilationRole&&Number.isFinite(matches[0].valueLps)&&matches[0].valueLps>0;
  });
  const sum=complete?allocations.reduce((n,a)=>n+a.valueLps,0):null;
  const allocatedLps=Number.isFinite(sum)?sum:null;
  const allocationComplete=complete&&allocatedLps!==null;
  if(assigned?.state==='known')return {valueLps:assigned.valueLps,source:'assigned-room-target',allocatedLps,allocationComplete,allocationDisagrees:allocationComplete&&Math.abs(assigned.valueLps-allocatedLps)>1e-9};
  return {valueLps:allocationComplete?allocatedLps:null,source:allocationComplete?'explicit-terminal-allocations':'unresolved',allocatedLps,allocationComplete,allocationDisagrees:false};
}
