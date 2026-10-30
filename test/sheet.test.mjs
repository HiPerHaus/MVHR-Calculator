import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  a3PageBounds,
  createA3SheetModel,
  escapeXml,
  renderA3SheetSvg,
  wrapSheetText,
} from "../src/sheets/a3-sheet.mjs";
import {
  applyCommand,
  createProject,
  identityQuaternion,
  knownMm,
  unknownMm,
} from "../src/domain/spatial.mjs";
import { createSyntheticComponent } from "../src/editor/synthetic-catalogue.mjs";
import { createCatalogueComponent } from "../src/editor/component-catalogue.mjs";
import { createEquipmentAssembly } from "../src/editor/equipment-assemblies.mjs";
import {
  createDxfReferenceRecords,
  inspectAsciiDxf,
  transformDxfReferenceGeometry,
} from "../src/import/dxf-reference.mjs";

test("A3 page bounds are exact for landscape and portrait", () => {
  assert.deepEqual(a3PageBounds("landscape"), {
    xMm: 0,
    yMm: 0,
    widthMm: 420,
    heightMm: 297,
    orientation: "landscape",
  });
  assert.deepEqual(a3PageBounds("portrait"), {
    xMm: 0,
    yMm: 0,
    widthMm: 297,
    heightMm: 420,
    orientation: "portrait",
  });
  assert.throws(() => a3PageBounds("square"), /landscape or portrait/);
});

test("a known ten-metre wall derives a numeric 1:40 sheet scale from model millimetres", () => {
  const sheet = createA3SheetModel(projectWithWall(10000), metadata());
  assert.equal(sheet.page.orientation, "landscape");
  assert.equal(sheet.fit.kind, "numeric");
  assert.equal(sheet.fit.label, "1:40");
  assert.equal(sheet.fit.denominator, 40);
  assert.equal(sheet.fit.modelMmPerSheetMm, 40);
  const projectedLengthMm = 10000 * sheet.fit.transform.scale;
  assert.equal(projectedLengthMm, 250);
  assert.ok(projectedLengthMm <= sheet.fit.innerBounds.widthMm);
});

test("uncalibrated input forces an explicit NTS sheet without a numeric scale claim", () => {
  const project = addReference(projectWithWall(3000), { calibrated: false });
  const sheet = createA3SheetModel(project, metadata());
  const svg = renderA3SheetSvg(sheet);
  assert.equal(sheet.fit.kind, "not-to-scale");
  assert.equal(sheet.fit.denominator, null);
  assert.equal(sheet.fit.modelMmPerSheetMm, null);
  assert.match(sheet.fit.label, /^NTS/);
  assert.match(svg, /UNCALIBRATED REFERENCE · DISPLAY ONLY · NOT TO SCALE/);
  assert.doesNotMatch(svg, />1:\d+</);
});

test("the sheet legend, plan references and schedule preserve service and evidence meaning", () => {
  let project = projectWithWall(4000);
  project = applyCommand(project, {
    type: "component.add",
    component: createSyntheticComponent("synthetic-supply-terminal", {
      id: "component-supply",
      floorId: "floor-ground",
      xMm: 1000,
      yMm: 1000,
    }),
  });
  project = applyCommand(project, {
    type: "route.add",
    route: {
      id: "route-radial",
      floorId: "floor-ground",
      system: "mvhr",
      stream: "supply",
      role: null,
      ductKind: "semi-rigid-radial",
      startAttachment: null,
      endAttachment: null,
      points: [
        { x: 1000, y: 1000, z: unknownMm("not set") },
        { x: 3000, y: 1600, z: unknownMm("not set") },
      ],
    },
  });
  project = addReference(project, { calibrated: true });
  const sheet = createA3SheetModel(project, metadata());
  assert.deepEqual(sheet.printScene.legend.map((entry) => entry.key), [
    "wall",
    "service-supply",
    "component",
  ]);
  const svg = renderA3SheetSvg(sheet);
  assert.match(svg, /data-kind="component"[^>]*data-schedule-ref="P01"/);
  assert.doesNotMatch(svg.slice(svg.indexOf('<g id="drawing-content"'), svg.indexOf('</g>', svg.indexOf('<g id="drawing-content"'))), /<text\b/);
  assert.match(svg, /Supply duct — drawing route/);
  assert.match(svg, /data-kind="parts-schedule"/);
  assert.match(svg, /Generic supply terminal/);
  assert.match(svg, /unmatched provisional/);
  assert.match(svg, /data-kind="route-body"/);
  assert.match(svg, /data-schedule-ref="D01"/);
  assert.doesNotMatch(svg, /Calibrated PNG reference — locked underlay/);
});

