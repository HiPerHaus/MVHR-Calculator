export const CA200_GRAPHIC_ID="zehnder-comfoair-200-manual-plan-v1";
export const CA200_MANUAL_EVIDENCE=Object.freeze({
  sourceId:"ComfoAir-200_Manual_EN.pdf",pages:"22,24–25",bodyWidthMm:535,bodyDepthMm:315,bodyLengthMm:1108,overallLengthMm:1200,
  portColumnSpacingMm:330,nominalSizeMm:125,steppedOutsideDiametersMm:[125.5,149.5,159.5],
  note:"Owner selected manual version over the differing Luxe brochure dimensions. Manufacturer Left/Right is viewed from the service face. Absolute transverse centres use a centred drawing interpretation; installation fit remains unverified.",
});
export function ca200Records(){return ["horizontal","vertical"].flatMap(mounting=>["left","right"].map(handing=>{
  const horizontal=mounting==="horizontal",left=handing==="left";
  const roles=[{key:"dwelling-supply",stream:"supply",role:"Dwelling supply",x:left?-165:165,top:true},
    {key:"dwelling-extract",stream:"extract",role:"Dwelling extract",x:left?165:-165,top:true},
    {key:"outdoor-exhaust",stream:"exhaust",role:"Outdoor exhaust",x:left?-165:165,top:false},
    {key:"outdoor-intake",stream:"intake",role:"Outdoor intake",x:left?165:-165,top:false}];
  const id=`zehnder-ca200-${mounting}-${handing}-drawing-profile`;
  return {id,versionId:`${id}.v1`,group:"Units",category:"mvhr-unit-drawing-profile",manufacturer:"Zehnder",productId:null,
    name:`ComfoAir 200 · ${mounting} · ${handing}`,placeable:true,status:"source-backed-drawing-profile-installation-review-required",
    source:{sourceId:CA200_MANUAL_EVIDENCE.sourceId,title:"ComfoAir 200 manual · owner-selected version",locator:"PDF pages22,24–25",sourceKind:"owner-uploaded-manufacturer-manual",verificationStatus:"manual-dimensions-and-handed-role-map-drawing-profile"},
    dimensions:{unit:"mm",body:{width:535,depth:horizontal?1108:315,height:horizontal?315:1108},overallLengthMm:1200,evidenceStatus:"manual-version-source-sized-drawing",note:CA200_MANUAL_EVIDENCE.note},
    symbol:{shape:"box",widthMm:535,heightMm:horizontal?1200:315,ca200Profile:{mounting,handing}},
    ports:roles.map(p=>({key:p.key,system:"mvhr",stream:p.stream,role:p.role,
      positionMm:{x:p.x,y:horizontal?(p.top?-600:600):1.5,z:horizontal?1.5:(p.top?600:-600)},
      direction:horizontal?{x:0,y:p.top?-1:1,z:0}:{x:0,y:0,z:p.top?1:-1},
      interface:{family:"rigid-epp",nominalSizeMm:125,boreMm:null,outsideDiameterMm:null,matingProfile:null,verificationStatus:"manual-stepped-spigot-DN125-drawing-only-installation-fit-unverified"}})),
    note:"CA200 manual drawing profile, not the Luxe brochure. Four DN125 drawing ports; separate remote attenuators. Stepped spigots also show150/160 sizes, but no adapters or alternative nominal interface are inferred. Vertical top/bottom ports share their plan positions and have distinct relative elevations. Installed elevation and service clearances require review."};
}));}
export function deriveCa200Graphic(component,symbol){return {graphicId:CA200_GRAPHIC_ID,widthMm:symbol.widthMm,depthMm:symbol.heightMm,...symbol.ca200Profile,ports:component.ports??component.catalogueSnapshot?.ports??[]};}
export function ca200Shapes(g){
 const horizontal=g.mounting==="horizontal",depth=horizontal?1108:315,half=depth/2;
 const out=[{tag:"rect",attributes:{x:-267.5,y:-half,width:535,height:depth,rx:12,fill:"#e9eded",stroke:"#52676f","stroke-width":6,"data-ca200-part":"casing"}},
 {tag:"rect",attributes:{x:-247.5,y:-half+20,width:495,height:depth-40,rx:8,fill:"#dce2e3",stroke:"#87979c","stroke-width":3}}];
 const colours={supply:"#2782b5",extract:"#c15c41",intake:"#409879",exhaust:"#8b6888"},codes={supply:"SUP",extract:"ETA",intake:"ODA",exhaust:"EHA"};
 if(horizontal){
  for(const y of [-400,400])out.push({tag:"rect",attributes:{x:-65,y:y-22,width:130,height:44,rx:8,fill:"#c6ced0",stroke:"#52676f","stroke-width":3,"data-ca200-part":"filter-access"}});
  out.push({tag:"rect",attributes:{x:-48,y:-35,width:96,height:70,rx:5,fill:"#52676f"}});
 }
 for(const p of g.ports){
  const top=p.direction.z>=0;
  if(horizontal){
   out.push({tag:"rect",attributes:{x:p.positionMm.x-62.5,y:p.positionMm.y<0?-600:554,width:125,height:46,fill:colours[p.stream],stroke:"#29434d","stroke-width":3,"data-ca200-part":"spigot"}});
   out.push({tag:"text",attributes:{x:p.positionMm.x,y:p.positionMm.y<0?-480:500,"text-anchor":"middle",fill:colours[p.stream],"font-size":32,"font-weight":700},text:codes[p.stream]});
  }else if(top){
   out.push({tag:"circle",attributes:{cx:p.positionMm.x,cy:p.positionMm.y,r:79.75,fill:"white",stroke:"#52676f","stroke-width":5,"data-ca200-part":"top-spigot"}});
   out.push({tag:"circle",attributes:{cx:p.positionMm.x,cy:p.positionMm.y,r:62.75,fill:colours[p.stream],stroke:"white","stroke-width":5}});
   out.push({tag:"text",attributes:{x:p.positionMm.x,y:-105,"text-anchor":"middle",fill:colours[p.stream],"font-size":26,"font-weight":700},text:codes[p.stream]});
  }else out.push({tag:"text",attributes:{x:p.positionMm.x,y:125,"text-anchor":"middle",fill:colours[p.stream],"font-size":24},text:`${codes[p.stream]} below`});
 }
 out.push({tag:"text",attributes:{x:0,y:horizontal?100:10,"text-anchor":"middle",fill:"#29434d","font-size":horizontal?42:26,"font-weight":700},text:"CA200"});
 return out;
}
