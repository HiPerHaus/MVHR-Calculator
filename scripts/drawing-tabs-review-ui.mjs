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
  project = applyCommand(project, { type: 'floorArea.create', outline: { id: 'qa-outline', floorId: 'floor-ground', name: 'Shared floor plan', geometrySource: 'manual-floor-area-outline', purpose: 'preliminary-quoting', areaConvention: 'closed-plan-outline', measurementBasis: 'floor-local-plan-mm', holes: [], vertices: [{x:0,y:0},{x:10000,y:0},{x:10000,y:7500},{x:0,y:7500}].map((point,index)=>({id:`qa-v-${index}`,positionMm:{...point,z:knownMm(0,'synthetic')}})) } });
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
    tabsQaEqual(activeVentilationWorkspace,type==='mixed'?'combined':type,`${type} default`);
    for (const workspace of ['decentralised','centralised','combined','decentralised','combined','centralised']) {
      tabsQaClick(`[data-ventilation-tab="${workspace}"]`);
      tabsQaEqual(tabsQaStable(),original,`${type} ${workspace}: view-only switch mutated model/history/camera/visibility`);
      tabsQaAssert(document.querySelector(`[data-ventilation-tab="${workspace}"]`).getAttribute('aria-pressed')==='true','Tab pressed state');
      tabsQaAssert(workspace==='combined' || [...catalogueCategories.children].every(button => workspace==='centralised' ? !button.textContent.includes('Decentralised')&&!button.textContent.includes('Controls') : /Decentralised|Controls/.test(button.textContent)), 'Cross-system categories');
      tabsQaAssert(document.querySelector('#automatic-routing-section').hidden===(workspace==='decentralised'),'Auto-route scope');
      tabsQaAssert(canvas.querySelector('[data-floor-area-id="qa-outline"]'),'Shared floor plan disappeared');
      if(workspace==='combined') {
        for(const category of ['Units','Terminals','Distribution','Decentralised','Controls','Duct']) tabsQaCategory(category);
        tabsQaAssert(!document.querySelector('#duct-parts').hidden,'Combined duct tools hidden');
        tabsQaAssert([...document.querySelectorAll('[data-ventilation-workspace]')].every(panel=>!panel.hidden),'Combined system panel hidden');
        for(const query of ['Lunos','Q350','controller','EPP']) {
          catalogueSearchInput.value=query;catalogueSearchInput.dispatchEvent(new Event('input'));
          tabsQaAssert(catalogueGroups.querySelectorAll('button').length>0 || !document.querySelector('#duct-parts').hidden,`Combined search lost ${query}`);
        }
      } else {
        catalogueSearchInput.value = workspace==='centralised'?'Lunos':'EPP';catalogueSearchInput.dispatchEvent(new Event('input'));
        tabsQaAssert(catalogueGroups.querySelectorAll('button').length===0&&document.querySelector('#duct-parts').hidden,'Cross-system search results');
      }
      const visibleIds=[...new Set([...canvas.querySelectorAll('[data-component-id]')].map(item=>item.dataset.componentId))].sort();
      const expectedComponents=history.present.components.filter(item=>workspace==='combined'||(item.decentralisedMvhr||item.decentralisedController?'decentralised':'centralised')===workspace);
      tabsQaEqual(visibleIds,expectedComponents.map(item=>item.id).sort(),'Plan has missing or cross-system components');
      const visibleRoutes=[...new Set([...canvas.querySelectorAll('[data-route-id]')].map(item=>item.dataset.routeId))].sort();
      tabsQaEqual(visibleRoutes,workspace==='decentralised'?[]:history.present.routes.map(item=>item.id).sort(),'Plan has missing or cross-system ducts');
      const visibleCables=[...new Set([...canvas.querySelectorAll('[data-decentralised-cable-id]')].map(item=>item.dataset.decentralisedCableId))].sort();
      tabsQaEqual(visibleCables,workspace==='centralised'?[]:history.present.decentralisedCables.map(item=>item.id).sort(),'Plan has missing or cross-system cables');
      for(const component of history.present.components) {
        const hit=mechanicalHitFromTarget({dataset:{componentId:component.id}});
        tabsQaEqual(Boolean(hit),expectedComponents.includes(component),'Hidden direct component hit');
      }
      catalogueSearchInput.value='';catalogueSearchInput.dispatchEvent(new Event('input'));
    }
    tabsQaClick('#plan-nav');tabsQaClick('#ventilation-nav');tabsQaClick('#checks-nav');tabsQaClick('#ventilation-nav');
    tabsQaEqual(tabsQaStable(),original,`${type}: navigation mutated model`);
    tabsQaClick('#decentralised-tools-tab');tabsQaClick('#sheets-nav');
    tabsQaAssert(!sheetPreviewPanel.hidden,'Export did not open');
    const decSheet=sheetPreviewPages.map(page=>page.svg).join('');
    tabsQaEqual(sheetExportSystemScope,'decentralised','Export should inherit Decentralised');
    tabsQaAssert(!decSheet.includes('data-id="qa-duct"'),'Decentralised export has central duct');
    tabsQaClick('#close-sheet-preview');tabsQaEqual(activeDesignStage,'draw','Export return');
    tabsQaEqual(activeVentilationWorkspace,'decentralised','Export lost system tab');
    tabsQaClick('#centralised-tools-tab');tabsQaClick('#sheets-nav');
    tabsQaEqual(sheetExportSystemScope,'centralised','Export should inherit Centralised');
    tabsQaAssert(!sheetPreviewPages.map(page=>page.svg).join('').includes('data-system="decentralised-mvhr"'),'Centralised export has decentralised equipment');
    tabsQaClick('#close-sheet-preview');
    tabsQaClick('#combined-tools-tab');tabsQaClick('#sheets-nav');
    tabsQaEqual(sheetExportSystemScope,'combined','Export should inherit Combined');
    const combinedSheet=sheetPreviewPages.map(page=>page.svg).join('');
    if(type==='mixed') tabsQaAssert(combinedSheet.includes('data-system="decentralised-mvhr"')&&combinedSheet.includes('data-id="qa-duct"'),'Combined export lacks a system');
    tabsQaClick('#close-sheet-preview');tabsQaEqual(activeVentilationWorkspace,'combined','Export lost Combined tab');
    tabsQaEqual(tabsQaStable(),original,`${type}: export mutated model`);
    passed.push(`${type}: defaults, 6 switches, clean system plan, shared outline, hidden-hit rejection, search, navigation, scoped exports with unchanged model`);
  }
  tabsQaFixture('mixed');tabsQaClick('#combined-tools-tab');
  const selectionOriginal=tabsQaStable();
  for(const kind of ['component','route','cable']) {
    tabsQaClick('#combined-tools-tab');
    mechanicalState={...mechanicalState,selectedComponentId:kind==='component'?'qa-hrv':null};
    selectedRouteId=kind==='route'?'qa-duct':null;selectedDecentralisedCableId=kind==='cable'?'qa-cable':null;render();
    tabsQaClick(kind==='cable'?'#centralised-tools-tab':'#decentralised-tools-tab');
    tabsQaAssert(!mechanicalState.selectedComponentId&&!selectedRouteId&&!selectedDecentralisedCableId,'Hidden selection survived switching');
    canvas.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}));
    tabsQaEqual(tabsQaStable(),selectionOriginal,'Delete after switching changed model');
    tabsQaAssert(!canvas.querySelector('.route-point-handle,.decentralised-cable-point-handle'),'Hidden edit handles remained');
  }
  tabsQaClick('#combined-tools-tab');
  openComponentContextAt(history.present.components.find(item=>item.id==='qa-hrv'),400,300);
  tabsQaAssert(!componentContext.hidden,'Context menu did not open');
  tabsQaClick('#decentralised-tools-tab');
  tabsQaAssert(componentContext.hidden,'Keyboard system switch retained hidden-item context actions');
  tabsQaEqual(tabsQaStable(),selectionOriginal,'Closing hidden context menu changed model');
  // A stale check reveal must not leak a component when moving to the opposite tab.
  focusCheckTarget({target:{kind:'component',id:'qa-lunos-a'}});tabsQaClick('#centralised-tools-tab');
  tabsQaAssert(!canvas.querySelector('[data-component-id="qa-lunos-a"]')&&!temporaryCheckReveal,'Check reveal leaked across system tabs');
  tabsQaClick('#return-to-check');tabsQaClick('#ventilation-nav');
  tabsQaClick('#combined-tools-tab');
  hiddenVentilationGroups.add('hrv');render();
  tabsQaAssert(!canvas.querySelector('[data-component-id="qa-hrv"]'),'View option not respected');
  tabsQaClick('#decentralised-tools-tab');tabsQaClick('#combined-tools-tab');
  tabsQaAssert(!canvas.querySelector('[data-component-id="qa-hrv"]'),'Combined reset view option');
  hiddenVentilationGroups.clear();render();
  // Hit testing and snapping must ignore hidden centralised equipment and ducts.
  tabsQaClick('#decentralised-tools-tab');
  const routePoint=canvas.createSVGPoint();routePoint.x=400;routePoint.y=250;
  const routeClient=routePoint.matrixTransform(canvas.getScreenCTM());
  tabsQaEqual(routeIdFromPointerEvent({target:canvas,clientX:routeClient.x,clientY:routeClient.y}),null,'Hidden duct selected by proximity');
  const unit=history.present.components.find(item=>item.id==='qa-hrv');
  const intake=unit.ports.find(port=>port.stream==='intake'),exhaust=unit.ports.find(port=>port.stream==='exhaust');
  const a=floorPortTransform(history.present,unit.id,intake.id),b=floorPortTransform(history.present,unit.id,exhaust.id);
  const proposed={x:(a.positionMm.x+b.positionMm.x)/2+a.direction.x*3000,y:(a.positionMm.y+b.positionMm.y)/2+a.direction.y*3000};
  const grille=createCatalogueComponent('generic-external-grille-combined-dn160',{id:'qa-preview-grille',floorId:'floor-ground',xMm:proposed.x,yMm:proposed.y});
  tabsQaEqual(grilleAlignment(grille,proposed,true),null,'Hidden HRV attracted grille snapping');
  const portPoint=canvas.createSVGPoint();portPoint.x=toView(a.positionMm.x);portPoint.y=toView(a.positionMm.y);
  const portClient=portPoint.matrixTransform(canvas.getScreenCTM());
  activeTool='route';tabsQaEqual(mechanicalHitFromPointerEvent({target:canvas,clientX:portClient.x,clientY:portClient.y}),null,'Hidden port attracted duct snapping');setTool('select');
  tabsQaClick('#centralised-tools-tab');tabsQaAssert(grilleAlignment(grille,proposed,true),'Visible HRV lost grille snapping');
  tabsQaClick('#combined-tools-tab');
  const beforeDrag=tabsQaStable();
  componentDragState={componentId:unit.id,memberIds:[unit.id],assemblyId:null,pointerId:999,start:{x:2000,y:2000},preview:{x:2400,y:2300}};
  renderDragPreview();tabsQaClick('#decentralised-tools-tab');
  tabsQaAssert(!componentDragState&&!routePointDragState&&!decentralisedCablePointDragState,'Drag preview survived tab switch');
  tabsQaEqual(tabsQaStable(),beforeDrag,'Interrupted drag changed model');
  tabsQaClick('#combined-tools-tab');
  passed.push('Selection/delete safety, handles, check reveal, view options, hidden route/port/grille snapping and cancelled drag');
  const original=tabsQaStable();tabsQaCategory('Terminals');tabsQaClick('.terminal-service-tool-supply');
  tabsQaClick('#ventilation-nav');tabsQaAssert(terminalPlacementMode?.service==='supply','Repeated Draw reset placement');
  tabsQaClick('#combined-tools-tab');tabsQaAssert(terminalPlacementMode?.service==='supply','Repeated Combined tab reset placement');
  tabsQaClick('#decentralised-tools-tab');tabsQaAssert(activeTool==='select'&&terminalPlacementMode===null,'System switch did not cancel placement');
  tabsQaEqual(tabsQaStable(),original,'Cancelled placement changed project');
  tabsQaClick('#combined-tools-tab');tabsQaCategory('Duct');tabsQaClick('[data-duct-kind="semi-rigid-radial"]');
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
  tabsQaClick('#combined-tools-tab');
  focusCheckTarget({target:{kind:'component',id:'qa-lunos-a'}});tabsQaEqual(activeVentilationWorkspace,'combined','Combined lost on decentralised Check focus');
  tabsQaAssert(!document.querySelector('#decentralised-system-field').hidden,'Combined pairing inspector inaccessible');
  focusCheckTarget({target:{kind:'route',id:'qa-duct'}});tabsQaEqual(activeVentilationWorkspace,'combined','Combined lost on route Check focus');
  tabsQaClick('#return-to-check');tabsQaClick('#ventilation-nav');
  passed.push('Check links choose system tools or retain Combined; pairing/controller inspector retained');
  tabsQaClick('#combined-tools-tab');await tabsQaSave();
  const stored=await workingSessions.read(workingContext());
  tabsQaEqual(stored.projectJson,serializeProject(history.present),'Stored model changed');
  tabsQaEqual(stored.ventilationWorkspace,'combined','Stored tool tab missing');
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
  tabsQaAssert(!canvas.querySelector('[data-component-id="qa-hrv"],[data-route-id]')&&canvas.querySelector('[data-component-id="qa-lunos-a"]'),'Recovered plan does not respect system tab');
  tabsQaEqual(tabsQaErrors,[],'Browser errors after reload');tabsQaOutput.textContent=`PASS reload ${innerWidth} × ${innerHeight}: mixed units, ducts, pairs, controller, cable, Draw, clean Decentralised plan and Controls restored.`;
});
tabsQaPanel.append(tabsQaOutput);
