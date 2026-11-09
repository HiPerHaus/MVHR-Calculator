// Appended only on the isolated loopback test origin, never shipped.
const eppReviewButton = document.createElement("button");
eppReviewButton.textContent = "Run EPP geometry checks";
reviewPanel.insertBefore(eppReviewButton, reviewOutput);
function eppGeometryReviewFixture() {
  let project = createInitialProject("synthetic-epp-review");
  project = applyCommand(project, { type: "floorArea.create", outline: { id: "epp-outline", floorId: "floor-ground", name: "Synthetic outline", geometrySource: "manual-floor-area-outline", purpose: "preliminary-quoting", areaConvention: "closed-plan-outline", measurementBasis: "floor-local-plan-mm", holes: [], vertices: [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 6000 }, { x: 0, y: 6000 }].map((point, index) => ({ id: `epp-vertex-${index}`, positionMm: { ...point, z: knownMm(0, "test") } })) } });
  project = applyCommand(project, { type: "reference.addImage", asset: { id: "epp-asset", kind: "image", fileName: "synthetic.png", mediaType: "image/png", byteLength: 3, sha256: "0".repeat(64), widthPx: 1000, heightPx: 500, dataUrl: "data:image/png;base64,AAAA" }, reference: { id: "epp-reference", floorId: "floor-ground", assetId: "epp-asset", visible: false, locked: true, opacity: 0.5, transform: { translationMm: { x: 0, y: 0 }, rotationRad: 0, scaleMmPerPixel: knownMm(10, "test") }, calibration: null } });
  project = applyCommand(project, { type: "reference.calibrate", referenceId: "epp-reference", sourcePointApx: { x: 0, y: 0 }, sourcePointBpx: { x: 1000, y: 0 }, knownDistanceMm: 10000, inputUnit: "m", acceptedAtUtc: "2026-11-09T00:00:00.000Z", previewScaleMmPerPixel: 10, rescaleFloorModel: false });
  project = applyCommand(project, { type: "component.add", component: createCatalogueComponent("zehnder-q350-hrv-left-drawing-profile", { id: "epp-unit", floorId: "floor-ground", xMm: 1400, yMm: 1200 }) });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...createEquipmentAssembly("generic-remote-supply-attenuation-set", { id: "epp-supply-set", floorId: "floor-ground", xMm: 7000, yMm: 3600 }) });
  history = createCommandHistory(project); mechanicalState = createMechanicalInteractionState(); activeTool = "select";
  automaticEppPreview = null; automaticReroutePreview = null; automaticRouteSystem.value = "epp"; automaticRouteStyle.value = "direct";
  activeDesignStage = "route"; setTask("ventilation", { designNavigation: true }); render();
  return project;
}
function eppGeometryChoose() {
  openAutomaticEppPreview();
  const start = automaticEppPreview.endpoints.find(endpoint => endpoint.componentId === "epp-unit" && endpoint.stream === "supply");
  automaticEppStart.value = start.key; automaticEppStart.dispatchEvent(new Event("change", { bubbles: true }));
  const end = automaticEppPreview.compatibleEnds.find(endpoint => endpoint.componentId.endsWith("end-plate"));
  reviewAssert(Boolean(end), "Q350 drawing-only automatic destination offered");
  automaticEppEnd.value = end.key; automaticEppEnd.dispatchEvent(new Event("change", { bubbles: true }));
  reviewAssert(Boolean(automaticEppPreview.proposal), "automatic EPP proposal ready");
}
eppReviewButton.onclick = () => {
  const passed = [];
  try {
    const original = eppGeometryReviewFixture(); eppGeometryChoose();
    let proposal = automaticEppPreview.proposal;
    reviewEqual(draftLayer.querySelector("[data-automatic-epp-preview]").getAttribute("points"), routePointString(proposal.sampledCentreline), "new EPP preview shows final rigid body");
    automaticEppDialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    reviewAssert(!automaticEppDialog.open && !automaticEppPreview, "Escape clears automatic preview");
    reviewEqual(history.present, original, "Cancel leaves project unchanged");
    eppGeometryChoose(); proposal = structuredClone(automaticEppPreview.proposal);
    applyAutomaticEppButton.click(); const committed = history.present.routes.at(-1);
    proposal.previewRoute.id = committed.id;
    reviewEqual(committed, proposal.previewRoute, "automatic preview equals actual command result");
    reviewAssert(history.past.length === 1 && !automaticEppDialog.open, "automatic route is one undo action");
    applyAutomaticEppPreview(); reviewAssert(history.past.length === 1, "repeat apply after dismissal does nothing");
    undoButton.click(); reviewEqual(history.present, original, "undo restores exact project"); redoButton.click();
    passed.push("Q350 final rigid preview, Escape, exact commit, single undo/redo and duplicate Apply guard");

    automaticRouteStyle.value = "building-aligned"; automaticRouteAxis.value = "0";
    openAutomaticRerouteDialog(); automaticRerouteRoutes.querySelector('input[type="checkbox"]').click(); previewAutomaticRerouteButton.click();
    const replacement = structuredClone(automaticReroutePreview.proposals[0]);
    const body = deriveDuctBodyGeometry(replacement.previewRoute, routeFamilyForKind(replacement.ductKind));
    reviewEqual([...draftLayer.querySelectorAll("[data-automatic-reroute-preview]")].map(element => element.getAttribute("points")), body.lanes.map(routePointString), "replacement overlay uses actual body lanes");
    const past = history.past.length; applyAutomaticRerouteButton.click();
    reviewAssert(history.past.length === past + 1 && !automaticRerouteDialog.open, "replacement commits one action");
    reviewEqual(history.present.routes.at(-1), replacement.previewRoute, "replacement preview equals commit");
    applyAutomaticReroute(); reviewAssert(history.past.length === past + 1, "duplicate replacement ignored after dismissal");
    passed.push("Building-aligned replacement overlay/commit parity and single-action repeated-click safety");

    eppGeometryReviewFixture(); eppGeometryChoose();
    history = executeCommand(history, { type: "equipmentAssembly.moveBy", assemblyId: "epp-supply-set", dxMm: 100, dyMm: 0 });
    applyAutomaticEppButton.click(); reviewAssert(history.present.routes.length === 0 && automaticEppDialog.open, "stale preview needs review before apply");
    reviewAssert(automaticEppSummary.textContent.includes("drawing changed"), "updated preview notice");
    applyAutomaticEppButton.click(); reviewAssert(history.present.routes.length === 1, "reviewed updated preview applies");
    eppGeometryReviewFixture(); eppGeometryChoose();
    history = executeCommand(history, { type: "routingExclusion.add", exclusion: { id: "epp-blocker", floorId: "floor-ground", name: "Synthetic solid exclusion", kind: "beam", geometry: { shape: "rectangle", x: 600, y: 600, width: 1600, height: 1600 }, verticalRange: { mode: "all-height" } } });
    applyAutomaticEppButton.click();
    reviewAssert(history.present.routes.length === 0 && applyAutomaticEppButton.disabled, "new blocker prevents stale application");
    cancelAutomaticEppButton.click();
    passed.push("newer geometry requires review and newer exclusion blocks stale Apply");
    reviewAssert(reviewErrors.length === 0, `No browser errors: ${reviewErrors.join("; ")}`);
    reviewOutput.textContent = JSON.stringify({ version: reviewVersion, passed, errors: reviewErrors }, null, 2);
  } catch (error) { reviewOutput.textContent = `${passed.join("\n")}\nFAIL: ${error.stack}`; }
};
