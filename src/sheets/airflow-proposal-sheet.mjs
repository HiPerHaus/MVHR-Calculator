import { escapeXml, wrapSheetText } from './a3-sheet.mjs';
const PAGE_LINES=49, LINE_HEIGHT=4.1;
const quantity=value=>Number.isFinite(value)?value.toFixed(1):'Unknown';
const parameter=value=>Number.isFinite(value)?String(value):'Unknown';
const describe=value=>typeof value==='string'?value:value?.message??JSON.stringify(value);
function content(sheet){
 const report=sheet.airflowProposal,settings=report.settings??{},result=[];
 const phpp=settings.profile==='phpp-9.6a-standard-v1';
 const add=(value,heading=false)=>{for(const text of wrapSheetText(String(value),heading?83:99,10000))result.push({text,heading});};
 add('WHOLE-OPTION DEMAND — ALL FLOORS',true);
 add('These totals apply once to this option. Do not add repeated totals from other floor sheets.');
 add(`Calculation profile: ${settings.profile??'legacy-studio-v1'}`);
 if(phpp){add('PHPP 9.6a standard single-unit method: maximum = max(occupancy, extract, reference volume × 0.3 × 1.3); normal = maximum / 1.3; basic = normal × 0.7.');add('Whole-dwelling method only. Room distribution below remains a separate Studio heuristic, not a PHPP-certified allocation.');}
 add(`Selected basis: ${report.basis??settings.basis??'Unknown'} · Governing basis: ${(report.governingBasis??[]).join(', ')||'Unknown'}`);
 add(`${phpp?'Input references (volume before maximum multiplier)':'Candidates'} (m³/h): occupancy ${quantity(report.candidatesM3h?.occupancy)} · volume ${quantity(report.candidatesM3h?.volume)} · extract ${quantity(report.candidatesM3h?.extract)}`);
 if(phpp)add(`Maximum-duty candidates (m³/h): occupancy ${quantity(report.maximumCandidatesM3h?.occupancy)} · volume ${quantity(report.maximumCandidatesM3h?.volume)} · extract ${quantity(report.maximumCandidatesM3h?.extract)}`);
 add(`Volume source: ${settings.volumeSource??'Unknown'} · Selected volume: ${quantity(report.volumeM3)} m³`);
 add(`Inputs: person rate ${parameter(settings.personRateM3h)} m³/h per person · air changes ${parameter(settings.ach)} /h`);
 add(`Proposed whole-option flows (m³/h): ${phpp?'basic':'low'} ${quantity(report.lowM3h)} · normal ${quantity(report.normalM3h)} · ${phpp?'maximum':'boost'} ${quantity(report.boostM3h)}`);
 add(`${phpp?'Fixed PHPP profile factors: basic':'Mode factors: low'} ${parameter(settings.lowFactor)} × normal · ${phpp?'maximum':'boost'} ${parameter(settings.boostFactor)} × normal`);
 add('Equipment capacity NOT VERIFIED. Not an approved design, certified PHPP result, compliance check or measured delivery.');
 add('');add('ROOM / ZONE PROPOSALS — THIS FLOOR ONLY',true);
 const rows=sheet.airflowProposalLines??(report.lines??[]).filter(line=>line.floorId===sheet.metadata.floorId);
 if(!rows.length)add('No room/zone proposal rows on this floor. Whole-option inputs and unresolved issues still require review.');
 for(const row of rows){
  add(`${row.name} · ${row.ventilationRole} · ID ${row.id}`,true);
  add(`Proposed m³/h: ${phpp?'basic':'low'} ${quantity(row.lowM3h)} · normal ${quantity(row.normalM3h)} · ${phpp?'maximum':'boost'} ${quantity(row.boostM3h)}`);
  add(`Existing assigned design: ${quantity(row.assignedExistingM3h)} m³/h (unchanged; not this proposal)`);
  add(`Weight: ${parameter(row.weight)} · Source: ${row.weightSource??'Unknown'}`);
  for(const missing of row.missing??[])add(`Unresolved: ${describe(missing)}`);
  add('');
 }
 add('UNRESOLVED INPUTS / ISSUES',true);
 if(!(report.issues??[]).length)add('None reported by this provisional method. This is not approval or a capacity/compliance check.');
 for(const issue of report.issues??[])add(describe(issue));
 add('');add('METHOD / ASSUMPTIONS / LIMITATIONS',true);add(`Method: ${report.method??'Unknown'}`);
 for(const assumption of report.assumptions??[])add(describe(assumption));
 add('Saved manual targets, terminal allocations and commissioning measurements remain unchanged.');
 add('');add('METHOD REFERENCES — REVIEW WITH PROJECT DESIGNER',true);
 for(const source of report.sourceUrls??[])add(source);
 return result;
}
export function createAirflowProposalPages(sheet,{firstPageNumber=1,totalPageCount=null}={}){
 if(!sheet.airflowProposal||sheet.metadata.systemScope==='decentralised'||sheet.airflowProposal.status==='not-applicable')return [];
 const lines=content(sheet),count=Math.max(1,Math.ceil(lines.length/PAGE_LINES));
 return Array.from({length:count},(_,index)=>({lines:lines.slice(index*PAGE_LINES,(index+1)*PAGE_LINES),proposalPageNumber:index+1,proposalPageCount:count,pageNumber:firstPageNumber+index,totalPageCount:totalPageCount??firstPageNumber+count-1}));
}
export function renderAirflowProposalSheetSvg(sheet,page){
 const report=sheet.airflowProposal,scope=sheet.airflowProposalScope??{},m=sheet.metadata;
 const text=(x,y,value,size=2.7,attrs='')=>`<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="#20343e" ${attrs}>${escapeXml(String(value))}</text>`;
 const bounded=(value,max=95)=>wrapSheetText(String(value),max,1)[0]??'';
 const out=['<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297" role="img" aria-label="Unapproved provisional airflow proposal"><rect width="210" height="297" fill="white"/><rect x="10" y="10" width="190" height="277" fill="none" stroke="#687880" stroke-width=".3"/>'];
 out.push(text(14,20,'PROVISIONAL AIRFLOW PROPOSAL',4.7,'font-weight="700"'));
 out.push(text(14,27,'UNAPPROVED · CAPACITY NOT VERIFIED · NOT FOR CONSTRUCTION',2.7,'font-weight="700"'));
 out.push(text(14,34,bounded(m.projectName,72),3.1));
 out.push(text(14,40,bounded(`Option: ${scope.optionName??report.optionId??'Unknown'} · ID ${scope.optionId??report.optionId??'Unknown'}`),2.5));
 out.push(text(14,46,bounded(`Floor rows: ${sheet.printScene.floorName} · Whole-option totals: all floors · ${report.status}`),2.5));
 out.push(text(14,52,`Proposal sheet ${page.proposalPageNumber} of ${page.proposalPageCount} · All airflow in m³/h`,2.5));
 page.lines.forEach((line,index)=>out.push(text(14,61+index*LINE_HEIGHT,line.text,line.heading?2.9:2.7,line.heading?'font-weight="700"':'')));
 out.push(text(14,274,'Proposal only. Existing live design and recorded site measurements are separate.',2.4));
 out.push(text(14,281,'Unknown means missing or unresolved; no zero has been inferred.',2.4));
 out.push(text(196,291,`Page ${page.pageNumber} of ${page.totalPageCount} · A4`,2.5,'text-anchor="end" data-output-page-number="true"'),'</svg>');return out.join('');
}
