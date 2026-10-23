// Drawing profiles assembled from the owner's uploaded manufacturer sheets.
// Connector seating, support clearances and acoustic selection are not inferred.
export const STANDALONE_CW_GRAPHIC_ID = "hiper-standalone-comfowell-plan-v1";
export const CW_PROFILES = Object.freeze({
  "220": { count:4, casingWidth:220, width:236, depth:230, length:500, plateDepth:230, branchProjection:41, mainProjection:51, pitch:102.5, pitchStatus:"dimensioned-pitch-centred-edge-offset-assumed", source:"Zehnder-ComfoWell-220-specifications-2021.02.18.pdf", pages:"4–5", generation:"2021 specification", article:"990323500" },
  "320": { count:6, width:336, depth:232.5, length:506, plateDepth:230, branchProjection:61.3, mainProjection:42.3, pitch:100, pitchStatus:"schematic-centred-not-dimensioned", source:"Zehnder_CSY_ComfoWell_320_DAS_UK-en.pdf", pages:"3,5", generation:"UK RapidLock", article:"990323501" },
  "420": { count:8, casingWidth:420, width:436, depth:230, length:500, plateDepth:230, branchProjection:42, mainProjection:41, pitch:102.5, pitchStatus:"dimensioned-pitch-centred-edge-offset-assumed", source:"Zehnder-ComfoWell-420-specifications-2021.02.18.pdf", pages:"4–5", generation:"2021 specification", article:"990323504" },
  "520": { count:10, width:536, depth:232.5, length:506, plateDepth:230, branchProjection:61.3, mainProjection:42.3, pitch:100, pitchStatus:"schematic-centred-not-dimensioned", source:"Zehnder_CSY_ComfoWell_520_DAS_UK-en-1.pdf", pages:"3,5", generation:"UK RapidLock", article:"990323502" },
  "625": { count:12, casingWidth:625, width:641, depth:230, length:500, plateDepth:230, branchProjection:42, mainProjection:41, pitch:102.5, pitchStatus:"dimensioned-pitch-centred-edge-offset-assumed", source:"Zehnder-ComfoWell-625-specifications-2021.02.18.pdf", pages:"4–5", generation:"2021 specification", article:"990323505" },
});
export function standaloneCwRecordId({size,stream,orientation,mainSize=size==="220"?125:160}) {
  if(!Object.hasOwn(CW_PROFILES,size)) throw new TypeError("Choose CW220, CW320, CW420, CW520 or CW625");
  if(!["supply","extract"].includes(stream)) throw new TypeError("Choose Supply or Extract");
  if(!["horizontal","vertical"].includes(orientation)) throw new TypeError("Choose horizontal or vertical CW placement");
  if(!(size==="220"?[125]:size==="320"?[125,160]:[160]).includes(Number(mainSize))) throw new TypeError("Choose a supported main connection: CW220 DN125; CW320 DN125/DN160; other CW profiles DN160");
  return `standalone-cw-${size}-${stream}-${orientation}-dn${mainSize}`;
}
function connection(family,size) {
  return {family,nominalSizeMm:size,boreMm:null,outsideDiameterMm:null,matingProfile:null,verificationStatus:"drawing-profile-installation-fit-unverified"};
}
export function standaloneCwRecords() {
  return Object.entries(CW_PROFILES).flatMap(([size,p])=>["supply","extract"].flatMap(stream=>["horizontal","vertical"].flatMap(orientation=>(size==="220"?[125]:size==="320"?[125,160]:[160]).map(mainSize=>{
    const vertical=orientation==="vertical",columns=p.count/2;
    const totalLength=p.length+p.branchProjection+p.mainProjection;
    const width=vertical?p.width:p.length+2*Math.max(p.branchProjection,p.mainProjection),depth=vertical?p.depth:p.width;
    const role=stream==="supply"?"Dwelling supply":"Dwelling extract";
    const ports=[{key:"main",positionMm:vertical?{x:0,y:0,z:-p.length/2-p.mainProjection}:{x:-p.length/2-p.mainProjection,y:0,z:0},direction:vertical?{x:0,y:0,z:-1}:{x:-1,y:0,z:0},system:"mvhr",stream,role,interface:connection("rigid-epp",mainSize)}];
    for(let row=0;row<2;row++)for(let column=0;column<columns;column++) {
      const across=(column-(columns-1)/2)*p.pitch,other=(row-.5)*p.pitch;
      ports.push({key:`branch-${row+1}-${column+1}`,positionMm:vertical?{x:across,y:other,z:p.length/2+p.branchProjection}:{x:p.length/2+p.branchProjection,y:across,z:other},direction:vertical?{x:0,y:0,z:1}:{x:1,y:0,z:0},system:"mvhr",stream,role,interface:connection("semi-rigid-pe",90)});
    }
    const id=standaloneCwRecordId({size,stream,orientation,mainSize});
    return {id,versionId:`${id}.drawing.v1`,group:"Attenuation & distribution",category:"standalone-cw",assemblyOnly:true,placeable:true,manufacturer:"Zehnder",productId:null,
      name:`CW${size} · ${stream} · ${orientation} · DN${mainSize}`,status:"source-backed-manufacturer-dimensions-schematic-assembly",
      source:{sourceId:p.source,title:`ComfoWell ${size} · ${p.generation}`,sourceKind:"owner-uploaded-manufacturer-sheet",locator:`pages ${p.pages}`,verificationStatus:"module-dimensions-verified-assembled-setout-provisional"},
      dimensions:{unit:"mm",body:{width,depth,height:vertical?totalLength:p.depth},evidenceStatus:"provisional-assembly-projection",manufacturerModule:{length:p.length,width:p.casingWidth??p.width,depth:p.depth},note:"Drawing envelope sums separate module and connector projections; assembled seating and mounting brackets require installation review."},
      symbol:{shape:"box",widthMm:width,heightMm:depth,cwProfile:{size,stream,orientation,mainSize,...p}},ports,
      note:"One remote attenuator with round end plate and radial plate. Branch centres are centred drawing setout; source generation is retained. Relative branch row heights are preserved; installed elevation remains unknown. No acoustic performance, fitting compatibility or pressure loss is inferred."};
  }))));
}
export function deriveStandaloneCwGraphic(component,symbol) {
  const profile=symbol.cwProfile;
  return {graphicId:STANDALONE_CW_GRAPHIC_ID,widthMm:symbol.widthMm,depthMm:symbol.heightMm,...profile,
    ports:component.ports??component.catalogueSnapshot?.ports??[],evidenceBoundary:"Source-sized modules; assembled seating and branch offsets remain provisional"};
}
export function standaloneCwShapes(g) {
  const colour=g.stream==="supply"?"#2020ff":"#ff3038",vertical=g.orientation==="vertical";
  const out=[];
  const rect=(x,y,width,height,part,fill="#dce2e3",extra={})=>out.push({tag:"rect",attributes:{x,y,width,height,fill,stroke:"#43565d","stroke-width":3,"data-cw-part":part,...extra}});
  if(vertical) {
    rect(-(g.casingWidth??g.width)/2,-g.depth/2,g.casingWidth??g.width,g.depth,"casing");
    rect(-g.width/2,-g.plateDepth/2,g.width,g.plateDepth,"branch-plate","#747779");
    out.push({tag:"circle",attributes:{cx:0,cy:0,r:g.mainSize/2,fill:"none",stroke:"#52676f","stroke-width":2,"stroke-dasharray":"8 6","data-cw-part":"main-below"}});
    for(const p of g.ports.filter(p=>p.interface.family==="semi-rigid-pe"))out.push({tag:"circle",attributes:{cx:p.positionMm.x,cy:p.positionMm.y,r:45,fill:"#747779",stroke:colour,"stroke-width":3,"data-cw-part":"branch"}});
  } else {
    rect(-g.length/2,-(g.casingWidth??g.width)/2,g.length,g.casingWidth??g.width,"casing");
    rect(-g.length/2+20,-g.width/2+20,g.length-40,g.width-40,"access-panel","#edf0f0");
    rect(-g.length/2-g.mainProjection,-g.mainSize/2,g.mainProjection,g.mainSize,"main-neck","#b5bfc2");
    for(let column=0;column<g.count/2;column++)rect(g.length/2,(column-(g.count/2-1)/2)*g.pitch-45,g.branchProjection,90,"branch-neck","#dce2e3",{stroke:colour});
    for(const x of [-g.length/2,g.length/2])out.push({tag:"line",attributes:{x1:x,y1:-g.width/2,x2:x,y2:g.width/2,stroke:"#52676f","stroke-width":7,"data-cw-part":"clamp"}});
  }
  const labelY=vertical?g.depth/2+32:0;
  out.push({tag:"text",attributes:{x:vertical?0:-20,y:labelY,"text-anchor":"middle",fill:"#29434d","font-size":24,"font-weight":700,"paint-order":"stroke",stroke:"white","stroke-width":4},text:`CW${g.size} · ${g.count} × 90`});
  return out;
}
