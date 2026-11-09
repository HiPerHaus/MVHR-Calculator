
import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, createProject, identityQuaternion, knownMm, serializeProject } from "../src/domain/spatial.mjs";
import { designOptionProjects } from "../src/domain/design-options.mjs";
import { createConfiguredMvhrComponent } from "../src/editor/mvhr-placement.mjs";
import { createA3SheetModel, renderA3SheetSvg } from "../src/sheets/a3-sheet.mjs";
import { createSheetOutputPages } from "../src/sheets/sheet-output.mjs";
import { layoutPlanDetails, PLAN_DETAIL_REFERENCES, renderPlanDetails, selectPlanDetails } from "../src/sheets/plan-details.mjs";

const metadata = { floorId:"ground", orientation:"landscape", includeSchedule:false, projectName:"Details QA", issueDate:"2026-11-09", drawingTitle:"Ventilation", drawingId:"V01", status:"Preliminary — not for construction", revision:"A", revisionText:"Detail review" };
function fixture() {
  let project = createProject("detail-test");
  for (const id of ["ground", "upper"]) project = applyCommand(project, { type:"floor.add", floor:{ id, name:id, transform:{translationMm:{x:0,y:0,z:knownMm(0,"test")},orientation:identityQuaternion()} } });
  return project;
}
function unit(project, model, cwSize, id = model, floorId = "ground", layout = "unit-mounted-cw") {
  return applyCommand(project, { type:"component.add", component:createConfiguredMvhrComponent({model, mounting:"vertical", handing:"left",layout,cwSize},{id,floorId,xMm:1000+project.components.length*3000,yMm:1000}) });
}
const ids = details => details.cards.map(card=>card.id);

test("each A3 plan carries vector terminal dimensions without changing source data or parts", () => {
  const project = fixture(), before = serializeProject(project);
  for (const floorId of ["ground","upper"]) {
    const sheet = createA3SheetModel(project,{...metadata,floorId}), svg = renderA3SheetSvg(sheet);
    assert.deepEqual(ids(sheet.planDetails),["ceiling-tva","wall-housing","equipment-notes"]);
    for (const value of [128,140,120,115]) assert.match(svg,new RegExp(`>${value}</text>`));
    assert.match(svg,/>Ø90</);
    assert.match(svg,/cut off after plastering/);
    assert.equal(sheet.partsSchedule.componentLines.length,0);
    assert.ok(Object.isFrozen(sheet.planDetails.cards[0]));
  }
  assert.equal(serializeProject(project),before);
});

test("only exact mounted Q/CW320 and AF/CW520 combinations receive the supplied envelopes", () => {
  const pairs = [["q350-hrv","320","q-cw320"],["q350-erv","320","q-cw320"],["aerofresh-450-hrv","520","af-cw520"],["aerofresh-450-erv","520","af-cw520"]];
  for (const [model,cwSize,key] of pairs) {
    const details = selectPlanDetails(unit(fixture(),model,cwSize),"ground");
    assert.ok(ids(details).includes(key));
    assert.equal(details.unmatchedComponentIds.length,0);
  }
  for (const model of ["q350-hrv","aerofresh-450-hrv"]) for (const cwSize of ["320","420","520","625"]) {
    if ((model==="q350-hrv"&&cwSize==="320") || (model==="aerofresh-450-hrv"&&cwSize==="520")) continue;
    const details = selectPlanDetails(unit(fixture(),model,cwSize),"ground");
    assert.deepEqual(ids(details),["ceiling-tva","wall-housing","equipment-notes"]);
    assert.equal(details.unmatchedComponentIds.length,1);
  }
  for (const layout of ["unit-only","remote-attenuators"]) assert.equal(ids(selectPlanDetails(unit(fixture(),"q350-hrv",null,"unit-q","ground",layout),"ground")).includes("q-cw320"),false);
});

test("selection never guesses from a display name, missing CW, horizontal mounting or German BIM", () => {
  for (const edit of [
    c=>delete c.mvhrDesignIntent.cwSize,
    c=>{c.mvhrDesignIntent.mounting="horizontal";},
    c=>{c.catalogueItemId="zehnder-q350-de-hrv-left-bim-profile";},
    c=>{c.catalogueItemId="synthetic-mvhr-placeholder";c.displayName="Q350 + CW320";},
  ]) {
    const project=unit(fixture(),"q350-hrv","320");edit(project.components[0]);
    assert.equal(ids(selectPlanDetails(project,"ground")).includes("q-cw320"),false);
  }
});

test("repeated matching units deduplicate and floor/option references remain independent", () => {
  let project=unit(unit(unit(fixture(),"q350-hrv","320","unit-q1"),"q350-erv","320","unit-q2"),"aerofresh-450-hrv","520","unit-af","upper");
  assert.equal(selectPlanDetails(project,"ground").cards.find(c=>c.id==="q-cw320").componentIds.length,2);
  assert.deepEqual(ids(selectPlanDetails(project,"upper")),["ceiling-tva","wall-housing","af-cw520"]);
  project=applyCommand(project,{type:"designOption.duplicate",id:"af-option",name:"AF only",copyScopes:["plan"],activate:true});
  project=unit(project,"aerofresh-450-hrv","520","af-only");
  const pages=designOptionProjects(project).map(({project})=>createSheetOutputPages(createA3SheetModel(project,metadata))[0]);
  assert.match(pages[0].svg,/data-detail-id="q-cw320"/);assert.doesNotMatch(pages[0].svg,/data-detail-id="af-cw520"/);
  assert.match(pages[1].svg,/data-detail-id="af-cw520"/);assert.doesNotMatch(pages[1].svg,/data-detail-id="q-cw320"/);
});

