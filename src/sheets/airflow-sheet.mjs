import { escapeXml, wrapSheetText } from './a3-sheet.mjs';

// A printable working record, not a certification or an automatic pass/fail.
export function createAirflowPages(sheet, { firstPageNumber = 3, totalPageCount = null } = {}) {
  if (!sheet.airflowReport) return [];
  const lines = sheet.airflowReport.lines ?? [], count = Math.max(1, Math.ceil(lines.length / 18));
  return Array.from({ length: count }, (_, index) => ({
    rows: lines.slice(index * 18, (index + 1) * 18), airflowPageNumber: index + 1,
    airflowPageCount: count, pageNumber: firstPageNumber + index,
    totalPageCount: totalPageCount ?? firstPageNumber + count - 1,
  }));
}
const bounded = (value, length) => wrapSheetText(String(value ?? ''), length, 1)[0] ?? '';
const flow = value => Number.isFinite(value) ? value.toFixed(1) : 'Not set';
export function renderAirflowSheetSvg(sheet, page) {
  const m = sheet.metadata, report = sheet.airflowReport;
  const text = (x, y, value, size = 2.7, extra = '') => `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="#20343e" ${extra}>${escapeXml(String(value ?? ''))}</text>`;
  const out = ['<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297" role="img" aria-label="Live design airflows"><rect width="210" height="297" fill="white"/><rect x="10" y="10" width="190" height="277" fill="none" stroke="#5e7079" stroke-width=".3"/>'];
  out.push(text(14,20,'LIVE DESIGN AIRFLOWS',5,'font-weight="700"'));
  for (const [i,line] of wrapSheetText(m.projectName,55,2).entries()) out.push(text(14,28+i*4,line,3.4));
  out.push(text(14,39,bounded(`${sheet.printScene.floorName} · ${m.drawingId} · Revision ${m.revision}`, 70)));
  out.push(text(14,45,`Airflow sheet ${page.airflowPageNumber} of ${page.airflowPageCount} · Normal mode · All flows in L/s`,2.5));
  out.push(text(14,49,'Room totals include all terminals; no per-terminal allocation. Not certification.',2.3));
  const unassignedCount = report.unassignedTerminals?.length ?? 0;
  out.push(text(14,53,unassignedCount ? `Incomplete: ${unassignedCount} unassigned terminal(s) excluded from room totals; review required.` : 'Live design targets only. Site records are exported separately.',2.3));
  out.push('<rect x="12" y="55" width="186" height="9" fill="#e8eef0"/>');
  for (const [x,label] of [[14,'ROOM / ROLE'],[108,'REQUIRED'],[142,'DESIGN'],[173,'TERMINALS']]) out.push(text(x,61,label,2.5));
  let y=65;
  for (const row of page.rows) {
    const nameLines=wrapSheetText(`${row.name} · ${row.ventilationRole}`,42,2);
    nameLines.forEach((line,i)=>out.push(text(14,y+4+i*3.4,line,2.6)));
    out.push(text(108,y+4,flow(row.requiredLps)),text(142,y+4,flow(row.designLps)),text(178,y+4,String(row.terminalIds?.length ?? 0)));
    if(row.boundaryNeedsReassignment) out.push(text(14,y+10,'Boundary needs reassignment; excluded from totals',2.2,'style="fill:#9b4e00"'));
    out.push(`<line x1="12" y1="${y+10.8}" x2="198" y2="${y+10.8}" stroke="#d7dfe2" stroke-width=".15"/>`); y+=11;
  }
  if (!page.rows.length) out.push(text(14,72,'No centralised room airflow data on this floor.'));
  // Summaries occupy a fixed lower band so long schedules cannot overlap them.
  const totalLabel = (side) => {
    const t=report.totals?.[side] ?? {};
    return `${side === 'supply' ? 'Supply' : 'Extract'}: design ${flow(t.designLps)}${t.incompleteDesign?' (partial)':''} L/s`;
  };
  out.push(text(14,268,totalLabel('supply'),2.4),text(14,273,totalLabel('extract'),2.4));
  out.push(text(14,280,'Required and assigned design targets remain separate; no compliance verdict.',2.3));
  out.push(text(14,291,bounded(m.status,55),2.2),text(196,291,`Page ${page.pageNumber} of ${page.totalPageCount} · A4`,2.5,'text-anchor="end" data-output-page-number="true"'),'</svg>');
  return out.join('');
}
