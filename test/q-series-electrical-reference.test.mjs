import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Q_SERIES_ELECTRICAL_IMAGE} from '../src/sheets/q-series-electrical-source.mjs';
import {createQSeriesElectricalPages, renderQSeriesElectricalReferenceSvg} from '../src/sheets/q-series-electrical-reference.mjs';
const sheet={page:{widthMm:420,heightMm:297},metadata:{systemScope:'centralised',drawingId:'V01',revision:'A',issueDate:'2026-11-18',status:'Preliminary'},installationDetails:{qElectricalModels:['Q350']}};
test('electrical source is unchanged owner supplied raster',()=>{
 const png=Buffer.from(Q_SERIES_ELECTRICAL_IMAGE.split(',')[1],'base64');
 assert.equal(createHash('sha256').update(png).digest('hex'),'b91e55b278a37889eb9eebbe0d2a21d1fa6b5e05ce4027dc8f02d3d9ae99cf61');
 assert.equal(png.readUInt32BE(16),858);assert.equal(png.readUInt32BE(20),758);
});
test('electrical reference requires matching model and centralised scope',()=>{
 assert.equal(createQSeriesElectricalPages(sheet).length,1);
 assert.deepEqual(createQSeriesElectricalPages({...sheet,metadata:{...sheet.metadata,systemScope:'decentralised'}}),[]);
 assert.deepEqual(createQSeriesElectricalPages({...sheet,installationDetails:{qElectricalModels:[]}}),[]);
});
test('electrical source keeps model-specific supplies, reference limits and page numbering',()=>{
 for(const [widthMm,heightMm]of [[420,297],[297,420]]){
 const svg=renderQSeriesElectricalReferenceSvg({...sheet,page:{widthMm,heightMm}},{pageNumber:3,totalPageCount:6});
 assert.match(svg,/Q350 — 10 A GPO; Q450 \/ Q600 — 15 A GPO/);
 assert.match(svg,/No terminal pinout has been inferred/);assert.match(svg,/qualified installer/);assert.match(svg,/not installation approval/);
 assert.match(svg,/Page 3 of 6/);assert.match(svg,/Selected models on this floor: Q350/);
 }
});
