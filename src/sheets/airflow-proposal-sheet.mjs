import { escapeXml, wrapSheetText } from './a3-sheet.mjs';
const quantity=value=>Number.isFinite(value)?value.toFixed(1):'Unknown';
export function createAirflowProposalPages(sheet,{firstPageNumber=1,totalPageCount=null}={}){
 if(!sheet.airflowProposal||sheet.metadata.systemScope==='decentralised'||sheet.airflowProposal.status==='not-applicable')return [];
 const rows=[...(sheet.airflowProposalLines??(sheet.airflowProposal.lines??[]).filter(row=>row.floorId===sheet.metadata.floorId))].sort((a,b)=>roleOrder(a.ventilationRole)-roleOrder(b.ventilationRole));
 // Preserve full room names: taller rows consume more of the fixed table area.
 const pages=[];let current={section:'outlet-chart',rows:[],lines:[]},used=0;
 for(const row of rows){
  const nameLines=wrapSheetText(row.name,38,10000);
  for(let offset=0;offset<nameLines.length;offset+=40){
   const part=nameLines.slice(offset,offset+40),height=Math.max(8,part.length*3.1+2);
   if(used+height>128&&current.rows.length){pages.push(current);current={section:'outlet-chart',rows:[],lines:[]};used=0;}
   current.rows.push({...row,nameLines:part,rowHeight:height,nameContinuation:offset>0});used+=height;
  }
 }
 if(current.rows.length||!pages.length)pages.push(current);
 const count=pages.length;
 return pages.map((page,index)=>({...page,proposalPageNumber:index+1,proposalPageCount:count,pageNumber:firstPageNumber+index,totalPageCount:totalPageCount??firstPageNumber+count-1}));
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
 out.push(renderOutletChart(sheet,page,text));
 const profile=report.settings?.profile??report.profile??'legacy-studio-v1';
 out.push(text(14,268,bounded(`Profile: ${profile} · Basis: ${report.settings?.basis??'Unknown'}`,100),2.4));
 out.push(text(14,274,'Room distribution is a Studio heuristic, not certified PHPP allocation.',2.4));
 out.push(text(14,281,'Unknown means missing or unresolved; no zero has been inferred.',2.4));
 out.push(text(196,291,`Page ${page.pageNumber} of ${page.totalPageCount} · A4`,2.5,'text-anchor="end" data-output-page-number="true"'),'</svg>');return out.join('');
}

function roleOrder(role){return role==='supply'?0:role==='extract'?1:2;}
function renderOutletChart(sheet,page,text){
 const report=sheet.airflowProposal,phpp=report.settings?.profile==='phpp-9.6a-standard-v1';
 const out=[text(14,62,'ROOM / ZONE PROPOSALS — THIS FLOOR ONLY',3.2,'font-weight="700"'),text(14,69,'Whole-option duty (ALL floors, per stream; do not add repeated floor sheets):',2.5),text(14,76,`${phpp?'Basic':'Low'} ${quantity(report.lowM3h)} · Normal ${quantity(report.normalM3h)} · ${phpp?'Maximum':'Boost'} ${quantity(report.boostM3h)} m³/h`,3),text(14,83,'Room size is drawn wall-reference area (m²), not verified net area or PHPP TFA.',2.3),text(14,90,'Proposed room flows only, not outlet measurements or per-terminal allocations.',2.3)];
 out.push('<rect x="12" y="96" width="186" height="10" fill="#e8eef0"/>');
 for(const [x,label]of [[14,'ROOM / ZONE'],[76,'TYPE'],[100,'m²'],[121,phpp?'BASIC':'LOW'],[146,'NORMAL'],[174,phpp?'MAXIMUM':'BOOST']])out.push(text(x,102,label,2.6,'font-weight="700"'));
 let y=107;
 for(const row of page.rows){
  const role=row.ventilationRole==='supply'?'Supply':row.ventilationRole==='extract'?'Extract':row.ventilationRole;
  out.push(`<g data-role="proposal-outlet-row" data-space-id="${escapeXml(row.id)}">`);
  if(row.ventilationRole==='extract')out.push(`<rect x="12" y="${y}" width="186" height="${row.rowHeight}" fill="#f5f8f9"/>`);
  (row.nameLines??wrapSheetText(row.name,38,10000)).forEach((line,i)=>out.push(text(14,y+3.1+i*3.1,line,2.5)));
  out.push(text(76,y+3.5,role,2.4),text(100,y+3.5,quantity(row.areaM2),2.4));
  for(const [x,key]of [[121,'lowM3h'],[146,'normalM3h'],[174,'boostM3h']])out.push(text(x,y+3.5,["supply","extract"].includes(row.ventilationRole)?quantity(row[key]):"—",2.6));
  out.push(`<line x1="12" y1="${y+row.rowHeight}" x2="198" y2="${y+row.rowHeight}" stroke="#d7dfe2" stroke-width=".15"/></g>`);y+=row.rowHeight;
 }
 if(!page.rows.length)out.push(text(14,113,'No room/zone rows on this floor. Inputs remain unresolved.',2.7));
 const all=sheet.airflowProposalLines??(report.lines??[]).filter(row=>row.floorId===sheet.metadata.floorId);
 for(const [index,role]of ['supply','extract'].entries()){
  const side=all.filter(row=>row.ventilationRole===role),known=side.filter(row=>Number.isFinite(row.normalM3h));
  const total=known.length?known.reduce((sum,row)=>sum+row.normalM3h,0):null;
  out.push(text(14,246+index*6,`This floor ${role} normal: ${quantity(total)} m³/h${known.length<side.length?' (partial)':''} · ${side.length} room/zone(s)`,2.7));
 }
 out.push(text(14,261,'Supply and extract are separate streams, not additive dwelling demand.',2.5));
 return out.join('');
}
