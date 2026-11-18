import { inspectAirflowBalance } from './airflow-balance.mjs';
import { getCommissioningRecord } from '../domain/commissioning.mjs';
export function buildCommissioningReport(project,floorId) {
  const balance=inspectAirflowBalance(project,floorId);
  const record=getCommissioningRecord(project);
  const lines=balance.lines.filter(l=>['supply','extract'].includes(l.ventilationRole)).map(line=>{
    const designLps=line.assigned.state==='known'?line.assigned.valueLps:null;
    const requiredLps=line.required.state==='known'?line.required.valueLps:null;
    const measurement=Object.hasOwn(record.measurements,line.id)?record.measurements[line.id]:null;
    const measuredLps=measurement?.measuredLps ?? null;
    return {id:line.id,name:line.name,ventilationRole:line.ventilationRole,terminalIds:line.terminalIds,requiredLps,designLps,measuredLps,deltaLps:measuredLps!==null&&designLps!==null?measuredLps-designLps:null,designChanged:measurement!==null&&measurement.designLpsAtMeasurement!==designLps,measurement};
  });
  const totals={};
  for(const role of ['supply','extract']) {
    const selected=lines.filter(l=>l.ventilationRole===role);
    totals[role]={designLps:selected.reduce((sum,l)=>sum+(l.designLps??0),0),measuredLps:selected.reduce((sum,l)=>sum+(l.measuredLps??0),0),incompleteDesign:!selected.length||selected.some(l=>l.designLps===null),incompleteMeasured:!selected.length||selected.some(l=>l.measuredLps===null)};
  }
  return {floorId,optionId:project.activeDesignOptionId,lines,totals,record,unassignedTerminals:balance.unassignedTerminals};
}
