import { MOUNTED_CW_DIMENSIONS, mountedCwDrawingLayout, mountedCwDrawingParts } from "../domain/mounted-cw-drawing-connections.mjs";
export { MOUNTED_CW_DIMENSIONS } from "../domain/mounted-cw-drawing-connections.mjs";
import { deriveCa200Graphic } from "./ca200-profile.mjs";
import { deriveStandaloneCwGraphic } from "./standalone-cw.mjs";
export const EXTERNAL_GRILLE_PLAN_GRAPHIC_ID = "hiper-external-grille-plan-v1";
const Q350_PROFILE_PATTERN = /^zehnder-q(350|450)(?:-de)?-(?:hrv|erv)-(left|right)-(?:drawing|bim)-profile$/u;
const GENERIC_REMOTE_PATTERN = /^generic-(supply|extract)-remote-(round-end-plate|attenuator|radial-plate)$/u;
const GENERIC_COMBINED_PATTERN = /^generic-(supply|extract)-attenuation-distribution-160$/u;

export const Q350_PLAN_GRAPHIC_ID = "zehnder-comfoair-q350-plan-v1";
export const GENERIC_CW_PLAN_GRAPHIC_ID = "hiper-generic-cw-inspired-plan-v1";

export const LUNA_GRILLE_PLAN_GRAPHIC_ID = "hiper-luna-grille-v1";

export const WALL_GRILLE_PLAN_GRAPHIC_ID = "hiper-wall-bulkhead-grille-v1";

export function wallGrillePaths(stream, widthMm, heightMm) {
  if (!["supply", "extract"].includes(stream)) throw new TypeError("Grille stream must be supply or extract");
  positiveFinite(widthMm, "Grille symbol width");
  positiveFinite(heightMm, "Grille symbol height");
  const left = -widthMm / 2, right = widthMm / 2;
  const top = heightMm * 0.14, bottom = heightMm / 2;
  const tip = stream === "supply" ? -heightMm / 2 : top - heightMm * 0.1;
  const base = stream === "supply" ? tip + heightMm * 0.22 : tip - heightMm * 0.22;
  const tail = stream === "supply" ? top : -heightMm / 2;
  const paths = [`M ${left} ${top} H ${right} V ${bottom} H ${left} Z`];
  for (const x of [-widthMm * 0.36, 0, widthMm * 0.36]) {
    const shaftEnd = base;
    paths.push(`M ${x} ${tail} V ${shaftEnd} M ${x} ${tip} L ${x-widthMm*0.085} ${base} L ${x+widthMm*0.085} ${base} Z`);
  }
  return paths;
}

export function lunaGrillePaths(stream, sizeMm) {
  if (!["supply", "extract"].includes(stream)) throw new TypeError("Grille stream must be supply or extract");
  positiveFinite(sizeMm, "Luna symbol size");
  const r = sizeMm * 0.21;
  const paths = [`M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 Z`];
  for (let i = 0; i < 5; i += 1) {
    const angle = -Math.PI/2 + i * 2*Math.PI/5;
    const point = (radius, side = 0) => [Math.cos(angle)*radius - Math.sin(angle)*side, Math.sin(angle)*radius + Math.cos(angle)*side];
    const tip = point(sizeMm * (stream === "supply" ? .47 : .29));
    const base = point(sizeMm * (stream === "supply" ? .39 : .37));
    const tail = point(sizeMm * (stream === "supply" ? .29 : .47));
    const left = [base[0] - Math.sin(angle)*sizeMm*.035, base[1] + Math.cos(angle)*sizeMm*.035];
    const right = [base[0] + Math.sin(angle)*sizeMm*.035, base[1] - Math.cos(angle)*sizeMm*.035];
    paths.push(`M ${tail.join(" ")} L ${base.join(" ")} M ${tip.join(" ")} L ${left.join(" ")} L ${right.join(" ")} Z`);
  }
  return paths;
}

