import assert from 'node:assert/strict';
import test from 'node:test';
import {applyCommand,createProject,knownMm,unknownMm,identityQuaternion,airflowTargetFromInput,serializeProject,deserializeProject} from '../src/domain/spatial.mjs';
import {deriveRoomBoundaries} from '../src/domain/rooms.mjs';
import {createSyntheticComponent} from '../src/editor/synthetic-catalogue.mjs';
import {buildCommissioningReport} from '../src/editor/commissioning-report.mjs';
test('live targets remain independent of measured evidence and flag later design changes',()=>{
 let p=twoRoomProject();p=createRoom(p,'bed','Bedroom','supply',leftBoundary(p));
 assert.equal(buildCommissioningReport(p,'floor-ground').lines[0].measuredLps,null);
 p=updateTargets(p,'bed','room',{assigned:airflowTargetFromInput(10,'l/s','Designer target','Test')});
 const command={type:'commissioning.recordMeasurement',spaceId:'bed',measuredLps:9,setting:'2 turns',notes:'Normal',recordedAt:'2026-11-18T00:00:00Z'};
 assert.deepEqual(applyCommand(p,command),applyCommand(p,command));
 p=applyCommand(p,command);
 assert.equal(p.rooms[0].airflowTargets.normal.assigned.valueLps,10);
 let r=buildCommissioningReport(p,'floor-ground');assert.equal(r.lines[0].deltaLps,-1);assert.equal(r.lines[0].designChanged,false);
 p=updateTargets(p,'bed','room',{assigned:airflowTargetFromInput(12,'l/s','Designer target','Revision')});
 r=buildCommissioningReport(deserializeProject(serializeProject(p)),'floor-ground');assert.equal(r.lines[0].designLps,12);assert.equal(r.lines[0].measuredLps,9);assert.equal(r.lines[0].designChanged,true);
 p=applyCommand(p,{...command,measuredLps:null});assert.equal(buildCommissioningReport(p,'floor-ground').lines[0].measuredLps,null);
 assert.throws(()=>applyCommand(p,{...command,measuredLps:-1}));assert.throws(()=>applyCommand(p,{...command,measuredLps:NaN}));
});
test('site details and safe embedded photos persist without changing the design',()=>{
 let p=twoRoomProject();p=applyCommand(p,{type:'commissioning.updateDetails',details:{unitSerial:'TEST-001',filterFinal:'F7'}});
 p=applyCommand(p,{type:'commissioning.addPhoto',photo:{id:'photo-1',caption:'Unit',dataUrl:'data:image/jpeg;base64,YQ=='}});
 let r=buildCommissioningReport(deserializeProject(serializeProject(p)),'floor-ground');assert.equal(r.record.details.unitSerial,'TEST-001');assert.equal(r.record.photos.length,1);
 assert.throws(()=>applyCommand(p,{type:'commissioning.addPhoto',photo:{id:'unsafe',caption:'',dataUrl:'data:image/svg+xml;base64,YQ=='}}));
 assert.throws(()=>applyCommand(p,{type:'commissioning.updateDetails',details:{certified:true}}));
 p=applyCommand(p,{type:'commissioning.removePhoto',photoId:'photo-1'});assert.equal(buildCommissioningReport(p,'floor-ground').record.photos.length,0);
});
function updateTargets(project, id, kind, partial) {
  const collection = kind === "zone" ? project.zones : project.rooms;
  const space = collection.find((candidate) => candidate.id === id);
  const targets = structuredClone(space.airflowTargets);
  if (partial.required) targets.normal.required = partial.required;
  if (partial.assigned) targets.normal.assigned = partial.assigned;
  return applyCommand(project, {
    type: `${kind}.updateMetadata`,
    [`${kind}Id`]: id,
    name: space.name,
    use: space.use,
    ventilationRole: space.ventilationRole,
    airflowTargets: targets,
  });
}

function addAndAssignTerminal(project, id, catalogueId, roomId, xMm, yMm) {
  const terminal = createSyntheticComponent(catalogueId, { id, floorId: "floor-ground", xMm, yMm });
  project = applyCommand(project, { type: "component.add", component: terminal });
  return applyCommand(project, {
    type: "terminal.assignRoom",
    roomId,
    componentId: terminal.id,
    portId: terminal.ports[0].id,
  });
}

function createRoom(project, id, name, ventilationRole, boundaryKey) {
  return applyCommand(project, {
    type: "room.createFromBoundary",
    roomId: id,
    floorId: "floor-ground",
    boundaryKey,
    name,
    use: name.startsWith("Bath") ? "bathroom" : "bedroom",
    ventilationRole,
  });
}

function twoRoomProject() {
  let project = applyCommand(createProject("project-airflow-balance"), { type: "floor.add", floor: floor() });
  project = applyCommand(project, wallChain(
    ["node-a", "node-b", "node-c", "node-d", "node-a"],
    ["wall-a-b", "wall-b-c", "wall-c-d", "wall-d-a"],
    [point(0, 0), point(4000, 0), point(4000, 4000), point(0, 4000), point(0, 0)],
  ));
  project = applyCommand(project, wallChain(
    ["node-b", "node-e", "node-f", "node-c"],
    ["wall-b-e", "wall-e-f", "wall-f-c"],
    [point(4000, 0), point(8000, 0), point(8000, 4000), point(4000, 4000)],
  ));
  return project;
}

