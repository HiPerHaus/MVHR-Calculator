import {buildAirflowProposal,reviewAirflowProposal} from '../src/domain/airflow-proposal.mjs';

const number=value=>Number.isFinite(value)?String(Number(value.toFixed(2))):'Not set';
function node(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
function input(label,value,key){const wrapper=node('label',undefined,'field-input'),control=node('input');wrapper.append(node('span',label),control);control.type='number';control.step='any';control.min='0';control.inputMode='decimal';control.value=value??'';control.dataset.proposalField=key;return {wrapper,control};}
function select(label,value,key,choices){const wrapper=node('label',undefined,'field-input'),control=node('select');for(const [v,t]of choices){const option=node('option',t);option.value=v;control.append(option);}control.value=value;control.dataset.proposalField=key;wrapper.append(node('span',label),control);return {wrapper,control};}
function formatFlows(line,phpp=false){return `${phpp?'Basic':'Low'} ${number(line.lowM3h)} · Normal ${number(line.normalM3h)} · ${phpp?'Maximum':'Boost'} ${number(line.boostM3h)} m³/h`;}

// A separate draft calculator. Saving this form never applies assigned targets or site readings.
export function createAirflowProposalSection(project,{onSave,onExport,onEditReference,onApply,currentFloorId}={}){
 const report=buildAirflowProposal(project),settings=report.settings,phpp=settings.profile==='phpp-9.6a-standard-v1';
 const section=node('section',undefined,'airflow-proposal');section.dataset.proposalStatus=report.status;
 section.append(node('h2','Automatic airflow proposal'),node('p','Provisional Studio design profile for all floors in this option. This is a proposal, not a PHPP-approved room allocation, commissioning result or equipment-capacity verdict. Existing targets change only through the explicit review/apply step below. Site readings are never overwritten.'));
 const references=project.ventilationReference??{};
 section.append(node('p',`Whole-dwelling inputs: ${number(references.occupants)} occupants · ${number(references.tfaM2)} m² reviewed TFA. Volume basis below remains separate from measured room heights.`));
 const editReference=node('button','Edit dwelling occupancy / TFA');editReference.type='button';editReference.addEventListener('click',()=>onEditReference?.());section.append(editReference);
 const results=node('div',undefined,'proposal-results');
 for(const [label,value]of [[phpp?'Occupancy maximum candidate':'Occupancy reference',report.candidatesM3h?.occupancy],[phpp?'Volume maximum candidate (V × 0.3 × 1.3)':'Volume reference',phpp?report.maximumCandidatesM3h?.volume:report.candidatesM3h?.volume],[phpp?'Extract maximum candidate':'Extract reference',report.candidatesM3h?.extract]])results.append(node('p',`${label}: ${number(value)} m³/h`));
 if(phpp){results.append(node('p',`Normal volume reference (V × 0.3): ${number(report.candidatesM3h?.volume)} m³/h`));}
 section.append(results,node('p',`Chosen ${phpp?'maximum':'normal'} basis: ${report.governingBasis?.length?report.governingBasis.join(" + "):settings.basis}. ${formatFlows(report,phpp)}`,'proposal-duty'));
 section.append(node('p',phpp?'PHPP 9.6a standard profile: maximum = highest of occupancy, extract and V × 0.3 × 1.3; normal = maximum ÷ 1.3; basic = 0.7 × normal. These duties are not manufacturer limits or a certification result. Unit selection still requires verified pressure and performance.':'Low and boost factors are configurable design assumptions, not manufacturer operating limits. Unit selection still needs verified performance at the project pressure, noise and installation conditions.'));
 if(report.issues?.length){const list=node('ul',undefined,'field-warning');for(const issue of report.issues)list.append(node('li',issue));section.append(list);}
 const form=node('form',undefined,'proposal-settings');form.dataset.proposalForm='true';
 const grid=node('div',undefined,'proposal-input-grid');
 const fields={
  profile:select('Versioned calculation profile',settings.profile??'legacy-studio-v1','profile',[['legacy-studio-v1','Legacy Studio proposal v1'],['phpp-9.6a-standard-v1','PHPP 9.6a standard v1']]),
  basis:select('Normal-flow selection policy',settings.basis,'basis',[['max','Highest complete reference (Studio policy)'],['occupancy','Occupancy reference'],['volume','Volume reference'],['extract','Extract reference']]),
  volumeSource:select('Volume reference basis',settings.volumeSource,'volumeSource',[['phpp-reference','PHPP reference: reviewed TFA × 2.5 m'],['actual-geometry','Actual room geometry estimate (not PHPP volume)']]),
  personRateM3h:input('Occupancy rate (m³/h per person)',settings.personRateM3h,'personRateM3h'),
  ach:input('Volume rate (air changes per hour)',settings.ach,'ach'),
  lowFactor:input('Low multiplier of normal (assumed 0.7)',settings.lowFactor,'lowFactor'),
  boostFactor:input('Boost multiplier of normal (assumed 1.3)',settings.boostFactor,'boostFactor'),
 };
 for(const field of Object.values(fields))grid.append(field.wrapper);form.append(grid);
 const fixed={basis:'max',volumeSource:'phpp-reference',personRateM3h:30,ach:.3,lowFactor:.7,boostFactor:1.3};
 const updateProfileControls=()=>{const selected=fields.profile.control.value==='phpp-9.6a-standard-v1';for(const [key,value]of Object.entries(fixed)){fields[key].control.disabled=selected;if(selected)fields[key].control.value=String(value);}fields.basis.wrapper.querySelector('span').textContent=selected?'Maximum-flow selection (fixed)':'Normal-flow selection policy';fields.basis.control.options[0].textContent=selected?'Highest maximum candidate (PHPP 9.6a)':'Highest complete reference (Studio policy)';fields.lowFactor.wrapper.querySelector('span').textContent=selected?'Basic multiplier of normal (fixed 0.7)':'Low multiplier of normal (assumed 0.7)';fields.boostFactor.wrapper.querySelector('span').textContent=selected?'Maximum / normal ratio (fixed 1.3)':'Boost multiplier of normal (assumed 1.3)';};
 fields.profile.control.addEventListener('change',updateProfileControls);updateProfileControls();
 form.append(node('p','Existing projects stay on the legacy Studio profile until explicitly changed and saved. PHPP 9.6a standard v1 fixes the whole-dwelling formula and reference parameters. Neither profile certifies the project. Supply distribution remains a Studio room-area-weighted heuristic; extract distribution uses selected reference weights. Rates are room totals, not automatic outlet splits.'));
 form.append(node('h3','Room allocation and assumptions · all floors'));
 const rooms=node('div',undefined,'proposal-room-list'),overrides=[];
 for(const line of report.lines??[]){
  const row=node('article',undefined,'proposal-room-card');row.dataset.proposalSpace=line.id;
  const floor=project.floors.find(f=>f.id===line.floorId),space=[...project.rooms,...project.zones].find(s=>s.id===line.id);
  row.append(node('h4',`${line.name} · ${floor?.name??line.floorId}`),node('p',`${line.ventilationRole} · room use: ${space?.use??'not set'}`),node('p',formatFlows(line,phpp),'proposal-room-flows'),node('p',`Weight: ${number(line.weight)} · ${line.weightSource??'unresolved'}`),node('p',`Existing assigned target: ${number(line.assignedExistingM3h)} m³/h (unchanged)`));
  if(line.ventilationRole==='supply'||line.ventilationRole==='extract'){
   const supply=line.ventilationRole==='supply',key=supply?'supplyWeights':'extractRatesM3h';
   const override=input(supply?'Supply weight override (blank = room area)':'Extract reference m³/h (blank = supported profile rate)',settings[key]?.[line.id],`${key}:${line.id}`);
   if(!supply){
    const preset=select('Choose a reviewed extract reference (optional)','',`extractPreset:${line.id}`,[['','Choose a profile or enter a custom rate below'],['60','Kitchen reference · 60 m³/h'],['40','Bathroom / utility reference · 40 m³/h'],['20','WC / storage reference · 20 m³/h']]);
    preset.control.addEventListener('change',()=>{if(preset.control.value)override.control.value=preset.control.value;});
    row.append(preset.wrapper,node('p','Use a positive reference; zero is not a mechanical extract allocation. For a room with no mechanical extract, review its ventilation role in Plan instead. Choose only a reference appropriate to this room. This sets a proposal weight, not its final flow or room classification. Save to recalculate; the selected total may scale this reference.'));
    if(space?.use==='ensuite')row.append(node('p','Confirm the actual ensuite facilities before choosing a reference. The name alone does not establish its extract requirement.'));
    if(space?.use==='other')row.append(node('p','This room is classified as other. If it is a storage room, you can explicitly choose the storage reference; otherwise enter a reviewed custom rate.'));
   }
   override.control.placeholder=Number.isFinite(line.weight)?`Current: ${number(line.weight)}`:'Required: agree a room reference';row.append(override.wrapper);overrides.push({key,id:line.id,input:override.control});
  }
  if(line.missing?.length)for(const missing of line.missing)row.append(node('p',missing,'field-warning'));
  rooms.append(row);
 }
 if(!report.lines?.length)rooms.append(node('p','No supply or extract rooms are available. Add room uses and ventilation roles in Plan.'));
 form.append(rooms);
 const assumptions=node('details',undefined,'proposal-assumptions');assumptions.append(node('summary','Calculation assumptions and source references'));
 const list=node('ul');for(const assumption of report.assumptions??[])list.append(node('li',assumption));assumptions.append(list);
 for(const url of report.sourceUrls??[]){const link=node('a','Read source guidance');link.href=url;link.target='_blank';link.rel='noopener';assumptions.append(link);}form.append(assumptions);
 const actions=node('div',undefined,'proposal-actions'),save=node('button','Save assumptions and recalculate proposal');save.type='submit';
 const exportButton=node('button','Export saved proposal');exportButton.type='button';exportButton.addEventListener('click',()=>onExport?.());
 actions.append(save,exportButton);form.append(actions,node('p','Save assumptions before exporting. Recalculation does not accept or overwrite room targets, outlet allocations or commissioning evidence.'));
 const feedback=node('p','','field-warning');feedback.setAttribute('role','status');form.append(feedback);
 form.addEventListener('submit',event=>{event.preventDefault();try{
  const next={...settings,supplyWeights:{...settings.supplyWeights},extractRatesM3h:{...settings.extractRatesM3h}};
  for(const [key,field]of Object.entries(fields)){const value=field.control.value;next[key]=field.control.tagName==='SELECT'?value:value.trim()?Number(value):NaN;}
  for(const override of overrides){const value=override.input.value.trim();if(value==='')delete next[override.key][override.id];else next[override.key][override.id]=Number(value);}
  if(onSave?.(next)===false)feedback.textContent='Could not save these assumptions. Check the project status and inputs.';
 }catch(error){feedback.textContent=error.message;}});
 section.append(form);
 const applySection=node('section',undefined,'proposal-apply');
 applySection.append(node('h3','Review and apply to the design schedule'),node('p','Use this separate step to copy the reviewed normal proposal into assigned room targets. Other operating duties remain proposal modes, not verified unit settings. Required references, outlet allocations and commissioning readings are retained. Keeping existing targets or applying only one floor can make the resulting design differ from the whole-dwelling proposal. Review the resulting supply/extract balance and network before issuing.'));
 const choices=node('div',undefined,'proposal-input-grid');
 const floor=project.floors.find(f=>f.id===currentFloorId);
 const scope=select('Application scope','floor','applyScope',[['floor',`Current floor: ${floor?.name??'Not selected'}`],['all-floors','All floors in this design option']]);
 const mode=select('Existing design values','fill-unset','applyMode',[['fill-unset','Fill unset; keep existing'],['replace-existing','Replace targets (confirm)']]);
 choices.append(scope.wrapper,mode.wrapper);applySection.append(choices);
 const reviewButton=node('button','Review proposed changes');reviewButton.type='button';reviewButton.dataset.proposalReview='true';
 const reviewHost=node('div',undefined,'proposal-review'),applyFeedback=node('p','','field-warning');applyFeedback.setAttribute('role','status');
 applySection.append(reviewButton,reviewHost,applyFeedback);section.append(applySection);
 let dirty=false,review=null;
 const invalidate=()=>{review=null;reviewHost.replaceChildren();applyFeedback.textContent=dirty?'Save assumptions and recalculate before reviewing or applying.':'';reviewButton.disabled=dirty||report.status!=='provisional'||(scope.control.value==='floor'&&!floor);};
 form.addEventListener('input',()=>{dirty=true;invalidate();});form.addEventListener('change',()=>{dirty=true;invalidate();});
 scope.control.addEventListener('change',invalidate);mode.control.addEventListener('change',invalidate);invalidate();
 if(report.status!=='provisional')applyFeedback.textContent='Resolve the incomplete proposal inputs before reviewing an application.';
 reviewButton.addEventListener('click',()=>{try{
  review=reviewAirflowProposal(project,{scope:scope.control.value,floorId:scope.control.value==='floor'?currentFloorId:null,mode:mode.control.value});
  reviewHost.replaceChildren();applyFeedback.textContent='';
  const scopeName=review.selection.scope==='floor'?floor.name:'all floors in this option';
  reviewHost.append(node('h4',`${review.changes.length} proposed change(s) · ${scopeName}`));
  const list=node('ul',undefined,'proposal-change-list');
  for(const change of review.changes){const f=project.floors.find(item=>item.id===change.floorId);list.append(node('li',`${change.name} (${f?.name??change.floorId}): ${number(change.previousM3h)} → ${number(change.normalM3h)} m³/h assigned normal target${change.hasTerminalAllocations?`; existing outlet allocation subtotal ${number(change.existingAllocationM3h)} m³/h is retained`:""}`));}
  reviewHost.append(list);
  if(review.skippedIds?.length){const skipped=node('ul',undefined,'proposal-skipped-list');reviewHost.append(node('p',`${review.skippedIds.length} existing design value(s) retained:`));for(const id of review.skippedIds){const line=report.lines.find(item=>item.id===id);skipped.append(node('li',`${line?.name??id}: ${review.skipped?.find(item=>item.id===id)?.reason??"existing target or outlet allocation kept"}`));}reviewHost.append(skipped);}
  reviewHost.append(node('p','Applying changes assigned room/zone targets only. Existing outlet allocations may differ afterwards and need review; measured readings stay unchanged and may show a changed-design warning. This is not commissioning acceptance. In Check, Create reviewed allocation draft can copy a target to one associated terminal; multiple outlets still need an explicit split. That separate action may replace existing network inputs and asks for confirmation.'));
  const apply=node('button',review.selection.mode==='replace-existing'?'Apply reviewed replacements…':'Apply reviewed changes');apply.type='button';apply.dataset.proposalApply='true';apply.disabled=!review.changes.length;reviewHost.append(apply);
  apply.addEventListener('click',()=>{if(!review||dirty)return;try{
   const replacing=review.selection.mode==='replace-existing';
   if(replacing&&!window.confirm(`Replace assigned normal targets for ${review.changes.length} reviewed room(s) on ${scopeName}?\n${review.changes.map(c=>`${c.name}: ${number(c.previousM3h)} → ${number(c.normalM3h)} m³/h`).join('\n')}\nOutlet allocations and commissioning readings are retained and must be reviewed. Undo can restore these targets.`))return;
   const command={type:'airflowProposal.apply',optionId:review.proposal.optionId,expectedFingerprint:review.fingerprint,...review.selection,...(replacing?{confirmReplaceExisting:true}:{})};
   if(onApply?.(command)===false)applyFeedback.textContent='Application was not saved. Review the current project state and generate a fresh review.';
  }catch(error){applyFeedback.textContent=error.message;}});
 }catch(error){review=null;reviewHost.replaceChildren();applyFeedback.textContent=error.message;}});
 return section;
}
