
import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, createProject, identityQuaternion, knownMm, serializeProject } from "../src/domain/spatial.mjs";
import { designOptionProjects } from "../src/domain/design-options.mjs";
import { createConfiguredMvhrComponent } from "../src/editor/mvhr-placement.mjs";
import { createA3SheetModel, renderA3SheetSvg } from "../src/sheets/a3-sheet.mjs";
import { createSheetOutputPages, createSheetOutputDocument } from "../src/sheets/sheet-output.mjs";
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
    assert.deepEqual(ids(sheet.planDetails),["ceiling-tva","wall-housing"]);
    for (const value of [128,140,120,115]) assert.match(svg,new RegExp(String(value)));
    assert.match(svg,/Ø90 duct spigot/);
    assert.match(svg,/after plastering/);
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
  const pages=designOptionProjects(project).map(({project})=>createSheetOutputPages(createA3SheetModel(project,metadata))[1]);
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
  assert.match(createSheetOutputPages(q)[1].svg,/Wiring source unreadable/);
  assert.match(createSheetOutputPages(q)[1].svg,/Drain space: not dimensioned/);
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
    assert.equal(b.heightMm,32);
    assert.ok(d.heightMm>150);
    assert.match(renderA3SheetSvg(sheet),/See next sheet: INSTALLATION DETAILS/);
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
    assert.match(pages[1].svg,/data-detail-id="ceiling-tva"/);assert.match(pages[1].svg,/data-detail-id="q-cw320"/);
    assert.equal(pages[1].widthMm,sheet.page.widthMm);assert.equal(pages[1].heightMm,sheet.page.heightMm);
    assert.doesNotMatch(pages[0].svg,/data-detail-id="q-cw320"/);
    assert.ok(pages.slice(2).every(page=>page.widthMm===210&&page.heightMm===297&&!page.svg.includes('id="plan-details"')));
    assert.match(pages[0].svg,new RegExp(`y="${sheet.page.heightMm-4}"[^>]*>Page 1`));
  }
});

test("a mixed matched AF and unmatched Q retains the unreadable Q wiring warning", () => {
 const project=unit(unit(fixture(),"q350-hrv","625"),"aerofresh-450-hrv","520");
 const svg=createSheetOutputPages(createA3SheetModel(project,metadata))[1].svg;
 assert.match(svg,/Q-series wiring source unreadable. Original wiring drawing required/);
 assert.match(svg,/data-detail-id="af-cw520"/);
 assert.doesNotMatch(svg,/data-detail-id="q-cw320"/);
});

test("source-shaped illustrations preserve dimension labels and characteristic profiles", async () => {
  const { renderInstallReferenceIllustration: render } = await import("../src/sheets/install-reference-illustrations.mjs");
  const expected = {
    "ceiling-tva": [128,140], "wall-housing": [120,115,140],
    "q-cw320": [791,566,1414], "af-cw520": [870,650,1400,150], "af300-remote": [],
  };
  for (const [id,values] of Object.entries(expected)) {
    const svg=render(id);
    assert.deepEqual([...svg.matchAll(/data-dimension="(\d+)"/g)].map(m=>Number(m[1])),values);
    assert.match(svg,/data-visual-basis="owner-source-profile"/);
    assert.doesNotMatch(svg,/<image|data:image|https?:|>Side<|>AF<|>Q</);
    assert.ok([...svg.matchAll(/font-size="([\d.]+)"/g)].every(m=>Number(m[1])>=2.5));
  }
  for(const id of ["ceiling-tva","wall-housing","af300-remote"]) assert.match(render(id),/data-source-feature="hatched-section"/);
  assert.match(render("q-cw320"),/data-source-feature="q-mounting-set"/);
  assert.match(render("af-cw520"),/data-source-feature="af-cw520-elevations"/);
  assert.match(render("q-cw320"),/data-dimension="unresolved"/);
  assert.match(render("af300-remote"),/data-dimension="unresolved"/);
  assert.throws(()=>render("unknown"),/Unknown installation reference/);
});


test("engineering page includes only conceptual insulation and explicit project unknowns", () => {
  const sheet=createA3SheetModel(fixture(),metadata),pages=createSheetOutputPages(sheet);
  assert.equal(pages[1].kind,"installation-details");
  assert.match(pages[1].svg,/Project material, thickness, R-value and vapour-control detail: not specified./);
  assert.match(pages[1].svg,/concept-not-project-specification/);
  assert.match(pages[1].svg,/No matching central unit/);
  assert.doesNotMatch(pages[1].svg,/R[0-9]|R-value[:=] ?[0-9]/);
});