export function deriveComponentPlanGraphic(component) {
  const symbol = component?.displaySymbol ?? component?.symbol ?? component?.catalogueSnapshot?.symbol;
  if (symbol?.ca200Profile) return deepFreeze(deriveCa200Graphic(component,symbol));
  if (symbol?.cwProfile) return deepFreeze(deriveStandaloneCwGraphic(component, symbol));
  if (symbol?.shape === "luna-grille") return deepFreeze({
    graphicId: LUNA_GRILLE_PLAN_GRAPHIC_ID, kind: "owner-schematic-symbol", stream: symbol.stream,
    widthMm: symbol.widthMm, depthMm: symbol.heightMm,
    colour: symbol.stream === "supply" ? "#2020ff" : "#ff2020",
    paths: lunaGrillePaths(symbol.stream, symbol.widthMm), strokeWidths: [4, 1, 1, 1, 1, 1],
    evidenceBoundary: "schematic symbol only; no physical dimensions or connection locations",
  });
  if (symbol?.shape === "wall-grille") return deepFreeze({
    graphicId: WALL_GRILLE_PLAN_GRAPHIC_ID, kind: "owner-schematic-symbol", stream: symbol.stream,
    widthMm: symbol.widthMm, depthMm: symbol.heightMm,
    colour: symbol.stream === "supply" ? "#5050ff" : "#ff3038",
    paths: wallGrillePaths(symbol.stream, symbol.widthMm, symbol.heightMm),
    evidenceBoundary: "schematic symbol only; no physical dimensions or connection locations",
  });
  const recordId = component?.catalogueItemId ?? component?.catalogueSnapshot?.recordId ?? component?.id;
  if(typeof recordId === "string" && /external.*grille|grille.*external/.test(recordId)) {
    const ports=component.ports??component.catalogueSnapshot?.ports??[];
    return deepFreeze({graphicId:EXTERNAL_GRILLE_PLAN_GRAPHIC_ID,kind:"external-weather-grille",widthMm:symbol.widthMm,depthMm:symbol.heightMm,
      view:"plan",combined:ports.filter(p=>["intake","exhaust"].includes(p.stream)).length===2,handing:component.externalGrilleHanding??"left",
      ports:ports.map(p=>({xMm:p.positionMm.x,yMm:p.positionMm.y,stream:p.stream,nominalSizeMm:p.interface?.nominalSizeMm??null})),
      evidenceBoundary:"Louvred weather hood drawing based on supplied Zehnder appearance; generic combined geometry remains schematic."});
  }
  const match = typeof recordId === "string" ? recordId.match(Q350_PROFILE_PATTERN) : null;
  if (match) return deriveQ350PlanGraphic(component, recordId, match[2], match[1]);
  const aeroMatch = typeof recordId === "string" ? recordId.match(/^aerofresh-450-(?:hrv|erv)-(left|right)-drawing-profile$/u) : null;
  if (aeroMatch) return deriveQ350PlanGraphic(component, recordId, aeroMatch[1]);

  const remoteMatch = typeof recordId === "string" ? recordId.match(GENERIC_REMOTE_PATTERN) : null;
  if (remoteMatch) return deriveGenericCwPlanGraphic(component, recordId, remoteMatch[1], remoteMatch[2]);

  const combinedMatch = typeof recordId === "string" ? recordId.match(GENERIC_COMBINED_PATTERN) : null;
  if (combinedMatch) return deriveGenericCwPlanGraphic(component, recordId, combinedMatch[1], "combined");

  return null;
}


// Branch centres are schematic setout; circles retain their nominal 90 mm diameter.
// Shared drawing centres also define typed DN90 connection targets.
// Outdoor snap targets always come from the unchanged authoritative unit ports.
export function q350PortLabelLayout(port, gapMm = 65) {
  const radius = (port.displayOutsideDiameterMm ?? port.outsideDiameterMm ?? port.nominalDiameterMm ?? 160) / 2;
  const side = port.xMm < 0 ? -1 : 1;
  return { xMm: port.xMm + side * (radius + gapMm), yMm: port.yMm,
    anchor: side < 0 ? "end" : "start", leaderStartXmm: port.xMm + side * (radius + 8),
    leaderEndXmm: port.xMm + side * (radius + gapMm - 15) };
}

