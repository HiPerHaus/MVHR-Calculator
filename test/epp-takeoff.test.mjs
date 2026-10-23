import assert from "node:assert/strict";
import test from "node:test";
import { deriveEppTakeoff, deriveEppElbowStock } from "../src/editor/epp-takeoff.mjs";
import { knownMm, unknownMm } from "../src/domain/spatial.mjs";
import { routeFamilyForKind } from "../src/editor/component-catalogue.mjs";

function route(points, runs = 1, kind = "epp-rigid-dn160") {
  return { id:"epp-test", floorId:"floor-ground", system:"mvhr", stream:"intake", role:"Outdoor intake", ductKind:kind,
    connectionInterface:routeFamilyForKind(kind).connectionInterface, parallelRunCount:runs,
    startAttachment:null, endAttachment:null,
    points: points.map(([x,y,z=0])=>({x,y,z:z === null ? unknownMm("not set") : knownMm(z,"test")})) };
}

test("EPP counts stock lengths, included sockets and one extra sleeve per elbow without changing routes", () => {
  const input = [route([[0,0],[1500,0],[1500,1000]])];
  const saved = structuredClone(input);
  const [line] = deriveEppTakeoff(input);
  assert.equal(line.stockLengthQuantity,3);
  assert.equal(line.includedSocketQuantity,3);
  assert.equal(line.elbow90Quantity,1);
  assert.equal(line.extraSleeveQuantity,1);
  assert.equal(line.totalCentrelineMm,2500);
  assert.equal(line.basis,"developed-centreline-allowance");
  assert.deepEqual(input,saved);
});

test("EPP uses vertical geometry when known and marks unknown elevations as plan only", () => {
  const [vertical] = deriveEppTakeoff([route([[0,0,0],[1000,0,0],[1000,0,1000]])]);
  assert.equal(vertical.stockLengthQuantity,2);
  assert.equal(vertical.elbow90Quantity,1);
  const [plan] = deriveEppTakeoff([route([[0,0,null],[1000,0,null],[1000,1000,null]])]);
  assert.equal(plan.basis,"plan-only-allowance");
  assert.equal(plan.reviewRequired,true);
  assert.equal(plan.elbow90Quantity,1);
});

test("EPP multiplies twin runs, preserves unset counts and does not count collinear vertices", () => {
  const points = [[0,0],[500,0],[1000,0],[1000,500]];
  const [twin] = deriveEppTakeoff([route(points,2,"epp-rigid-dn125")]);
  assert.equal(twin.stockLengthQuantity,4);
  assert.equal(twin.extraSleeveQuantity,2);
  assert.equal(twin.productReferences.sleeve,"AER-DUC-DN125-SL");
  const [unset] = deriveEppTakeoff([route(points,null)]);
  assert.equal(unset.stockLengthQuantity,null);
  assert.equal(unset.extraSleeveQuantity,null);
  assert.equal(unset.stockLengthsPerRun,2);
});

test("EPP counts 45 degree half-elbows separately from full 90 degree bends", () => {
  const [line] = deriveEppTakeoff([route([[0,0],[1000,0],[1500,500]])]);
  assert.equal(line.elbow45Quantity,1);
  assert.equal(line.elbow90Quantity,0);
  assert.equal(line.extraSleeveQuantity,1);
  assert.equal(line.reviewRequired,false);
  assert.deepEqual(deriveEppTakeoff([route([[0,0],[1000,0]],1,"semi-rigid-radial")]),[]);
});


test("45 degree halves share whole 90 degree elbow stock across matching diameters", () => {
  const half = route([[0,0],[1000,0],[1500,500]]);
  const full = route([[0,0],[1000,0],[1000,1000]]);
  const original = deriveEppTakeoff([half, half, full]);
  const [stock] = deriveEppElbowStock(original);
  assert.equal(stock.full90Quantity,1);
  assert.equal(stock.half45Quantity,2);
  assert.equal(stock.elbow90StockQuantity,2);
  assert.equal(stock.spareHalfQuantity,0);
  assert.equal(original.reduce((n,line)=>n+line.extraSleeveQuantity,0),3);
  const [odd] = deriveEppElbowStock(deriveEppTakeoff([half]));
  assert.equal(odd.elbow90StockQuantity,1);
  assert.equal(odd.spareHalfQuantity,1);
  const sizes = deriveEppElbowStock(deriveEppTakeoff([half,route([[0,0],[1000,0],[1500,500]],1,"epp-rigid-dn125")]));
  assert.equal(sizes.length,2);
  assert.equal(sizes.reduce((n,s)=>n+s.elbow90StockQuantity,0),2);
  const [unset] = deriveEppElbowStock(deriveEppTakeoff([route([[0,0],[1000,0],[1500,500]],null)]));
  assert.equal(unset.pendingRouteCount,1);
});

