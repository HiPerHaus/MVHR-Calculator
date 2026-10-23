// Renderer-independent drawing setout shared by CW symbols and typed snap targets.
// Branch-centre setout remains schematic, not installation or acoustic verification.
export const MOUNTED_CW_DIMENSIONS=Object.freeze({
  "320":Object.freeze({widthMm:791,depthMm:566,heightMm:1414,moduleWidthMm:336,branchCount:6}),
  "420":Object.freeze({widthMm:824,depthMm:566,heightMm:1414,moduleWidthMm:436,branchCount:8}),
  "520":Object.freeze({widthMm:924,depthMm:566,heightMm:1414,moduleWidthMm:536,branchCount:10,drainAllowanceBelowMm:250}),
  "625":Object.freeze({widthMm:1029,depthMm:566,heightMm:1414,moduleWidthMm:641,branchCount:12}),
});
export function mountedCwDrawingLayout(component){
  if(component.mvhrDesignIntent?.layout!=="unit-mounted-cw")return null;
  const record=component.catalogueItemId??component.catalogueSnapshot?.recordId??component.id;
  const aero=record?.startsWith("aerofresh-450");
  if(!aero && !/^zehnder-q350-/.test(record??""))return null;
  const size=component.mvhrDesignIntent.cwSize??(aero?"520":"320"),base=MOUNTED_CW_DIMENSIONS[size];
  if(!base)return null;
  const symbol=component.displaySymbol??component.symbol??component.catalogueSnapshot?.symbol;
  const handing=component.mvhrDesignIntent.handing??(record.includes("-left-")?"left":"right");
  const manufacturer=(component.catalogueSnapshot?.connectionSetout??component.connectionSetout)?.orientationConvention==="manufacturer";
  const side=(handing==="left"?-1:1)*(aero&&manufacturer?-1:1);
  const dimensions=!aero?base:size==="625"?{widthMm:970,depthMm:640,heightMm:1400,drainAllowanceBelowMm:150,branchCount:12,moduleWidthMm:641}
    :["320","420"].includes(size)?{...base,widthMm:870-(536-base.moduleWidthMm),depthMm:650,heightMm:null,drainAllowanceBelowMm:null,envelopeStatus:"schematic-layout-allowance",measuredEnvelopeMm:null}
    :{...base,widthMm:870,depthMm:650,heightMm:1400,drainAllowanceBelowMm:150};
  return {widthMm:symbol.widthMm,mountedCw:{size,branchCount:base.branchCount,side},mountedDimensions:dimensions};
}
export function mountedCwDrawingParts(layout){
  if(!layout?.mountedCw)return {plates:[],branches:[]};
  const {side,size}=layout.mountedCw,dimensions=layout.mountedDimensions??MOUNTED_CW_DIMENSIONS[size];
  const moduleWidth=dimensions.moduleWidthMm??((dimensions.branchCount/2-1)*102.5+130);
  const unmirrored=layout.widthMm/2-dimensions.widthMm,x=side===-1?unmirrored:-unmirrored-moduleWidth;
  const columns=dimensions.branchCount/2,pitch=102.5,margin=(moduleWidth-(columns-1)*pitch)/2;
  const plates=[],branches=[];
  for(const stream of ["extract","supply"]){
    const y=stream==="extract"?-dimensions.depthMm/2+26.5:26.5;
    plates.push({x,y,width:moduleWidth,height:230,stream});
    for(let row=0;row<2;row++)for(let column=0;column<columns;column++)branches.push({key:`cw-${stream}-${row+1}-${column+1}`,stream,
      x:x+(side===-1?margin+column*pitch:moduleWidth-margin-column*pitch),y:y+(230-pitch)/2+row*pitch});
  }
  return {plates,branches};
}
export function pendingMountedCwConnections(component){
  return mountedCwDrawingParts(mountedCwDrawingLayout(component)).branches.some(branch=>!component.ports.some(port=>port.id===`${component.id}-port-${branch.key}`));
}
export function enableMountedCwDrawingConnections(component){
  const branches=mountedCwDrawingParts(mountedCwDrawingLayout(component)).branches;
  let changed=false;
  for(const branch of branches){
    const id=`${component.id}-port-${branch.key}`;
    if(component.ports.some(port=>port.id===id))continue;
    component.ports.push({id,definitionId:`mounted-cw-drawing-dn90-v1-${branch.key}`,system:"mvhr",stream:branch.stream,role:branch.stream==="supply"?"Dwelling supply":"Dwelling extract",
      drawingDiameterMm:90,positionMm:{x:branch.x,y:branch.y,z:0},direction:{x:0,y:0,z:1},
      interface:{family:"semi-rigid-pe",nominalSizeMm:90,boreMm:null,outsideDiameterMm:null,matingProfile:null,verificationStatus:"owner-approved-CW-drawing-connection",installationCompatibilityStatus:"unverified"},
      evidence:"CW branch drawing connection at schematic symbol centre; installed setout and elevation require review"});
    changed=true;
  }
  if(changed)component.mountedCwDrawingConnectionVersion=1;
  return changed;
}