function leftBoundary(project) {
  return deriveRoomBoundaries(project, "floor-ground").candidates.find((candidate) => candidate.centroidMm.x < 4000).key;
}

function rightBoundary(project) {
  return deriveRoomBoundaries(project, "floor-ground").candidates.find((candidate) => candidate.centroidMm.x > 4000).key;
}

function floor() {
  return {
    id: "floor-ground",
    name: "Ground Floor",
    transform: {
      translationMm: { x: 0, y: 0, z: knownMm(0, "airflow test datum") },
      orientation: identityQuaternion(),
    },
  };
}

function wallChain(nodeIds, wallIds, points) {
  return {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds,
    wallIds,
    points,
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("not measured"),
    referenceLine: "centreline",
    classification: "physical",
  };
}

function point(x, y) {
  return { x, y, z: unknownMm("not measured") };
}

test('commissioning stays scoped to the original option and supports undo/redo',async()=>{
 const {createCommandHistory,executeCommand,undoCommand,redoCommand}=await import('../src/domain/history.mjs');
 let p=twoRoomProject();const originalId=p.activeDesignOptionId;
 let h=createCommandHistory(p);h=executeCommand(h,{type:'commissioning.updateDetails',details:{unitSerial:'ORIGINAL'}});
 assert.equal(buildCommissioningReport(undoCommand(h).present,'floor-ground').record.details.unitSerial,undefined);
 assert.equal(buildCommissioningReport(redoCommand(undoCommand(h)).present,'floor-ground').record.details.unitSerial,'ORIGINAL');
 p=applyCommand(h.present,{type:'designOption.duplicate',id:'other',name:'Other',copyScopes:['plan','rooms'],activate:true});
 assert.equal(buildCommissioningReport(p,'floor-ground').record.details.unitSerial,undefined);
 p=applyCommand(p,{type:'commissioning.updateDetails',details:{unitSerial:'OTHER'}});
 p=applyCommand(p,{type:'designOption.switch',optionId:originalId});
 assert.equal(buildCommissioningReport(p,'floor-ground').record.details.unitSerial,'ORIGINAL');
});

test('unset totals remain unknown while genuine zero values stay zero',()=>{
 let p=createRoom(twoRoomProject(),'bed','Bedroom','supply',leftBoundary(twoRoomProject()));
 let report=buildCommissioningReport(p,'floor-ground');
 assert.equal(report.totals.supply.designLps,null);assert.equal(report.totals.supply.measuredLps,null);
 p=updateTargets(p,'bed','room',{assigned:airflowTargetFromInput(10,'l/s','Designer target','Test')});
 p=applyCommand(p,{type:'commissioning.recordMeasurement',spaceId:'bed',measuredLps:0,recordedAt:'2026-11-18T00:00:00Z'});
 report=buildCommissioningReport(p,'floor-ground');
 assert.equal(report.totals.supply.designLps,10);assert.equal(report.totals.supply.measuredLps,0);
 assert.equal(report.totals.extract.designLps,null);
});

test('partial commissioning form saves retain separate as-built details and photos',()=>{
 let p=twoRoomProject();
 p=applyCommand(p,{type:'commissioning.updateDetails',details:{filterFinal:'F7',controls:'Hall boost',serviceNotes:'Annual review'}});
 p=applyCommand(p,{type:'commissioning.addPhoto',photo:{id:'photo-1',caption:'Unit',dataUrl:'data:image/jpeg;base64,YQ=='}});
 p=applyCommand(p,{type:'commissioning.updateDetails',details:{engineer:'Engineer',instrument:'Meter'}});
 const r=buildCommissioningReport(deserializeProject(serializeProject(p)),'floor-ground').record;
 assert.equal(r.details.filterFinal,'F7');assert.equal(r.details.controls,'Hall boost');assert.equal(r.details.serviceNotes,'Annual review');
 assert.equal(r.details.engineer,'Engineer');assert.equal(r.photos.length,1);
});

test('fresh export follows design revisions without relabelling saved readings',async()=>{
 const {createA3SheetModel}=await import('../src/sheets/a3-sheet.mjs');
 let p=createRoom(twoRoomProject(),'bed','Bedroom','supply',leftBoundary(twoRoomProject()));
 p=updateTargets(p,'bed','room',{assigned:airflowTargetFromInput(10,'l/s','Design','Initial')});
 p=applyCommand(p,{type:'commissioning.recordMeasurement',spaceId:'bed',measuredLps:9,recordedAt:'2026-11-18T00:00:00Z'});
 const meta={floorId:'floor-ground',orientation:'landscape',includeSchedule:false,projectName:'Live design test',issueDate:'2026-11-18',drawingTitle:'Ventilation',drawingId:'V01',status:'Preliminary — not for construction',revision:'A',revisionText:'Test'};
 const before=createA3SheetModel(p,meta);
 assert.equal(before.airflowReport.lines[0].designLps,10);
 p=updateTargets(p,'bed','room',{assigned:airflowTargetFromInput(14,'l/s','Design','Revised')});
 const after=createA3SheetModel(p,meta);
 assert.equal(after.airflowReport.lines[0].designLps,14);assert.equal(after.airflowReport.lines[0].measuredLps,9);assert.equal(after.airflowReport.lines[0].designChanged,true);
 assert.equal(before.airflowReport.lines[0].designLps,10);
});