test("A3 uses the shared Q350 plan graphic for both handed profiles and rotated placement", () => {
  let project = projectWithWall(5000);
  const left = createCatalogueComponent("zehnder-q350-hrv-left-drawing-profile", {
    id: "q350-left-sheet",
    floorId: "floor-ground",
    xMm: 1200,
    yMm: 1300,
  });
  const right = createCatalogueComponent("zehnder-q350-hrv-right-drawing-profile", {
    id: "q350-right-sheet",
    floorId: "floor-ground",
    xMm: 3000,
    yMm: 1600,
  });
  project = applyCommand(project, { type: "component.add", component: left });
  project = applyCommand(project, { type: "component.add", component: right });
  project = applyCommand(project, {
    type: "component.rotateFloorZ",
    componentId: right.id,
    angleRad: Math.PI / 2,
  });

  const sheet = createA3SheetModel(project, metadata());
  assert.deepEqual(sheet.printScene.components.map((component) => component.planGraphic.handing), ["left", "right"]);
  assert.equal(sheet.printScene.components[0].planGraphic.widthMm, 725);
  assert.equal(sheet.printScene.components[0].planGraphic.ports[0].outsideDiameterMm, 190);
  assert.equal(Math.round(sheet.printScene.components[1].yawRad * 180 / Math.PI), 90);

  const svg = renderA3SheetSvg(sheet);
  assert.equal((svg.match(/data-plan-graphic="zehnder-comfoair-q350-plan-v1"/gu) ?? []).length, 2);
  assert.match(svg, /data-q350-handing="left"/);
  assert.match(svg, /data-q350-handing="right"/);
  assert.match(svg, /data-q350-port-role="Dwelling supply"/);
  assert.doesNotMatch(svg, />SUP<\/text>/);
  assert.doesNotMatch(svg, />ETA<\/text>/);
  assert.doesNotMatch(svg, />Q350 LH<\/text>/);
  assert.doesNotMatch(svg, />Q350 RH<\/text>/);
  assert.match(svg, /rotate\(90\)/);
});

test("A3 shares the provisional CW-inspired assembly graphic for supply, extract and rotation", () => {
  let project = projectWithWall(8000);
  const supply = createEquipmentAssembly("generic-remote-supply-attenuation-set", {
    id: "sheet-supply-assembly",
    floorId: "floor-ground",
    xMm: 1800,
    yMm: 1400,
  });
  const extract = createEquipmentAssembly("generic-remote-extract-attenuation-set", {
    id: "sheet-extract-assembly",
    floorId: "floor-ground",
    xMm: 5200,
    yMm: 2400,
  });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...supply });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...extract });
  project = applyCommand(project, {
    type: "equipmentAssembly.rotateFloorZ",
    assemblyId: extract.assembly.id,
    angleRad: Math.PI,
  });

  const sheet = createA3SheetModel(project, metadata());
  const graphics = sheet.printScene.components.map((component) => component.planGraphic);
  assert.equal(graphics.length, 6);
  assert.equal(sheet.fit.label, "1:40");
  assert.deepEqual(graphics.slice(0, 3).map((graphic) => [graphic.widthMm, graphic.depthMm]), [
    [51, 336], [500, 320], [41, 336],
  ]);
  assert.deepEqual(graphics.map((graphic) => graphic.partType), [
    "round-end-plate", "attenuator", "radial-plate",
    "round-end-plate", "attenuator", "radial-plate",
  ]);
  assert.deepEqual(graphics.map((graphic) => graphic.stream), [
    "supply", "supply", "supply", "extract", "extract", "extract",
  ]);

  const svg = renderA3SheetSvg(sheet);
  assert.equal((svg.match(/data-plan-graphic="hiper-generic-cw-inspired-plan-v1"/gu) ?? []).length, 6);
  assert.equal((svg.match(/data-generic-cw-status="provisional"/gu) ?? []).length, 6);
  assert.equal((svg.match(/data-generic-cw-part="attenuator"/gu) ?? []).length, 2);
  assert.doesNotMatch(svg, /GENERIC · PROVISIONAL/);
  assert.doesNotMatch(svg, /6×DN90 PLATE/);
  assert.match(svg, /data-generic-cw-service="supply"/);
  assert.match(svg, /data-generic-cw-service="extract"/);
  assert.match(svg, /<g transform="scale\(0\.025\)"><rect[^>]*width="500" height="320"/);
  assert.match(svg, /rotate\(180\)/);
});

