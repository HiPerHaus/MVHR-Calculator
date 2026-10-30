import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  deserializeProject,
  identityQuaternion,
  knownMm,
  serializeProject,
} from "../src/domain/spatial.mjs";
import { createCatalogueComponent } from "../src/editor/component-catalogue.mjs";
import { createA3SheetModel, renderA3SheetSvg } from "../src/sheets/a3-sheet.mjs";
import { createA4PartsListPages, renderA4PartsListSvg } from "../src/sheets/a4-parts-list.mjs";
import {
  filterVentilationProjectEntries,
  inspectVentilationProjectType,
  ventilationProjectTypeLabel,
} from "../src/domain/ventilation-project-type.mjs";

test("new and legacy projects remain explicitly unclassified until the user chooses", () => {
  const project=fixture();
  assert.equal(project.ventilationDesignType,"unclassified");
  assert.equal(inspectVentilationProjectType(project).contentType,"unclassified");

  const legacy=structuredClone(project);
  legacy.schemaVersion=21;
  delete legacy.ventilationDesignType;
  const reopened=deserializeProject(JSON.stringify(legacy));
  assert.equal(reopened.ventilationDesignType,"unclassified");
  assert.equal(ventilationProjectTypeLabel(reopened.ventilationDesignType),"Unclassified");
});

test("explicit type persists without deleting or rewriting ventilation content", () => {
  let project=fixture();
  project=applyCommand(project,{type:"component.add",component:createCatalogueComponent("aerofresh-30-compact-decentralised",{id:"decentral-unit",floorId:"floor-ground",xMm:1000,yMm:1200})});
  const components=structuredClone(project.components);
  project=applyCommand(project,{type:"project.setVentilationDesignType",ventilationDesignType:"decentralised"});
  const reopened=deserializeProject(serializeProject(project));
  assert.equal(reopened.ventilationDesignType,"decentralised");
  assert.deepEqual(reopened.components,components);
  assert.equal(inspectVentilationProjectType(reopened).conflictsWithContent,false);
});

test("content inspection warns rather than silently reclassifying conflicting drawings", () => {
  let project=fixture();
  project=applyCommand(project,{type:"component.add",component:createCatalogueComponent("aerofresh-30-compact-decentralised",{id:"decentral-unit",floorId:"floor-ground",xMm:1000,yMm:1200})});
  project=applyCommand(project,{type:"project.setVentilationDesignType",ventilationDesignType:"centralised"});
  const conflicting=inspectVentilationProjectType(project);
  assert.equal(conflicting.selectedType,"centralised");
  assert.equal(conflicting.contentType,"decentralised");
  assert.equal(conflicting.conflictsWithContent,true);
  assert.equal(conflicting.suggestedType,"mixed");

  project=applyCommand(project,{type:"project.setVentilationDesignType",ventilationDesignType:"mixed"});
  const mixed=inspectVentilationProjectType(project);
  assert.equal(mixed.selectedType,"mixed");
  assert.equal(mixed.conflictsWithContent,false);
  assert.equal(project.components.length,1);
});

test("mixed inspection keeps central and decentralised objects separate", () => {
  let project=fixture();
  project=applyCommand(project,{type:"component.add",component:createCatalogueComponent("aerofresh-30-compact-decentralised",{id:"decentral-unit",floorId:"floor-ground",xMm:1000,yMm:1200})});
  project=applyCommand(project,{type:"component.add",component:createCatalogueComponent("synthetic-supply-terminal",{id:"central-terminal",floorId:"floor-ground",xMm:2200,yMm:1200})});
  const inspection=inspectVentilationProjectType(project);
  assert.equal(inspection.contentType,"mixed");
  assert.equal(inspection.decentralisedUnitCount,1);
  assert.equal(inspection.centralObjectCount,1);
  assert.equal(project.ventilationDesignType,"unclassified");
});

test("unsupported project types fail without changing the project", () => {
  const project=fixture();
  assert.throws(()=>applyCommand(project,{type:"project.setVentilationDesignType",ventilationDesignType:"automatic"}),/Unsupported ventilation project type/);
  assert.equal(project.ventilationDesignType,"unclassified");
});

test("project-list filters keep explicit and unclassified types separate", () => {
  const entries=[
    {id:"a",ventilationDesignType:"centralised"},
    {id:"b",ventilationDesignType:"decentralised"},
    {id:"c",ventilationDesignType:"mixed"},
    {id:"d",ventilationDesignType:"unclassified"},
    {id:"e",ventilationDesignType:"unavailable"},
  ];
  assert.deepEqual(filterVentilationProjectEntries(entries,"all").map((entry)=>entry.id),["a","b","c","d","e"]);
  assert.deepEqual(filterVentilationProjectEntries(entries,"decentralised").map((entry)=>entry.id),["b"]);
  assert.deepEqual(filterVentilationProjectEntries(entries,"unclassified").map((entry)=>entry.id),["d"]);
  assert.throws(()=>filterVentilationProjectEntries(entries,"automatic"),/Unsupported ventilation project type/);
});

test("A3 and A4 output retain the explicit project type", () => {
  const project=applyCommand(fixture(),{type:"project.setVentilationDesignType",ventilationDesignType:"mixed"});
  const sheet=createA3SheetModel(project,{
    includeSchedule:true,
    floorId:"floor-ground",
    orientation:"landscape",
    projectName:"Mixed system test",
    siteName:"Test site",
    clientName:"Not set",
    drawingTitle:"Ground floor ventilation",
    drawingId:"TYPE-001",
    issueDate:"2026-10-30",
    status:"Preliminary — not for construction",
    revision:"DRAFT",
    revisionText:"Project type test",
    drawnBy:"",
    checkedBy:"",
  });
  assert.equal(sheet.metadata.ventilationDesignType,"mixed");
  assert.equal(sheet.metadata.ventilationDesignTypeLabel,"Mixed");
  assert.match(renderA3SheetSvg(sheet),/>SYSTEM</u);
  assert.match(renderA3SheetSvg(sheet),/>Mixed</u);
  const [page]=createA4PartsListPages(sheet);
  assert.match(renderA4PartsListSvg(sheet,page),/Mixed/u);
});

function fixture() {
  return applyCommand(createProject("project-ventilation-type"),{
    type:"floor.add",
    floor:{
      id:"floor-ground",
      name:"Ground",
      transform:{translationMm:{x:0,y:0,z:knownMm(0,"test datum")},orientation:identityQuaternion()},
    },
  });
}
