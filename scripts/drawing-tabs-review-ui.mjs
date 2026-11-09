// Appended only by drawing-tabs-review-server.mjs on an isolated loopback origin.
document.querySelector('#app-auth-status').hidden = true;
const tabsQaPanel = document.createElement('details');
tabsQaPanel.open = true;
tabsQaPanel.style = 'position:fixed;right:8px;bottom:45px;z-index:99999;max-width:400px;max-height:34vh;overflow:auto;background:#fff;border:2px solid #146b69;padding:8px;font:12px sans-serif';
const tabsQaSummary = document.createElement('summary');
tabsQaSummary.textContent = `Synthetic tab QA · ${innerWidth} × ${innerHeight}`;
const tabsQaOutput = document.createElement('pre');
tabsQaOutput.id = 'tabs-qa-results';
tabsQaOutput.style = 'white-space:pre-wrap';
tabsQaOutput.textContent = 'Ready. Synthetic fixtures only; no live cloud.';
tabsQaPanel.append(tabsQaSummary);
document.body.append(tabsQaPanel);
const tabsQaErrors = [];
window.addEventListener('error', event => tabsQaErrors.push(event.message));
window.addEventListener('unhandledrejection', event => tabsQaErrors.push(String(event.reason)));
const tabsQaAssert = (value, label) => { if (!value) throw Error(label); };
const tabsQaEqual = (actual, expected, label) => tabsQaAssert(JSON.stringify(actual) === JSON.stringify(expected), label);
const tabsQaFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const tabsQaClick = selector => { const button = document.querySelector(selector); tabsQaAssert(button, `Missing ${selector}`); button.click(); };
const tabsQaCategory = name => { const button = [...catalogueCategories.children].find(item => item.textContent.includes(name)); tabsQaAssert(button, `Missing category ${name}`); button.click(); };
function tabsQaButton(label, action) {
  const button = document.createElement('button');button.textContent = label;button.style='margin:3px;min-height:34px';
  button.onclick = async () => { try { await action(); } catch (error) { tabsQaOutput.textContent = `FAIL: ${error.stack}`; } };
  tabsQaPanel.append(button);
}
function tabsQaFixture(type) {
  let project = createInitialProject(`synthetic-tabs-${type}`);
  project.projectDetails.name = `Synthetic ${type} review`;
  project = applyCommand(project, {type:'project.setVentilationDesignType', ventilationDesignType:type});
  const add = (catalogueItemId, id, xMm, yMm) => { project = applyCommand(project, {type:'component.add', component:createCatalogueComponent(catalogueItemId,{id,floorId:'floor-ground',xMm,yMm})}); };
  if (type !== 'decentralised') {
    add('zehnder-q350-hrv-left-drawing-profile','qa-hrv',2000,2000);
    add('luna-supply','qa-terminal',6500,3000);
    const family = routeFamilyForKind('semi-rigid-radial');
    project = applyCommand(project,{type:'route.add', route:{id:'qa-duct',floorId:'floor-ground',system:'mvhr',stream:'supply',role:'Dwelling supply',ductKind:family.id,connectionInterface:family.connectionInterface,parallelRunCount:1,startAttachment:null,endAttachment:null,points:[{x:2500,y:2500,z:unknownMm('synthetic')},{x:5000,y:2500,z:unknownMm('synthetic')},{x:6500,y:3000,z:unknownMm('synthetic')}]}});
  }
  if (type !== 'centralised') {
    add('lunos-e2-60-decentralised','qa-lunos-a',2800,6000);
    add('lunos-e2-60-decentralised','qa-lunos-b',7000,6000);
    add('lunos-5-sc-ft-controller-decentralised','qa-controller',4800,4700);
    for (const id of ['qa-lunos-a','qa-lunos-b']) project = applyCommand(project,{type:'component.setDecentralisedConfiguration',componentId:id,roomId:null,zoneId:null,pairGroupId:'Pair A',controllerReference:'Synthetic C1',notes:''});
    project = applyCommand(project,{type:'decentralisedCable.add',cable:{id:'qa-cable',floorId:'floor-ground',controllerId:'qa-controller',unitComponentId:'qa-lunos-a',cableKind:'combined-power-control',topologyStatus:'verified-star-individual-runs',maximumRouteLengthMm:null,specification:{status:'verified-manufacturer',label:'J-Y(St)Y (2x2x0.8)',source:'Synthetic test fixture'},points:[{x:4800,y:4700},{x:2800,y:6000}]}});
  }
  applyLocalReopen({project},{named:false});currentProjectName=project.projectDetails.name;
  selectDesignStage('draw');initialCameraFit.cancel();camera={x:0,y:0,width:1100,height:800};render();
  return project;
}
async function tabsQaReady() { for(let i=0;i<120&&!workingReady;i++) await tabsQaFrame();tabsQaAssert(workingReady,'Recovery not ready'); }
async function tabsQaSave() { queueWorkingSession();await Promise.resolve();await workingSessions.flush(); }
function tabsQaStable() {return {project:serializeProject(history.present),past:history.past.length,future:history.future.length,camera:{...camera},visibility:[...hiddenVentilationGroups]};}
for (const type of ['centralised','decentralised','mixed']) tabsQaButton(`Load ${type}`, async () => {await tabsQaReady();tabsQaFixture(type);tabsQaOutput.textContent=`Loaded synthetic ${type}. Tabs, parts and canvas are available for manual review.`;});
tabsQaButton('Run tab checks', async () => {
  tabsQaOutput.textContent='Running checks…';
  await tabsQaReady();const passed=[];
  for (const type of ['centralised','decentralised','mixed']) {
    tabsQaFixture(type);const original=tabsQaStable();
    tabsQaEqual(activeVentilationWorkspace,type==='decentralised'?'decentralised':'centralised',`${type} default`);
    for (const workspace of ['decentralised','centralised','decentralised','centralised']) {
      tabsQaClick(`[data-ventilation-tab="${workspace}"]`);
      tabsQaEqual(tabsQaStable(),original,`${type} ${workspace}: view-only switch mutated model/history/camera/visibility`);
      tabsQaAssert(document.querySelector(`[data-ventilation-tab="${workspace}"]`).getAttribute('aria-pressed')==='true','Tab pressed state');
      tabsQaAssert([...catalogueCategories.children].every(button => workspace==='centralised' ? !button.textContent.includes('Decentralised')&&!button.textContent.includes('Controls') : /Decentralised|Controls/.test(button.textContent)), 'Cross-system categories');
      tabsQaAssert(document.querySelector('#automatic-routing-section').hidden===(workspace==='decentralised'),'Auto-route scope');
      tabsQaAssert([...canvas.querySelectorAll('[data-component-id]')].length>0,'Shared plan lost equipment');
      catalogueSearchInput.value = workspace==='centralised'?'Lunos':'EPP';catalogueSearchInput.dispatchEvent(new Event('input'));
      tabsQaAssert(catalogueGroups.querySelectorAll('button').length===0&&document.querySelector('#duct-parts').hidden,'Cross-system search results');
      catalogueSearchInput.value='';catalogueSearchInput.dispatchEvent(new Event('input'));
    }
    tabsQaClick('#plan-nav');tabsQaClick('#ventilation-nav');tabsQaClick('#checks-nav');tabsQaClick('#ventilation-nav');
    tabsQaEqual(tabsQaStable(),original,`${type}: navigation mutated model`);
    tabsQaClick('#decentralised-tools-tab');tabsQaClick('#sheets-nav');
    tabsQaAssert(!sheetPreviewPanel.hidden,'Export did not open');
    const sheetBefore=sheetPreviewPages.map(page=>page.svg);
    tabsQaClick('#close-sheet-preview');tabsQaEqual(activeDesignStage,'draw','Export return');
    tabsQaEqual(activeVentilationWorkspace,'decentralised','Export lost system tab');
    tabsQaClick('#centralised-tools-tab');tabsQaClick('#sheets-nav');
    tabsQaEqual(sheetPreviewPages.map(page=>page.svg),sheetBefore,`${type}: output changed with tool tab`);
    if(type==='mixed') tabsQaAssert(sheetBefore.join('').includes('data-system="decentralised-mvhr"')&&sheetBefore.join('').includes('data-id="qa-duct"'),'Mixed export lacks a system');
    tabsQaClick('#close-sheet-preview');tabsQaEqual(tabsQaStable(),original,`${type}: export mutated model`);
    passed.push(`${type}: defaults, 4 switches, scoped search, plan/check/export return, identical outputs`);
  }
  const original=tabsQaStable();tabsQaCategory('Terminals');tabsQaClick('.terminal-service-tool-supply');
  tabsQaClick('#ventilation-nav');tabsQaAssert(terminalPlacementMode?.service==='supply','Repeated Draw reset placement');
  tabsQaClick('#centralised-tools-tab');tabsQaAssert(terminalPlacementMode?.service==='supply','Repeated tab reset placement');
  tabsQaClick('#decentralised-tools-tab');tabsQaAssert(activeTool==='select'&&terminalPlacementMode===null,'System switch did not cancel placement');
  tabsQaEqual(tabsQaStable(),original,'Cancelled placement changed project');
  tabsQaClick('#centralised-tools-tab');tabsQaCategory('Duct');tabsQaClick('[data-duct-kind="semi-rigid-radial"]');
  mechanicalState={...mechanicalState,routeDraft:{points:[{x:10,y:10}],startAttachment:null}};
  tabsQaClick('#decentralised-tools-tab');tabsQaAssert(activeTool==='select'&&mechanicalState.routeDraft===null,'System switch retained unfinished route');
  tabsQaEqual(tabsQaStable(),original,'Cancelled route changed project');
  tabsQaCategory('Controls');tabsQaClick('[data-catalogue-item-id="lunos-5-sc-ft-controller-decentralised"]');
  tabsQaClick('#centralised-tools-tab');tabsQaAssert(activeTool==='select','Controller preview leaked across tabs');
  passed.push('Repeated active tab/Draw retains placement; changing system cancels pending outlet, controller and route');
  focusCheckTarget({target:{kind:'component',id:'qa-lunos-a'}});tabsQaEqual(activeVentilationWorkspace,'decentralised','Check target chose wrong tools');
  tabsQaAssert(!document.querySelector('#decentralised-system-field').hidden,'Pair/controller inspector inaccessible');
  focusCheckTarget({target:{kind:'route',id:'qa-duct'}});tabsQaEqual(activeVentilationWorkspace,'centralised','Route focus chose wrong tools');
  tabsQaClick('#return-to-check');tabsQaClick('#ventilation-nav');
  passed.push('Check links select correct system tools; pairing/controller inspector retained');
  tabsQaClick('#decentralised-tools-tab');await tabsQaSave();
  const stored=await workingSessions.read(workingContext());
  tabsQaEqual(stored.projectJson,serializeProject(history.present),'Stored model changed');
  tabsQaEqual(stored.ventilationWorkspace,'decentralised','Stored tool tab missing');
  tabsQaAssert(ventilationWorkspaceButtons.every(button=>button.getBoundingClientRect().height>=43.9),'Tab touch height <44');
  tabsQaAssert(document.documentElement.scrollWidth<=innerWidth,'Horizontal page overflow');
  tabsQaAssert(canvas.getBoundingClientRect().width <= planWorkspace.getBoundingClientRect().width + 0.1, 'Canvas intrinsic grid overflow');
  if (innerWidth <= 1100) tabsQaAssert(tabletInspectorToggle.getBoundingClientRect().right <= innerWidth + 0.1, 'Inspector button clipped');
  tabsQaAssert(!document.querySelector('#route-nav'),'Duplicate Route navigation remains');
  tabsQaEqual(tabsQaErrors,[],'Browser runtime errors');
  passed.push('IndexedDB mixed model/tab preserved; 44px targets; no page overflow or runtime errors');
  tabsQaOutput.textContent=`PASS ${innerWidth} × ${innerHeight}\n`+passed.join('\n');
});
tabsQaButton('Prepare reload', async () => {
  await tabsQaReady();tabsQaFixture('mixed');tabsQaClick('#decentralised-tools-tab');tabsQaCategory('Controls');await tabsQaSave();
  sessionStorage.setItem('tabs-qa-reload',JSON.stringify({project:serializeProject(history.present),workspace:activeVentilationWorkspace,group:selectedCatalogueGroup}));
  tabsQaOutput.textContent='Reload prepared. Reload this page, then choose Check restored.';
});
tabsQaButton('Check restored', async () => {
  await tabsQaReady();const expected=JSON.parse(sessionStorage.getItem('tabs-qa-reload'));
  tabsQaAssert(expected,'Prepare reload first');tabsQaEqual(serializeProject(history.present),expected.project,'Reload changed mixed model');
  tabsQaEqual(activeVentilationWorkspace,expected.workspace,'Reload lost selected tab');tabsQaEqual(selectedCatalogueGroup,expected.group,'Reload lost category');
  tabsQaEqual(activeDesignStage,'draw','Reload lost Draw');tabsQaAssert(document.querySelector('#decentralised-tools-tab').getAttribute('aria-pressed')==='true','Recovered palette not rendered');
  tabsQaEqual(tabsQaErrors,[],'Browser errors after reload');tabsQaOutput.textContent=`PASS reload ${innerWidth} × ${innerHeight}: mixed units, ducts, pairs, controller, cable, Draw, Decentralised and Controls restored.`;
});
tabsQaPanel.append(tabsQaOutput);