test("HRV ceiling allowance counts unique connected unit ports, not route runs or remote boxes", async () => {
  const {deriveHrvEppConnectionAllowances}=await import("../src/editor/epp-takeoff.mjs");
  const {createCatalogueComponent}=await import("../src/editor/component-catalogue.mjs");
  const unit=createCatalogueComponent("zehnder-q350-hrv-right-drawing-profile",{id:"unit-test",floorId:"floor-ground",xMm:0,yMm:0});
  const box=createCatalogueComponent("generic-supply-attenuation-distribution-160",{id:"box-test",floorId:"floor-ground",xMm:2000,yMm:0});
  const routes=unit.ports.map((port,index)=>({...route([[0,0,null],[1000,0,null]],2),id:`route-${index}`,startAttachment:index%2?null:{componentId:unit.id,portId:port.id},endAttachment:index%2?{componentId:unit.id,portId:port.id}:{componentId:box.id,portId:box.ports[0].id}}));
  const before=structuredClone({routes,unit,box});
  const lines=deriveHrvEppConnectionAllowances([...routes,routes[0]],[unit,box]);
  assert.equal(lines.length,4);
  assert.equal(lines.reduce((n,l)=>n+l.ductLengthMm,0),4000);
  assert.equal(lines.reduce((n,l)=>n+l.elbow90Quantity,0),4);
  assert.equal(lines.reduce((n,l)=>n+l.extraSleeveQuantity,0),16);
  assert.ok(lines.every(l=>l.nominalSizeMm===160 && l.includedSocketQuantity===1 && l.reviewRequired));
  assert.equal(deriveEppElbowStock([...deriveEppTakeoff(routes),...lines])[0].elbow90StockQuantity,4);
  assert.equal(deriveHrvEppConnectionAllowances(routes.slice(1),[unit,box]).length,3);
  assert.deepEqual({routes,unit,box},before);
  assert.deepEqual(deriveHrvEppConnectionAllowances(routes.map(r=>({...r,ductKind:"semi-rigid-radial"})),[unit,box]),[]);
  assert.deepEqual(deriveHrvEppConnectionAllowances(routes,[box]),[]);
});

test("HRV allowance follows the port diameter and keeps route bend sleeves separate", async () => {
  const {deriveHrvEppConnectionAllowances}=await import("../src/editor/epp-takeoff.mjs");
  const {createCatalogueComponent}=await import("../src/editor/component-catalogue.mjs");
  const unit=createCatalogueComponent("synthetic-mvhr-placeholder",{id:"unit-125",floorId:"floor-ground",xMm:0,yMm:0});
  unit.ports[0].interface.nominalSizeMm=125;
  const input={...route([[0,0],[1000,0],[1000,1000]],1,"epp-rigid-dn125"),startAttachment:{componentId:unit.id,portId:unit.ports[0].id}};
  const [allowance]=deriveHrvEppConnectionAllowances([input],[unit]);
  const [measured]=deriveEppTakeoff([input]);
  assert.equal(allowance.nominalSizeMm,125);
  assert.equal(allowance.extraSleeveQuantity+measured.extraSleeveQuantity,5);
  assert.equal(deriveEppElbowStock([measured,allowance])[0].elbow90StockQuantity,2);
});

test("HRV top elbows follow either EPP endpoint without changing geometry or stock", async()=>{
 const {deriveHrvCeilingElbows,hrvCeilingElbowShapes}=await import("../src/editor/hrv-ceiling-elbows.mjs");
 const {createCatalogueComponent}=await import("../src/editor/component-catalogue.mjs");
 const unit=createCatalogueComponent("zehnder-q350-hrv-right-drawing-profile",{id:"top-elbow-unit",floorId:"floor-ground",xMm:0,yMm:0});
 const attachment={componentId:unit.id,portId:unit.ports[0].id};
 const first={...route([[0,0,null],[1000,0,null]]),startAttachment:attachment};
 const before=structuredClone(first);
 const [elbow]=deriveHrvCeilingElbows([first],[unit]);
 assert.equal(elbow.angle,90);assert.equal(elbow.angleDegrees,0);
 assert.equal(elbow.xMm,0);assert.equal(elbow.yMm,0);
 assert.equal(hrvCeilingElbowShapes(elbow).find(s=>s.attributes["data-part"]==="ceiling-elbow-rise").attributes.r,80);
 const reversed={...first,startAttachment:null,endAttachment:attachment,points:first.points.slice().reverse()};
 assert.deepEqual(deriveHrvCeilingElbows([reversed],[unit]),[elbow]);
 const turned={...first,points:route([[0,0,null],[0,1000,null]]).points};
 const [vertical]=deriveHrvCeilingElbows([turned],[unit]);
 assert.equal(vertical.angleDegrees,90);assert.equal(vertical.xMm,0);assert.equal(vertical.yMm,0);
 assert.deepEqual(deriveHrvCeilingElbows([{...first,startAttachment:null}],[unit]),[]);
 assert.deepEqual(first,before);
 assert.equal(deriveEppTakeoff([first])[0].elbow90Quantity,0);
});