export function mountedCwShapes(graphic) {
  if(!graphic.mountedCw)return [];
  const parts=mountedCwDrawingParts(graphic),size=graphic.mountedCw.size;
  return [
    ...parts.plates.map(plate=>({tag:"rect",attributes:{x:plate.x,y:plate.y,width:plate.width,height:plate.height,fill:"#747779",stroke:"#303436","stroke-width":3,"data-cw-symbol":size,"data-cw-module":plate.stream}})),
    ...parts.branches.map(branch=>({tag:"circle",attributes:{cx:branch.x,cy:branch.y,r:45,fill:"#747779",stroke:branch.stream==="supply"?"#2020ff":"#ff3038","stroke-width":3,"data-cw-branch":branch.stream,"data-cw-port-key":branch.key}})),
  ];
}

function deriveQ350PlanGraphic(component, recordId, handing, qSize = "350") {
  const symbol = component.displaySymbol ?? component.symbol ?? component.catalogueSnapshot?.symbol;
  const mounted = component.mvhrDesignIntent?.layout === "unit-mounted-cw";
  const aerofresh = recordId.startsWith("aerofresh-450");
  const manufacturerHanding = (component.catalogueSnapshot?.connectionSetout ?? component.connectionSetout)?.orientationConvention === "manufacturer";
  const dwellingSide = (handing === "left" ? -1 : 1) * (aerofresh && manufacturerHanding ? -1 : 1);
  const mountedDimensions = mountedCwDrawingLayout(component)?.mountedDimensions ?? null;
  const widthMm = positiveFinite(symbol?.widthMm, "Q350 plan-symbol width");
  const depthMm = mountedDimensions?.depthMm ?? positiveFinite(symbol?.heightMm, "Q350 plan-symbol depth");
  const drawingBoundsMm = mountedDimensions ? {
    minX: dwellingSide < 0 ? widthMm/2 - mountedDimensions.widthMm : -widthMm/2,
    maxX: dwellingSide < 0 ? widthMm/2 : mountedDimensions.widthMm - widthMm/2,
    minY: -mountedDimensions.depthMm/2, maxY: mountedDimensions.depthMm/2,
  } : null;
  const ports = (component.ports ?? component.catalogueSnapshot?.ports ?? []).filter(port=>port.interface?.family!=="semi-rigid-pe").map((port) => ({
    id: port.id ?? port.key ?? null,
    xMm: finite(port.positionMm?.x, "Q350 port x"),
    yMm: finite(port.positionMm?.y, "Q350 port y"),
    role: port.role,
    stream: port.stream,
    code: q350PortCode(port.role),
    nominalDiameterMm: nullablePositiveFinite(port.interface?.nominalSizeMm),
    boreDiameterMm: nullablePositiveFinite(port.interface?.boreMm),
    outsideDiameterMm: nullablePositiveFinite(port.interface?.outsideDiameterMm),
    // Shared DN160 collar styling is visual only; do not invent physical spigot dimensions.
    displayOutsideDiameterMm: nullablePositiveFinite(port.interface?.outsideDiameterMm) ?? (aerofresh && port.interface?.nominalSizeMm === 160 ? 190 : null),
  }));

  return deepFreeze({
    graphicId: Q350_PLAN_GRAPHIC_ID,
    modelName: aerofresh ? "Aerofresh 450" : `ComfoAir Q${qSize}`,
    shortModelName: aerofresh ? "Aero 450" : `Q${qSize}`,
    brandLabel: aerofresh ? "A" : "Z",
    drawingBoundsMm,
    mountedDimensions: mountedDimensions ? { ...mountedDimensions, source: aerofresh ? mountedDimensions.envelopeStatus === "schematic-layout-allowance" ? "owner-confirmed-common-CW-family-schematic-AF450-layout" : `owner-aerofresh-450-CW${component.mvhrDesignIntent.cwSize ?? "520"}-drawing-2026-10-23` : component.mvhrDesignIntent.cwSize === "625" ? "Zehnder-ComfoWell-625-specifications-2021.02.18-pages-5-7" : "owner-supplied-Q350-Q450-mounted-CW-drawing-2026-10-23", branchDiameterMm: 90, branchCentresStatus: "schematic-not-verified" } : null,
    mountedCw: component.mvhrDesignIntent?.layout === "unit-mounted-cw"
      ? { size: component.mvhrDesignIntent.cwSize ?? "320", branchCount: ({ "320": 6, "420": 8, "520": 10, "625": 12 })[component.mvhrDesignIntent.cwSize ?? "320"] ?? 6, side: dwellingSide }
      : null,
    kind: aerofresh ? "owner-drawing-profile" : "manufacturer-plan-symbol",
    recordId,
    handing,
    handingLabel: handing === "left" ? "LH" : "RH",
    widthMm,
    depthMm,
    frontEdgeYmm: depthMm / 2,
    frontCornerRadiusMm: 34,
    centrePanel: {
      xMm: -108,
      yMm: -depthMm / 2 + 18,
      widthMm: 216,
      heightMm: depthMm - 54,
      cornerRadiusMm: 15,
    },
    frontCue: {
      yMm: depthMm / 2 - 24,
      arrowTipYmm: depthMm / 2 - 8,
    },
    badge: {
      xMm: widthMm / 2 - 82,
      yMm: depthMm / 2 - 50,
      widthMm: 48,
      heightMm: 24,
    },
    ports,
    evidenceBoundary: "plan appearance only; no clearance or installation compatibility",
  });
}