test("print scene carries Twin smooth bodies, exact endpoints and saved-centreline schedule quantity", () => {
  let project = projectWithWall(6000);
  project = applyCommand(project, {
    type: "route.add",
    route: {
      id: "route-twin-sweep",
      floorId: "floor-ground",
      system: "mvhr",
      stream: "extract",
      role: "Dwelling extract",
      ductKind: "semi-rigid-radial",
      parallelRunCount: 2,
      startAttachment: null,
      endAttachment: null,
      points: [
        { x: 500, y: 500, z: knownMm(2400, "sheet sweep fixture") },
        { x: 2500, y: 500, z: knownMm(2400, "sheet sweep fixture") },
        { x: 2500, y: 2500, z: knownMm(2400, "sheet sweep fixture") },
      ],
    },
  });

  const sheet = createA3SheetModel(project, metadata());
  const route = sheet.printScene.routes[0];
  const ductLine = sheet.partsSchedule.routeLines[0];
  assert.equal(route.arrangement, "twin");
  assert.equal(route.lanes.length, 2);
  assert.ok(route.sampledCentreline.length > 3);
  assert.deepEqual(route.lanes[0][0], { x: 500, y: 500 });
  assert.deepEqual(route.lanes[1][0], { x: 500, y: 500 });
  assert.deepEqual(route.lanes[0].at(-1), { x: 2500, y: 2500 });
  assert.deepEqual(route.lanes[1].at(-1), { x: 2500, y: 2500 });
  assert.equal(ductLine.savedCentrelinePlanMm, 4000);
  assert.equal(ductLine.knownMultipliedPlanMm, 8000);
  assert.equal(sheet.scheduleBounds.yMm > sheet.drawingBounds.yMm + sheet.drawingBounds.heightMm, true);

  const svg = renderA3SheetSvg(sheet);
  assert.equal((svg.match(/data-kind="route-body"/gu) ?? []).length, 2);
  assert.doesNotMatch(svg, /D01 · Extract · Twin/);
  assert.match(svg, /8 m plan qty/);
  assert.match(svg, /Display sweeps, bends, fittings, allowances and waste are excluded/);
});

test("sheet schedule reports display overflow without dropping model lines", () => {
  let project = projectWithWall(4000);
  for (let index = 1; index <= 16; index += 1) {
    const component = createSyntheticComponent("synthetic-supply-terminal", {
      id: `component-${index}`,
      floorId: "floor-ground",
      xMm: 200 + index * 180,
      yMm: 1200,
    });
    component.displayName = `Synthetic terminal variant ${index}`;
    component.catalogueItemId = `synthetic-terminal-${index}`;
    component.catalogueRecordVersionId = `synthetic-terminal-${index}.v1`;
    component.catalogueSnapshot.recordId = component.catalogueItemId;
    component.catalogueSnapshot.recordVersionId = component.catalogueRecordVersionId;
    component.catalogueSnapshot.displayName = component.displayName;
    project = applyCommand(project, { type: "component.add", component });
  }

  const sheet = createA3SheetModel(project, metadata());
  assert.equal(sheet.partsSchedule.componentLines.length, 16);
  const svg = renderA3SheetSvg(sheet);
  assert.match(svg, /3 additional schedule lines/);
  assert.match(svg, /Not omitted from model/);
});

