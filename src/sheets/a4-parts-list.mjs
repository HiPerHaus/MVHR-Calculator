import {quotedCode} from '../editor/quote-product-codes.mjs';
import {escapeXml,wrapSheetText} from './a3-sheet.mjs';

export function partsListRows(schedule){
 const rows=[],section=description=>rows.push({section:true,description,height:7});
 const add=(ref,description,quantity,unit='ea',partNumber='',kind='part')=>{const lines=wrapSheetText(description,58,4),partNumberLines=wrapSheetText(partNumber||'—',25,4);rows.push({ref,kind,partNumber,partNumberLines,description,lines,quantity:String(quantity),unit,height:Math.max(8,Math.max(lines.length,partNumberLines.length)*3.6+3)});};
 for(const [key,title] of [['mvhr','MVHR units'],['equipment','CW units and other equipment'],['terminals','Terminals']]){
  const lines=schedule.componentLines.filter(line=>(line.section??'equipment')===key);
  if(!lines.length)continue;
  section(title);
  for(const line of lines)add(line.ref,line.description,line.quantity,'ea',line.partNumber??line.productId??line.manufacturerArticle??'',line.isAssemblySummary?'assembly':'part');
 }
 if(!schedule.componentLines.length){section('MVHR units and terminals');add('—','No equipment placed',0,'ea','','summary');}
 const accessories=schedule.projectAccessories;
 if(accessories.terminalLines.length){section('Terminal components');for(const line of accessories.terminalLines)add('TERM',line.description,line.quantity,line.unit,line.code,line.code?'part':'selection');}
 if(accessories.cwLines.length){section('CW components');for(const line of accessories.cwLines)add('CW',line.description,line.quantity,line.unit,line.code);}
 if(accessories.unitLines.length){section('HRV accessories');for(const line of accessories.unitLines)add('HRV',line.description,line.quantity,line.unit,line.code);}
 if(accessories.jobLines.length){section('Job allowances and packs — counted once for the project');for(const line of accessories.jobLines)add('JOB',line.description,line.quantity,line.unit,line.code);}

 const duct=accessories.duct90;
 if(duct.showOnThisFloor&&(duct.knownTotalLengthMm>0||duct.pendingCount)){
  section('90 mm duct — project total');
  add('90','Total 90 mm duct · drawn runs plus unused CW port stubs',`${metres(duct.knownTotalLengthMm)}${duct.pendingCount?' + pending':''}`,'m','','summary');
  add('90','90 mm duct coil · 50 m per coil, rounded up',`${duct.coilQuantity}${duct.pendingCount?' + pending':''}`,'coil','ZEN-CT90-50M');
 }
 const otherRoutes=schedule.routeLines.filter(line=>line.ductKind!=='semi-rigid-radial'&&!line.ductKind.startsWith('epp-rigid-'));
 if(otherRoutes.length){section('Other drawn duct lengths');for(const line of otherRoutes)add(line.ref,`${line.description} · ${line.stream}${line.pendingParallelRunRouteCount?' · some Single/Twin choices pending':''}`,`${metres(line.knownMultipliedPlanMm)}${line.pendingParallelRunRouteCount?' + pending':''}`,'m','','summary');}
 if(duct.showOnThisFloor&&accessories.eppTotals.length){
  section('EPP — project totals, including HRV-to-ceiling allowances');
  for(const line of accessories.eppTotals){
   const size=line.nominalSizeMm,qty=value=>`${value}${line.pendingCount?' + pending':''}`;
   add('EPP',`Total DN${size} EPP duct · all streams and floors`,qty(metres(line.knownTotalLengthMm)),'m','','summary');
   add('EPP',`DN${size} EPP straight · 1 m stock length, rounded up from total · socket included`,qty(line.stockLengthQuantity),'ea',quotedCode(`AER-DUC-DN${size}-1MSL`)??'');
   add('EPP',`DN${size} 90° elbow stock · includes halves for 45° bends`,qty(line.elbow90StockQuantity),'ea',quotedCode(`AER-DUC-DN${size}-B90`)??'');
   add('EPP',`DN${size} additional sleeves · bends and HRV connections`,qty(line.extraSleeveQuantity),'ea',quotedCode(`AER-DUC-DN${size}-SL`)??'');
   if(line.otherBendQuantity)add('EPP',`DN${size} other bends · product selection required`,line.otherBendQuantity);
  }
 }
 const a=schedule.radialAccessories;
 if(a.capQuantity){section('Unused CW branch closures');
  add('CW',`90 mm short pipe stub · unused CW branch${a.stubLengthMm===null?' · length to confirm':` · ${a.stubLengthMm} mm each · included in duct total`}`,a.stubQuantity,'ea','','cut-piece');
 }
 // Only purchasable parts belong in Local supply. Totals, assembly references,
 // cut pieces already in duct stock, and pending choices of listed products stay in context.
 const local=rows.filter(row=>!row.section&&row.kind==='part'&&!quotedCode(row.partNumber));
 const localSet=new Set(local),regular=rows.filter(row=>!localSet.has(row));
 const result=regular.filter((row,index)=>!row.section||(regular[index+1]&&!regular[index+1].section));
 if(local.length)result.push({section:true,description:'Local supply',height:7},...local.map(row=>({...row,localSupply:true})));
 return result;
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
 out.push('<rect x="12" y="56" width="186" height="8" fill="#e8eef0"/>',text(14,61,'REF',2.7),text(30,61,'PART NUMBER',2.7),text(70,61,'NAME',2.7),text(181,61,'QTY',2.7,'text-anchor="end"'),text(195,61,'UNIT',2.7,'text-anchor="end"'));
 let y=65;
 for(const row of page.rows){
  if(row.section){out.push(`<rect x="12" y="${y}" width="186" height="${row.height}" fill="#f1f4f5"/>`,text(14,y+4.7,row.description,2.8,'font-weight="700"'));}
  else{out.push(text(14,y+4.5,row.ref,2.6));for(const [i,line] of row.partNumberLines.entries())out.push(text(30,y+4.5+i*3.6,line,2.5));for(const [i,line] of row.lines.entries())out.push(text(70,y+4.5+i*3.6,line,2.7));out.push(text(181,y+4.5,row.quantity,2.8,'text-anchor="end"'),text(195,y+4.5,row.unit,2.7,'text-anchor="end"'),`<line x1="12" y1="${y+row.height}" x2="198" y2="${y+row.height}" stroke="#d7dfe2" stroke-width=".15"/>`);}
  y+=row.height;
 }
 const notes=['Lengths are saved plan centrelines × Single/Twin; unmeasured rises and waste are excluded.','EPP includes standard HRV port allowances; 45° bends use halves of 90° elbow stock.',a.stubLengthMm===null&&a.stubQuantity?'Unused CW ports: one O-ring, one short pipe stub and one cap each; stub length to confirm.':'Every CW branch receives an O-ring, including unused capped branches.',`Job totals and packs: ${wrapSheetText(sheet.partsSchedule.projectAccessories.jobOwnerFloorName??'no ventilation placed',30,1)[0]} · selection and installation compatibility require review.`];
 notes.forEach((note,i)=>out.push(text(14,269+i*3.5,note,2.2)));
 out.push(text(14,291,m.status,2.5),text(196,291,`Page ${page.pageNumber} of ${page.totalPageCount} · A4`,2.5,'text-anchor="end"'),'</svg>');return out.join('');
}
function metres(mm){return (mm/1000).toFixed(2).replace(/\.00$/,'');}
