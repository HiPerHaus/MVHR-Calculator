import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,applyCommand,serializeProject,deserializeProject,identityQuaternion,knownMm} from '../src/domain/spatial.mjs';
import {normalizeCompanyProfile,validateLogoDataUrl,createCompanyProfileStore} from '../src/persistence/company-profile.mjs';
import {createA3SheetModel,renderA3SheetSvg} from '../src/sheets/a3-sheet.mjs';
const metadata={floorId:'ground',issueDate:'2026-10-24',status:'Preliminary — not for construction',drawingTitle:'Ventilation layout',drawingId:'V-01',revision:'A',revisionText:'Design review'};
const logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4l8AAAAASUVORK5CYII=';
function project(){return applyCommand(createProject('sheet-review'),{type:'floor.add',floor:{id:'ground',name:'Ground floor',transform:{translationMm:{x:0,y:0,z:knownMm(0,'test')},orientation:identityQuaternion()}}});}
test('project identity and deliberate drawing attribution persist without inventing review',()=>{
 const original=project();const changed=applyCommand(original,{type:'project.updateDetails',details:{name:' Example home ',address:'12 Example Road\nAdelaide',clientName:'Example client',projectReference:'EX01',drawingTitle:' Ground Floor Ventilation Layout ',drawnBy:'Designer',checkedBy:''}});
 assert.equal(original.projectDetails.name,'');assert.deepEqual(deserializeProject(serializeProject(changed)).projectDetails,{name:'Example home',address:'12 Example Road\nAdelaide',clientName:'Example client',projectReference:'EX01',drawingTitle:'Ground Floor Ventilation Layout',drawnBy:'Designer',checkedBy:''});
 const old=structuredClone(original);old.schemaVersion=19;delete old.projectDetails;assert.deepEqual(deserializeProject(JSON.stringify(old)).projectDetails,original.projectDetails);
 assert.throws(()=>applyCommand(original,{type:'project.updateDetails',details:{name:'x'.repeat(121)}}),/Invalid project name/);
});
test('default sheet gives markup full height and puts project identity and branding in the right column',()=>{
 const p=applyCommand(project(),{type:'project.updateDetails',details:{name:'Example home',address:'12 Example Road',clientName:'Example client',projectReference:'EX01'}});
 const sheet=createA3SheetModel(p,{...metadata,company:{companyName:'Example & Co',contactName:'Designer',email:'office@example.test'},companyLogoDataUrl:logo});
 assert.equal(sheet.drawingBounds.heightMm,sheet.printableBounds.heightMm);
 assert.equal(sheet.legendBounds.xMm,sheet.titleBlockBounds.xMm);
 assert.equal(sheet.legendBounds.yMm+sheet.legendBounds.heightMm,sheet.titleBlockBounds.yMm);
 const svg=renderA3SheetSvg(sheet);assert.match(svg,/Example home/);assert.match(svg,/12 Example Road/);assert.match(svg,/Example client/);assert.match(svg,/Example &amp; Co/);assert.match(svg,/data-kind="company-logo"/);assert.doesNotMatch(svg,/id="parts-schedule"/);assert.match(svg,/SYMBOL KEY/);
 assert.throws(()=>createA3SheetModel(p,{...metadata,companyLogoDataUrl:'data:image/svg+xml;base64,PHN2Zz4='}),/PNG or JPEG/);
});
test('drawing attribution is explicit and checked by remains blank until recorded review',()=>{
 const p=applyCommand(project(),{type:'project.updateDetails',details:{name:'Example home',drawingTitle:'Ground Floor Ventilation Layout',drawnBy:'J. Designer',checkedBy:''}});
 const svg=renderA3SheetSvg(createA3SheetModel(p,{...metadata,drawingTitle:p.projectDetails.drawingTitle,drawnBy:p.projectDetails.drawnBy,checkedBy:p.projectDetails.checkedBy}));
 assert.match(svg,/Ground Floor Ventilation Layout/);assert.match(svg,/DRAWN BY J\. Designer · CHECKED BY —/);
});
test('company fields preserve contacts and reject executable logo formats or oversized input',()=>{
 const details=normalizeCompanyProfile({companyName:' Example ',contactPhone:'123',ignored:'discard'});assert.equal(details.companyName,'Example');assert.equal(details.contactPhone,'123');assert.equal(details.ignored,undefined);
 assert.equal(validateLogoDataUrl(logo),logo);assert.throws(()=>validateLogoDataUrl('data:image/png;base64,YWJj'),/Invalid PNG/);assert.throws(()=>normalizeCompanyProfile({phone:'x'.repeat(61)}),/Invalid company phone/);
});
test('company updates use optimistic version matching so stale tabs cannot overwrite branding',async()=>{
 const predicates=[];let uploadCount=0;
 const query={eq(key,value){predicates.push([key,value]);return this;},select(){return this;},async maybeSingle(){return {data:null,error:null};}};
 const store=createCompanyProfileStore({from(){return {update(){return query;}}},storage:{from(){return {async upload(){uploadCount++;return {data:{},error:null};}}}}});
 await assert.rejects(store.save({workspaceId:'workspace',userId:'user',details:{companyName:'Example'},logoDataUrl:logo,previous:{row:{version:7,logo_path:'existing'},logoDataUrl:logo}}),/changed in another tab/);
 assert.deepEqual(predicates,[['workspace_id','workspace'],['version',7]]);assert.equal(uploadCount,0);
});