test("all-options documents have global numbering with independent per-option details", () => {
  const q=createA3SheetModel(unit(fixture(),"q350-hrv","320"),metadata);
  const af=createA3SheetModel(unit(fixture(),"aerofresh-450-hrv","520"),{...metadata,orientation:"portrait"});
  const pages=createSheetOutputDocument([q,af]);
  for(const [index,page] of pages.entries())assert.match(page.svg,new RegExp(`Page ${index+1} of ${pages.length} · A[34]`));
  assert.deepEqual(pages.map(p=>p.kind),["drawing","installation-details","parts-list","drawing","installation-details","parts-list"]);
  assert.match(pages[1].svg,/q-cw320/);assert.doesNotMatch(pages[1].svg,/af-cw520/);
  assert.match(pages[4].svg,/af-cw520/);assert.doesNotMatch(pages[4].svg,/q-cw320/);
  assert.match(pages[4].className,/sheet-a3-portrait/);
});

test("multi-page A4 lists start after both A3 pages and retain every row", () => {
  const sheet=structuredClone(createA3SheetModel(fixture(),metadata));
  sheet.partsSchedule.componentLines=Array.from({length:80},(_,i)=>({section:"mvhr",ref:`HRV-${i}`,description:`Distinct equipment ${i}`,quantity:1,partNumber:"ZEN-TEST"}));
  const pages=createSheetOutputPages(sheet);
  assert.ok(pages.length>4);
  for(const [i,page] of pages.entries())assert.match(page.svg,new RegExp(`Page ${i+1} of ${pages.length} · A[34]`));
  for(let i=0;i<80;i++)assert.equal(pages.slice(2).filter(p=>p.svg.includes(`>Distinct equipment ${i}</text>`)).length,1);
});


test("TVA finished body and plasterboard share a flush face without changing source dimensions", async () => {
  const { renderInstallReferenceIllustration: render } = await import("../src/sheets/install-reference-illustrations.mjs");
  const svg = render("ceiling-tva");
  const bodyY = Number(svg.match(/data-source-feature="tva-body" data-finish-y="([^"]+)"/)[1]);
  const faceY = Number(svg.match(/data-source-feature="plasterboard" data-finish-y="([^"]+)"/)[1]);
  assert.equal(bodyY, faceY);
  assert.match(svg, new RegExp(`M11 14 H38 V${faceY} H12`));
  assert.deepEqual([...svg.matchAll(/data-dimension="(\d+)"/g)].map(m => Number(m[1])), [128, 140]);
  const sheet = createA3SheetModel(fixture(), metadata);
  assert.match(createSheetOutputPages(sheet)[1].svg, /Finished body flush with plasterboard face/);
  assert.match(renderA3SheetSvg(sheet), /Trim flush with plasterboard after plastering/);
});


test("insulation reference shows the guide's two three-duct ceiling arrangements", async () => {
  const { renderInsulationReferenceIllustration: render } = await import("../src/sheets/insulation-reference-illustrations.mjs");
  for (const arrangement of ["service-zone", "insulation-cover"]) {
    const svg = render(arrangement);
    assert.equal((svg.match(/data-duct-section="distribution-duct"/g) || []).length, 3);
    assert.match(svg, /data-visual-basis="owner-mvhr-guide-page-4"/);
    assert.match(svg, /data-source-feature="finished-ceiling-lining"/);
    assert.doesNotMatch(svg, /R[0-9]|thickness=.*\d/);
  }
  assert.match(render("service-zone"), /data-source-feature="internal-service-zone"/);
  assert.doesNotMatch(render("insulation-cover"), /data-source-feature="internal-service-zone"/);
  assert.match(render("insulation-cover"), /data-source-feature="continuous-insulation-cover"/);
  assert.throws(() => render("unknown"), /Unknown insulation arrangement/);
  for (const orientation of ["landscape", "portrait"]) {
    const svg = createSheetOutputPages(createA3SheetModel(fixture(), {...metadata, orientation}))[1].svg;
    assert.match(svg, /Dropped ceiling \/ service zone/);
    assert.match(svg, /Ducts protected by insulation/);
    assert.match(svg, /owner-mvhr-guide-v1-page-4/);
    assert.doesNotMatch(svg, /Duct \/ insulation \/ outer vapour-control layer/);
  }
});