test("SVG text is escaped, invalid XML characters are replaced, and overflow is bounded", () => {
  const longText = `<North & \"South\">\u0001\ud800 ${"overflow ".repeat(80)}`;
  const sheet = createA3SheetModel(projectWithWall(2000), metadata({
    projectName: longText,
    drawingTitle: "<script>alert('x')</script>",
  }));
  const svg = renderA3SheetSvg(sheet);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;alert\(&apos;x&apos;\)&lt;\/script&gt;/);
  assert.match(svg, /&lt;North &amp; &quot;South&quot;&gt;�/);
  assert.doesNotMatch(svg, /\u0001/u);
  assert.doesNotMatch(svg, /\ud800/u);
  assert.match(svg, /…/);
  assert.equal(wrapSheetText("abcdefghijk", 5, 2).at(-1).endsWith("…"), true);
  assert.deepEqual(wrapSheetText("abcdefghijk", 5, 3), ["abcde", "fghij", "k"]);
  assert.equal(escapeXml("A&B<C>"), "A&amp;B&lt;C&gt;");
  assert.throws(
    () => createA3SheetModel(projectWithWall(2000), metadata({ issueDate: "2026-02-31" })),
    /YYYY-MM-DD/,
  );
});

test("the sheet is clipped, visibly draft, and contains no editor overlay state", () => {
  const sheet = createA3SheetModel(projectWithWall(5000), metadata());
  const svg = renderA3SheetSvg(sheet);
  assert.match(svg, /clipPath id="drawing-clip"/);
  assert.match(svg, /clip-path="url\(#drawing-clip\)"/);
  assert.match(svg, /data-kind="draft-watermark" clip-path="url\(#drawing-clip\)"/);
  assert.match(svg, /DRAFT PREVIEW · NOT FOR CONSTRUCTION/);
  assert.match(svg, /Preliminary — not for construction/);
  assert.doesNotMatch(svg, /selected|pointer|snap-marker|toolbar|draft-layer/);
  assert.match(svg, /CHECKED BY/);
});

test("captured print scenes render deterministically despite later working-project edits", () => {
  const project = projectWithWall(6000);
  const sheet = createA3SheetModel(project, metadata());
  const first = renderA3SheetSvg(sheet);
  project.wallNodes[1].positionMm.x = 9000;
  project.walls[0].thicknessMm = 350;
  const second = renderA3SheetSvg(sheet);
  assert.equal(second, first);
  assert.equal(sheet.printScene.walls[0].end.x, 6000);
  assert.equal(Object.isFrozen(sheet), true);
  const rebuilt = createA3SheetModel(projectWithWall(6000), metadata());
  assert.equal(rebuilt.printSceneFingerprint, sheet.printSceneFingerprint);
  assert.equal(renderA3SheetSvg(rebuilt), first);
});