test('complete explicit terminal allocations fill missing design targets without writing room targets',()=>{
 let p=allocationProject();const before=serializeProject(p);
 let r=buildCommissioningReport(p,'floor-ground'),line=r.lines[0];
 assert.equal(line.designLps,15);assert.equal(line.designSource,'explicit-terminal-allocations');assert.equal(line.allocationComplete,true);assert.equal(r.totals.supply.designLps,15);
 assert.equal(serializeProject(p),before);assert.equal(p.rooms[0].airflowTargets.normal.assigned.state,'unresolved');
 p=applyCommand(p,{type:'commissioning.recordMeasurement',spaceId:'bed',measuredLps:14,setting:'test',notes:'',recordedAt:'2026-11-18T00:00:00Z'});
 line=buildCommissioningReport(p,'floor-ground').lines[0];assert.equal(line.measurement.designLpsAtMeasurement,15);assert.equal(line.designChanged,false);
 const design=structuredClone(p.engineeringInputs.networkDesigns[0]);design.terminalAllocations[0].inputValue=36;design.terminalAllocations[0].valueLps=10;
 p=applyCommand(p,{type:'engineering.setNetworkDesign',design});line=buildCommissioningReport(p,'floor-ground').lines[0];assert.equal(line.designLps,17);assert.equal(line.measuredLps,14);assert.equal(line.designChanged,true);
 p=updateTargets(p,'bed','room',{assigned:airflowTargetFromInput(20,'l/s','Manual precedence','Test')});line=buildCommissioningReport(p,'floor-ground').lines[0];assert.equal(line.designLps,20);assert.equal(line.designSource,'assigned-room-target');assert.equal(line.allocationDisagrees,true);
});
test('partial, absent, stale and other-floor/mode allocations never invent a complete room flow',()=>{
 let p=allocationProject();let design=structuredClone(p.engineeringInputs.networkDesigns[0]);design.terminalAllocations.pop();
 p=applyCommand(p,{type:'engineering.setNetworkDesign',design});assert.equal(buildCommissioningReport(p,'floor-ground').lines[0].designLps,null);
 p=allocationProject();design=structuredClone(p.engineeringInputs.networkDesigns[0]);p.engineeringInputs.networkDesigns=[];design.mode='boost';p=applyCommand(p,{type:'engineering.setNetworkDesign',design});assert.equal(buildCommissioningReport(p,'floor-ground').lines[0].designLps,null);
 p=allocationProject();p.rooms[0].boundaryState='reassignment-required';assert.equal(buildCommissioningReport(p,'floor-ground').lines[0].designLps,null);
 p=allocationProject();p=applyCommand(p,{type:'floor.add',floor:{...floor(),id:'upper',name:'Upper'}});assert.equal(buildCommissioningReport(p,'upper').totals.supply.designLps,null);
 const original=p.activeDesignOptionId;p=applyCommand(p,{type:'designOption.duplicate',id:'other-alloc',name:'Other',copyScopes:[],activate:true});assert.equal(buildCommissioningReport(p,'floor-ground').totals.supply.designLps,null);
 p=applyCommand(p,{type:'designOption.switch',optionId:original});assert.equal(buildCommissioningReport(p,'floor-ground').lines[0].designLps,15);
});
function allocationProject(){
 let p=twoRoomProject();p=createRoom(p,'bed','Bedroom','supply',leftBoundary(p));
 p=addAndAssignTerminal(p,'terminal-a','synthetic-supply-terminal','bed',1500,1500);
 p=addAndAssignTerminal(p,'terminal-b','synthetic-supply-terminal','bed',2500,2500);
 const terminalAllocations=p.rooms[0].terminalAssociations.map((a,i)=>({id:`allocation-${i}`,componentId:a.componentId,portId:a.portId,spaceKind:'room',spaceId:'bed',inputValue:(i?7:8)*3.6,inputUnit:'m3/h',valueLps:i?7:8,basis:'Explicit design',source:'Test',terminalPressureLoss:{state:'unresolved',valuePa:null,inputValue:null,inputUnit:null,basis:null,source:null,reason:'Unknown'}}));
 return applyCommand(p,{type:'engineering.setNetworkDesign',design:{floorId:'floor-ground',mode:'normal',basis:'Explicit design',source:'Test',sourceVersion:'1',occupancy:{state:'unresolved',persons:null,basis:null,source:null,reason:'Not set'},fluid:{densityKgM3:1.2,dynamicViscosityPaS:0.000018,basis:'Test',source:'Test'},terminalAllocations,routeResistanceInputs:[],componentResistanceInputs:[],fanCurves:[],operatingPointModels:[]}});
}
