import { liveDesignAirflow } from '../domain/live-design-airflow.mjs';
import { inspectAirflowBalance } from './airflow-balance.mjs';
import { getCommissioningRecord } from '../domain/commissioning.mjs';
export function buildCommissioningReport(project,floorId) {
  const balance=inspectAirflowBalance(project,floorId);
  const record=getCommissioningRecord(project);
  const lines=balance.lines.filter(l=>['supply','extract'].includes(l.ventilationRole)).map(line=>{
    const space=(line.kind==='zone'?project.zones:project.rooms).find(s=>s.id===line.id);
    const design=liveDesignAirflow(project,space,line.kind);
    const designLps=design.valueLps;
    const requiredLps=line.required.state==='known'?line.required.valueLps:null;
    const measurement=Object.hasOwn(record.measurements,line.id)?record.measurements[line.id]:null;
    const measuredLps=measurement?.measuredLps ?? null;
    return {id:line.id,name:line.name,boundaryNeedsReassignment:line.boundaryNeedsReassignment,ventilationRole:line.ventilationRole,terminalIds:line.terminalIds,requiredLps,designLps,designSource:design.source,allocatedLps:design.allocatedLps,allocationComplete:design.allocationComplete,allocationDisagrees:design.allocationDisagrees,measuredLps,deltaLps:measuredLps!==null&&designLps!==null?measuredLps-designLps:null,designChanged:measurement!==null&&measurement.designLpsAtMeasurement!==designLps,measurement};
  });
  const totals={};
  for(const role of ['supply','extract']) {
    const selected=lines.filter(l=>l.ventilationRole===role);
    const designValues=selected.filter(l=>l.designLps!==null), measuredValues=selected.filter(l=>!l.boundaryNeedsReassignment&&l.measuredLps!==null);
    totals[role]={designLps:designValues.length?designValues.reduce((sum,l)=>sum+l.designLps,0):null,measuredLps:measuredValues.length?measuredValues.reduce((sum,l)=>sum+l.measuredLps,0):null,incompleteDesign:!selected.length||selected.some(l=>l.designLps===null),incompleteMeasured:!selected.length||selected.some(l=>l.measuredLps===null||l.boundaryNeedsReassignment)};
  }
  return {floorId,optionId:project.activeDesignOptionId,lines,totals,record,unassignedTerminals:balance.unassignedTerminals};
}