test("a calibrated PNG uses its saved model transform in the clipped print scene", () => {
  const project = addReference(projectWithFloor(), { calibrated: true, translationX: 500, translationY: 1000 });
  const sheet = createA3SheetModel(project, metadata());
  const svg = renderA3SheetSvg(sheet);
  assert.equal(sheet.fit.label, "1:40");
  assert.match(svg, /data-calibration="calibrated"/);
  assert.match(svg, /transform="matrix\(0\.25 0 0 0\.25 /);
  assert.match(svg, /data-kind="reference"/);
});

test("a locked DXF reference uses its validated layer and source-to-floor transform on the A3 scene", async () => {
  const sourceText = await readFile(new URL("./fixtures/dxf/supported-ac1015.dxf", import.meta.url), "utf8");
  const candidate = await inspectAsciiDxf(sourceText, { fileName: "supported-ac1015.dxf" });
  const records = createDxfReferenceRecords(candidate, dxfSettings({
    includedLayers: ["WALLS", "SYMBOLS"],
    transform: {
      localOriginSource: { x: 0, y: 0 },
      translationMm: { x: 500, y: 1000 },
      rotationRad: Math.PI / 2,
    },
  }));
  const project = applyCommand(projectWithFloor(), { type: "reference.addCad", ...records });
  const expected = transformDxfReferenceGeometry(records.asset, records.reference);
  const sheet = createA3SheetModel(project, metadata());
  const cad = sheet.printScene.cadReferences[0];
  const svg = renderA3SheetSvg(sheet);

  assert.deepEqual(cad.geometry, expected.geometry);
  assert.deepEqual(cad.boundsMm, expected.boundsMm);
  assert.deepEqual(cad.includedLayers, ["SYMBOLS", "WALLS"]);
  assert.equal(sheet.fit.kind, "numeric");
  assert.match(svg, /data-kind="cad-reference"/);
  assert.match(svg, /data-source-units="mm"/);
  assert.match(svg, /data-layers="SYMBOLS,WALLS"/);
  assert.match(svg, /Synthetic AC1015 DXF reference — locked underlay,/);
  const transformedLine = expected.geometry.find((item) => item.sourceHandle === "10");
  const expectedX = sheet.fit.transform.offsetX + transformedLine.start.x * sheet.fit.transform.scale;
  assert.match(svg, new RegExp(`x1="${formatNumber(expectedX)}"`));
});

test("accepted unsupported DXF content remains a visible A3 warning", async () => {
  const sourceText = await readFile(new URL("./fixtures/dxf/unsupported-content-ac1015.dxf", import.meta.url), "utf8");
  const candidate = await inspectAsciiDxf(sourceText, { fileName: "unsupported-content-ac1015.dxf" });
  const records = createDxfReferenceRecords(candidate, dxfSettings({
    includedLayers: ["SUPPORTED"],
    acceptPartial: true,
  }));
  const project = applyCommand(projectWithFloor(), { type: "reference.addCad", ...records });
  const sheet = createA3SheetModel(project, metadata());
  const svg = renderA3SheetSvg(sheet);

  assert.equal(sheet.printScene.hasPartialCadReference, true);
  assert.equal(sheet.printScene.cadReferences[0].omittedEntities, 2);
  assert.match(svg, /data-kind="cad-reference-warning"/);
  assert.match(svg, /DXF REFERENCE · UNSUPPORTED CONTENT OMITTED · REVIEW DIAGNOSTICS/);
  assert.match(svg, /DXF reference has accepted unsupported-content/);
});

function projectWithFloor() {
  return applyCommand(createProject("project-sheet-fixture"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "sheet test") },
        orientation: identityQuaternion(),
      },
    },
  });
}

function projectWithWall(lengthMm) {
  return applyCommand(projectWithFloor(), {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["node-a", "node-b"],
    wallIds: ["wall-a"],
    points: [
      { x: 0, y: 0, z: unknownMm("not set") },
      { x: lengthMm, y: 0, z: unknownMm("not set") },
    ],
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("not set"),
    referenceLine: "centreline",
    classification: "physical",
  });
}

function addReference(project, { calibrated, translationX = 0, translationY = 0 }) {
  const scale = calibrated ? knownMm(10, "sheet test calibration") : unknownMm("uncalibrated");
  return applyCommand(project, {
    type: "reference.addImage",
    asset: {
      id: "asset-plan",
      kind: "image",
      fileName: "synthetic-plan.png",
      mediaType: "image/png",
      byteLength: 3,
      sha256: "0".repeat(64),
      widthPx: 1000,
      heightPx: 500,
      dataUrl: "data:image/png;base64,AAAA",
    },
    reference: {
      id: "reference-plan",
      floorId: "floor-ground",
      assetId: "asset-plan",
      visible: true,
      locked: true,
      opacity: 0.55,
      transform: {
        translationMm: { x: translationX, y: translationY },
        rotationRad: 0,
        scaleMmPerPixel: scale,
      },
      calibration: calibrated ? {
        sourcePointApx: { x: 0, y: 0 },
        sourcePointBpx: { x: 1000, y: 0 },
        knownDistanceMm: 10000,
        inputUnit: "m",
        acceptedAtUtc: "2026-10-15T00:00:00.000Z",
        scaleMmPerPixel: 10,
        modelScaleMode: "reference-only",
        modelScaleFactor: 1,
        secondCheck: null,
      } : null,
    },
  });
}

