import { deriveHrvEppConnectionAllowances } from "./epp-takeoff.mjs";

// A top-view symbol for the scheduled vertical-to-horizontal ceiling turn.
// Centre the rise on the authoritative unit connection; fitting radius remains schematic.
// This never adds a second bend to the takeoff.
export function deriveHrvCeilingElbows(routes, components) {
  return deriveHrvEppConnectionAllowances(routes, components).flatMap(allowance => {
    const route=routes.find(route=>route.id===allowance.routeId);
    const atStart=route.startAttachment?.componentId===allowance.componentId && route.startAttachment?.portId===allowance.portId;
    const points=atStart?route.points:route.points.slice().reverse();
    const origin=points[0];
    const next=points.find(point=>Math.hypot(point.x-origin.x,point.y-origin.y)>1e-6);
    if(!next)return [];
    const length=Math.hypot(next.x-origin.x,next.y-origin.y);
    const dx=(next.x-origin.x)/length,dy=(next.y-origin.y)/length;
    return [{componentId:allowance.componentId,portId:allowance.portId,routeId:route.id,stream:allowance.stream,
      xMm:origin.x,yMm:origin.y,angleDegrees:Math.atan2(dy,dx)*180/Math.PI,
      nominalSizeMm:allowance.nominalSizeMm,basis:allowance.basis,angle:90,
      note:"Top elbow to ceiling: schematic display of the existing per-port allowance; elevation remains unset."}];
  });
}
export function hrvCeilingElbowShapes(elbow) {
  const r=elbow.nominalSizeMm/2,colour=({supply:"#2782b5",extract:"#c15c41",intake:"#409879",exhaust:"#8b6888"})[elbow.stream]??"#617b83";
  return [
    {tag:"rect",attributes:{x:0,y:-r,width:r*1.5,height:r*2,fill:colour,stroke:"#29434d","stroke-width":4,"data-part":"ceiling-elbow-outlet"}},
    {tag:"circle",attributes:{cx:0,cy:0,r,fill:colour,stroke:"#29434d","stroke-width":4,"data-part":"ceiling-elbow-rise"}},
    {tag:"path",attributes:{d:`M ${-r*.5} ${-r*.6} Q ${r*.8} 0 ${-r*.5} ${r*.6}`,fill:"none",stroke:"white","stroke-width":5}},
    {tag:"line",attributes:{x1:r*1.5,y1:-r,x2:r*1.5,y2:r,stroke:"#29434d","stroke-width":5}},
  ];
}
