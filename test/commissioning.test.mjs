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
