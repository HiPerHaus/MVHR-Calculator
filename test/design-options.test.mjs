import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  deserializeProject,
  identityQuaternion,
  knownMm,
  serializeProject,
  unknownMm,
} from "../src/domain/spatial.mjs";
import { createCommandHistory, executeCommand, undoCommand } from "../src/domain/history.mjs";
import { designOptionProjects } from "../src/domain/design-options.mjs";
import { createCatalogueComponent } from "../src/editor/component-catalogue.mjs";
import { createA3SheetModel } from "../src/sheets/a3-sheet.mjs";

test("legacy single-option projects reopen as Option A without changing their design", () => {
  const current=fixture();
  const legacy=structuredClone(current);
  legacy.schemaVersion=22;
  delete legacy.activeDesignOptionId;
  delete legacy.designOptions;
  const reopened=deserializeProject(JSON.stringify(legacy));
  assert.equal(reopened.designOptions.length,1);
  assert.equal(reopened.designOptions[0].name,"Option A");
  assert.equal(reopened.activeDesignOptionId,reopened.designOptions[0].id);
  assert.deepEqual(reopened.components,current.components);
  assert.deepEqual(reopened.walls,current.walls);
});

test("selective duplication isolates plan, rooms and MVHR markup", () => {
  let project=fixture();
  project=applyCommand(project,{type:"project.setVentilationDesignType",ventilationDesignType:"centralised"});
  project=applyCommand(project,{type:"component.add",component:createCatalogueComponent("synthetic-supply-terminal",{id:"terminal-original",floorId:"floor-ground",xMm:1800,yMm:1600})});
  const originalOptionId=project.activeDesignOptionId;

  project=applyCommand(project,{type:"designOption.duplicate",id:"option-decentralised",name:"Option B – Decentralised",revision:"B",copyScopes:["plan","rooms"],activate:true});
  assert.equal(project.activeDesignOptionId,"option-decentralised");
  assert.equal(project.ventilationDesignType,"unclassified");
  assert.equal(project.components.length,0);
  assert.equal(project.walls.length,1);
  assert.notEqual(project.walls[0].id,"wall-a-b");

  project=applyCommand(project,{type:"project.setVentilationDesignType",ventilationDesignType:"decentralised"});
  project=applyCommand(project,{type:"component.add",component:createCatalogueComponent("aerofresh-30-compact-decentralised",{id:"decentral-unit",floorId:"floor-ground",xMm:2400,yMm:1800})});
  project=applyCommand(project,{type:"designOption.switch",optionId:originalOptionId});
  assert.equal(project.ventilationDesignType,"centralised");
  assert.deepEqual(project.components.map((component)=>component.id),["terminal-original"]);
  assert.equal(project.walls[0].id,"wall-a-b");

  project=applyCommand(project,{type:"designOption.switch",optionId:"option-decentralised"});
  assert.equal(project.ventilationDesignType,"decentralised");
  assert.deepEqual(project.components.map((component)=>component.id),["decentral-unit"]);
});

test("markup duplication remaps identities and remains independently editable", () => {
  let project=fixture();
  project=applyCommand(project,{type:"component.add",component:createCatalogueComponent("synthetic-supply-terminal",{id:"terminal-original",floorId:"floor-ground",xMm:1800,yMm:1600})});
  const originalOptionId=project.activeDesignOptionId;
  project=applyCommand(project,{type:"designOption.duplicate",id:"option-markup-copy",name:"Option C",revision:"C1",copyScopes:["plan","markup"],activate:true});
  assert.equal(project.components.length,1);
  assert.notEqual(project.components[0].id,"terminal-original");
  assert.match(project.components[0].id,/^option-markup-copy-copy-/u);
  project=applyCommand(project,{type:"component.moveXY",componentId:project.components[0].id,xMm:5000,yMm:4200});
  project=applyCommand(project,{type:"designOption.switch",optionId:originalOptionId});
  assert.equal(project.components[0].positionMm.x,1800);
  assert.equal(project.components[0].positionMm.y,1600);
});

test("switching options is one undoable command and survives save/reopen", () => {
  let project=fixture();
  const originalOptionId=project.activeDesignOptionId;
  project=applyCommand(project,{type:"designOption.duplicate",id:"option-empty",name:"Option B",revision:"Working",copyScopes:[],activate:false});
  let history=createCommandHistory(project);
  history=executeCommand(history,{type:"designOption.switch",optionId:"option-empty"});
  assert.equal(history.present.activeDesignOptionId,"option-empty");
  history=undoCommand(history);
  assert.equal(history.present.activeDesignOptionId,originalOptionId);

  const reopened=deserializeProject(serializeProject(project));
  assert.equal(reopened.designOptions.length,2);
  assert.equal(reopened.activeDesignOptionId,originalOptionId);
});

test("each option produces its own sheet and parts schedule without mixing content", () => {
  let project=fixture();
  project=applyCommand(project,{type:"component.add",component:createCatalogueComponent("synthetic-supply-terminal",{id:"central-terminal",floorId:"floor-ground",xMm:1800,yMm:1600})});
  project=applyCommand(project,{type:"project.setVentilationDesignType",ventilationDesignType:"centralised"});
  project=applyCommand(project,{type:"designOption.duplicate",id:"option-decentral",name:"Decentralised",revision:"D1",copyScopes:["plan"],activate:true});
  project=applyCommand(project,{type:"component.add",component:createCatalogueComponent("aerofresh-30-compact-decentralised",{id:"decentral-unit",floorId:"floor-ground",xMm:2200,yMm:1800})});
  project=applyCommand(project,{type:"project.setVentilationDesignType",ventilationDesignType:"decentralised"});

  const outputs=designOptionProjects(project).map(({option,project:optionProject})=>({
    option,
    sheet:createA3SheetModel(optionProject,{floorId:"floor-ground",orientation:"landscape",projectName:"Same job",siteName:"Site",clientName:"Client",drawingTitle:`Layout · ${option.name}`,drawingId:option.id,issueDate:"2026-11-01",status:"Preliminary — not for construction",revision:option.revision,revisionText:"Option test",drawnBy:"",checkedBy:""}),
  }));
  assert.equal(outputs.length,2);
  assert.equal(outputs[0].sheet.partsSchedule.componentLines.length,1);
  assert.equal(outputs[1].sheet.partsSchedule.componentLines.length,1);
  assert.notEqual(outputs[0].sheet.partsSchedule.componentLines[0].description,outputs[1].sheet.partsSchedule.componentLines[0].description);
});

function fixture() {
  let project=applyCommand(createProject("project-design-options"),{type:"floor.add",floor:{id:"floor-ground",name:"Ground Floor",transform:{translationMm:{x:0,y:0,z:knownMm(0,"test datum")},orientation:identityQuaternion()}}});
  return applyCommand(project,{type:"wall.addChain",floorId:"floor-ground",nodeIds:["node-a","node-b"],wallIds:["wall-a-b"],points:[{x:0,y:0,z:unknownMm("test wall")},{x:4000,y:0,z:unknownMm("test wall")}],splits:[],thicknessMm:140,heightMm:unknownMm("test height"),referenceLine:"centreline",classification:"physical"});
}
