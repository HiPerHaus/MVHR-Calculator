import {escapeXml,wrapSheetText} from './a3-sheet.mjs';

export function partsListRows(schedule){
 const rows=[],section=description=>rows.push({section:true,description,height:7});
 const add=(ref,description,quantity,unit='ea')=>{const lines=wrapSheetText(description,82,3);rows.push({ref,description,lines,quantity:String(quantity),unit,height:Math.max(8,lines.length*3.6+3)});};
 section('Equipment and terminals');
 for(const line of schedule.componentLines)add(line.ref,[line.description,line.productId?`Code: ${line.productId}`:line.manufacturerArticle?`Article: ${line.manufacturerArticle}`:''].filter(Boolean).join(' · '),line.quantity);
 if(!schedule.componentLines.length)add('—','No equipment placed',0);
 if(schedule.routeLines.length){section('Drawn duct lengths');for(const line of schedule.routeLines)add(line.ref,`${line.description} · ${line.stream}${line.pendingParallelRunRouteCount?' · some Single/Twin choices pending':''}`,`${metres(line.knownMultipliedPlanMm)}${line.pendingParallelRunRouteCount?' + pending':''}`,'m');}
 const sizes=new Set([...schedule.eppTakeoff,...schedule.eppUnitConnectionAllowances].map(line=>line.nominalSizeMm));
 if(sizes.size){section('EPP materials — includes HRV-to-ceiling allowances');for(const size of [...sizes].sort((a,b)=>a-b)){
  const lines=[...schedule.eppTakeoff,...schedule.eppUnitConnectionAllowances].filter(line=>line.nominalSizeMm===size),pending=lines.some(line=>line.parallelRunCount===null);
  const sum=field=>lines.reduce((total,line)=>total+(line[field]??0),0),qty=value=>`${value}${pending?' + pending':''}`;
  add('EPP',`DN${size} EPP straight · 1 m stock length, socket included`,qty(sum('stockLengthQuantity')));
  const stock=schedule.eppElbowStock.find(line=>line.nominalSizeMm===size);
  add('EPP',`DN${size} 90° elbow stock · includes halves for 45° bends`,qty(stock?.elbow90StockQuantity??0));
  add('EPP',`DN${size} additional sleeves · bends and HRV connections`,qty(sum('extraSleeveQuantity')));
 }}
 const a=schedule.radialAccessories;
 if(a.cwPortQuantity||a.connectedTerminalQuantity||a.pendingTerminalRunCount){section('90 mm connections and unused CW ports');
  add('90','90 mm O-ring · all CW branches and connected TVA/Luna / Aerofresh ducts',`${a.oRingQuantity}${a.pendingTerminalRunCount?' + pending':''}`);
  if(a.capQuantity){add('CW','90 mm end cap · unused CW branch',a.capQuantity);add('CW',`90 mm short pipe stub · unused CW branch${a.stubLengthMm===null?' · length to confirm':` · ${a.stubLengthMm} mm each`}`,a.stubQuantity);if(a.stubTotalMm!==null)add('CW','Additional 90 mm pipe for unused branch stubs',metres(a.stubTotalMm),'m');}
 }
 return rows;
}
export function createA4PartsListPages(sheet){
 const rows=partsListRows(sheet.partsSchedule),pages=[];let current=[],y=65;
 for(let i=0;i<rows.length;i++){
  const row=rows[i],needed=row.height+(row.section?(rows[i+1]?.height??0):0);
  if(y+needed>263&&current.length){pages.push(current);current=[];y=65;}
  current.push(row);y+=row.height;
 }
 if(current.length)pages.push(current);
 return pages.map((rows,index)=>({kind:'a4-parts-list',widthMm:210,heightMm:297,pageNumber:index+2,totalPageCount:pages.length+1,rows}));
}
export function renderA4PartsListSvg(sheet,page){
 const m=sheet.metadata,a=sheet.partsSchedule.radialAccessories,out=[`<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297" role="img" aria-label="A4 parts list page ${page.pageNumber}"><rect width="210" height="297" fill="white"/><rect x="10" y="10" width="190" height="277" fill="none" stroke="#5e7079" stroke-width=".3"/>`];
 const text=(x,y,value,size=2.8,extra='')=>`<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="#20343e" ${extra}>${escapeXml(String(value))}</text>`;
 out.push(text(14,20,'PARTS LIST',5,'font-weight="700"'));
 if(m.companyLogoDataUrl)out.push(`<image href="${m.companyLogoDataUrl}" x="145" y="13" width="50" height="17" preserveAspectRatio="xMidYMid meet"/>`);
 else out.push(text(195,20,m.company.companyName||'',3,'text-anchor="end"'));
 for(const [i,line] of wrapSheetText(m.projectName,76,2).entries())out.push(text(14,29+i*4,line,3.5));
 for(const [i,line] of wrapSheetText(m.siteName,100,2).entries())out.push(text(14,39+i*3.5,line));
 out.push(text(14,51,`${m.drawingId} · ${m.issueDate} · ${sheet.printScene.floorName}`));
 out.push('<rect x="12" y="56" width="186" height="8" fill="#e8eef0"/>',text(14,61,'REF',2.7),text(30,61,'DESCRIPTION',2.7),text(181,61,'QTY',2.7,'text-anchor="end"'),text(195,61,'UNIT',2.7,'text-anchor="end"'));
 let y=65;
 for(const row of page.rows){
  if(row.section){out.push(`<rect x="12" y="${y}" width="186" height="${row.height}" fill="#f1f4f5"/>`,text(14,y+4.7,row.description,2.8,'font-weight="700"'));}
  else{out.push(text(14,y+4.5,row.ref,2.6));for(const [i,line] of row.lines.entries())out.push(text(30,y+4.5+i*3.6,line,2.7));out.push(text(181,y+4.5,row.quantity,2.8,'text-anchor="end"'),text(195,y+4.5,row.unit,2.7,'text-anchor="end"'),`<line x1="12" y1="${y+row.height}" x2="198" y2="${y+row.height}" stroke="#d7dfe2" stroke-width=".15"/>`);}
  y+=row.height;
 }
 const notes=['Lengths are saved plan centrelines × Single/Twin; unmeasured rises and waste are excluded.','EPP includes standard HRV port allowances; 45° bends use halves of 90° elbow stock.',a.stubLengthMm===null&&a.stubQuantity?'Unused CW ports: one O-ring, one short pipe stub and one cap each; stub length to confirm.':'Every CW branch receives an O-ring, including unused capped branches.','Product selection and installation compatibility require review.'];
 notes.forEach((note,i)=>out.push(text(14,269+i*3.5,note,2.2)));
 out.push(text(14,291,m.status,2.5),text(196,291,`Page ${page.pageNumber} of ${page.totalPageCount} · A4`,2.5,'text-anchor="end"'),'</svg>');return out.join('');
}
function metres(mm){return (mm/1000).toFixed(2).replace(/\.00$/,'');}