function deriveGenericCwPlanGraphic(component, recordId, stream, partType) {
  const recordVersionId = component.catalogueRecordVersionId ?? component.catalogueSnapshot?.recordVersionId ?? null;
  const symbol = component.displaySymbol ?? component.symbol ?? component.catalogueSnapshot?.symbol;
  const widthMm = positiveFinite(symbol?.widthMm, "Generic CW-inspired plan-symbol width");
  const depthMm = positiveFinite(symbol?.heightMm, "Generic CW-inspired plan-symbol depth");
  const ports = (component.ports ?? component.catalogueSnapshot?.ports ?? []).map((port) => ({
    id: port.id ?? port.key ?? null,
    xMm: finite(port.positionMm?.x, "Generic CW-inspired port x"),
    yMm: finite(port.positionMm?.y, "Generic CW-inspired port y"),
    directionX: finite(port.direction?.x ?? 0, "Generic CW-inspired port direction x"),
    directionY: finite(port.direction?.y ?? 0, "Generic CW-inspired port direction y"),
    role: port.role,
    stream: port.stream,
    family: port.interface?.family ?? null,
    nominalDiameterMm: nullablePositiveFinite(port.interface?.nominalSizeMm),
    boreDiameterMm: nullablePositiveFinite(port.interface?.boreMm),
    outsideDiameterMm: nullablePositiveFinite(port.interface?.outsideDiameterMm),
  }));
  const partLabels = {
    "round-end-plate": "MAIN PLATE",
    attenuator: "ATTENUATOR",
    "radial-plate": "6 × DN90 PLATE",
    combined: "ATTENUATOR / MANIFOLD",
  };
  return deepFreeze({
    graphicId: GENERIC_CW_PLAN_GRAPHIC_ID,
    kind: "generic-provisional-plan-symbol",
    recordId,
    recordVersionId,
    partType,
    partLabel: partLabels[partType],
    stream,
    serviceLabel: stream === "supply" ? "SUPPLY" : "EXTRACT",
    flowDirectionX: stream === "supply" ? 1 : -1,
    widthMm,
    depthMm,
    casingInsetMm: Math.min(16, widthMm / 12, depthMm / 12),
    railWidthMm: Math.min(18, widthMm / 8),
    ports,
    displayIdentity: "GENERIC CW-STYLE",
    verificationLabel: "PROVISIONAL",
    dimensionBasis: typeof recordVersionId === "string" && /\.v(?:2|3)$/u.test(recordVersionId)
      ? "official-cw320-envelope-with-generic-unverified-port-centres"
      : "legacy-generic-envelope-preserved",
    connectorExtentStatus: "unverified-not-included-in-body-envelope",
    evidenceBoundary: "CW320-inspired modular drawing language only; generic fixture, not a verified ComfoWell SKU or installation fit",
  });
}

