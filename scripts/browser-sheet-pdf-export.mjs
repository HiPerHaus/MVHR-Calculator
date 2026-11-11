import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isPathInside, resolveStaticRequestPath } from "../src/dev/static-path.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "hiper-sheet-pdf-profile-"));
const downloadDirectory = await mkdtemp(join(tmpdir(), "hiper-sheet-pdf-download-"));
const outputDirectory = resolve(root, "tmp/option-export-qa-20261111");
const outputPath = resolve(outputDirectory, "mixed-centralised-decentralised.pdf");
const canvasOutputPath = resolve(outputDirectory, "grille-canvas.png");
const previewOutputPath = resolve(outputDirectory, "grille-print-preview.png");
const debuggingPort = await reservePort();
const server = await startQaServer();
const address = server.address();
const pageUrl = `http://127.0.0.1:${address.port}/qa/sheet-pdf.html`;
const appUrl = `http://127.0.0.1:${address.port}/app/`;
const browser = spawn(chrome, [
  "--headless=new", "--no-first-run", "--disable-gpu", "--disable-background-networking",
  "--disable-component-update", `--remote-debugging-port=${debuggingPort}`, `--user-data-dir=${profileDirectory}`,
  "--window-size=1280,900", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let browserStderr = "";
browser.stderr.setEncoding("utf8");
browser.stderr.on("data", (chunk) => { browserStderr += chunk; });

try {
  await waitForDevTools(debuggingPort);
  const target = await fetch(`http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(pageUrl)}`, { method: "PUT" }).then((response) => response.json());
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  const exceptions = [];
  cdp.on("Runtime.exceptionThrown", (params) => exceptions.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "Runtime exception"));
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  cdp.on("Fetch.requestPaused", params => {
    const allowed = params.request.url.startsWith(`http://127.0.0.1:${address.port}/`) || /^(data:|blob:|about:)/.test(params.request.url);
    cdp.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", { requestId: params.requestId, ...(allowed ? {} : { errorReason: "BlockedByClient" }) }).catch(error => exceptions.push(error.message));
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDirectory, eventsEnabled: true });
  await waitFor(cdp, "window.__pdfReady === true", 30_000);
  const pagePlan = await evaluate(cdp, "window.__pagePlan");
  assert.equal(pagePlan[0].widthMm, 420);
  assert.equal(pagePlan[0].heightMm, 297);
  assert.ok(pagePlan.length >= 4, `Expected drawing, installation details and multiple parts pages, got ${pagePlan.length}`);
  assert.equal(pagePlan.slice(2).every((page) => page.widthMm === 210 && page.heightMm === 297), true);
  assert.equal(pagePlan[1].kind, "installation-details");
  assert.equal(pagePlan[1].widthMm, 420);
  assert.equal(pagePlan[1].heightMm, 297);
  const outputText = await evaluate(cdp, "window.__outputText");
  assert.doesNotMatch(outputText, /Synthetic Ground Floor|three per job|Supplier pages show rounded stock items|EPP includes standard HRV port allowances|CW branches require O-rings|Job totals and packs/i);
  assert.match(outputText, /Ground Floor/);
  const supplierEvidence = await evaluate(cdp, "window.__supplierEvidence");
  assert.equal(supplierEvidence.some((row) => row.description.startsWith("Total 90 mm duct")), false);
  assert.equal(supplierEvidence.some((row) => row.description.startsWith("Total DN160 EPP")), false);
  assert.deepEqual(supplierEvidence.filter((row) => row.partNumber === "ZEN-CT90-50M").map((row) => [row.quantity, row.unit]), [["1", "coil"]]);
  assert.deepEqual(supplierEvidence.filter((row) => row.partNumber === "AER-DUC-DN160-1MSL").map((row) => [row.quantity, row.unit]), [["7", "ea"]]);
  assert.equal(supplierEvidence.some((row) => row.unit === "stock" && row.quantity === "Not set" && row.description.includes("DN150")), true);
  assert.equal(supplierEvidence.some((row) => row.unit === "m"), false);
  const grilleEvidence = await evaluate(cdp, "window.__grilleEvidence");
  assert.equal(grilleEvidence.arrowCount, 4);
  assert.deepEqual(grilleEvidence.streams.sort(), ["exhaust", "exhaust", "intake", "intake"]);
  assert.equal(grilleEvidence.fills.includes("#1769d2"), true);
  assert.equal(grilleEvidence.fills.includes("#e2342f"), true);
  assert.deepEqual(grilleEvidence.labels.sort(), ["Exhaust Air OUT", "Exhaust Air OUT", "Outside Air", "Outside Air"]);
  assert.equal(grilleEvidence.largeArrows, true);
  assert.equal(grilleEvidence.offsetArrows, true);
  assert.equal(grilleEvidence.readableLabels, true);
  assert.equal(grilleEvidence.integratedLabels, true);
  assert.equal(grilleEvidence.combinedPairClear, true);
  assert.ok(grilleEvidence.watermarkFontSize > 0 && grilleEvidence.watermarkFontSize <= 14, "draft watermark should fit inside the drawing clip");
  assert.equal(grilleEvidence.lunaMasks, 2,"placed Luna and key should both retain opaque duct masks");
  const electricalEvidence = await evaluate(cdp, "window.__electricalEvidence");
  assert.deepEqual(electricalEvidence.keyLabels.sort(), [
    "Controller - 5/SC-FT SmartComfort",
    "Controller - sMove",
    "Controller Cable - J-Y(St)Y (2x2x0.8)",
    "Controller Cable - LiYY 3 × 0.75 mm² or equivalent",
    "Decentralised MVHR - AeroFresh 30 Compact",
    "Decentralised MVHR - ComfoAir 70",
    "Decentralised MVHR - ComfoSpot 50",
    "Decentralised MVHR - LUNOS e²60",
  ].sort());
  assert.equal(electricalEvidence.noteCount, 2);
  assert.equal(electricalEvidence.preliminaryBoundary, true);
  assert.equal(electricalEvidence.verifiedLunos, true);
  assert.equal(electricalEvidence.unverifiedAeroFresh, true);
  assert.equal(electricalEvidence.genericLegend, false);
  assert.equal(electricalEvidence.singleColumn, true);
  assert.equal(electricalEvidence.compactOnly, true);
  assert.match(electricalEvidence.visibleText, /DECENTRALISED MVHR ELECTRICAL CONNECTION/);
  assert.match(electricalEvidence.visibleText, /Cable from control location to head units - LiYY 3 × 0\.75 mm² or equivalent/);
  assert.doesNotMatch(electricalEvidence.visibleText, /ELECTRICAL CONNECTION · PRELIMINARY|Verify current supplied manual and AU requirements/);
  assert.match(electricalEvidence.visibleText, /230 V to controller location/);
  assert.doesNotMatch(electricalEvidence.visibleText, /controller\/PSU arrangement|exact arrangement manual-required|via specified separate PSU|\(C[0-9]+ [^)]+\) —/iu);
  assert.match(await evaluate(cdp, "window.__outputText"), /Controller Cable - LiYY 3 × 0\.75 mm² or equivalent/);
  await evaluate(cdp, "document.querySelector('#download').click()");
  const downloaded = await waitForDownload(downloadDirectory);
  await mkdir(outputDirectory, { recursive: true });
  await copyFile(downloaded, outputPath);
  await cdp.send("Page.navigate", { url: appUrl });
  await waitFor(cdp, "document.readyState === 'complete' && !document.querySelector('.app-shell')?.hidden && document.querySelector('#draft-status')?.textContent.includes('outline')", 20_000);
  await waitFor(cdp, "document.querySelectorAll('[data-plan-graphic=\"hiper-external-grille-plan-v1\"] [data-part=\"airflow-label\"]').length === 4");
  const canvasEvidence=await evaluate(cdp, `(()=>{const follows=(routeId,componentId)=>{const route=document.querySelector('[data-route-id="'+routeId+'"]'),component=document.querySelector('.component-group[data-component-id="'+componentId+'"]');return Boolean(route&&component&&(route.compareDocumentPosition(component)&Node.DOCUMENT_POSITION_FOLLOWING));};const labels=[...document.querySelectorAll('[data-plan-graphic="hiper-external-grille-plan-v1"] [data-part="airflow-label"]')];const combined=document.querySelector('[data-plan-graphic="hiper-external-grille-plan-v1"][data-external-grille-handing]');const arrows=[...(combined?.querySelectorAll('[data-part="airflow-arrow"]')??[])].map(node=>node.getBBox()).sort((a,b)=>a.y-b.y);return {labels:labels.map(node=>node.textContent),integratedLabels:labels.every(node=>node.getAttribute('data-label-integrated')==='true'&&getComputedStyle(node).fill==='rgb(255, 255, 255)'),combinedPairClear:arrows.length===2&&arrows[0].y+arrows[0].height<arrows[1].y,masks:[...document.querySelectorAll('[data-plan-graphic="hiper-luna-grille-v1"] [data-part="luna-duct-mask"]')].map(node=>getComputedStyle(node).fill),lunaAboveDuct:follows('qa-radial','luna-output'),externalAboveDuct:follows('qa-grille-intake','grille-combined')};})()`);
  assert.deepEqual(canvasEvidence.labels.sort(),["Exhaust Air OUT","Exhaust Air OUT","Outside Air","Outside Air"]);
  assert.equal(canvasEvidence.integratedLabels,true,"Canvas should render white wording inside each arrow shaft");
  assert.equal(canvasEvidence.combinedPairClear,true,"Canvas combined-grille arrows should retain separate lanes");
  assert.deepEqual(canvasEvidence.masks,["rgb(255, 255, 255)"],"Canvas Luna terminal should keep an opaque white centre over its duct");
  assert.equal(canvasEvidence.lunaAboveDuct,true,"Canvas Luna face should mask the rounded route cap");
  assert.equal(canvasEvidence.externalAboveDuct,true,"Canvas external grille face should mask the rounded route cap");
  await writeFile(canvasOutputPath,Buffer.from((await cdp.send("Page.captureScreenshot",{format:"png"})).data,"base64"));
  assert.equal(await evaluate(cdp, "document.querySelector('#export-sheet-pdf')?.textContent"), "Export PDF");
  assert.equal(await evaluate(cdp, "document.querySelector('#print-sheet-preview')?.textContent"), "Print");
  await evaluate(cdp, `(()=>{const form=document.querySelector('#project-details-form');form.elements.name.value='QA House';form.elements.drawingTitle.value='';form.elements.drawnBy.value='QA Designer';form.elements.checkedBy.value='';form.requestSubmit();})()`);
  await evaluate(cdp, "document.querySelector('#sheets-nav').click()");
  await waitFor(cdp, "!document.querySelector('#sheet-preview-panel')?.hidden && document.querySelectorAll('#sheet-preview-host .sheet-page').length >= 2");
  assert.match(await evaluate(cdp, "document.querySelectorAll('#sheet-preview-host .sheet-page')[1].textContent"), /INSTALLATION DETAILS/);
  assert.equal(await evaluate(cdp, `document.querySelectorAll('#sheet-preview-host .sheet-page:first-child [data-kind="installation-detail"], #sheet-preview-host .sheet-page:first-child [data-illustration]').length`), 0, "Engineering artwork must not share the drawing page");
  assert.equal(await evaluate(cdp, `document.querySelectorAll('#sheet-preview-host .sheet-page:nth-child(2) #drawing-content').length`), 0, "Detail page must not contain the plan");
  assert.match(await evaluate(cdp, "document.querySelector('#sheet-preview-status').textContent"), /1 A3 installation detail sheet/);
  const appSheetText = await evaluate(cdp, "document.querySelector('#sheet-preview-host .sheet-page')?.textContent");
  assert.match(appSheetText, /QA House - Ground Floor - Ventilation Layout/);
  assert.match(appSheetText, /DRAWN BY QA Designer · CHECKED BY —/);
  assert.equal(await evaluate(cdp, `document.querySelectorAll('#sheet-preview-host .sheet-page:first-child #drawing-content [data-part="airflow-label"]').length`),4,"Print drawing should retain all external airflow labels");
  assert.equal(await evaluate(cdp, `document.querySelectorAll('#sheet-preview-host .sheet-page:first-child [data-kind="legend-external-grille"] [data-part="airflow-label"]').length`),4,"Print key should retain the matching external airflow labels");
  assert.ok(await evaluate(cdp, `document.querySelectorAll('#sheet-preview-host .sheet-page:first-child [data-part="luna-duct-mask"]').length`)>=2,"Print preview and key should retain Luna duct masks");
  await writeFile(previewOutputPath,Buffer.from((await cdp.send("Page.captureScreenshot",{format:"png"})).data,"base64"));
  await evaluate(cdp, "document.querySelector('#export-sheet-pdf').click()");
  await waitForDownloadCount(downloadDirectory, 2);
  await evaluate(cdp, "document.querySelector('#export-all-options-pdf').click()");
  await waitForDownloadCount(downloadDirectory, 3);
  assert.equal(await evaluate(cdp, "document.querySelector('#export-all-options-pdf').disabled"), false);
  const originalOptionId = await evaluate(cdp, "document.querySelector('#design-option-select').value");
  assert.equal(await evaluate(cdp, "document.querySelectorAll('#sheet-option-navigation button').length"), 3);
  const printEvidence = [];
  for (const [name, optionId, drawings] of [["selected-empty", "qa-empty-option", 1], ["all-options", "", 2], ["selected-original", originalOptionId, 1]]) {
    await evaluate(cdp, `document.querySelector('#sheet-option-navigation [data-export-option="${optionId}"]').click()`);
    assert.equal(await evaluate(cdp, "document.querySelector('#design-option-select').value"), originalOptionId, "Export selection must not change the editable design");
    assert.equal(await evaluate(cdp, `document.querySelectorAll('#sheet-preview-host [data-page-kind="drawing"]').length`), drawings);
    assert.equal(await evaluate(cdp, "document.querySelector('#export-parts-csv').disabled"), optionId === "");
    const beforeRepeat = await evaluate(cdp, "document.querySelector('#sheet-preview-host').innerHTML");
    await evaluate(cdp, `document.querySelector('#sheet-option-navigation [data-export-option="${optionId}"]').click()`);
    assert.equal(await evaluate(cdp, "document.querySelector('#sheet-preview-host').innerHTML"), beforeRepeat, "Repeated option clicks are idempotent");
    if (name === "selected-empty") {
      assert.equal(await evaluate(cdp, "document.querySelectorAll('#sheet-preview-host #drawing-content [data-kind=component]').length"), 0, "Empty alternative cannot contain another option's equipment");
      await evaluate(cdp, "document.querySelector('#export-sheet-pdf').click()");
      await evaluate(cdp, `document.querySelector('#sheet-option-navigation [data-export-option="${originalOptionId}"]').click()`);
      await waitForDownloadCount(downloadDirectory, 4);
      await evaluate(cdp, `document.querySelector('#sheet-option-navigation [data-export-option="qa-empty-option"]').click()`);
      await evaluate(cdp, "document.querySelector('#export-parts-csv').click()");
      await waitForFileCount(downloadDirectory, ".csv", 1);
      const csvName = (await readdir(downloadDirectory)).find(name => name.endsWith(".csv"));
      const csv = await readFile(join(downloadDirectory, csvName), "utf8");
      assert.match(csv, /No equipment option/);
      assert.doesNotMatch(csv, /AeroFresh 30 Compact|ComfoAir 70/);
    }
    if (name === "all-options") {
      // Headless Chrome may overwrite a same-name download. Preserve the earlier
      // all-options-button output before testing Export PDF from the All page.
      const previousAll = (await readdir(downloadDirectory)).find(file => file.includes("all-design-options") && file.endsWith(".pdf"));
      await rename(join(downloadDirectory, previousAll), join(downloadDirectory, "qa-all-options-button.pdf"));
      await evaluate(cdp, "document.querySelector('#export-sheet-pdf').click()");
      await waitForDownloadCount(downloadDirectory, 5);
    }
    const print = await cdp.send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
    const printPath = join(outputDirectory, `${name}-print.pdf`);
    await writeFile(printPath, Buffer.from(print.data, "base64"));
    const evidence = await verifyPdfPageSeparation(printPath);
    assert.equal(evidence.planPages.length, drawings);
    printEvidence.push({ name, ...evidence });
  }
  const electricalLayout = await evaluate(cdp, `(()=>{
    const block=document.querySelector('#sheet-preview-host .sheet-page:first-child #electrical-connection-notes');
    const box=block.querySelector('rect').getBBox();
    const text=[...block.querySelectorAll('text')];
    return {lines:[text[0].textContent,...text.slice(1).flatMap(node=>[...node.querySelectorAll('tspan')].map(line=>line.textContent))],fits:text.every(node=>{const b=node.getBBox();return b.x>=box.x&&b.x+b.width<=box.x+box.width-2&&b.y>=box.y&&b.y+b.height<=box.y+box.height;})};
  })()`);
  const longCableLayout = await evaluate(cdp, `(async()=>{
    const {createA3SheetModel,renderA3SheetSvg}=await import('/src/sheets/a3-sheet.mjs');
    const domain=await import('/src/domain/spatial.mjs');
    const {createCatalogueComponent}=await import('/src/editor/component-catalogue.mjs');
    let project=domain.applyCommand(domain.createProject('long-cable-qa'),{type:'floor.add',floor:{id:'ground',name:'Ground Floor',transform:{translationMm:{x:0,y:0,z:domain.knownMm(0,'QA')},orientation:domain.identityQuaternion()}}});
    for(const [id,item,x] of [['head','lunos-e2-60-decentralised',1000],['control','manual-decentralised-controller',2000]])project=domain.applyCommand(project,{type:'component.add',component:createCatalogueComponent(item,{id,floorId:'ground',xMm:x,yMm:1000})});
    project=domain.applyCommand(project,{type:'decentralisedCable.add',cable:{id:'long-cable',floorId:'ground',controllerId:'control',unitComponentId:'head',cableKind:'unspecified',topologyStatus:'unverified-model-specific',maximumRouteLengthMm:null,specification:{status:'unverified-manual-input',label:'W'.repeat(240),source:'Synthetic wrap test'},points:[{x:2000,y:1000},{x:1000,y:1000}]}});
    const host=document.createElement('div');host.innerHTML=renderA3SheetSvg(createA3SheetModel(project,{floorId:'ground',orientation:'landscape',projectName:'Wrap QA',drawingTitle:'Wrap QA',drawingId:'W',issueDate:'2026-11-11',revision:'A',revisionText:'QA',status:'Preliminary — not for construction'}));document.body.append(host);
    const block=host.querySelector('#electrical-connection-notes'),box=block.querySelector('rect').getBBox(),text=[...block.querySelectorAll('text')];
    const result={lines:block.querySelectorAll('tspan').length,fits:text.every(node=>{const b=node.getBBox();return b.x>=box.x&&b.x+b.width<=box.x+box.width-2&&b.y>=box.y&&b.y+b.height<=box.y+box.height;})};host.remove();return result;
  })()`);
  assert.ok(longCableLayout.lines>2);assert.ok(longCableLayout.fits,"Long custom cable specification must remain inside the electrical note");
  assert.equal(electricalLayout.lines[0], "DECENTRALISED MVHR ELECTRICAL CONNECTION");
  assert.ok(electricalLayout.lines.includes("Cable from control location to head units - LiYY 3 × 0.75 mm² or equivalent"));
  assert.ok(electricalLayout.fits, "Electrical wording must fit its box without wrapping or clipping");
  await writeFile(join(outputDirectory, "electrical-wording.png"), Buffer.from((await cdp.send("Page.captureScreenshot", {format:"png",clip:await evaluate(cdp, `(()=>{const b=document.querySelector('#sheet-preview-host .sheet-page:first-child #electrical-connection-notes').getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,scale:3};})()`) })).data,"base64"));
  for (const [name,width,height] of [["desktop",1440,900],["tablet",1024,768]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {width,height,deviceScaleFactor:1,mobile:false});
    const layout=await evaluate(cdp, `(()=>{const buttons=[...document.querySelectorAll('#sheet-option-navigation button')];return {overflow:document.documentElement.scrollWidth>innerWidth,touch:buttons.every(b=>b.getBoundingClientRect().height>=44),preview:document.querySelector('.sheet-preview-stage').getBoundingClientRect().height};})()`);
    assert.equal(layout.overflow,false);assert.equal(layout.touch,true);assert.ok(layout.preview>300);
    await writeFile(join(outputDirectory, `option-preview-${name}.png`),Buffer.from((await cdp.send("Page.captureScreenshot",{format:"png"})).data,"base64"));
  }
  const previewBeforeClose=await evaluate(cdp, "document.querySelector('#sheet-preview-host').textContent");
  await evaluate(cdp, "document.querySelector('#close-sheet-preview').click(); document.querySelector('#sheets-nav').click()");
  assert.equal(await evaluate(cdp, "document.querySelector('#sheet-preview-host').textContent"),previewBeforeClose);
  const pdfSeparation = [];
  for (const name of (await readdir(downloadDirectory)).filter(name=>name.endsWith(".pdf"))) {
    const source=join(downloadDirectory,name);
    const evidence=await verifyPdfPageSeparation(source);
    pdfSeparation.push({file:name,...evidence});
    await copyFile(source,join(outputDirectory,name));
  }
  assert.equal(pdfSeparation.length,5);
  assert.ok(pdfSeparation.some(result=>result.planPages.length===2),"All-options export should retain separate plan/detail pairs");
  const reviewBytes = (await readFile(join(outputDirectory,"QA-House-V-Option-A.pdf"))).toString("base64");
  for (const pageNumber of [1,2]) {
    const rendered = await evaluate(cdp, `(async()=>{
      const pdfjs=await import('/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc='/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs';
      const loading=pdfjs.getDocument({data:Uint8Array.from(atob('${reviewBytes}'),c=>c.charCodeAt(0)),standardFontDataUrl:'/node_modules/pdfjs-dist/standard_fonts/'});
      const pdf=await loading.promise,page=await pdf.getPage(${pageNumber}),viewport=page.getViewport({scale:1.25}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;const image=canvas.toDataURL('image/png');await loading.destroy();return image.split(',')[1];
    })()`);
    await writeFile(join(outputDirectory,`actual-pdf-page-${pageNumber}.png`),Buffer.from(rendered,"base64"));
  }
  await writeFile(join(outputDirectory,"page-separation-evidence.json"),JSON.stringify(pdfSeparation,null,2));
  assert.deepEqual(exceptions, [], `Browser runtime exceptions: ${exceptions.join("; ")}`);
  cdp.close();
  process.stdout.write(`${JSON.stringify({ ok: true, outputPath, canvasOutputPath, previewOutputPath, pagePlan, pdfSeparation, printEvidence, electricalLayout, bytes: (await stat(outputPath)).size, appExportButton: true, separatePrintButton: true }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  if (browserStderr) process.stderr.write(`Chrome diagnostics:\n${browserStderr.slice(-3000)}\n`);
  process.exitCode = 1;
} finally {
  const exited = new Promise((resolveExit) => browser.once("exit", resolveExit));
  browser.kill("SIGTERM");
  await Promise.race([exited, delay(2000)]);
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await rm(downloadDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

async function startQaServer() {
  const index = await readFile(resolve(root, "app/index.html"), "utf8");
  const qaBootstrap = `<script type="module">\nimport { setBootAccess } from "./auth-context.mjs";\nsetBootAccess({ state:"approved", user:{ id:"pdf-qa-user", email:"pdf-qa@example.test" }, memberships:[{ role:"owner", status:"active", workspace:{ id:"pdf-qa-workspace", name:"PDF QA" } }] });\ndocument.querySelector("#app-auth-status").hidden=true;\ndocument.querySelector(".app-shell").hidden=false;\nawait import("./main.mjs");\n</script>`;
  const qaIndex = index.replace('<script type="module" src="./bootstrap.mjs"></script>', qaBootstrap);
  const page = `<!doctype html><meta charset="utf-8"><button id="download">Download</button><script type="module">
    import * as domain from "/src/domain/spatial.mjs";
    import { createConfiguredMvhrComponent } from "/src/editor/mvhr-placement.mjs";
    import { createCatalogueComponent, routeFamilyForKind } from "/src/editor/component-catalogue.mjs";
    import * as portable from "/src/persistence/portable-project.mjs";
    import { createA3SheetModel } from "/src/sheets/a3-sheet.mjs";
    import { partsListRows } from "/src/sheets/a4-parts-list.mjs";
    import { createSheetOutputPages } from "/src/sheets/sheet-output.mjs";
    import { createWorkingSessionStore, workingTabId } from "/src/persistence/working-session.mjs";
    import { setBootAccess } from "/app/auth-context.mjs";
    import { createMixedPagePdfBlob, downloadPdfBlob } from "/app/sheet-pdf-export.mjs";
    let project = domain.applyCommand(domain.createProject("pdf-browser-qa"), { type:"floor.add", floor:{ id:"floor-ground", name:"Synthetic Ground Floor", transform:{ translationMm:{x:0,y:0,z:domain.knownMm(0,"QA datum")}, orientation:domain.identityQuaternion() } } });
    project = domain.applyCommand(project,{type:"project.setVentilationDesignType",ventilationDesignType:"mixed"});
    const referenceBytes = new Uint8Array(await (await fetch("/qa/sheet-plan.png")).arrayBuffer());
    const dimensions = portable.pngDimensions(referenceBytes);
    project = domain.applyCommand(project,{type:"reference.addImage",asset:{id:"qa-plan-asset",kind:"image",fileName:"sheet-plan.png",mediaType:"image/png",byteLength:referenceBytes.length,sha256:await portable.sha256Hex(referenceBytes),widthPx:dimensions.widthPx,heightPx:dimensions.heightPx,dataUrl:portable.bytesToDataUrl(referenceBytes,"image/png")},reference:{id:"qa-plan-reference",floorId:"floor-ground",assetId:"qa-plan-asset",visible:true,locked:true,opacity:.7,transform:{translationMm:{x:0,y:0},rotationRad:0,scaleMmPerPixel:domain.knownMm(10,"QA scale")},calibration:null}});
    project = domain.applyCommand(project,{type:"component.add",component:createConfiguredMvhrComponent({model:"q350-hrv",mounting:"vertical",handing:"left",layout:"unit-mounted-cw",cwSize:"320"},{id:"unit",floorId:"floor-ground",xMm:1000,yMm:1000})});
    for (const [index, catalogueItemId] of ["aerofresh-30-compact-decentralised","zehnder-comfospot-50-decentralised","zehnder-comfoair-70-decentralised","lunos-e2-60-decentralised"].entries()) project = domain.applyCommand(project,{type:"component.add",component:createCatalogueComponent(catalogueItemId,{id:\`decentralised-\${index}\`,floorId:"floor-ground",xMm:3000+index*600,yMm:2000})});
    project = domain.applyCommand(project,{type:"component.add",component:createCatalogueComponent("aerofresh-smove-controller-decentralised",{id:"controller-aerofresh",floorId:"floor-ground",xMm:3000,yMm:2700})});
    project = domain.applyCommand(project,{type:"component.add",component:createCatalogueComponent("lunos-5-sc-ft-controller-decentralised",{id:"controller-lunos",floorId:"floor-ground",xMm:4800,yMm:2700})});
    project = domain.applyCommand(project,{type:"decentralisedCable.add",cable:{id:"cable-aerofresh",floorId:"floor-ground",controllerId:"controller-aerofresh",unitComponentId:"decentralised-0",cableKind:"combined-power-control",topologyStatus:"verified-synchronised-pairs",maximumRouteLengthMm:null,specification:{status:"candidate-manual-mirror",label:"LiYY 3 × 0.75 mm² stranded",source:"INST-AEROFRESH30 V1 pp6, 21–22 · manufacturer-authored mirror; original host not retrieved"},points:[{x:3000,y:2700},{x:3000,y:2000}]}});
    project = domain.applyCommand(project,{type:"decentralisedCable.add",cable:{id:"cable-lunos",floorId:"floor-ground",controllerId:"controller-lunos",unitComponentId:"decentralised-3",cableKind:"control-interconnect",topologyStatus:"verified-star-individual-runs",maximumRouteLengthMm:null,specification:{status:"verified-manufacturer",label:"J-Y(St)Y (2x2x0.8)",source:"LUNOS E474 09.23 pp1, 3"},points:[{x:4800,y:2700},{x:4800,y:2000}]}});
    for (const [id,catalogueItemId,x,y,angleRad] of [["grille-combined","generic-external-grille-combined-dn160",5200,1200,0],["grille-intake","generic-external-grille-intake-dn160",5200,2300,Math.PI/2],["grille-exhaust","generic-external-grille-exhaust-dn160",5200,3100,Math.PI],["luna-output","luna-supply",4500,3500,0]]) { project=domain.applyCommand(project,{type:"component.add",component:createCatalogueComponent(catalogueItemId,{id,floorId:"floor-ground",xMm:x,yMm:y})}); if(angleRad) project=domain.applyCommand(project,{type:"component.rotateFloorZ",componentId:id,angleRad}); }
    const addRoute = (id, ductKind, stream, points, parallelRunCount=1) => { const family=routeFamilyForKind(ductKind); project=domain.applyCommand(project,{type:"route.add",route:{id,floorId:"floor-ground",system:"mvhr",stream,role:stream==="extract"?"Dwelling extract":stream==="intake"?"Outdoor intake":"Dwelling supply",ductKind,connectionInterface:family.connectionInterface,parallelRunCount,startAttachment:null,endAttachment:null,points:points.map(([x,y])=>({x,y,z:domain.unknownMm("QA route elevation not set")}))}}); };
    addRoute("qa-radial","semi-rigid-radial","supply",[[500,3500],[4500,3500]]);
    addRoute("qa-grille-intake","epp-rigid-dn160","intake",[[2600,1059.75],[5020,1059.75]]);
    addRoute("qa-grille-exhaust","epp-rigid-dn160","exhaust",[[2600,1340.25],[5020,1340.25]]);
    addRoute("qa-epp","epp-rigid-dn160","intake",[[500,4000],[1500,4000],[1500,4500]]);
    addRoute("qa-flex","flexible-round-dn150","supply",[[2000,4500],[4200,4500]]);
    const sheet = createA3SheetModel(project,{floorId:"floor-ground",orientation:"landscape",includeSchedule:false,projectName:"PDF browser QA",siteName:"Test address",issueDate:"2026-10-30",drawingTitle:"Ventilation",drawingId:"V-QA",status:"Preliminary — not for construction",revision:"A",revisionText:"Review"});
    const seedLine = sheet.partsSchedule.componentLines[0];
    const longSheet = {...sheet,partsSchedule:{...sheet.partsSchedule,componentLines:[...sheet.partsSchedule.componentLines,...Array.from({length:70},(_,index)=>({...seedLine,ref:\`QA\${index+1}\`,catalogueItemId:\`qa-item-\${index+1}\`,itemNumber:\`QA-\${index+1}\`,description:\`QA equipment line \${index+1} with a deliberately long description for wrapping and pagination\`}))]}};
    const pages = createSheetOutputPages(longSheet);
    window.__outputText = pages.map(page=>new DOMParser().parseFromString(page.svg,"image/svg+xml").documentElement.textContent).join(" ");
    const drawingDocument = new DOMParser().parseFromString(pages[0].svg,"image/svg+xml");
    const grilleArrows = [...drawingDocument.querySelectorAll('#drawing-content [data-part="airflow-arrow"]')];
    const grilleLabels=[...drawingDocument.querySelectorAll('#drawing-content [data-part="airflow-label"]')];
    const watermark=drawingDocument.querySelector('[data-kind="draft-watermark"]');
    const combinedArrows=[...drawingDocument.querySelector('[data-id="grille-combined"]')?.querySelectorAll('[data-part="airflow-arrow"]')??[]].map(node=>{const values=node.getAttribute('d').match(/-?\\d+(?:\\.\\d+)?/g).map(Number),ys=values.filter((_,index)=>index%2===1);return {minY:Math.min(...ys),maxY:Math.max(...ys)};}).sort((a,b)=>a.minY-b.minY);
    window.__grilleEvidence = {arrowCount:grilleArrows.length,streams:grilleArrows.map(node=>node.getAttribute("data-stream")),fills:grilleArrows.map(node=>node.getAttribute("fill")),labels:grilleLabels.map(node=>node.textContent),largeArrows:grilleArrows.every(node=>Number(node.getAttribute("data-annotation-scale"))===2&&Number(node.getAttribute("data-arrow-length-mm"))>=640),offsetArrows:grilleArrows.every(node=>Number(node.getAttribute("data-grille-clearance-mm"))>=120),readableLabels:grilleLabels.every(node=>Number(node.getAttribute("font-size"))===300&&Number(node.getAttribute("data-annotation-scale"))===2),integratedLabels:grilleLabels.every(node=>node.getAttribute("data-label-integrated")==="true"&&node.getAttribute("fill")==="white"&&Number(node.getAttribute("data-label-scale-x"))>0&&Number(node.getAttribute("data-label-scale-x"))<=1),combinedPairClear:combinedArrows.length===2&&combinedArrows[0].maxY<combinedArrows[1].minY,watermarkFontSize:Number(watermark?.getAttribute("font-size")),lunaMasks:drawingDocument.querySelectorAll('[data-part="luna-duct-mask"]').length};
    const keyLabels=[...drawingDocument.querySelectorAll('#sheet-key [data-kind="legend-item"] > title')].map(node=>node.textContent).filter(label=>/^(Controller Cable|Decentralised MVHR|Controller) - /u.test(label));
    const electricalNotes=[...drawingDocument.querySelectorAll('#electrical-connection-notes [data-kind="electrical-connection"]')];
    const electricalText=drawingDocument.querySelector('#electrical-connection-notes')?.textContent??'';
    window.__electricalEvidence={keyLabels,noteCount:electricalNotes.length,preliminaryBoundary:drawingDocument.querySelector('#electrical-connection-notes')?.getAttribute('data-evidence-boundary')==='preliminary-model-specific-not-installation-approval',verifiedLunos:electricalNotes.some(node=>node.getAttribute('data-evidence-status')==='verified-manufacturer'),unverifiedAeroFresh:electricalNotes.some(node=>node.getAttribute('data-evidence-status')==='manufacturer-authored-mirror-original-unverified'),genericLegend:keyLabels.some(label=>/schematic location marker|electrical design status shown/u.test(label)),singleColumn:drawingDocument.querySelector('#sheet-key')?.getAttribute('data-layout')==='single-column',visibleText:electricalText,compactOnly:!/LV\\/control|Topology|Terminals|Evidence|Source|Limit|individual star runs|6–16 VDC|controller\\/PSU arrangement|exact arrangement manual-required|via specified separate PSU/iu.test(electricalText)};
    window.__pagePlan = pages.map(({kind,widthMm,heightMm,orientation})=>({kind,widthMm,heightMm,orientation}));
    window.__supplierEvidence = partsListRows(longSheet.partsSchedule).filter(row=>!row.section).map(({description,quantity,unit,partNumber})=>({description,quantity,unit,partNumber}));
    const blob = await createMixedPagePdfBlob(pages,{title:"PDF browser QA",subject:"Mixed centralised and decentralised",author:"HiPer Studio"});
    document.querySelector("#download").addEventListener("click",()=>downloadPdfBlob(blob,"pdf-browser-qa.pdf"));
    const access={state:"approved",user:{id:"pdf-qa-user",email:"pdf-qa@example.test"},memberships:[{role:"owner",status:"active",workspace:{id:"pdf-qa-workspace",name:"PDF QA"}}]};
    setBootAccess(access);
    project=domain.applyCommand(project,{type:"designOption.duplicate",id:"qa-empty-option",name:"No equipment option",copyScopes:["plan"],activate:false});
    const store=createWorkingSessionStore(indexedDB,{tabId:workingTabId(sessionStorage)});
    await store.write({userId:access.user.id,workspaceId:access.memberships[0].workspace.id},{projectJson:domain.serializeProject(project),name:"PDF browser QA",dirty:true,cloudRecord:null,task:"ventilation",camera:{x:0,y:0,width:20,height:20},catalogueGroup:"all"});
    await store.flush();
    window.__pdfReady = true;
  </script>`;
  const contentTypes = new Map([[".css", "text/css"], [".html", "text/html"], [".js", "text/javascript"], [".mjs", "text/javascript"], [".json", "application/json"], [".svg", "image/svg+xml"]]);
  const instance = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/qa/sheet-pdf.html") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(page);
        return;
      }
      if (url.pathname === "/app/" || url.pathname === "/app/index.html") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(qaIndex);
        return;
      }
      if (url.pathname === "/qa/sheet-plan.png") {
        response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
        response.end(await readFile(resolve(root, "test/fixtures/sheet-plan.png")));
        return;
      }
      const resolved = resolveStaticRequestPath(root, url.pathname);
      const filePath = await realpath(resolved.filePath);
      const allowedRoot = await realpath(resolved.allowedRoot);
      if (!isPathInside(filePath, allowedRoot) || !(await stat(filePath)).isFile()) throw new Error("Not found");
      response.writeHead(200, { "Content-Type": contentTypes.get(extname(filePath)) ?? "application/octet-stream", "Cache-Control": "no-store" });
      response.end(await readFile(filePath));
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    }
  });
  await new Promise((resolveListen) => instance.listen(0, "127.0.0.1", resolveListen));
  return instance;
}

