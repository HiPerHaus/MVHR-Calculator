import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand, createProject, deserializeProject, floorPortTransform, identityQuaternion, knownMm, roomTerminalPort, serializeProject } from "../src/domain/spatial.mjs";
import { createCatalogueComponent, deriveVentilationConnectionDemand, routeFamilyForKind } from "../src/editor/component-catalogue.mjs";
import { terminalPlacementRecordId } from "../src/editor/terminal-placement-mode.mjs";
import { deriveComponentPlanGraphic, LINEA_GRILLE_PLAN_GRAPHIC_ID } from "../src/editor/component-plan-graphics.mjs";
import { auditVentilation } from "../src/editor/ventilation-audit.mjs";
import { createPartsCsvRows } from "../src/sheets/parts-csv-export.mjs";
import { createOsTakeoff } from "../app/os-takeoff.mjs";

function fixture() {
  let p = applyCommand(createProject("linea-test"), { type: "floor.add", floor: { id: "ground", name: "Ground", transform: { translationMm: {x:0,y:0,z:knownMm(0,"test")}, orientation:identityQuaternion() } } });
  for (const [shape, service, x] of [["linea-400","supply",1000],["linea-600","extract",3000]]) {
    const id=terminalPlacementRecordId({ shape, service });
    p = applyCommand(p, { type: "component.add", component: createCatalogueComponent(id,{id:shape,floorId:"ground",xMm:x,yMm:1000}), autoAssignTerminalSpace:true });
  }
  return p;
}
test("Linea 400 is one terminal with one DN90 feed and Linea 600 is one with two", () => {
  const p=fixture();
  for (const [index,c] of p.components.entries()) {
    assert.equal(c.ports.length,index+1);
    assert.equal(c.ductRunCount,index+1);
    assert.equal(roomTerminalPort(p,c.id).id,c.ports[0].id);
    assert.equal(deriveComponentPlanGraphic(c).graphicId,LINEA_GRILLE_PLAN_GRAPHIC_ID);
    assert.ok(c.ports.every(port=>port.interface.nominalSizeMm===90));
  }
  const demand=deriveVentilationConnectionDemand(p);
  assert.deepEqual(demand.supply,{outletCount:1,knownRunCount:1,outletsMissingRunCount:0});
  assert.deepEqual(demand.extract,{outletCount:1,knownRunCount:2,outletsMissingRunCount:0});
  assert.deepEqual(deserializeProject(serializeProject(p)),p);
});

test("Linea 600 feeds attach independently, reject twin paths and remain auditable per feed", () => {
  let p=fixture(); const c=p.components.find(c=>c.id==="linea-600");
  const family=routeFamilyForKind("semi-rigid-radial");
  function route(i,runs) {
    const portId=c.ports[i].id, end=floorPortTransform(p,c.id,portId).positionMm;
    return {type:"route.add",route:{id:`radial-${i}`,floorId:"ground",system:"mvhr",stream:"extract",role:"Dwelling extract",
      ductKind:family.id,connectionInterface:family.connectionInterface,parallelRunCount:runs,startAttachment:null,endAttachment:{componentId:c.id,portId},
      points:[{...end,y:end.y+1000},end]}};
  }
  assert.throws(()=>applyCommand(p,route(0,2)),/one separate DN90 route/);
  p=applyCommand(p,route(0,1));
  const feedDiagnostics=auditVentilation(p,"ground").diagnostics.filter(d=>d.code==="outlet-disconnected"&&d.componentId===c.id);
  assert.deepEqual(feedDiagnostics.map(d=>d.portId),[c.ports[1].id]);
  p=applyCommand(p,route(1,1));
  assert.equal(auditVentilation(p,"ground").diagnostics.some(d=>d.code==="outlet-disconnected"&&d.componentId===c.id),false);
  assert.equal(new Set(p.routes.map(r=>r.endAttachment.portId)).size,2);
});

test("parts CSV has distinct face and housing references, no wrong filter or unverified quote item", () => {
  const p=fixture();
  const rows=createPartsCsvRows(p);
  for (const code of ["990321791","990321745","990321794","990321746","990321769"]) {
    const matching=rows.filter(r=>r.partNumber===code);
    assert.equal(matching.length,1,code);
    assert.equal(matching[0].kind,"selection",code);
  }
  assert.ok(!rows.some(r=>["990321768","AER-GR-FILT-DN125","ZEN-H-TVA90-300"].includes(r.partNumber)));
  const takeoff=createOsTakeoff(rows,{id:"saved",save_version:1},p.activeDesignOptionId,"centralised");
  assert.ok(!takeoff.items.some(item=>item.partNumber?.startsWith("990321")));
  assert.ok(takeoff.issues.some(issue=>issue.includes("Zehnder ComfoGrid Linea 600")));
});