export function q350CasingPath(graphic) {
  if (graphic?.graphicId !== Q350_PLAN_GRAPHIC_ID) {
    throw new TypeError("Q350 casing path requires a Q350 plan graphic");
  }
  const halfWidth = graphic.widthMm / 2;
  const halfDepth = graphic.depthMm / 2;
  const radius = Math.min(graphic.frontCornerRadiusMm, halfWidth, halfDepth);
  return [
    `M ${-halfWidth} ${-halfDepth}`,
    `H ${halfWidth}`,
    `V ${halfDepth - radius}`,
    `Q ${halfWidth} ${halfDepth} ${halfWidth - radius} ${halfDepth}`,
    `H ${-halfWidth + radius}`,
    `Q ${-halfWidth} ${halfDepth} ${-halfWidth} ${halfDepth - radius}`,
    "Z",
  ].join(" ");
}

export function q350PortCode(role) {
  if (role === "Dwelling supply") return "SUP";
  if (role === "Dwelling extract") return "ETA";
  if (role === "Outdoor intake") return "ODA";
  if (role === "Outdoor exhaust") return "EHA";
  return "AIR";
}

function nullablePositiveFinite(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function positiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be positive and finite`);
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function externalGrilleShapes(graphic) {
  const w=graphic.widthMm,h=graphic.depthMm;
  const shapes=[],push=(tag,attributes,text=null)=>shapes.push({tag,attributes,text});
  if(graphic.combined) {
    // Owner's plan sketch: narrow shared body, short rear collars, one projecting exhaust hood.
    const portRear=Math.min(...graphic.ports.map(p=>p.xMm));
    const rear=portRear+w*.07,thickness=w*.2,front=rear+thickness;
    push("rect",{x:rear,y:-h/2,width:thickness,height:h,fill:"#e3e8e9",stroke:"#52656d","stroke-width":4,"data-part":"shared-body"});
    const exhaust=graphic.ports.find(p=>p.stream==="exhaust");
    if(exhaust)push("rect",{x:front,y:exhaust.yMm-h*.135,width:thickness*1.6,height:h*.27,fill:"#d9e1e3",stroke:"#52656d","stroke-width":4,"data-part":"projecting-exhaust-hood"});
    for(const port of graphic.ports) {
      const y=port.yMm,d=port.nominalSizeMm??Math.min(160,h*.35),colour=port.stream==="intake"?"#359a78":"#89617d";
      push("rect",{x:port.xMm,y:y-d/2,width:rear-port.xMm,height:d,fill:"#d1dadd",stroke:"#52656d","stroke-width":3,"data-part":"rear-duct-neck"});
      push("text",{x:rear+thickness/2,y:y+8,fill:colour,"font-size":20,"font-weight":750,"text-anchor":"middle"},port.stream==="intake"?"ODA":"EHA");
    }
    return shapes;
  }
  push("rect",{x:-w/2,y:-h/2,width:w,height:h,rx:8,fill:"#e1e5e6",stroke:"#52656d","stroke-width":4});
  push("rect",{x:-w/2+7,y:-h/2+7,width:w-14,height:h-14,rx:4,fill:"#f1f3f3",stroke:"#8c9ba1","stroke-width":2});
  if(!graphic.combined) {
    for(let i=1;i<=4;i++) {
      const y=-h/2+h*i/5;
      push("line",{x1:-w*.42,y1:y,x2:w*.42,y2:y,stroke:"#61747b","stroke-width":3});
      push("line",{x1:-w*.42,y1:y+2,x2:w*.42,y2:y+2,stroke:"white","stroke-width":1});
    }
  }
  return shapes;
}