async function waitForDownload(directory, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const names = await readdir(directory);
    const pdfName = names.find((name) => name.endsWith(".pdf"));
    if (pdfName) {
      const candidate = join(directory, pdfName);
      if ((await stat(candidate)).size > 1000) return candidate;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the PDF download");
}

async function waitForDownloadCount(directory, expected, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const names = await readdir(directory);
    if (names.filter((name) => name.endsWith(".pdf")).length >= expected) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${expected} PDF downloads`);
}

async function reservePort() { const instance = createServer(); await new Promise((resolveListen) => instance.listen(0, "127.0.0.1", resolveListen)); const port = instance.address().port; await new Promise((resolveClose) => instance.close(resolveClose)); return port; }
async function waitForDevTools(port) { for (let attempt = 0; attempt < 400; attempt += 1) { try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) return; } catch {} await delay(50); } throw new Error("Chrome DevTools endpoint did not become available"); }
async function connectCdp(url) { const socket = new WebSocket(url); await new Promise((resolveOpen, reject) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", reject, { once: true }); }); let sequence = 0; const pending = new Map(), handlers = new Map(); socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); if (message.id) { const request = pending.get(message.id); pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); } else for (const handler of handlers.get(message.method) ?? []) handler(message.params); }); return { send(method, params = {}) { const id = ++sequence; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolveSend, rejectSend) => pending.set(id, { resolve: resolveSend, reject: rejectSend })); }, on(method, handler) { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(handler); }, close() { socket.close(); } }; }
async function evaluate(cdp, expression) { const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; }
async function waitFor(cdp, expression, timeoutMs = 10_000) { const started = Date.now(); while (Date.now() - started < timeoutMs) { if (await evaluate(cdp, `Boolean(${expression})`)) return; await delay(50); } throw new Error(`Timed out waiting for: ${expression}`); }
function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }


async function verifyPdfPageSeparation(path) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({data:new Uint8Array(await readFile(path)),standardFontDataUrl:resolve(root,"node_modules/pdfjs-dist/standard_fonts")+"/"});
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let pageNumber=1; pageNumber<=pdf.numPages; pageNumber++) {
    const page=await pdf.getPage(pageNumber);
    const text=(await page.getTextContent()).items.map(item=>item.str).join(" ").replace(/\s+/g," ");
    const isPlan=text.includes("SYMBOL KEY"),isDetails=text.includes("Ducts within thermal envelope");
    assert.equal(isPlan&&isDetails,false,`Plan and engineering details share PDF page ${pageNumber}`);
    if (isPlan) for (const detail of ["Ceiling insulation","TERMINAL DIMENSIONS","128 horizontal","120 horizontal","after plastering"]) assert.ok(!text.includes(detail),`Terminal detail leaked onto plan page ${pageNumber}: ${detail}`);
    if (isDetails) {
      assert.ok(text.includes("128 horizontal × 140 vertical"));
      assert.ok(text.includes("120 horizontal · 115 inner · 140 overall"));
    }
    if (isDetails) assert.ok(!text.includes("SYMBOL KEY"),`Drawing key leaked onto engineering page ${pageNumber}`);
    assert.ok(text.includes(`Page ${pageNumber} of ${pdf.numPages}`),`Global numbering missing on page ${pageNumber}`);
    const viewport=page.getViewport({scale:1}),width=Math.round(viewport.width),height=Math.round(viewport.height);
    assert.equal(width,isPlan||isDetails?1191:595,`Correct A3/A4 width on page ${pageNumber}`);
    assert.equal(height,842,`Correct landscape A3/portrait A4 height on page ${pageNumber}`);
    pages.push({pageNumber,kind:isPlan?"drawing":isDetails?"installation-details":"parts-list",width,height});
  }
  assert.equal(pages[0].kind,"drawing");
  for (const [i,page] of pages.entries()) {
    if (page.kind==="drawing") assert.equal(pages[i+1]?.kind,"installation-details");
    if (page.kind==="installation-details") {
      assert.equal(pages[i-1]?.kind,"drawing");
      assert.equal(pages[i+1]?.kind,"parts-list");
    }
  }
  await loadingTask.destroy();
  return {pageCount:pages.length,planPages:pages.filter(p=>p.kind==="drawing").map(p=>p.pageNumber),detailPages:pages.filter(p=>p.kind==="installation-details").map(p=>p.pageNumber),pages};
}

async function waitForFileCount(directory, extension, count) { for(let i=0;i<200;i++){ if((await readdir(directory)).filter(name=>name.endsWith(extension)).length>=count)return; await delay(50); } throw Error(`Missing ${extension} download`); }
