// Appended inside the application module by the loopback-only review server.
// Synthetic projects only. Buttons run assertions through real UI handlers.
const reviewVersion='__REVIEW_VERSION__';
document.querySelector('.app-shell').hidden=false;
document.querySelector('#app-auth-status').hidden=true;
workingReady=false;
workingActivity=0;
initialCameraFit.cancel();
const reviewPanel=document.createElement('section');
reviewPanel.style='position:fixed;right:8px;top:8px;z-index:99999;width:380px;background:white;border:2px solid #246;padding:10px;max-height:50vh;overflow:auto;font:12px sans-serif';
const reviewTitle=document.createElement('strong');reviewTitle.textContent=`Synthetic drag review: ${reviewVersion}`;
const reviewOutput=document.createElement('pre');reviewOutput.id='review-results';reviewOutput.style='white-space:pre-wrap';
const reviewTests=document.createElement('button');reviewTests.textContent='Run interaction checks';
const reviewBench=document.createElement('button');reviewBench.textContent='Benchmark 40 ducts';
reviewPanel.append(reviewTitle,document.createElement('br'),reviewTests,reviewBench,reviewOutput);document.body.append(reviewPanel);
const reviewErrors=[];window.addEventListener('error',e=>reviewErrors.push(e.message));window.addEventListener('unhandledrejection',e=>reviewErrors.push(String(e.reason)));
const capture=canvas.setPointerCapture.bind(canvas);canvas.setPointerCapture=id=>{try{capture(id);}catch(error){if(error.name!=='NotFoundError')throw error;}};
function reviewFixture(count=3){
 let p=createInitialProject('synthetic-drag-review');
 const unit=createCatalogueComponent('zehnder-q350-hrv-left-drawing-profile',{id:'review-unit',floorId:'floor-ground',xMm:1500,yMm:1000});
 const grille=createCatalogueComponent('generic-external-grille-combined-dn160',{id:'review-grille',floorId:'floor-ground',xMm:7000,yMm:4000});
 p=applyCommand(p,{type:'component.add',component:unit});p=applyCommand(p,{type:'component.add',component:grille});
 const family=routeFamilyForKind('epp-rigid-dn160');
 const a=unit.ports.find(port=>port.stream==='intake'),b=grille.ports.find(port=>port.stream==='intake');
 p=applyCommand(p,{type:'route.add',route:{id:'review-epp',floorId:'floor-ground',system:'mvhr',stream:'intake',role:'Outdoor intake',ductKind:family.id,connectionInterface:family.connectionInterface,parallelRunCount:1,startAttachment:{componentId:unit.id,portId:a.id},endAttachment:{componentId:grille.id,portId:b.id},points:[floorPortTransform(p,unit.id,a.id).positionMm,{x:3500,y:3500,z:unknownMm('fixture')},floorPortTransform(p,grille.id,b.id).positionMm]}});
 const radial=routeFamilyForKind('semi-rigid-radial');
 for(let i=0;i<count;i++)p=applyCommand(p,{type:'route.add',route:{id:`review-radial-${i}`,floorId:'floor-ground',system:'mvhr',stream:i%2?'extract':'supply',role:i%2?'Dwelling extract':'Dwelling supply',ductKind:radial.id,connectionInterface:radial.connectionInterface,parallelRunCount:1,startAttachment:null,endAttachment:null,points:[{x:1000,y:5500+i*200},{x:3500,y:5500+i*200},{x:5500,y:7500+i*200},{x:8500,y:7500+i*200}].map(point=>({...point,z:unknownMm('fixture')}))}});
 p=applyCommand(p,{type:'route.add',route:{...p.routes.at(-1),id:'review-overlap',points:p.routes[1].points}});
 p=applyCommand(p,{type:'route.add',route:{...p.routes.at(-1),id:'review-self-crossing',points:[{x:1000,y:9000},{x:5000,y:13000},{x:1000,y:13000},{x:5000,y:9000}].map(point=>({...point,z:unknownMm('fixture')}))}});
 history=createCommandHistory(p);activeTool='select';mechanicalState=createMechanicalInteractionState();selectedRouteId=null;selectedRoutePointIndex=null;
 componentDragState=null;routePointDragState=null;suppressNextClick=false;camera={x:0,y:0,width:1600,height:1600};
 activeDesignStage='route';setTask('ventilation',{designNavigation:true});initialCameraFit.cancel();const rect=canvas.getBoundingClientRect();camera={x:0,y:0,width:1600*rect.width/rect.height,height:1600};render();
 return p;
}
function reviewAssert(ok,message){if(!ok)throw Error(message);}
function reviewEqual(a,b,message){reviewAssert(JSON.stringify(a)===JSON.stringify(b),message);}
function reviewClient(point){const p=canvas.createSVGPoint();p.x=point.x/10;p.y=point.y/10;const screen=p.matrixTransform(canvas.getScreenCTM());return{x:screen.x,y:screen.y};}
function reviewPointer(target,type,point,extra={}){target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:81,pointerType:'mouse',button:0,buttons:type==='pointerup'?0:1,clientX:point.x,clientY:point.y,...extra}));}
function reviewClick(point,extra={}){canvas.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:point.x,clientY:point.y,...extra}));}
const reviewFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>resolve()));
reviewTests.onclick=async()=>{
 reviewOutput.textContent='Running…';const passed=[];
 try{
  reviewFixture();let initial=JSON.stringify(history.present);selectedRouteId='review-radial-0';render();
  const route=history.present.routes.find(r=>r.id===selectedRouteId),handle=[...canvas.querySelectorAll('.route-point-handle.intermediate')].find(e=>e.dataset.pointIndex==='1');
  const from=reviewClient(route.points[1]),to=reviewClient({x:3700,y:5900});
  const frozen=renderedModelGroups.get('route:review-radial-1');
  reviewPointer(handle,'pointerdown',from);const unchanged=renderedModelGroups.get('route:review-radial-1');
  for(let i=0;i<20;i++)reviewPointer(canvas,'pointermove',{x:from.x+(to.x-from.x)*i/19,y:from.y+(to.y-from.y)*i/19});
  reviewEqual(JSON.stringify(history.present),initial,'drag must not modify model before release');await reviewFrame();
  reviewAssert(renderedModelGroups.get('route:review-radial-1')===unchanged,'unrelated route DOM must be retained during drag');
  const pending=routeDisplayPoints(history.present.routes.find(r=>r.id===selectedRouteId));
  reviewPointer(canvas,'pointerup',to);reviewAssert(history.past.length===1,'release must be one undo command');
  reviewEqual(history.present.routes.find(r=>r.id===selectedRouteId).points,pending,'displayed point preview must equal commit');
  history=undoCommand(history);render();reviewEqual(JSON.stringify(history.present),initial,'Undo must restore geometry');history=redoCommand(history);render();
  passed.push('20-event drag, retained unrelated DOM, one commit, exact preview, undo/redo');
  reviewFixture();initial=JSON.stringify(history.present);selectedRouteId='review-epp';render();
  const epp=history.present.routes.find(r=>r.id===selectedRouteId),h=[...canvas.querySelectorAll('.route-point-handle.intermediate')][0],start=reviewClient(epp.points[1]);
  reviewPointer(h,'pointerdown',start);reviewPointer(canvas,'pointermove',reviewClient({x:4000,y:2500}));
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await reviewFrame();
  reviewEqual(JSON.stringify(history.present),initial,'Escape must cancel queued preview');reviewAssert(routePointDragState===null,'Escape clears drag');
  passed.push('Escape before animation frame leaves model unchanged');
  const component=history.present.components[0],compNode=canvas.querySelector('.component-group[data-component-id="review-unit"]');
  const cp=reviewClient(component.positionMm),ct=reviewClient({x:2000,y:1600});
  reviewPointer(compNode,'pointerdown',cp);reviewPointer(canvas,'pointermove',ct);await reviewFrame();
  const preview=routeDisplayPoints(history.present.routes[0]);reviewPointer(canvas,'pointerup',ct);
  reviewEqual(history.present.routes[0].points,preview,'moved unit route/top elbow must match final geometry');
  passed.push('unit drag updates connected EPP and top elbow with exact commit geometry');
  reviewFixture();const cross=reviewClient({x:2000,y:5500});reviewClick(cross,{altKey:true});const first=selectedRouteId;reviewClick(cross,{altKey:true});const second=selectedRouteId;
  reviewAssert(first!==second&&first&&second,'Alt-click must cycle distinct overlapping ducts');
  reviewAssert(canvas.querySelector('[data-route-warning="review-self-crossing"]'),'self-cross warning drawn');
  reviewAssert(routeCoordinationDiagnostics.some(d=>d.routeId==='review-self-crossing'&&d.code.startsWith('route-self-crossing')),'self-cross diagnostic missing');
  passed.push('overlap cycling and visible self-cross warning');
  reviewFixture();initial=JSON.stringify(history.present);selectedRouteId='review-radial-0';render();
  let current=history.present.routes.find(r=>r.id===selectedRouteId);let ph=[...canvas.querySelectorAll('.route-point-handle.intermediate')][0];
  reviewPointer(ph,'pointerdown',reviewClient(current.points[1]));reviewPointer(canvas,'pointermove',reviewClient({x:3700,y:5900}));
  reviewPointer(canvas,'pointercancel',reviewClient({x:3700,y:5900}));await reviewFrame();
  reviewEqual(JSON.stringify(history.present),initial,'pointercancel must not commit');
  ph=[...canvas.querySelectorAll('.route-point-handle.intermediate')][0];reviewPointer(ph,'pointerdown',reviewClient(current.points[1]));
  reviewPointer(canvas,'pointermove',reviewClient({x:3700,y:5900}));reviewPointer(canvas,'pointerup',reviewClient({x:4000,y:6200}));await reviewFrame();
  current=history.present.routes.find(r=>r.id===selectedRouteId);reviewAssert(current.points[1].x===4000&&current.points[1].y===6200,'release uses final coordinate, not queued pointermove');
  passed.push('pointercancel and immediate release with a newer final coordinate');
  reviewFixture();history=createCommandHistory(applyCommand(history.present,{type:'route.delete',routeId:'review-epp'}));render();
  mechanicalState=activateMechanicalTool(mechanicalState,'route',{ductKind:'epp-rigid-dn160'});activeTool='route';render();
  const unit=history.present.components[0],grille=history.present.components[1],sp=unit.ports.find(p=>p.stream==='intake'),ep=grille.ports.find(p=>p.stream==='intake');
  const startPort=canvas.querySelector(`[data-component-id="${unit.id}"][data-port-id="${sp.id}"]`),endPort=canvas.querySelector(`[data-component-id="${grille.id}"][data-port-id="${ep.id}"]`);
  let sc=reviewClient(floorPortTransform(history.present,unit.id,sp.id).positionMm);suppressNextClick=false;
  startPort.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:sc.x,clientY:sc.y}));
  const ec=reviewClient(floorPortTransform(history.present,grille.id,ep.id).positionMm);
  reviewPointer(canvas,'pointermove',ec);const line=canvas.querySelector('[data-route-preview="normalized"]');
  reviewAssert(line,'normalized EPP draft must be drawn');const shown=line.getAttribute('points');reviewAssert(canvas.querySelector('[data-preview-hrv-elbow]'),'draft top elbow must be drawn');
  const liveEnd=canvas.querySelector(`[data-component-id="${grille.id}"][data-port-id="${ep.id}"]`);liveEnd.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:ec.x,clientY:ec.y}));
  const committed=history.present.routes.at(-1);reviewEqual(routePointString(routeBodyGeometry(committed).sampledCentreline),shown,'manual EPP hover path must equal committed path');
  passed.push('manual EPP endpoint hover and displayed unit top elbow match committed route');
  reviewEqual(reviewErrors,[],'browser runtime errors');
  reviewOutput.textContent=JSON.stringify({passed,errors:reviewErrors},null,2);
 }catch(error){reviewOutput.textContent=JSON.stringify({passed,error:error.stack,errors:reviewErrors},null,2);}
};
reviewBench.onclick=async()=>{
 reviewOutput.textContent='Measuring…';await reviewFrame();
 try{
  reviewFixture(40);const route=history.present.routes.find(r=>r.id==='review-radial-0');selectedRouteId=route.id;
  routePointDragState={routeId:route.id,pointIndex:1,pointerId:81,start:route.points[1],preview:route.points[1]};render();
  const samples=[];for(let i=0;i<35;i++){routePointDragState.preview={x:3500+i*10,y:5500+i*5};const start=performance.now();if(reviewVersion==='before')render();else renderDragPreview();const elapsed=performance.now()-start;if(i>=5)samples.push(elapsed);}
  samples.sort((a,b)=>a-b);routePointDragState=null;render();
  reviewOutput.textContent=JSON.stringify({version:reviewVersion,fixture:'43 ducts including 40 four-point radial routes, overlapping duct, self-cross, 2 components',samples:30,medianMs:samples[15],p95Ms:samples[28],maxMs:samples[29],scope:'synchronous drawing work, excludes browser frame scheduling/paint and pointerup validation'},null,2);
 }catch(error){reviewOutput.textContent=error.stack;}
};
reviewFixture();reviewOutput.textContent='Ready. Isolated synthetic project; no cloud connection or real drawings.';
