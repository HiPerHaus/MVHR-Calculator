import { liveDesignAirflow } from './live-design-airflow.mjs';
// Site evidence is separate from design authority and scoped to a design option.
export const COMMISSIONING_DETAIL_FIELDS = Object.freeze(['engineer','date','instrument','instrumentSerial','calibrationDate','unitModel','unitSerial','normalSetting','boostSetting','filterDuringTest','filterFinal','controls','asBuiltChanges','serviceNotes']);
const unsafe = new Set(['__proto__','prototype','constructor']);
function key(value) { if(typeof value !== 'string' || !value || value.length > 250 || unsafe.has(value)) throw new TypeError('Invalid commissioning identifier'); return value; }
function text(value, max=4000) { if(typeof value !== 'string' || value.length > max) throw new TypeError('Invalid commissioning text'); return value; }
function flow(value) { if(value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new TypeError('Measured airflow must be blank or a non-negative finite l/s value'); return value; }
export function emptyCommissioningRecord() { return {details:{},measurements:{},photos:[]}; }
export function getCommissioningRecord(project) { return project.commissioning && Object.hasOwn(project.commissioning,project.activeDesignOptionId) ? project.commissioning[project.activeDesignOptionId] : emptyCommissioningRecord(); }
export function validateCommissioning(records) {
  if(records === undefined) return;
  if(!records || typeof records !== 'object' || Array.isArray(records)) throw new TypeError('Invalid commissioning records');
  for(const [optionId, record] of Object.entries(records)) {
    key(optionId);
    if(!record || !record.details || !record.measurements || !Array.isArray(record.photos) || record.photos.length > 10) throw new TypeError('Invalid commissioning record');
    for(const [field,value] of Object.entries(record.details)) { if(!COMMISSIONING_DETAIL_FIELDS.includes(field)) throw new TypeError('Unknown commissioning field'); text(value); }
    for(const [id,m] of Object.entries(record.measurements)) { key(id); flow(m.measuredLps); flow(m.designLpsAtMeasurement); text(m.setting); text(m.notes); text(m.recordedAt,50); }
    const ids=new Set();
    for(const photo of record.photos) { key(photo.id); if(ids.has(photo.id)) throw new TypeError('Duplicate photo'); ids.add(photo.id); text(photo.caption,4000); text(photo.dataUrl,400000); if(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo.dataUrl)) throw new TypeError('Photo must be an embedded JPEG, PNG or WebP'); }
  }
}
export function applyCommissioningCommand(project,command) {
  const optionId=key(project.activeDesignOptionId);
  project.commissioning ??= {};
  if(!Object.hasOwn(project.commissioning,optionId)) project.commissioning[optionId]=emptyCommissioningRecord();
  const record=project.commissioning[optionId];
  if(command.type === 'commissioning.updateDetails') {
    record.details={...record.details,...command.details};
  } else if(command.type === 'commissioning.recordMeasurement') {
    const spaceId=key(command.spaceId);
    const space=[...project.rooms,...project.zones].find(s=>s.id===spaceId);
    if(!space || !['supply','extract'].includes(space.ventilationRole)) throw new TypeError('Select a current supply or extract room/zone');
    const design=liveDesignAirflow(project,space);
    record.measurements[spaceId]={measuredLps:flow(command.measuredLps),setting:text(command.setting ?? ''),notes:text(command.notes ?? ''),designLpsAtMeasurement:design.valueLps,recordedAt:text(command.recordedAt ?? "",50)};
  } else if(command.type === 'commissioning.addPhoto') {
    record.photos.push(structuredClone(command.photo));
  } else if(command.type === 'commissioning.removePhoto') {
    record.photos=record.photos.filter(p=>p.id!==command.photoId);
  } else throw new TypeError('Unknown commissioning command');
  validateCommissioning(project.commissioning);
}
