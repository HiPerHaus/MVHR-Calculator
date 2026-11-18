import {inspectRoomBoundary,inspectZoneBoundary} from './rooms.mjs';
import {roomVolume} from './room-volume.mjs';

export const AIRFLOW_PROPOSAL_METHOD='studio-provisional-residential-v1';
export const AIRFLOW_PROPOSAL_PROFILES=Object.freeze(['legacy-studio-v1','phpp-9.6a-standard-v1']);
export const PHPP_STANDARD_PROFILE='phpp-9.6a-standard-v1';
const PHPP_FIXED=Object.freeze({basis:'max',volumeSource:'phpp-reference',personRateM3h:30,ach:.3,lowFactor:.7,boostFactor:1.3});
export const AIRFLOW_PROPOSAL_SOURCES=Object.freeze([
 'https://passipedia.org/_media/picopen/final_protocol_worksheets_ventilation_example.pdf',
 'https://passipedia.org/planning/building_services/ventilation/differentiation_between_vv_and_vn50_values',
 'https://passipedia.org/planning/building_services/ventilation/basics/air_volumes',
]);
const EXTRACT_PROFILE=Object.freeze({kitchen:60,bathroom:40,laundry:40,wc:20,storage:20});
const unsafe=new Set(['__proto__','prototype','constructor']);
function number(value,name,max=1e6){if(!Number.isFinite(value)||value<=0||value>max)throw new TypeError(`${name} must be positive and no greater than ${max}`);return value;}
function map(value,name){if(value===undefined)return {};if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`Invalid ${name}`);const entries=Object.entries(value);if(entries.length>10000)throw new TypeError(`Too many ${name}`);return Object.fromEntries(entries.map(([key,v])=>{if(!key||key.length>250||unsafe.has(key))throw new TypeError(`Invalid ${name} identifier`);return [key,number(v,name)];}));}
export function normalizeAirflowProposalSettings(value={}) {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Invalid airflow proposal settings');
 const profile=value.profile===undefined?'legacy-studio-v1':value.profile;
 if(!AIRFLOW_PROPOSAL_PROFILES.includes(profile))throw new TypeError('Unsupported airflow proposal profile');
 if(profile===PHPP_STANDARD_PROFILE)for(const [key,fixed]of Object.entries(PHPP_FIXED))if(value[key]!==undefined&&value[key]!==fixed)throw new TypeError(`PHPP 9.6a standard profile requires ${key}=${fixed}`);
 const basis=value.basis??'max',volumeSource=value.volumeSource??'phpp-reference';
 if(!['max','occupancy','volume','extract'].includes(basis))throw new TypeError('Unsupported airflow proposal basis');
 if(!['phpp-reference','actual-geometry'].includes(volumeSource))throw new TypeError('Unsupported proposal volume source');
 const lowFactor=number(value.lowFactor??.7,'Low factor',1),boostFactor=number(value.boostFactor??1.3,'Boost factor',10);
 if(boostFactor<1)throw new TypeError('Boost factor must be at least 1');
 return {profile,basis,volumeSource,personRateM3h:number(value.personRateM3h??30,'Person rate',1000),ach:number(value.ach??.3,'Air changes per hour',10),lowFactor,boostFactor,supplyWeights:map(value.supplyWeights,'Supply weight'),extractRatesM3h:map(value.extractRatesM3h,'Extract reference')};
}
export function validateAirflowProposalSettingsByOption(value) {
 if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Invalid option airflow settings');
 for(const [id,settings] of Object.entries(value)){if(!id||id.length>250||unsafe.has(id))throw new TypeError('Invalid proposal option ID');normalizeAirflowProposalSettings(settings);}
}
function safe(value){return Number.isFinite(value)&&value>=0&&value<=1e9?value:null;}
export function buildAirflowProposal(project) {
 const settings=normalizeAirflowProposalSettings(Object.hasOwn(project.airflowProposalSettingsByOption??{},project.activeDesignOptionId)?project.airflowProposalSettingsByOption[project.activeDesignOptionId]:undefined);
 const isPhpp=settings.profile===PHPP_STANDARD_PROFILE;
 const issues=[],assumptions=[
  'Unapproved Studio design proposal, not a certified PHPP result, local-code check or measured delivery.',
  isPhpp?'PHPP 9.6a standard single-unit reference convention: maximum = max(occupancy × 30, extract reference sum, PHPP reference volume × 0.3 × 1.3); standard/normal = maximum ÷ 1.3; basic = 0.7 × normal. This is not an operating-hours-weighted average.':'The max-of-three governing rule is a Studio proposal policy, not a universal or mandatory PHI rule. PHPP standard-design and final-protocol examples use different normal/maximum conventions.',
  'Default extract profile: kitchen 60, bathroom 40, laundry mapped to utility 40, WC 20, storage 20 m³/h. Ensuite, shower-only and kitchen-dining are not inferred; use an explicit reviewed reference.',
  isPhpp?'This PHPP 9.6a reference profile is not validated for multi-unit systems or duty apportionment. It provides single-unit whole-dwelling reference duties only; unit capacity, pressure and low-speed capability are not verified.':'These are whole-dwelling duties, not duties apportioned between multiple ventilation units. Unit capacity, pressure and low-speed capability are not verified.',
  isPhpp?'This versioned PHPP reference profile is explicitly selected; absent profiles retain the legacy Studio normal-demand convention. Maximum demand is calculated once across all active-option floors.':'Normal demand uses the selected basis. Default max compares occupancy, ventilation-volume reference and supported extract-room references once across all active-option floors.',
  'Supply distribution is a Studio area-weighted heuristic, not a PHI room-allocation rule. Bedroom occupancy, transfer paths, noise, terminal capacity and local extract minima need review.',
  'Extract distribution uses reference-rate weights, scaled to the selected total; reference weights are not verified local minimum rates.',
  isPhpp?'Basic and maximum are reference design duties, not measured flows or certified unit settings. Verify occupied minimum ventilation and manufacturer operating range.':'Low and boost factors are design assumptions, not certified unit settings. Verify occupied minimum ventilation and manufacturer operating range.',
  'Existing targets, terminal allocations and commissioning readings are not overwritten or approved by this proposal.',
 ];
 const sourceProvenance=isPhpp?[
  'Verified supplied PHPP 9.6a workbook, Ventilation sheet: N65 = MAX(N59,N63,N9*0.3*1.3), Design air flow rate (maximum).',
  'Ventilation P72 = N72*$N$65 with N72 = 0.769230769230769 (Standard, equivalent to maximum / 1.3); P73 = N73*$N$65 with N73 = 0.538461538461538 (Basic, equivalent to 0.7 * standard).',
  'Ventilation P76 is the operating-hours-weighted average, not inherently the Standard rate. Additional Vent room allocations were inactive in the reviewed workbook; Studio room weights remain separate assumptions.',
 ]:[];
 assumptions.push(...sourceProvenance);
 const active=project.rooms.flatMap(room=>{const zones=project.zones.filter(z=>z.parentRoomId===room.id);return zones.length?zones.map(space=>({space,kind:'zone',parent:room})):[{space:room,kind:'room',parent:null}];});
 const lines=active.map(({space,kind,parent})=>{
  const missing=[];const geometry=kind==='zone'?inspectZoneBoundary(project,space):inspectRoomBoundary(project,space);
  const stale=geometry.status!=='current'||space.boundaryState==='reassignment-required'||parent?.boundaryState==='reassignment-required';
  if(stale)missing.push('Current room/zone boundary required');
  const areaM2=!stale&&Number.isFinite(geometry.areaMm2)&&geometry.areaMm2>0?geometry.areaMm2/1e6:null;
  const role=space.ventilationRole;let weight=null,weightSource=null;
  if(role==='unassigned')missing.push('Ventilation role not assigned');
  if(role==='supply'){
   if(Object.hasOwn(settings.supplyWeights,space.id)){weight=settings.supplyWeights[space.id];weightSource='explicit-supply-weight';}
   else {weight=areaM2;weightSource='Studio wall-reference-area weighting';}
   if(weight===null)missing.push('Supply weighting area or override required');
  }
  if(role==='extract'){
   if(Object.hasOwn(settings.extractRatesM3h,space.id)){weight=settings.extractRatesM3h[space.id];weightSource='explicit-extract-reference';}
   else if(Object.hasOwn(EXTRACT_PROFILE,space.use)){weight=EXTRACT_PROFILE[space.use];weightSource=`PHI-protocol-inspired reference: ${space.use}`;}
   else missing.push(`Choose a reviewed extract reference for room use '${space.use}' in Room allocation and assumptions; no rate inferred`);
  }
  const assigned=space.airflowTargets?.normal?.assigned;
  return {id:space.id,kind,floorId:space.floorId,name:space.name,ventilationRole:role,areaM2,weight,weightSource,assignedExistingM3h:assigned?.state==='known'?assigned.valueLps*3.6:null,normalM3h:null,lowM3h:null,boostM3h:null,maximumM3h:null,basicM3h:null,missing};
 });
 const supply=lines.filter(l=>l.ventilationRole==='supply'),extract=lines.filter(l=>l.ventilationRole==='extract');
 if(!supply.length)issues.push('At least one supply space is required');if(!extract.length)issues.push('At least one extract space is required');
 for(const l of lines)for(const reason of l.missing)issues.push(`${l.name}: ${reason}`);
 const ref=project.ventilationReference;
 const occupancy=Number.isFinite(ref?.occupants)&&ref.occupants>0?safe(ref.occupants*settings.personRateM3h):null;
 let volumeM3=null;
 if(settings.volumeSource==='phpp-reference'){
  volumeM3=Number.isFinite(ref?.tfaM2)&&ref.tfaM2>0?safe(ref.tfaM2*2.5):null;
  assumptions.push('PHPP residential reference volume is reviewed whole-dwelling TFA × 2.5 m, independent of actual ceiling heights.');
 }else{
  const volumes=project.rooms.map(r=>roomVolume(project,r));
  if(volumes.length&&project.floors.every(f=>project.rooms.some(r=>r.floorId===f.id))&&volumes.every(v=>v.state==='calculated'))volumeM3=safe(volumes.reduce((sum,v)=>sum+v.valueM3,0));
  assumptions.push('Actual-geometry option uses all drawn parent-room volumes once, not zones again. Wall-reference area is not verified net volume; complete building coverage requires review.');
  if(volumes.some(v=>v.assumed))assumptions.push('Actual-geometry volume includes assumed ceiling heights, including the default 2.5 m.');
 }
 const candidatesM3h={occupancy,volume:volumeM3===null?null:safe(volumeM3*settings.ach),extract:extract.length&&extract.every(l=>!l.missing.length&&l.weight!==null)?safe(extract.reduce((sum,l)=>sum+l.weight,0)):null};
 const maximumCandidatesM3h=Object.fromEntries(Object.entries(candidatesM3h).map(([key,value])=>[key,value===null?null:safe(value*(isPhpp?(key==='volume'?1.3:1):settings.boostFactor))]));
 const governingCandidates=isPhpp?maximumCandidatesM3h:candidatesM3h;
 const required=settings.basis==='max'?['occupancy','volume','extract']:[settings.basis];
 for(const basis of required)if(governingCandidates[basis]===null)issues.push(basis==='extract'&&extract.some(l=>l.missing.length)?'Extract total is unavailable until the room issues above are resolved.':`${basis} demand input is incomplete or outside numeric range`);
 const selected=required.every(b=>governingCandidates[b]!==null)?Math.max(...required.map(b=>governingCandidates[b])):null;
 const selectedNormal=selected===null?null:isPhpp?selected/1.3:selected;
 const governingBasis=selected===null?[]:required.filter(b=>Math.abs(governingCandidates[b]-selected)<1e-9);
 if(selectedNormal!==null&&candidatesM3h.extract!==null&&selectedNormal<candidatesM3h.extract)assumptions.push('Selected normal total is below the extract reference sum. Scaled room proposals are not evidence of satisfying local extract minima.');
 if(settings.basis!=='max')assumptions.push('Single-basis selection does not enforce the other demand candidates.');
 if(selected!==null&&safe(isPhpp?selected:selected*settings.boostFactor)===null)issues.push('Mode flow exceeds numeric range');
 const notApplicable=project.ventilationDesignType==='decentralised';if(notApplicable)issues.push('This proposal is for a single centralised whole-dwelling system, not decentralised unit selection');
 const status=notApplicable?'not-applicable':issues.length?'incomplete':'provisional';
 const normalM3h=status==='provisional'?selectedNormal:null;
 const maximumM3h=normalM3h===null?null:isPhpp?selected:normalM3h*settings.boostFactor;
 const basicM3h=normalM3h===null?null:normalM3h*settings.lowFactor;
 if(normalM3h!==null){
  for(const side of [supply,extract]){
   const sum=side.reduce((n,l)=>n+l.weight,0);
   if(!Number.isFinite(sum)||sum<=0)throw new RangeError('Proposal weighting sum is invalid');
   // Preserve exact totals, without independent rounding drift between supply and extract.
   let allocated=0;
   side.forEach((line,index)=>{line.normalM3h=index===side.length-1?normalM3h-allocated:normalM3h*line.weight/sum;allocated+=line.normalM3h;line.lowM3h=line.normalM3h*settings.lowFactor;line.boostM3h=line.normalM3h*settings.boostFactor;line.maximumM3h=line.boostM3h;line.basicM3h=line.lowM3h;});
  }
 }
 return {profile:settings.profile,method:isPhpp?PHPP_STANDARD_PROFILE:AIRFLOW_PROPOSAL_METHOD,status,optionId:project.activeDesignOptionId,settings,sourceProvenance,candidatesM3h,maximumCandidatesM3h,volumeM3,normalM3h,lowM3h:basicM3h,basicM3h,boostM3h:maximumM3h,maximumM3h,governingBasis,lines,issues,assumptions,sourceUrls:[...AIRFLOW_PROPOSAL_SOURCES]};
}

