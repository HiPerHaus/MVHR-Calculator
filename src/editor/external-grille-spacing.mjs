export const EXTERNAL_GRILLE_SEPARATION_RULE = Object.freeze({minimumMm:1500,basis:"centre-to-centre",source:"owner-rule-2026-10-23",basisStatus:"owner-confirmed"});

function singleService(component) {
  if(!/external.*grille|grille.*external/.test(component.catalogueItemId??""))return null;
  const ports=component.ports.filter(port=>["intake","exhaust"].includes(port.stream));
  return ports.length===1?ports[0].stream:null;
}
export function inspectExternalGrilleSeparation(project,floorId,rule=EXTERNAL_GRILLE_SEPARATION_RULE) {
  const singles=project.components.filter(c=>c.floorId===floorId).map(component=>({component,service:singleService(component)})).filter(c=>c.service);
  const result=[];
  for(let i=0;i<singles.length;i++)for(let j=i+1;j<singles.length;j++) {
    const a=singles[i],b=singles[j];if(a.service===b.service)continue;
    const centreDistanceMm=Math.hypot(a.component.positionMm.x-b.component.positionMm.x,a.component.positionMm.y-b.component.positionMm.y);
    const distanceMm=centreDistanceMm;
    result.push({componentId:a.component.id,otherComponentId:b.component.id,minimumMm:rule.minimumMm,basis:rule.basis,centreDistanceMm,distanceMm,
      status:distanceMm===null?"unverified":distanceMm+1e-6<rule.minimumMm?"too-close":"plan-clearance-met",
      note:"Active-floor plan separation only; vertical spacing, wall assignment, openings and facade suitability are not verified."});
  }
  return result;
}