function dxfSettings(overrides = {}) {
  return {
    assetId: "cad-asset-sheet",
    referenceId: "cad-reference-sheet",
    floorId: "floor-ground",
    includedLayers: ["WALLS"],
    unitChoice: "mm",
    transform: {
      localOriginSource: { x: 0, y: 0 },
      translationMm: { x: 0, y: 0 },
      rotationRad: 0,
    },
    visible: true,
    opacity: 0.55,
    acceptPartial: false,
    ...overrides,
  };
}

function formatNumber(value) {
  const rounded = Math.round(value * 1000000) / 1000000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function metadata(overrides = {}) {
  return {
    includeSchedule:true,
    floorId: "floor-ground",
    orientation: "landscape",
    projectName: "Synthetic sheet fixture",
    siteName: "Test site",
    clientName: "Not set",
    drawingTitle: "Ground Floor Manual MVHR Plan",
    drawingId: "HS-DRAFT-001",
    issueDate: "2026-10-15",
    status: "Preliminary — not for construction",
    revision: "DRAFT",
    revisionText: "Working-draft preview",
    drawnBy: "",
    checkedBy: "",
    ...overrides,
  };
}

test("sheet preserves full raster payloads for PDF page underlays and logos, and prints building area",async()=>{
 const bytes=await readFile(new URL('./fixtures/sheet-plan.png',import.meta.url));
 const dataUrl=`data:image/png;base64,${bytes.toString('base64')}`;
 assert.ok(dataUrl.length>500,'exercise a real image exceeding the text-label limit');
 let project=addReference(projectWithFloor(),{calibrated:true});
 project.referenceAssets[0].dataUrl=dataUrl;project.referenceAssets[0].byteLength=bytes.length;
 project=applyCommand(project,{type:'floorArea.create',outline:{id:'sheet-building-area',floorId:'floor-ground',name:'Serviced building area',geometrySource:'manual-floor-area-outline',purpose:'preliminary-quoting',areaConvention:'closed-plan-outline',measurementBasis:'floor-local-plan-mm',vertices:[[400,400],[4600,400],[4600,3100],[400,3100]].map(([x,y],i)=>({id:`area-vertex-${i}`,positionMm:{x,y,z:unknownMm('not set')}})),holes:[]}});
 const sheet=createA3SheetModel(project,{...metadata(),includeSchedule:false,companyLogoDataUrl:dataUrl});
 const svg=renderA3SheetSvg(sheet);
 assert.equal((svg.match(/href="([^"]+)"/g)||[]).filter(href=>href===`href="${dataUrl}"`).length,2,'both image and company logo retain their complete payload');
 assert.match(svg,/data-kind="building-area"/);assert.ok(sheet.printScene.legend.some(item=>item.key==='building-area'));
 assert.ok(svg.indexOf('data-kind="reference"')<svg.indexOf('data-kind="building-area"'),'area overlays the plan');
 assert.equal(sheet.printScene.floorAreas[0].vertices.length,4);
 project.floorReferences[0].visible=false;
 const areaOnly=createA3SheetModel(project,metadata());assert.notEqual(areaOnly.fit.transform,null,'building area alone determines sheet extent');
});


test("Luna symbol sits above radial duct with an opaque centre", () => {
  let project = projectWithWall(10000);
  project = applyCommand(project, {type: "component.add", component: createCatalogueComponent("luna-supply", {
    id: "luna-over-duct", floorId: "floor-ground", xMm: 1000, yMm: 1000,
  })});
  project = applyCommand(project, {type: "route.add", route: {
    id: "duct-under-luna", floorId: "floor-ground", system: "mvhr", stream: "supply", role: null,
    ductKind: "semi-rigid-radial", startAttachment: null, endAttachment: null,
    points: [{x:1000,y:1000,z:unknownMm("not set")},{x:3000,y:1000,z:unknownMm("not set")}],
  }});
  const svg = renderA3SheetSvg(createA3SheetModel(project, metadata()));
  assert.ok(svg.indexOf('data-id="luna-over-duct"') > svg.indexOf('data-id="duct-under-luna"'));
  const placed=svg.slice(svg.indexOf('data-id="luna-over-duct"'));
  assert.match(placed, /<circle data-part="luna-duct-mask"[^>]+fill="white"/);
  assert.match(placed, /<path d="[^"]+" fill="white"/);
  assert.match(svg, /data-kind="legend-terminal"[^>]*>[\s\S]*?<circle data-part="luna-duct-mask"[^>]+fill="white"/);
});

test("external grille face sits above the duct and keeps its authoritative route endpoint", () => {
  let project=projectWithWall(10000);
  const grille=createCatalogueComponent("generic-external-grille-intake-dn160",{id:"outdoor-over-duct",floorId:"floor-ground",xMm:3000,yMm:1000});
  project=applyCommand(project,{type:"component.add",component:grille});
  const port=grille.ports[0];
  const requestedEndpoint={x:2820,y:1000,z:unknownMm("not set")};
  project=applyCommand(project,{type:"route.add",route:{
    id:"duct-under-outdoor",floorId:"floor-ground",system:"mvhr",stream:"intake",role:"Outdoor intake",
    ductKind:"epp-rigid-dn160",parallelRunCount:1,startAttachment:null,endAttachment:{componentId:grille.id,portId:port.id},
    connectionInterface:{family:"rigid-epp",nominalSizeMm:160,connectionType:"drawing-only",drawingConnectionClass:"circular-dn160",installationCompatibility:"unverified"},
    points:[{x:1000,y:1000,z:unknownMm("not set")},requestedEndpoint],
  }});
  const endpoint=structuredClone(project.routes[0].points.at(-1));
  assert.deepEqual({x:endpoint.x,y:endpoint.y},{x:2820,y:1000});
  const svg=renderA3SheetSvg(createA3SheetModel(project,metadata()));
  assert.ok(svg.indexOf('data-id="outdoor-over-duct"')>svg.indexOf('data-id="duct-under-outdoor"'));
  assert.match(svg.slice(svg.indexOf('data-id="outdoor-over-duct"')),/<rect x="-180" y="-130" width="360" height="260"[^>]+fill="#e1e5e6"/);
  assert.deepEqual(project.routes[0].points.at(-1),endpoint,"presentation masking must not shorten the route");
});


test("outdoor legend distinguishes combined, intake and exhaust using the drawn profiles", () => {
  let project=projectWithWall(10000);
  for(const [index,service] of ["combined","intake","exhaust"].entries()) {
    project=applyCommand(project,{type:"component.add",component:createCatalogueComponent(`generic-external-grille-${service}-dn160`,{
      id:`outdoor-${service}`,floorId:"floor-ground",xMm:1000+index*1500,yMm:1000,
    })});
  }
  const sheet=createA3SheetModel(project,metadata());
  const entries=sheet.printScene.legend.filter(entry=>entry.key.startsWith("external-grille-"));
  assert.deepEqual(entries.map(entry=>entry.key),["external-grille-combined","external-grille-intake","external-grille-exhaust"]);
  const svg=renderA3SheetSvg(sheet);
  for(const type of ["combined","intake","exhaust"]) assert.ok(svg.includes(`data-grille-type="${type}"`));
  assert.match(svg,/Combined outdoor intake \/ exhaust grille/);
  assert.match(svg,/Separate outdoor intake grille/);
  assert.match(svg,/Separate outdoor exhaust grille/);
  const drawing=svg.split('<g id="drawing-content"')[1].split('<text data-kind="draft-watermark"')[0];
  assert.equal((drawing.match(/data-part="airflow-label"/g)||[]).length,4);
  assert.equal((drawing.match(/>Outside Air<\/text>/g)||[]).length,2);
  assert.equal((drawing.match(/>Exhaust air out<\/text>/g)||[]).length,2);
  assert.doesNotMatch(drawing,/>ODA<|>EHA<|>P\d+<\/text>/);
  assert.equal((drawing.match(/data-part="airflow-arrow"/g)||[]).length,4);
  assert.match(drawing,/data-stream="intake" data-flow-x="-1" data-flow-y="0"/);
  assert.match(drawing,/data-stream="exhaust" data-flow-x="1" data-flow-y="0"/);
});