function normalizeReviewSelection(project, input={}) {
 const scope=input.scope??'all-floors',mode=input.mode??'fill-unset';
 if(!['all-floors','floor'].includes(scope))throw new TypeError('Invalid proposal application scope');
 if(!['fill-unset','replace-existing'].includes(mode))throw new TypeError('Invalid proposal application mode');
 const floorId=scope==='floor'?input.floorId:null;
 if(scope==='floor'&&!project.floors.some(f=>f.id===floorId))throw new TypeError('Select an existing floor to review');
 return {scope,floorId,mode};
}
/** Review is read-only. The exact token covers source inputs, computed results and the selected action scope. */
export function reviewAirflowProposal(project, input={}) {
 const selection=normalizeReviewSelection(project,input),proposal=buildAirflowProposal(project),changes=[],skippedIds=[],skipped=[];
 for(const line of proposal.lines.filter(l=>['supply','extract'].includes(l.ventilationRole)&&(selection.scope==='all-floors'||l.floorId===selection.floorId))){
  const space=(line.kind==='zone'?project.zones:project.rooms).find(s=>s.id===line.id);
  const target=space.airflowTargets.normal.assigned;
  const allocations=(project.engineeringInputs?.networkDesigns??[]).filter(d=>d.floorId===space.floorId&&d.mode==='normal').flatMap(d=>d.terminalAllocations).filter(a=>a.spaceId===space.id&&a.spaceKind===line.kind);
  const hasTerminalAllocations=allocations.length>0;
  const protectedExisting=target.state==='known'||hasTerminalAllocations;
  if(selection.mode==='fill-unset'&&protectedExisting){skippedIds.push(line.id);skipped.push({id:line.id,name:line.name,reason:target.state==='known'?'Existing assigned room target preserved':'Existing Normal terminal allocations preserved'});continue;}
  if(line.normalM3h===null)continue;
  changes.push({id:line.id,kind:line.kind,floorId:line.floorId,name:line.name,previousM3h:target.state==='known'?target.valueLps*3.6:null,normalM3h:line.normalM3h,hasTerminalAllocations,existingAllocationM3h:hasTerminalAllocations?allocations.reduce((sum,a)=>sum+a.valueLps*3.6,0):null});
 }
 const fingerprint=JSON.stringify({version:1,projectId:project.id,optionId:project.activeDesignOptionId,selection,reference:project.ventilationReference??null,settings:proposal.settings,ventilationDesignType:project.ventilationDesignType,floors:project.floors,wallNodes:project.wallNodes,walls:project.walls,rooms:project.rooms,zones:project.zones,engineeringInputs:project.engineeringInputs,proposal,changes,skipped});
 return {fingerprint,proposal,selection,changes,skippedIds,skipped};
}
/** Mutates only the applyCommand clone after all review guards pass. */
export function applyReviewedAirflowProposal(project, command) {
 if(command.optionId!==project.activeDesignOptionId)throw new TypeError('The design option changed. Review the proposal again.');
 const review=reviewAirflowProposal(project,command);
 if(typeof command.expectedFingerprint!=='string'||command.expectedFingerprint!==review.fingerprint)throw new TypeError('The proposal or selected scope changed. Review the current proposal again.');
 if(review.proposal.status!=='provisional')throw new TypeError('Only a complete current proposal can be applied. Resolve missing inputs first.');
 if(review.selection.mode==='replace-existing'&&command.confirmReplaceExisting!==true)throw new TypeError('Replacing existing design targets requires explicit confirmation.');
 if(!review.changes.length)throw new TypeError('No eligible room targets to apply. Existing targets and allocations were preserved.');
 for(const change of review.changes)if(!Number.isFinite(change.normalM3h)||change.normalM3h<=0)throw new TypeError('The proposal contains an invalid room target.');
 // Guarded batch: no required target, terminal allocation or site record is changed.
 for(const change of review.changes){
  const space=(change.kind==='zone'?project.zones:project.rooms).find(s=>s.id===change.id);
  space.airflowTargets.normal.assigned={state:'known',inputValue:change.normalM3h,inputUnit:'m3/h',valueLps:change.normalM3h/3.6,basis:`User-reviewed Studio proposal: ${review.proposal.method}; ${review.proposal.settings.basis} basis; Normal; not certified`,source:`Applied from reviewed ${review.selection.scope} proposal for option ${project.activeDesignOptionId}. ${change.hasTerminalAllocations?'Existing terminal allocations were not changed.':'Terminal distribution requires review.'}`,reason:null};
 }
 return review;
}