test("unknown AF300 assembly values and Q wiring remain explicitly unresolved", () => {
  const project={components:[{id:"af300",floorId:"ground",catalogueItemId:"aerofresh-300-hrv",mvhrDesignIntent:{mounting:"vertical",layout:"remote-attenuators"}}]};
  const details=selectPlanDetails(project,"ground"), af=details.cards.find(card=>card.id==="af300-remote");
  assert.equal(af.widthMm,null);assert.equal(af.depthMm,null);assert.equal(af.heightMm,null);assert.equal(af.drainAllowanceMm,null);
  const svg=renderPlanDetails(layoutPlanDetails(details,{xMm:10,yMm:10,widthMm:325,heightMm:277}));
  assert.match(svg,/dimension arrows are blank/);assert.doesNotMatch(svg,/>660<|>443<|>760<|>150</);
  const q=createA3SheetModel(unit(fixture(),"q350-hrv","320"),metadata);
  assert.match(renderA3SheetSvg(q),/Wiring source unreadable/);
  assert.match(renderA3SheetSvg(q),/Drain space: not dimensioned/);
  assert.equal(PLAN_DETAIL_REFERENCES.q320.drainAllowanceMm,null);
  assert.equal(PLAN_DETAIL_REFERENCES.af520.drainAllowanceMm,150);
});

test("detail panels reserve space outside the plan, legend, title and optional schedule", () => {
  const project=unit(unit(fixture(),"q350-hrv","320"),"aerofresh-450-hrv","520");
  for (const orientation of ["landscape","portrait"]) for (const includeSchedule of [false,true]) {
    const sheet=createA3SheetModel(project,{...metadata,orientation,includeSchedule});
    const b=sheet.planDetails.bounds,d=sheet.drawingBounds;
    assert.ok(d.heightMm>60);
    assert.ok(d.yMm+d.heightMm+4<=b.yMm);
    assert.ok(b.xMm+b.widthMm<=sheet.legendBounds.xMm);
    assert.ok(b.yMm+b.heightMm<= (includeSchedule?sheet.scheduleBounds.yMm:sheet.printableBounds.yMm+sheet.printableBounds.heightMm));
    for (const card of sheet.planDetails.cards) {
      assert.ok(card.bounds.widthMm>=60);
      assert.ok(card.bounds.xMm>=b.xMm && card.bounds.xMm+card.bounds.widthMm<=b.xMm+b.widthMm+1e-8);
      assert.ok(card.bounds.yMm+card.bounds.heightMm<=b.yMm+b.heightMm);
    }
  }
});

test("all five reference kinds fit in landscape and portrait without shrinking annotation text", () => {
  const details={cards:Object.values(PLAN_DETAIL_REFERENCES),unmatchedComponentIds:[],hasQ:true,hasAeroFresh:true};
  for (const [widthMm,heightMm] of [[325,277],[202,400]]) {
    const layout=layoutPlanDetails(details,{xMm:10,yMm:10,widthMm,heightMm});
    assert.ok(layout.bounds.yMm>70);
    const svg=renderPlanDetails(layout);
    assert.ok([...svg.matchAll(/font-size="([\d.]+)"/g)].every(m=>Number(m[1])>=2.5));
    assert.equal((svg.match(/data-kind="plan-detail"/g)||[]).length,5);
  }
});

test("export pages preserve exact A3 orientation and shared detail SVG while A4 pagination stays unchanged", () => {
  for (const orientation of ["landscape","portrait"]) {
    const sheet=createA3SheetModel(unit(fixture(),"q350-hrv","320"),{...metadata,orientation}),pages=createSheetOutputPages(sheet);
    assert.equal(pages[0].widthMm,sheet.page.widthMm);assert.equal(pages[0].heightMm,sheet.page.heightMm);assert.equal(pages[0].orientation,orientation);
    assert.match(pages[0].svg,/data-detail-id="ceiling-tva"/);assert.match(pages[0].svg,/data-detail-id="q-cw320"/);
    assert.ok(pages.slice(1).every(page=>page.widthMm===210&&page.heightMm===297&&!page.svg.includes('id="plan-details"')));
    assert.match(pages[0].svg,new RegExp(`y="${sheet.page.heightMm-4}"[^>]*>Page 1`));
  }
});

test("a mixed matched AF and unmatched Q retains the unreadable Q wiring warning", () => {
 const project=unit(unit(fixture(),"q350-hrv","625"),"aerofresh-450-hrv","520");
 const svg=renderA3SheetSvg(createA3SheetModel(project,metadata));
 assert.match(svg,/Q-series wiring source unreadable; original drawing required/);
 assert.match(svg,/data-detail-id="af-cw520"/);
 assert.doesNotMatch(svg,/data-detail-id="q-cw320"/);
});
