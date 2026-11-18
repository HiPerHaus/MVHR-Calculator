import { Q_SERIES_ELECTRICAL_IMAGE } from './q-series-electrical-source.mjs';
import { escapeXml } from './a3-sheet.mjs';
export function hasQElectricalReference(sheet) {
  return sheet.metadata.systemScope !== 'decentralised' && Boolean(sheet.installationDetails.qElectricalModels?.length);
}
export function renderQSeriesElectricalReferenceSvg(sheet,{pageNumber,totalPageCount}={}) {
  const {widthMm:w,heightMm:h}=sheet.page,m=sheet.metadata;
  const scale=Math.min((w-36)/858,(h-94)/758),iw=858*scale,ih=758*scale;
  const text=(x,y,value,size=2.8,attrs='')=>`<text x="${x}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" fill="#243b46" ${attrs}>${escapeXml(value)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" role="img" aria-label="Q-series electrical reference">
<rect width="100%" height="100%" fill="white"/><rect x="10" y="10" width="${w-20}" height="${h-20}" fill="none" stroke="#687880" stroke-width=".25"/>
${text(15,20,'Q-SERIES ELECTRICAL REFERENCE',5,'font-weight="700"')}
${text(15,28,`${m.drawingId} / ELECTRICAL · Revision ${m.revision} · ${m.issueDate}`)}
${text(15,35,`Selected models on this floor: ${sheet.installationDetails.qElectricalModels.join(', ')}. Owner-supplied source dated 18 Nov 2026.`)}
<image data-source="owner-q350-q450-q600-controls-2026-11-18" href="${Q_SERIES_ELECTRICAL_IMAGE}" x="${(w-iw)/2}" y="43" width="${iw}" height="${ih}" preserveAspectRatio="xMidYMid meet"/>
${text(15,h-43,'Source specifies: Q350 — 10 A GPO; Q450 / Q600 — 15 A GPO.')}
${text(15,h-37,'Boost: low-voltage 2-core cabling and momentary switches; bathroom, kitchen, laundry and WC shown.')}
${text(15,h-31,'Source also shows Comfoconnect Pro and Option Box. No terminal pinout has been inferred.')}
${text(15,h-25,'Reference only. Confirm exact unit, accessories and current manufacturer instructions with the qualified installer.')}
${text(15,h-19,'This reference does not specify project circuits, cable sizing or protective devices and is not installation approval.',2.6)}
${text(12,h-4,m.status,2.5)}${text(w-12,h-4,`Page ${pageNumber} of ${totalPageCount} · A3`,2.5,'text-anchor="end" data-output-page-number="true"')}
</svg>`;
}
export function createQSeriesElectricalPages(sheet,{firstPageNumber=1,totalPageCount=firstPageNumber}={}) {
  return hasQElectricalReference(sheet) ? [{pageNumber:firstPageNumber,totalPageCount}] : [];
}
export const renderQSeriesElectricalSheetSvg = renderQSeriesElectricalReferenceSvg;
