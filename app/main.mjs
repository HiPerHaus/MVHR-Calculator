import { layoutPointerPosition } from "../src/editor/layout-pointer.mjs";
import { ventilationVisibilityGroup, routeVisibilityGroup, VENTILATION_VISIBILITY_GROUPS } from "../src/editor/ventilation-visibility.mjs";
import {createWorkingSessionStore,workingTabId,workingContextKey} from "../src/persistence/working-session.mjs";
import {createA4PartsListPages,renderA4PartsListSvg} from "../src/sheets/a4-parts-list.mjs";
import { initializeCloudUI } from "./cloud-ui.mjs";
import { getStudioClient } from "./auth-client.mjs";
import { getBootAccess } from "./auth-context.mjs";
let cloudSession=null, currentCloudRecord=null, cloudSavePending=null, cloudBindingVersion=0;
const workingSessions=createWorkingSessionStore(window.indexedDB,{tabId:workingTabId(window.sessionStorage)});
let workingReady=false,workingRestoring=false,workingRestoreStarted=false,workingActivity=0,workingQueued=false,workingOwnerKey=null;
let workingModel=null,workingJson=null,workingRecoveryError="",workingWrites=0;
import { createCompactProjectStorage, compactExistingProjectStorage } from "../src/persistence/compact-storage.mjs";
import { findCombinedGrilleAlignment } from "../src/editor/combined-grille-alignment.mjs";
import { needsCombinedGrilleSpacing } from "../src/domain/combined-grille-drawing-spacing.mjs";
import { pendingMountedCwConnections } from "../src/domain/mounted-cw-drawing-connections.mjs";
import { CA200_GRAPHIC_ID, ca200Shapes } from "../src/editor/ca200-profile.mjs";
import { deriveHrvCeilingElbows, hrvCeilingElbowShapes } from "../src/editor/hrv-ceiling-elbows.mjs";
import { CW_PROFILES, STANDALONE_CW_GRAPHIC_ID, standaloneCwRecordId, standaloneCwShapes } from "../src/editor/standalone-cw.mjs";
import { terminalDrawingAnchors } from "../src/domain/terminal-drawing-connections.mjs";
import { inspectExternalGrilleSeparation } from "../src/editor/external-grille-spacing.mjs";
import { constrainEppPlanPoints, hasHrvCeilingElbow } from "../src/domain/epp-plan-constraints.mjs";
import { createConfiguredMvhrComponent, MVHR_LAYOUTS } from "../src/editor/mvhr-placement.mjs";
import {
  canRedo,
  canUndo,
  createCommandHistory,
  executeCommand,
  redoCommand,
  undoCommand,
} from "../src/domain/history.mjs";
import {
  applyCommand,
  airflowTargetFromInput,
  assumedMm,
  createProject,
  deserializeProject,
  floorPortTransform,
  identityQuaternion,
  inspectComponentDeletion,
  inspectFloorVentilationClear,
  knownMm,
  referenceScaleMmPerPixel,
  roomTerminalPort,
  serializeProject,
  sourcePointToWorld,
  terminalRoomAssignment,
  terminalPlacementSpace,
  unresolvedAirflowTarget,
  unknownMm,
  wallConnectedComponentIds,
  worldPointToSource,
} from "../src/domain/spatial.mjs";
import {
  bytesToDataUrl,
  exportPortableProject,
  importPortableProject,
  MAX_IMAGE_BYTES,
  MAX_PORTABLE_TEXT_BYTES,
  pngDimensions,
  sha256Hex,
  validateImageBytes,
} from "../src/persistence/portable-project.mjs";
import { createLocalProjectStore } from "../src/persistence/local-project-store.mjs";
import {
  createLocalProjectLibrary,
  createOpaqueProjectId,
  validateProjectName,
} from "../src/persistence/local-project-library.mjs";
import {
  clientPointToCamera,
  createInitialCameraFitScheduler,
  createCamera,
  fitCameraToBounds,
  panCamera,
  zoomCameraAt,
} from "../src/editor/camera.mjs";
import {
  activateMechanicalTool,
  cancelMechanicalOperation,
  componentMoveIntent,
  componentRotationIntent,
  createMechanicalInteractionState,
  handleMechanicalCanvasClick,
  requiresProjectReplacementConfirmation,
  resolveComponentPlacementState,
  updateMechanicalPointer,
} from "../src/editor/mechanical-controller.mjs";
import {
  CATALOGUE_CANDIDATES,
  COMPONENT_CATALOGUE,
  createCatalogueComponent,
  deriveVentilationConnectionDemand,
  findCatalogueItem,
  routeFamilyForKind,
} from "../src/editor/component-catalogue.mjs";
import {
  EXTERNAL_GRILLE_PLAN_GRAPHIC_ID,
  externalGrilleShapes,
  LUNA_GRILLE_PLAN_GRAPHIC_ID,
  WALL_GRILLE_PLAN_GRAPHIC_ID,
  GENERIC_CW_PLAN_GRAPHIC_ID,
  Q350_PLAN_GRAPHIC_ID,
  deriveComponentPlanGraphic,
  mountedCwShapes,
  q350PortLabelLayout,
  q350CasingPath,
} from "../src/editor/component-plan-graphics.mjs";
import {
  createEquipmentAssembly,
  EQUIPMENT_ASSEMBLY_TEMPLATES,
  equipmentAssemblyCentre,
  equipmentAssemblyForComponent,
  findEquipmentAssemblyTemplate,
} from "../src/editor/equipment-assemblies.mjs";
import {
  closestScreenCandidate,
  planSnappedWallChain,
  wallInteriorSnapRadiusPx,
} from "../src/editor/wall-snap.mjs";
import { pickRouteAtClientPoint } from "../src/editor/route-picker.mjs";
import { pickPortAtClientPoint, PORT_PICK_TOLERANCE_CSS_PX } from "../src/editor/port-picker.mjs";
import {
  deriveDuctBodyGeometry,
  deriveSweptCentreline,
  ductBodyDisplayLabel,
} from "../src/editor/duct-body-geometry.mjs";
import { inspectAutomaticRadialRouting, suggestBuildingAxis } from "../src/editor/automatic-radial-routing.mjs";
import { inspectAutomaticEppRouting } from "../src/editor/automatic-epp-routing.mjs";
import { inspectEquipmentFirstRouting } from "../src/editor/routing-workflow.mjs";
import { inspectRoutingCoordination } from "../src/editor/routing-coordination.mjs";
import { createDxfImportReviewController } from "../src/editor/dxf-import-controller.mjs";
import {
  dxfReferenceSnapPoints,
  MAX_DXF_TEXT_BYTES,
  transformDxfReferenceGeometry,
} from "../src/import/dxf-reference.mjs";
import {
  createA3SheetModel,
  renderA3SheetSvg,
} from "../src/sheets/a3-sheet.mjs";
import { createDefaultThreeDView, createThreeDDrawingScene, renderThreeDDrawingSvg } from "../src/sheets/three-d-drawing.mjs";
import {
  deriveRoomBoundaries,
  deriveZoneBoundaries,
  inspectRoomBoundary,
  inspectZoneBoundary,
  newlyEligibleRoomBoundaries,
} from "../src/domain/rooms.mjs";
import { inspectFloorAreaOutline } from "../src/domain/floor-area.mjs";
import {
  inspectDetailedDesign,
  inspectQuickQuote,
} from "../src/domain/design-workflow.mjs";
import { auditVentilation } from "../src/editor/ventilation-audit.mjs";
import { createPartsSchedule } from "../src/editor/parts-schedule.mjs";
import { inspectConnectionAccessoryEvidence } from "../src/editor/connection-accessory-evidence.mjs";
import { inspectAirflowBalance } from "../src/editor/airflow-balance.mjs";
import {
  externalStaticPressureFromInput,
  unresolvedExternalStaticPressure,
} from "../src/domain/engineering-inputs.mjs";
import { inspectSizingPressureEvidence } from "../src/editor/sizing-pressure-evidence.mjs";
import { inspectProductCostingReadiness } from "../src/editor/product-costing.mjs";
import { createInstallerDocumentFoundation } from "../src/editor/installer-document.mjs";
import {
  closePdfReference,
  MAX_PDF_SOURCE_BYTES,
  openPdfForReference,
  PDF_IMPORTER,
  renderPdfPageToCanvas,
} from "../src/import/pdf-reference.mjs";
import * as pdfjsLib from "../node_modules/pdfjs-dist/build/pdf.mjs";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const PROJECT_ID = "project-local-wall-shell";
const MILLIMETRES_PER_VIEW_UNIT = 10;
const PREVIEW_SCALE_MM_PER_PIXEL = MILLIMETRES_PER_VIEW_UNIT;
const GRID_SNAP_MM = 100;
const ENDPOINT_SNAP_RADIUS_CSS_PX = 12;
const WALL_SNAP_RADIUS_CSS_PX = 12;
const PDF_RESOURCE_URLS = Object.freeze({
  cMapUrl: "/node_modules/pdfjs-dist/cmaps/",
  standardFontDataUrl: "/node_modules/pdfjs-dist/standard_fonts/",
  wasmUrl: "/node_modules/pdfjs-dist/wasm/",
});

pdfjsLib.GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.min.mjs";

const canvas = document.querySelector("#plan-canvas");
const referenceLayer = document.querySelector("#reference-layer");
const floorAreaLayer = document.querySelector("#floor-area-layer");
const routingExclusionLayer = document.querySelector("#routing-exclusion-layer");
const roomLayer = document.querySelector("#room-layer");
const modelLayer = document.querySelector("#model-layer");
const draftLayer = document.querySelector("#draft-layer");
const selectButton = document.querySelector("#select-tool");
const wallButton = document.querySelector("#wall-tool");
const roomDividerButton = document.querySelector("#room-divider-tool");
const floorAreaButton = document.querySelector("#floor-area-tool");
const panToolButton = document.querySelector("#pan-tool");
const snapToggleButton = document.querySelector("#snap-toggle");
const snapToggleLabel = document.querySelector("#snap-toggle-label");
const snapToggleDetail = document.querySelector("#snap-toggle-detail");
const undoButton = document.querySelector("#undo");
const redoButton = document.querySelector("#redo");
const saveButton = document.querySelector("#save-local");
const saveAsButton = document.querySelector("#save-as-local");
const reopenButton = document.querySelector("#reopen-local");
const exportButton = document.querySelector("#export-portable");
const openButton = document.querySelector("#open-portable");
const portableFileInput = document.querySelector("#portable-file");
const referenceFileInput = document.querySelector("#reference-file");
const addReferenceButton = document.querySelector("#add-reference");
const pdfReferenceFileInput = document.querySelector("#pdf-reference-file");
const addPdfReferenceButton = document.querySelector("#add-pdf-reference");
const dxfReferenceFileInput = document.querySelector("#dxf-reference-file");
const addDxfReferenceButton = document.querySelector("#add-dxf-reference");
const calibrateReferenceButton = document.querySelector("#calibrate-reference");
const cropReferenceButton = document.querySelector("#crop-reference");
const resetReferenceCropButton = document.querySelector("#reset-reference-crop");
const cancelReferenceCropButton = document.querySelector("#cancel-reference-crop");
const referenceList = document.querySelector("#reference-list");
const cadReferenceList = document.querySelector("#cad-reference-list");
const pdfImportDialog = document.querySelector("#pdf-import-dialog");
const pdfImportForm = document.querySelector("#pdf-import-form");
const pdfImportSummary = document.querySelector("#pdf-import-summary");
const pdfPageChoice = document.querySelector("#pdf-page-choice");
const pdfPagePreview = document.querySelector("#pdf-page-preview");
const pdfPageDetail = document.querySelector("#pdf-page-detail");
const pdfImportError = document.querySelector("#pdf-import-error");
const acceptPdfImportButton = document.querySelector("#accept-pdf-import");
const cancelPdfImportButton = document.querySelector("#cancel-pdf-import");
const dxfImportDialog = document.querySelector("#dxf-import-dialog");
const dxfImportForm = document.querySelector("#dxf-import-form");
const dxfImportSummary = document.querySelector("#dxf-import-summary");
const dxfUnitChoice = document.querySelector("#dxf-unit-choice");
const dxfDeclaredUnits = document.querySelector("#dxf-declared-units");
const dxfLayerChoices = document.querySelector("#dxf-layer-choices");
const dxfDiagnostics = document.querySelector("#dxf-diagnostics");
const dxfPartialChoice = document.querySelector("#dxf-partial-choice");
const dxfAcceptPartial = document.querySelector("#dxf-accept-partial");
const dxfImportError = document.querySelector("#dxf-import-error");
const acceptDxfImportButton = document.querySelector("#accept-dxf-import");
const cancelDxfImportButton = document.querySelector("#cancel-dxf-import");
const openConfirmDialog = document.querySelector("#open-confirm-dialog");
const openConfirmMessage = document.querySelector("#open-confirm-message");
const confirmOpenButton = document.querySelector("#confirm-open");
const projectNameDialog = document.querySelector("#project-name-dialog");
const projectNameForm = document.querySelector("#project-name-form");
const projectNameTitle = document.querySelector("#project-name-title");
const projectNameSummary = document.querySelector("#project-name-summary");
const projectNameInput = document.querySelector("#project-name-input");
const projectNameError = document.querySelector("#project-name-error");
const cancelProjectNameButton = document.querySelector("#cancel-project-name");
const newProjectButton = document.querySelector("#new-project");
const renameProjectButton = document.querySelector("#rename-project");
const projectSaveButton = document.querySelector("#project-save");
const projectSaveAsButton = document.querySelector("#project-save-as");
const currentProjectNameElement = document.querySelector("#current-project-name");
const currentProjectIdElement = document.querySelector("#current-project-id");
const projectLibraryList = document.querySelector("#project-library-list");
const deleteWallButton = document.querySelector("#delete-wall");
const deleteWallDialog = document.querySelector("#delete-wall-dialog");
const deleteWallMessage = document.querySelector("#delete-wall-message");
const deleteComponentButton = document.querySelector("#delete-component");
const deleteComponentDialog = document.querySelector("#delete-component-dialog");
const deleteComponentMessage = document.querySelector("#delete-component-message");
const deleteComponentScope = document.querySelector("#delete-component-scope");
const clearVentilationButton = document.querySelector("#clear-ventilation");
const clearVentilationDialog = document.querySelector("#clear-ventilation-dialog");
const clearVentilationMessage = document.querySelector("#clear-ventilation-message");
const clearVentilationWarning = document.querySelector("#clear-ventilation-warning");
const confirmClearVentilationButton = document.querySelector("#confirm-clear-ventilation");
const routeGuidance = document.querySelector("#route-guidance");
const calibrationDialog = document.querySelector("#calibration-dialog");
const calibrationForm = document.querySelector("#calibration-form");
const calibrationDistance = document.querySelector("#calibration-distance");
const calibrationUnit = document.querySelector("#calibration-unit");
const calibrationScope = document.querySelector("#calibration-scope");
const calibrationScopeSummary = document.querySelector("#calibration-scope-summary");
const calibrationRescaleChoice = document.querySelector("#calibration-rescale-choice");
const calibrationRescaleDetail = document.querySelector("#calibration-rescale-detail");
const calibrationError = document.querySelector("#calibration-error");
const cancelCalibrationButton = document.querySelector("#cancel-calibration");
const referenceCropDialog = document.querySelector("#reference-crop-dialog");
const referenceCropForm = document.querySelector("#reference-crop-form");
const referenceCropSummary = document.querySelector("#reference-crop-summary");
const referenceCropError = document.querySelector("#reference-crop-error");
const cancelReferenceCropDialogButton = document.querySelector("#cancel-reference-crop-dialog");
const modePrompt = document.querySelector("#mode-prompt");
const toolStatus = document.querySelector("#tool-status");
const cursorStatus = document.querySelector("#cursor-status");
const draftStatus = document.querySelector("#draft-status");
const snapStatus = document.querySelector("#snap-status");
const localState = document.querySelector("#local-state");
const localStateLabel = document.querySelector("#local-state-label");
const inspectorEmpty = document.querySelector("#inspector-empty");
const wallInspector = document.querySelector("#wall-inspector");
const wallActions = document.querySelector("#wall-actions");
const nodeInspector = document.querySelector("#node-inspector");
const componentInspector = document.querySelector("#component-inspector");
const componentActions = document.querySelector("#component-actions");
const rotateComponentButton = document.querySelector("#rotate-component");
const componentRoomAssignment = document.querySelector("#component-room-assignment");
const componentRoomDetail = document.querySelector("#component-room-detail");
const singleComponentDuctRunButton = document.querySelector("#single-component-duct-run");
const twinComponentDuctRunButton = document.querySelector("#twin-component-duct-run");
const clearComponentDuctRunsButton = document.querySelector("#clear-component-duct-runs");
const componentDuctRunDetail = document.querySelector("#component-duct-run-detail");
const componentElevationInput = document.querySelector("#component-elevation-input");
const applyComponentElevationButton = document.querySelector("#apply-component-elevation");
const clearComponentElevationButton = document.querySelector("#clear-component-elevation");
const componentElevationDetail = document.querySelector("#component-elevation-detail");
const routeInspector = document.querySelector("#route-inspector");
const routeActions = document.querySelector("#route-actions");
const removeRoutePointButton = document.querySelector("#remove-route-point");
const routeEditDetail = document.querySelector("#route-edit-detail");
const singleRouteRunButton = document.querySelector("#single-route-run");
const twinRouteRunButton = document.querySelector("#twin-route-run");
const clearRouteRunButton = document.querySelector("#clear-route-run");
const routeRunDetail = document.querySelector("#route-run-detail");
const catalogueSearchInput = document.querySelector("#catalogue-search");
const catalogueGroups = document.querySelector("#catalogue-groups");
const catalogueCategories = document.querySelector("#catalogue-categories");
const supplyRunDemand = document.querySelector("#supply-run-demand");
const supplyRunDetail = document.querySelector("#supply-run-detail");
const extractRunDemand = document.querySelector("#extract-run-demand");
const extractRunDetail = document.querySelector("#extract-run-detail");
const cwSuggestionStatus = document.querySelector("#cw-suggestion-status");
const automaticRouteButton = document.querySelector("#auto-route");
const automaticRouteSystem = document.querySelector("#automatic-route-system");
const automaticRouteStyle = document.querySelector("#automatic-route-style");
const automaticRouteAxisRow = document.querySelector("#automatic-route-axis-row");
const automaticRouteAxis = document.querySelector("#automatic-route-axis");
const suggestBuildingAxisButton = document.querySelector("#suggest-building-axis");
const automaticRouteAxisDetail = document.querySelector("#automatic-route-axis-detail");
const automaticRouteSetupStatus = document.querySelector("#automatic-route-setup-status");
const routingWorkflowSteps = document.querySelector("#routing-workflow-steps");
const automaticRadialDialog = document.querySelector("#automatic-radial-dialog");
const automaticRadialSummary = document.querySelector("#automatic-radial-summary");
const automaticRadialSelectionStatus = document.querySelector("#automatic-radial-selection-status");
const automaticRadialResults = document.querySelector("#automatic-radial-results");
const cancelAutomaticRadialButton = document.querySelector("#cancel-automatic-radial");
const applyAutomaticRadialButton = document.querySelector("#apply-automatic-radial");
const automaticEppDialog = document.querySelector("#automatic-epp-dialog");
const automaticEppStart = document.querySelector("#automatic-epp-start");
const automaticEppEnd = document.querySelector("#automatic-epp-end");
const automaticEppSummary = document.querySelector("#automatic-epp-summary");
const automaticEppResult = document.querySelector("#automatic-epp-result");
const cancelAutomaticEppButton = document.querySelector("#cancel-automatic-epp");
const applyAutomaticEppButton = document.querySelector("#apply-automatic-epp");
const addRoutingExclusionButton = document.querySelector("#add-routing-exclusion");
const routingClearanceInput = document.querySelector("#routing-clearance-input");
const applyRoutingClearanceButton = document.querySelector("#apply-routing-clearance");
const routingClearanceStatus = document.querySelector("#routing-clearance-status");
const routingCoordinationStatus = document.querySelector("#routing-coordination-status");
const routingExclusionList = document.querySelector("#routing-exclusion-list");
const routingExclusionDialog = document.querySelector("#routing-exclusion-dialog");
const routingExclusionForm = document.querySelector("#routing-exclusion-form");
const routingExclusionName = document.querySelector("#routing-exclusion-name");
const routingExclusionKind = document.querySelector("#routing-exclusion-kind");
const routingExclusionX = document.querySelector("#routing-exclusion-x");
const routingExclusionY = document.querySelector("#routing-exclusion-y");
const routingExclusionWidth = document.querySelector("#routing-exclusion-width");
const routingExclusionHeight = document.querySelector("#routing-exclusion-height");
const routingExclusionHeightMode = document.querySelector("#routing-exclusion-height-mode");
const routingExclusionHeightFields = document.querySelector("#routing-exclusion-height-fields");
const routingExclusionBottom = document.querySelector("#routing-exclusion-bottom");
const routingExclusionTop = document.querySelector("#routing-exclusion-top");
const routingExclusionError = document.querySelector("#routing-exclusion-error");
const cancelRoutingExclusionButton = document.querySelector("#cancel-routing-exclusion");
let catalogueButtons = [];
const routeButtons = [...document.querySelectorAll(".route-tool")];
const planNavigationButton = document.querySelector("#plan-nav");
const projectNavigationButton = document.querySelector("#project-nav");
const ventilationNavigationButton = document.querySelector("#ventilation-nav");
const threeDNavigationButton = document.querySelector("#three-d-nav");
const catalogueNavigationButton = document.querySelector("#catalogue-nav");
const checksNavigationButton = document.querySelector("#checks-nav");
const sheetsNavigationButton = document.querySelector("#sheets-nav");
const planWorkspace = document.querySelector("#plan-workspace");
const projectWorkspace = document.querySelector("#project-workspace");
const catalogueWorkspace = document.querySelector("#catalogue-workspace");
const checksWorkspace = document.querySelector("#checks-workspace");
const threeDWorkspace = document.querySelector("#three-d-workspace");
const threeDReturnButton = document.querySelector("#three-d-return");
const exportThreeDButton = document.querySelector("#export-three-d");
const threeDHeightForm = document.querySelector("#three-d-height-form");
const threeDEquipmentHeight = document.querySelector("#three-d-equipment-height");
const threeDOutletHeight = document.querySelector("#three-d-outlet-height");
const threeDDuctHeight = document.querySelector("#three-d-duct-height");
const threeDHeightBasis = document.querySelector("#three-d-height-basis");
const threeDDatum = document.querySelector("#three-d-datum");
const threeDHeightStatus = document.querySelector("#three-d-height-status");
const threeDHeightItems = document.querySelector("#three-d-height-items");
const threeDDiagnostics = document.querySelector("#three-d-diagnostics");
const threeDHost = document.querySelector("#three-d-host");
const threeDViewButtons = [...document.querySelectorAll("[data-three-d-view]")];
const checksStatusPill = document.querySelector("#checks-status-pill");
const checksReturnVentilationButton = document.querySelector("#checks-return-ventilation");
const checksPartsSummary = document.querySelector("#checks-parts-summary");
const checksAssemblyGroups = document.querySelector("#checks-assembly-groups");
const checksPartsList = document.querySelector("#checks-parts-list");
const checksRoutesSummary = document.querySelector("#checks-routes-summary");
const checksRoutesList = document.querySelector("#checks-routes-list");
const checksDiagnosticSummary = document.querySelector("#checks-diagnostic-summary");
const checksSpareBranches = document.querySelector("#checks-spare-branches");
const checksDiagnostics = document.querySelector("#checks-diagnostics");
const checksEvidenceBoundary = document.querySelector("#checks-evidence-boundary");
const checksScheduleSummary = document.querySelector("#checks-schedule-summary");
const checksScheduleParts = document.querySelector("#checks-schedule-parts");
const checksScheduleRoutes = document.querySelector("#checks-schedule-routes");
const checksScheduleUnresolved = document.querySelector("#checks-schedule-unresolved");
const checksScheduleBoundary = document.querySelector("#checks-schedule-boundary");
const checksConnectionEvidenceSummary = document.querySelector("#checks-connection-evidence-summary");
const checksConnectionEvidence = document.querySelector("#checks-connection-evidence");
const checksConnectionEvidenceBoundary = document.querySelector("#checks-connection-evidence-boundary");
const checksAirflowSummary = document.querySelector("#checks-airflow-summary");
const checksAirflowSpaces = document.querySelector("#checks-airflow-spaces");
const checksAirflowIssues = document.querySelector("#checks-airflow-issues");
const checksAirflowBoundary = document.querySelector("#checks-airflow-boundary");
const checksEngineeringForm = document.querySelector("#checks-engineering-form");
const checksEngineeringUnit = document.querySelector("#checks-engineering-unit");
const checksEngineeringPressure = document.querySelector("#checks-engineering-pressure");
const checksEngineeringBasis = document.querySelector("#checks-engineering-basis");
const checksEngineeringSource = document.querySelector("#checks-engineering-source");
const checksEngineeringFilter = document.querySelector("#checks-engineering-filter");
const checksEngineeringClear = document.querySelector("#checks-engineering-clear");
const checksEngineeringInputStatus = document.querySelector("#checks-engineering-input-status");
const checksEngineeringSummary = document.querySelector("#checks-engineering-summary");
const checksEngineeringIssues = document.querySelector("#checks-engineering-issues");
const checksEngineeringBoundary = document.querySelector("#checks-engineering-boundary");
const checksCostingSummary = document.querySelector("#checks-costing-summary");
const checksCostingLines = document.querySelector("#checks-costing-lines");
const checksCostingIssues = document.querySelector("#checks-costing-issues");
const checksCostingBoundary = document.querySelector("#checks-costing-boundary");
const checksInstallerSummary = document.querySelector("#checks-installer-summary");
const checksInstallerSections = document.querySelector("#checks-installer-sections");
const checksInstallerIssues = document.querySelector("#checks-installer-issues");
const checksInstallerBoundary = document.querySelector("#checks-installer-boundary");
const catalogueLibrarySearch = document.querySelector("#catalogue-library-search");
const catalogueLibraryRecords = document.querySelector("#catalogue-library-records");
const sheetPreviewPanel = document.querySelector("#sheet-preview-panel");
const workflowStagePill = document.querySelector("#workflow-stage-pill");
const workflowReadiness = document.querySelector("#workflow-readiness");
const workflowOpenPlanButton = document.querySelector("#workflow-open-plan");
const workflowStartPreliminaryButton = document.querySelector("#workflow-start-preliminary");
const workflowOpenVentilationButton = document.querySelector("#workflow-open-ventilation");
const workflowConvertButton = document.querySelector("#workflow-convert");
const workflowStartDetailedButton = document.querySelector("#workflow-start-detailed");
const workflowLinkOutletsButton = document.querySelector("#workflow-link-outlets");
const workflowUploadPlanButton = document.querySelector("#workflow-upload-plan");
const workflowSetScaleButton = document.querySelector("#workflow-set-scale");
const workflowDrawPerimeterButton = document.querySelector("#workflow-draw-perimeter");
const workflowMarkupMvhrButton = document.querySelector("#workflow-markup-mvhr");
const quoteInputForm = document.querySelector("#quote-input-form");
const quoteExclusionsInput = document.querySelector("#quote-exclusions");
const quoteScopeReviewedInput = document.querySelector("#quote-scope-reviewed");
const quoteInputError = document.querySelector("#quote-input-error");
const quoteSummary = document.querySelector("#quote-summary");
const quoteMissing = document.querySelector("#quote-missing");
const quoteSnapshotSummary = document.querySelector("#quote-snapshot-summary");
const detailedDesignSummary = document.querySelector("#detailed-design-summary");
const detailedDesignUnresolved = document.querySelector("#detailed-design-unresolved");
const convertProjectDialog = document.querySelector("#convert-project-dialog");
const convertProjectSummary = document.querySelector("#convert-project-summary");
const confirmProjectConversionButton = document.querySelector("#confirm-project-conversion");
const sheetPreviewHost = document.querySelector("#sheet-preview-host");
const sheetPreviewStatus = document.querySelector("#sheet-preview-status");
const printSheetPreviewButton = document.querySelector("#print-sheet-preview");
const closeSheetPreviewButton = document.querySelector("#close-sheet-preview");
const drawToolsSection = document.querySelector("#draw-tools-section");
const mechanicalToolsSection = document.querySelector("#mechanical-tools-section");
const hiddenVentilationGroups = new Set();
const componentIsVisible = component => !hiddenVentilationGroups.has(ventilationVisibilityGroup(component));
const routeIsVisible = route => !hiddenVentilationGroups.has(routeVisibilityGroup(route));
const visibilityControls = document.querySelector("#ventilation-visibility");
for (const [key, label] of VENTILATION_VISIBILITY_GROUPS) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.visibilityGroup = key;
  button.textContent = `Hide ${label}`;
  button.setAttribute("aria-pressed", "true");
  button.addEventListener("click", () => {
    if (hiddenVentilationGroups.has(key)) hiddenVentilationGroups.delete(key);
    else hiddenVentilationGroups.add(key);
    button.textContent = `${hiddenVentilationGroups.has(key) ? "Show" : "Hide"} ${label}`;
    button.setAttribute("aria-pressed", String(!hiddenVentilationGroups.has(key)));
    mechanicalState = clearMechanicalSelection(mechanicalState);
    selectedRouteId = null;
    render();
  });
  visibilityControls.append(button);
}
const showAllVentilation = document.createElement("button");
showAllVentilation.type = "button";
showAllVentilation.textContent = "Show all";
showAllVentilation.addEventListener("click", () => {
  hiddenVentilationGroups.clear();
  for (const button of visibilityControls.querySelectorAll("[data-visibility-group]")) {
    button.textContent = `Hide ${VENTILATION_VISIBILITY_GROUPS.find(([key]) => key === button.dataset.visibilityGroup)[1]}`;
    button.setAttribute("aria-pressed", "true");
  }
  render();
});
visibilityControls.append(showAllVentilation);

const ventilationReadiness = document.querySelector("#ventilation-readiness");
const roomToolsSection = document.querySelector("#room-tools-section");
const floorAreaToolsSection = document.querySelector("#floor-area-tools-section");
const referenceToolsSection = document.querySelector("#reference-tools-section");
const floorAreaSummary = document.querySelector("#floor-area-summary");
const floorAreaScale = document.querySelector("#floor-area-scale");
const roomSummary = document.querySelector("#room-summary");
const roomIssues = document.querySelector("#room-issues");
const roomInspector = document.querySelector("#room-inspector");
const roomActions = document.querySelector("#room-actions");
const editRoomButton = document.querySelector("#edit-room");
const reassignRoomButton = document.querySelector("#reassign-room");
const removeRoomButton = document.querySelector("#remove-room");
const roomDialog = document.querySelector("#room-dialog");
const roomForm = document.querySelector("#room-form");
const roomDialogTitle = document.querySelector("#room-dialog-title");
const roomBoundarySummary = document.querySelector("#room-boundary-summary");
const roomNameLabel = document.querySelector("#room-name-label");
const roomUseLabel = document.querySelector("#room-use-label");
const roomRoleLabel = document.querySelector("#room-role-label");
const roomNameInput = document.querySelector("#room-name");
const roomUseInput = document.querySelector("#room-use");
const roomVentilationRoleInput = document.querySelector("#room-ventilation-role");
const roomRequiredAirflowInput = document.querySelector("#room-required-airflow");
const roomRequiredAirflowUnitInput = document.querySelector("#room-required-airflow-unit");
const roomRequiredAirflowBasisInput = document.querySelector("#room-required-airflow-basis");
const roomRequiredAirflowSourceInput = document.querySelector("#room-required-airflow-source");
const roomAssignedAirflowInput = document.querySelector("#room-assigned-airflow");
const roomAssignedAirflowUnitInput = document.querySelector("#room-assigned-airflow-unit");
const roomAssignedAirflowBasisInput = document.querySelector("#room-assigned-airflow-basis");
const roomAssignedAirflowSourceInput = document.querySelector("#room-assigned-airflow-source");
const adoptRequiredAirflowButton = document.querySelector("#adopt-required-airflow");
const roomDialogError = document.querySelector("#room-dialog-error");
const cancelRoomButton = document.querySelector("#cancel-room");
const removeRoomDialog = document.querySelector("#remove-room-dialog");
const removeRoomMessage = document.querySelector("#remove-room-message");
const floorAreaInspector = document.querySelector("#floor-area-inspector");
const floorAreaActions = document.querySelector("#floor-area-actions");
const editFloorAreaButton = document.querySelector("#edit-floor-area");
const removeFloorAreaButton = document.querySelector("#remove-floor-area");
const floorAreaDialog = document.querySelector("#floor-area-dialog");
const floorAreaForm = document.querySelector("#floor-area-form");
const floorAreaDialogTitle = document.querySelector("#floor-area-dialog-title");
const floorAreaDialogSummary = document.querySelector("#floor-area-dialog-summary");
const floorAreaNameInput = document.querySelector("#floor-area-name");
const floorAreaDialogError = document.querySelector("#floor-area-dialog-error");
const cancelFloorAreaButton = document.querySelector("#cancel-floor-area");
const removeFloorAreaDialog = document.querySelector("#remove-floor-area-dialog");
const removeFloorAreaMessage = document.querySelector("#remove-floor-area-message");

const localStore = createStore();
const projectLibrary = createProjectLibrary();
const legacyLoad = localStore.load(PROJECT_ID);
const legacyMigration = projectLibrary.migrateLegacy(legacyLoad, "Recovered project");
const initialLibrary = projectLibrary.listProjects();
const initialNamedLoad = initialLibrary.ok && initialLibrary.activeProjectId
  ? projectLibrary.loadProject(initialLibrary.activeProjectId)
  : null;
const initialLoad = initialNamedLoad?.ok && initialNamedLoad.found ? initialNamedLoad : legacyLoad;
let history = createCommandHistory(
  initialLoad.ok && initialLoad.found ? initialLoad.project : createInitialProject(),
);
let currentProjectName = initialNamedLoad?.ok && initialNamedLoad.found
  ? initialNamedLoad.name
  : "Untitled project";
let savedProjectJson = initialNamedLoad?.ok && initialNamedLoad.found
  ? serializeProject(initialNamedLoad.project)
  : null;
let savedProjectName = initialNamedLoad?.ok && initialNamedLoad.found
  ? initialNamedLoad.name
  : null;
let activeTool = "select";
let activeTask = "project";
let selectedCatalogueGroup = "Units";
let snapEnabled = true;
let draftPoints = [];
let floorAreaDraftPoints = [];
let activeChainId = null;
let hoverPoint = null;
let selectedWallId = null;
let selectedNodeId = null;
let selectedRouteId = null;
let selectedRoutePointIndex = null;
let selectedReferenceId = history.present.floorReferences[0]?.id ?? null;
let dragState = null;
let floorAreaDragState = null;
let componentDragState = null;
let grilleAlignmentPreview = null;
let routePointDragState = null;
let panState = null;
let spacePressed = false;
let suppressNextClick = false;
let interactionMessage = "";
let identityCounter = nextIdentityCounter(history.present);
let referenceIdentityCounter = nextReferenceIdentityCounter(history.present);
let cadReferenceIdentityCounter = nextCadReferenceIdentityCounter(history.present);
let storageState = initialStorageState(initialLoad);
let portableDirty = true;
let pendingPortableOpen = null;
let pendingProjectTransition = null;
let projectNameMode = null;
let pendingDeleteWallId = null;
let pendingComponentDeletion = null;
let pendingClearVentilationFloorId = null;
let calibrationState = null;
let referenceCropState = null;
let automaticRadialPreview = null;
let automaticRadialSelectedKeys = new Set();
let automaticEppPreview = null;
let routingExclusionDraftStart = null;
let pendingRoutingExclusionId = null;
let selectedRoutingExclusionId = null;
let threeDView = { ...createDefaultThreeDView() };
let threeDPointer = null;
let camera = createCamera();
const initialCameraFit = createInitialCameraFitScheduler({
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  measure: () => canvas.getBoundingClientRect(),
  apply: (rect) => applyCameraFit(rect, "Drawing fitted after loading; project geometry unchanged"),
});
if (typeof window.ResizeObserver === "function") {
  const drawingResizeObserver = new window.ResizeObserver(() => initialCameraFit.request());
  drawingResizeObserver.observe(canvas);
}
referenceLayer.addEventListener("load", () => initialCameraFit.request(), true);
let mechanicalState = createMechanicalInteractionState();
let mvhrPlacementMounting = null;
let pendingMvhrDrop = null;
const mvhrDialog = document.querySelector("#mvhr-placement-dialog");
const mvhrForm = document.querySelector("#mvhr-placement-form");
const mvhrModel = document.querySelector("#mvhr-model");
const mvhrHanding = document.querySelector("#mvhr-handing");
const mvhrLayout = document.querySelector("#mvhr-layout");
const mvhrCwSize = document.querySelector("#mvhr-cw-size");
const mvhrSummary = document.querySelector("#mvhr-preview-summary");
const mvhrError = document.querySelector("#mvhr-placement-error");
const mvhrDefaults = new Map();

function updateMvhrPreview() {
  const mounting = pendingMvhrDrop?.mounting ?? "vertical";
  const generic = mvhrModel.value === "generic";
  const ca200=mvhrModel.value === "ca200";
  const germanBim=/^q(?:350|450)-de-(?:hrv|erv)$/u.test(mvhrModel.value);
  mvhrHanding.disabled = generic;
  mvhrLayout.querySelector('[value="unit-mounted-cw"]').disabled = generic || ca200 || germanBim;
  if ((generic || ca200 || germanBim) && mvhrLayout.value === "unit-mounted-cw") mvhrLayout.value = "unit-only";
  document.querySelector("#mvhr-cw-size-label").hidden = mvhrLayout.value !== "unit-mounted-cw";
  const aerofresh = mvhrModel.value.startsWith("aerofresh-450");
  const accessoryNote = mvhrLayout.value === "unit-only" ? "" : mvhrLayout.value === "unit-mounted-cw"
    ? aerofresh && ["320", "420"].includes(mvhrCwSize.value)
      ? ` CW${mvhrCwSize.value}: shared CW layout with 90 mm branch circles. Overall AF450 mounted dimensions pending; drawing envelope is a provisional layout allowance. Outdoor DN160 drawing snap targets and left/right orientation are retained.`
      : ` CW${mvhrCwSize.value}: ${aerofresh ? mvhrCwSize.value === "625" ? "970 × 640" : "870 × 650" : `${{ "320": 791, "420": 824, "520": 924, "625": 1029 }[mvhrCwSize.value]} × 566`} mm assembly envelope; 90 mm branch circles. Mirrored with unit orientation. Outdoor connections remain snap targets. Each CW branch has a DN90 drawing snap target; installed branch setout remains provisional.`
    : " The selected accessory arrangement is saved as design intent; accessories still need a separate layout.";
  mvhrSummary.textContent = generic
    ? `Generic ${mounting} planning symbol: 900 × 650 mm, four DN160 test ports. No manufacturer mounting dimensions or clearance are established.${accessoryNote}`
    : ca200 ? `CA200 manual version · ${mounting} · manufacturer ${mvhrHanding.value}-hand. Body 535 × 315 × 1108 mm; 1200 mm including spigots. Four DN125 drawing connections. Remote attenuators placed separately. Absolute port setout and installation fit require review.${accessoryNote}`
    : aerofresh ? `Aerofresh 450, manufacturer ${mvhrHanding.value}-hand orientation. Body: 728 × 608 × 881 mm from reviewed manual/brochure. Unit spigots suit 160 mm EPP, as confirmed by you. No reducers added.${accessoryNote}`
    : germanBim ? `${mvhrModel.value.startsWith("q350") ? "Q350" : "Q450"} TR German BIM, ${mvhrHanding.value}-hand. Exact article identity, IFC4 solid and four connector placements are retained. This is not an export/Australian SKU crosswalk; CW mating and installation clearance remain unverified.${mvhrModel.value.startsWith("q450") ? " The IFC carries conflicting diameter text, so this exact record stays DN180/200 and will not auto-connect to DN160." : ""}${accessoryNote}`
    : `Q350 drawing profile: 725 × 570 mm body, supply/extract on the ${mvhrHanding.value}. Installation fit and service clearance remain unverified.${accessoryNote}`;
}
mvhrForm.addEventListener("change", updateMvhrPreview);
document.querySelector("#cancel-mvhr-placement").addEventListener("click", () => mvhrDialog.close("cancel"));
mvhrDialog.addEventListener("close", () => {
  pendingMvhrDrop = null;
  if (mvhrDialog.returnValue !== "placed-repeat") setTool("select");
  if (!["placed", "placed-repeat"].includes(mvhrDialog.returnValue)) {
    interactionMessage = "MVHR placement cancelled; drawing unchanged";
    render();
  }
  canvas.focus();
});
mvhrForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!pendingMvhrDrop) return;
  const selection = { mounting: pendingMvhrDrop.mounting, model: mvhrModel.value,
    handing: mvhrHanding.value, layout: mvhrLayout.value, cwSize: mvhrCwSize.value };
  const id = pendingMvhrDrop.componentId ?? `component-catalogue-${componentIdentityCounter}`;
  try {
    const component = createConfiguredMvhrComponent(selection, {
      id, floorId: "floor-ground", xMm: pendingMvhrDrop.point.x, yMm: pendingMvhrDrop.point.y,
    });
    if (!commitCommand(pendingMvhrDrop.componentId ? {type:"component.replaceDrawingConfiguration",componentId:id,component} : { type: "component.add", component }, pendingMvhrDrop.componentId ? "MVHR / CW configuration changed" : "MVHR unit placed; accessory layout intention recorded")) {
      mvhrError.textContent = interactionMessage;
      return;
    }
    if (!pendingMvhrDrop.componentId) componentIdentityCounter += 1;
    mechanicalState.selectedComponentId = id;
    mvhrDefaults.set(selection.mounting, selection);
    mvhrDialog.close(pendingMvhrDrop.repeat ? "placed-repeat" : "placed");
    render();
  } catch (error) { mvhrError.textContent = error.message; }
});

function openMvhrPlacement(point, repeat) {
  pendingMvhrDrop = { point, mounting: mvhrPlacementMounting, repeat };
  const defaults = mvhrDefaults.get(mvhrPlacementMounting);
  for (const option of mvhrModel.options) option.disabled = mvhrPlacementMounting === "horizontal" && !["generic","ca200"].includes(option.value);
  mvhrModel.value = defaults?.model ?? (mvhrPlacementMounting === "vertical" ? "q350-hrv" : "generic");
  mvhrHanding.value = defaults?.handing ?? "left";
  mvhrLayout.value = defaults?.layout ?? "unit-only";
  mvhrCwSize.value = defaults?.cwSize ?? "320";
  document.querySelector("#mvhr-placement-title").textContent = `Configure ${mvhrPlacementMounting} MVHR`;
  mvhrError.textContent = "";
  updateMvhrPreview();
  mvhrDialog.showModal();
}
let standaloneCwPlacement = null;
let pendingCw = null;
let cwDefaults = {size:"320",stream:"supply",orientation:"horizontal",mainSize:160};
const cwDialog=document.querySelector("#cw-dialog");
const cwSize=document.querySelector("#cw-size");
const cwStream=document.querySelector("#cw-stream");
const cwOrientation=document.querySelector("#cw-orientation");
const cwMain=document.querySelector("#cw-main");
const cwError=document.querySelector("#cw-error");
function cwSelection(){return {size:cwSize.value,stream:cwStream.value,orientation:cwOrientation.value,mainSize:Number(cwMain.value)};}
function updateCwSummary(){
  cwMain.querySelector('[value="125"]').disabled=!["220","320"].includes(cwSize.value);
  cwMain.querySelector('[value="160"]').disabled=cwSize.value==="220";
  if(cwSize.value==="220")cwMain.value="125";
  else if(cwSize.value!=="320" && cwMain.value==="125")cwMain.value="160";
  const p=CW_PROFILES[cwSize.value];
  document.querySelector("#cw-summary").textContent=`${p.count} × 90 mm branches · ${p.generation}. Module ${p.length} × ${p.casingWidth??p.width} × ${p.depth} mm. ${cwOrientation.value==="horizontal"?"Two branch rows at different heights share their plan positions; the next free row is selected when routing.":"Branch plate visible from above; dashed circle is the main connection underneath. Vertical duct transitions require elevation review."} Assembly seating and branch offsets remain provisional.`;
}
function openCw(point,repeat=false,component=null){
  const profile=component?.displaySymbol?.cwProfile??cwDefaults;
  pendingCw={point,repeat,componentId:component?.id??null};
  cwSize.value=profile.size;cwStream.value=profile.stream;cwOrientation.value=component?profile.orientation:standaloneCwPlacement??profile.orientation;cwMain.value=String(profile.mainSize);
  document.querySelector("#cw-title").textContent=component?"Change CW unit":"Configure standalone CW";
  document.querySelector("#cw-submit").textContent=component?"Apply changes":"Place CW";
  cwError.textContent="";updateCwSummary();cwDialog.showModal();
}
for(const input of [cwSize,cwStream,cwOrientation,cwMain])input.addEventListener("change",updateCwSummary);
document.querySelector("#cancel-cw").addEventListener("click",()=>cwDialog.close("cancel"));
cwDialog.addEventListener("close",()=>{pendingCw=null;if(cwDialog.returnValue!=="placed-repeat")setTool("select");canvas.focus();});
document.querySelector("#cw-form").addEventListener("submit",event=>{
  event.preventDefault();if(!pendingCw)return;
  try{
    const drop=pendingCw,selection=cwSelection(),id=drop.componentId??`component-catalogue-${componentIdentityCounter}`;
    const component=createCatalogueComponent(standaloneCwRecordId(selection),{id,floorId:"floor-ground",xMm:drop.point.x,yMm:drop.point.y,allowAssemblyOnly:true});
    const command=drop.componentId?{type:"component.replaceDrawingConfiguration",componentId:id,component}:{type:"component.add",component};
    if(!commitCommand(command,drop.componentId?"CW configuration changed; attached ducts updated":"Standalone CW placed")){cwError.textContent=interactionMessage;return;}
    if(!drop.componentId)componentIdentityCounter++;
    cwDefaults=selection;mechanicalState.selectedComponentId=id;
    cwDialog.close(drop.repeat?"placed-repeat":"placed");render();
  }catch(error){cwError.textContent=error.message;}
});
const componentContext=document.querySelector("#component-context-menu");
function closeComponentContext(){componentContext.hidden=true;}
componentContext.addEventListener("keydown",event=>{
  const buttons=[...componentContext.querySelectorAll("button")];
  const index=buttons.indexOf(document.activeElement);
  if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)) {
    event.preventDefault();
    const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(index+(event.key==="ArrowDown"?1:-1)+buttons.length)%buttons.length;
    buttons[next]?.focus();
  }
});
function editPlacedMvhr(component){
  const intent=component.mvhrDesignIntent;
  if(!intent)return;
  openMvhrPlacement({x:component.positionMm.x,y:component.positionMm.y},false);
  pendingMvhrDrop.componentId=component.id;pendingMvhrDrop.mounting=intent.mounting;
  for(const option of mvhrModel.options)option.disabled=intent.mounting==="horizontal" && !["generic","ca200"].includes(option.value);
  mvhrModel.value=intent.model;mvhrHanding.value=intent.handing??"left";mvhrLayout.value=intent.layout;mvhrCwSize.value=intent.cwSize??"320";
  document.querySelector("#mvhr-placement-title").textContent="Change MVHR / CW configuration";
  updateMvhrPreview();
}
canvas.addEventListener("contextmenu",event=>{
  const hit=mechanicalHitFromTarget(event.target);
  const component=history.present.components.find(c=>c.id===hit?.componentId);
  if(!component)return;
  event.preventDefault();setTool("select");mechanicalState.selectedComponentId=component.id;render();
  componentContext.replaceChildren();
  const action=(label,fn)=>{const button=document.createElement("button");button.type="button";button.setAttribute("role","menuitem");button.textContent=label;button.addEventListener("click",()=>{closeComponentContext();fn();});componentContext.append(button);};
  action("Rotate 90°",()=>rotateSelectedComponent());
  if(component.mvhrDesignIntent) {
    action("Change unit / CW size…",()=>editPlacedMvhr(component));
    if(component.mvhrDesignIntent.model!=="generic")action("Flip Left / Right",()=>{
      const intent={...component.mvhrDesignIntent,handing:component.mvhrDesignIntent.handing==="left"?"right":"left"};
      const replacement=createConfiguredMvhrComponent(intent,{id:component.id,floorId:component.floorId,xMm:component.positionMm.x,yMm:component.positionMm.y});
      commitCommand({type:"component.replaceDrawingConfiguration",componentId:component.id,component:replacement},"Unit orientation flipped; attached ducts updated");render();
    });
  } else if(component.displaySymbol?.cwProfile){
    action("Change CW size / orientation…",()=>openCw({x:component.positionMm.x,y:component.positionMm.y},false,component));
    action("Turn end-for-end",()=>{commitCommand({type:"component.rotateFloorZ",componentId:component.id,angleRad:Math.PI},"CW turned end-for-end");render();});
  } else if(/external.*grille|grille.*external/.test(component.catalogueItemId??"") && component.ports.length===2){
    action("Flip Left / Right",()=>{commitCommand({type:"component.setExternalGrilleHanding",componentId:component.id,handing:(component.externalGrilleHanding??"left")==="left"?"right":"left"},"Grille flipped; attached ducts updated");render();});
  } else action("Turn 180°",()=>{commitCommand({type:"component.rotateFloorZ",componentId:component.id,angleRad:Math.PI},"Component turned 180°");render();});
  componentContext.hidden=false;
  componentContext.style.left=`${Math.max(0,Math.min(event.clientX,window.innerWidth-290))}px`;
  componentContext.style.top=`${Math.max(0,Math.min(event.clientY,window.innerHeight-200))}px`;
  componentContext.querySelector("button")?.focus();
});
document.addEventListener("pointerdown",event=>{if(!componentContext.contains(event.target))closeComponentContext();});
document.addEventListener("keydown",event=>{if(event.key==="Escape")closeComponentContext();});

let terminalPlacementShape = null;
let pendingTerminalDrop = null;
const terminalDefaults = new Map();
const terminalDialog = document.querySelector("#terminal-placement-dialog");
const terminalService = document.querySelector("#terminal-service");
const terminalError = document.querySelector("#terminal-placement-error");
function terminalRecordId(shape, service) {
  return shape === "round" ? `luna-${service}` : `aerofresh-magnetic-wall-grille-${service}`;
}
function placeConfiguredTerminal(drop, service) {
  const id = `component-catalogue-${componentIdentityCounter}`;
  const component = createCatalogueComponent(terminalRecordId(drop.shape, service), {
    id, floorId: "floor-ground", xMm: drop.point.x, yMm: drop.point.y,
  });
  if (!commitCommand({ type: "component.add", component, autoAssignTerminalSpace: true }, "Terminal placed")) return false;
  componentIdentityCounter += 1;
  terminalDefaults.set(drop.shape, service);
  mechanicalState.selectedComponentId = id;
  if (!drop.repeat) setTool("select");
  interactionMessage = `${drop.shape === "round" ? "Round" : "Rectangular"} ${service} terminal placed${drop.space ? ` in ${drop.space.space.name}` : ""}`;
  render();
  return true;
}
function openTerminalPlacement(point, repeat) {
  const space = terminalPlacementSpace(history.present, "floor-ground", point);
  const role = space?.space.ventilationRole;
  const automatic = ["supply", "extract"].includes(role) ? role : null;
  const drop = { point, repeat, shape: terminalPlacementShape, space };
  // Repeated placements still follow each destination's confirmed ventilation role.
  const remembered = terminalDefaults.get(drop.shape);
  if (repeat && remembered && (automatic || !space)) {
    if (placeConfiguredTerminal(drop, automatic ?? remembered)) return;
  }
  pendingTerminalDrop = drop;
  terminalService.value = automatic ?? remembered ?? "";
  document.querySelector("#terminal-placement-title").textContent = `Configure ${drop.shape === "round" ? "round" : "rectangular"} terminal`;
  document.querySelector("#terminal-product-name").textContent = drop.shape === "round" ? "Luna grille" : "Aerofresh box · magnetic cover";
  document.querySelector("#terminal-space-note").textContent = automatic
    ? `${space.space.name}: ${automatic === "supply" ? "Supply" : "Extract"} selected from the ${space.kind}. You can change it.`
    : space ? `${space.space.name} has no Supply/Extract role. Choose the air service manually.` : "No unambiguous room or zone here. Choose the air service manually.";
  terminalError.textContent = "";
  terminalDialog.showModal();
}
function deleteSelectedDuctRun() {
  if (!selectedRouteId) return;
  if (commitCommand({type:"route.delete",routeId:selectedRouteId}, "Duct run deleted; connections released · Undo restores it")) {
    selectedRouteId=null;
    selectedRoutePointIndex=null;
    render();
  }
}
document.querySelector("#delete-duct-run").addEventListener("click",deleteSelectedDuctRun);
document.querySelector("#realign-epp-connections").addEventListener("click",()=>{
  if(!selectedRouteId)return;
  commitCommand({type:"route.realignEppConnections",routeId:selectedRouteId},"EPP connection approaches realigned · nearby end clicks removed · Undo restores the run");
  render();
});
document.querySelector("#cancel-terminal-placement").addEventListener("click", () => terminalDialog.close("cancel"));
terminalDialog.addEventListener("close", () => {
  pendingTerminalDrop = null;
  if (terminalDialog.returnValue !== "placed-repeat") setTool("select");
  canvas.focus();
});
document.querySelector("#terminal-placement-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!pendingTerminalDrop) return;
  if (!["supply", "extract"].includes(terminalService.value)) { terminalError.textContent = "Choose Supply or Extract."; return; }
  try {
    const repeat = pendingTerminalDrop.repeat;
    if (placeConfiguredTerminal(pendingTerminalDrop, terminalService.value)) terminalDialog.close(repeat ? "placed-repeat" : "placed");
    else terminalError.textContent = "The terminal could not be placed. Review the drawing status and try again.";
  } catch (error) { terminalError.textContent = error.message; }
});
let externalGrillePlacement=null;
let pendingExternalGrille=null;
let externalGrilleDefault={service:"intake",size:"160"};
const externalGrilleDialog=document.querySelector("#external-grille-dialog");
document.querySelector("#external-grille-handing").addEventListener("change",event=>{
  if(!mechanicalState.selectedComponentId)return;
  commitCommand({type:"component.setExternalGrilleHanding",componentId:mechanicalState.selectedComponentId,handing:event.target.value},"Combined grille intake side swapped; connected ducts follow · Undo available");
});
function externalGrilleRecordId(selection) {
  return `${selection.service==="combined"?"generic":"zehnder"}-external-grille-${selection.service}-dn${selection.size}`;
}
function updateExternalGrilleSpacingPreview() {
  const selection={service:document.querySelector("#external-grille-type").value,size:document.querySelector("#external-grille-size").value};
  const message=document.querySelector("#external-grille-spacing");
  document.querySelector("#external-grille-product-summary").textContent=selection.service==="combined"
    ? "Generic combined drawing symbol with separate ports. Supplied Zehnder data recorded; physical Left/Right setout remains under review. Rotate the grille to face the building."
    : "Zehnder single external wall grille, using the supplied dimensions. Exact EPP mating and wall installation still require review. Rotate the grille to face the building.";
  if(selection.service==="combined") {message.textContent="Combined grille: the separate-grille 1.5 m rule does not apply within this product. Physical Left/Right layout remains under review.";return;}
  if(!pendingExternalGrille)return;
  const component=createCatalogueComponent(externalGrilleRecordId(selection),{id:"external-grille-preview",floorId:"floor-ground",xMm:pendingExternalGrille.point.x,yMm:pendingExternalGrille.point.y});
  const pairs=inspectExternalGrilleSeparation({...history.present,components:[...history.present.components,component]},"floor-ground").filter(p=>p.componentId===component.id||p.otherComponentId===component.id);
  const tooClose=pairs.filter(p=>p.status==="too-close");
  message.textContent=tooClose.length ? `Too close: nearest centre-to-centre distance ${(Math.min(...tooClose.map(p=>p.distanceMm))/1000).toFixed(2)} m. Separate intake/exhaust grilles need at least 1.50 m centre-to-centre. You can place the draft and move it; Checks will retain the warning.` : "Zehnder single grille dimensions loaded. Keep separate intake/exhaust grilles at least 1.50 m centre-to-centre. Vertical and facade checks remain separate.";
}
document.querySelector("#external-grille-form").addEventListener("change",updateExternalGrilleSpacingPreview);
function grilleAlignment(component,point,allowHandingChange=false) {
  if(!snapEnabled)return null;
  const rect=canvas.getBoundingClientRect(),pixelsPerViewUnit=Math.min(rect.width/camera.width,rect.height/camera.height);
  return findCombinedGrilleAlignment(history.present,component,point,{toleranceMm:12*MILLIMETRES_PER_VIEW_UNIT/Math.max(pixelsPerViewUnit,1e-6),allowHandingChange,allowRotation:allowHandingChange});
}
function grillePlacementAlignment(point) {
  if(externalGrillePlacement!=="combined")return null;
  const component=createCatalogueComponent(`generic-external-grille-combined-dn${externalGrilleDefault.size}`,{id:"grille-alignment-preview",floorId:"floor-ground",xMm:point.x,yMm:point.y});
  return grilleAlignment(component,point,true);
}
function placeExternalGrille(drop,selection) {
  const id=`component-catalogue-${componentIdentityCounter}`;
  let component=createCatalogueComponent(externalGrilleRecordId(selection),{id,floorId:"floor-ground",xMm:drop.point.x,yMm:drop.point.y});
  const alignment=grilleAlignment(component,drop.point,true);
  if(alignment)component=alignment.component;
  if(!commitCommand({type:"component.add",component},"External grille placed; connect intake and exhaust separately")) return false;
  componentIdentityCounter++;
  externalGrilleDefault=selection;
  mechanicalState.selectedComponentId=id;
  if(!drop.repeat) setTool("select");
  render();return true;
}
function openExternalGrille(point,repeat) {
  pendingExternalGrille={point,repeat};
  const combined=externalGrillePlacement === "combined";
  document.querySelector("#external-grille-title").textContent=combined?"Configure combined external grille":"Configure individual external grille";
  document.querySelector("#external-grille-type-label").hidden=combined;
  for(const option of document.querySelector("#external-grille-type").options) {
    option.disabled=combined ? option.value!=="combined" : option.value==="combined";
    option.hidden=option.disabled;
  }
  document.querySelector("#external-grille-type").value=externalGrilleDefault.service;
  document.querySelector("#external-grille-size").value=externalGrilleDefault.size;
  document.querySelector("#external-grille-error").textContent="";
  updateExternalGrilleSpacingPreview();
  externalGrilleDialog.showModal();
}
document.querySelector("#cancel-external-grille").addEventListener("click",()=>externalGrilleDialog.close("cancel"));
externalGrilleDialog.addEventListener("close",()=>{pendingExternalGrille=null;if(externalGrilleDialog.returnValue!=="placed-repeat")setTool("select");canvas.focus();});
document.querySelector("#external-grille-form").addEventListener("submit",event=>{
  event.preventDefault();if(!pendingExternalGrille)return;
  try { const repeat=pendingExternalGrille.repeat;
    if(placeExternalGrille(pendingExternalGrille,{service:document.querySelector("#external-grille-type").value,size:document.querySelector("#external-grille-size").value}))externalGrilleDialog.close(repeat?"placed-repeat":"placed");
    else document.querySelector("#external-grille-error").textContent="The grille could not be placed. Review the drawing status.";
  }catch(error){document.querySelector("#external-grille-error").textContent=error.message;}
});
let componentIdentityCounter = nextComponentIdentityCounter(history.present);
let equipmentAssemblyIdentityCounter = nextEquipmentAssemblyIdentityCounter(history.present);
let routeIdentityCounter = nextRouteIdentityCounter(history.present);
let roomIdentityCounter = nextRoomIdentityCounter(history.present);
let zoneIdentityCounter = nextZoneIdentityCounter(history.present);
let floorAreaIdentityCounter = nextFloorAreaIdentityCounter(history.present);
let selectedRoomId = null;
let selectedZoneId = null;
let pendingRoomBoundaryKey = null;
let pendingZoneBoundaryKey = null;
let pendingZoneParentRoomId = null;
let editingRoomId = null;
let editingZoneId = null;
let reassignRoomId = null;
let reassignZoneId = null;
let pendingRemoveRoomId = null;
let pendingRemoveZoneId = null;
let selectedFloorAreaId = null;
let pendingFloorAreaVertices = null;
let editingFloorAreaId = null;
let pendingPdfImport = null;
let pdfRenderRevision = 0;
const dxfImportController = createDxfImportReviewController();
const cadProjectionCache = new Map();

selectButton.addEventListener("click", () => setTool("select"));
wallButton.addEventListener("click", () => setTool("wall"));
roomDividerButton.addEventListener("click", () => setTool("room-divider"));
floorAreaButton.addEventListener("click", () => setTool("floor-area"));
panToolButton.addEventListener("click", () => setTool("pan"));
snapToggleButton.addEventListener("click", toggleSnap);
saveButton.addEventListener("click", () => saveExplicit());
saveAsButton.addEventListener("click", () => openProjectNameDialog("save-as"));
reopenButton.addEventListener("click", () => setTask("project"));
document.querySelector("#project-cloud-open").addEventListener("click",()=>document.querySelector("#cloud-projects-button").click());
document.querySelector("#project-signin").addEventListener("click",()=>document.querySelector("#account-button").click());
newProjectButton.addEventListener("click", () => openProjectNameDialog("new"));
renameProjectButton.addEventListener("click", () => openProjectNameDialog("rename"));
projectSaveButton.addEventListener("click", () => saveExplicit());
projectSaveAsButton.addEventListener("click", () => openProjectNameDialog("save-as"));
projectNameForm.addEventListener("submit", applyProjectNameChoice);
document.querySelector("#account-nav").addEventListener("click",()=>cloudSession?.openAccount());
document.querySelector("#project-details-form").addEventListener("submit",event=>{
 event.preventDefault();const form=event.currentTarget;
 try{const details=Object.fromEntries(new FormData(form));commitCommand({type:"project.updateDetails",details},"Project details applied · save the drawing to keep changes");currentProjectName=details.name.trim();document.querySelector("#project-details-status").textContent="Applied. Save the drawing to keep these details.";renderProjectWorkspace();}
 catch(error){document.querySelector("#project-details-status").textContent=error.message;}
});
cancelProjectNameButton.addEventListener("click", closeProjectNameDialog);
projectLibraryList.addEventListener("click", openProjectFromLibraryClick);
undoButton.addEventListener("click", () => applyHistoryChange(undoCommand(history), "Undo saved locally"));
redoButton.addEventListener("click", () => applyHistoryChange(redoCommand(history), "Redo saved locally"));
exportButton.addEventListener("click", exportProject);
openButton.addEventListener("click", () => {document.querySelector("#cloud-projects-dialog").close();portableFileInput.click();});
document.querySelector("#cloud-projects-button").addEventListener("click",renderProjectLibrary);
portableFileInput.addEventListener("change", stagePortableOpen);
addReferenceButton.addEventListener("click", () => referenceFileInput.click());
referenceFileInput.addEventListener("change", addReferenceImage);
addPdfReferenceButton.addEventListener("click", () => pdfReferenceFileInput.click());
pdfReferenceFileInput.addEventListener("change", stagePdfReference);
pdfPageChoice.addEventListener("change", renderPendingPdfPage);
pdfImportForm.addEventListener("submit", acceptPdfReference);
cancelPdfImportButton.addEventListener("click", () => cancelPdfReference("PDF import cancelled; current project preserved"));
pdfImportDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelPdfReference("PDF import cancelled; current project preserved");
});
addDxfReferenceButton.addEventListener("click", () => dxfReferenceFileInput.click());
dxfReferenceFileInput.addEventListener("change", stageDxfReference);
dxfImportForm.addEventListener("submit", acceptDxfReference);
cancelDxfImportButton.addEventListener("click", () => cancelDxfReference("DXF import cancelled; current project preserved"));
dxfUnitChoice.addEventListener("change", updateDxfUnitChoice);
dxfAcceptPartial.addEventListener("change", updateDxfPartialAcceptance);
dxfImportDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelDxfReference("DXF import cancelled; current project preserved");
});
calibrateReferenceButton.addEventListener("click", startCalibration);
cropReferenceButton.addEventListener("click", startReferenceCrop);
resetReferenceCropButton.addEventListener("click", resetReferenceCrop);
cancelReferenceCropButton.addEventListener("click", () => cancelReferenceCrop("PDF crop cancelled; project unchanged"));
referenceCropForm.addEventListener("submit", applyReferenceCrop);
cancelReferenceCropDialogButton.addEventListener("click", () => cancelReferenceCrop("PDF crop cancelled; project unchanged"));
referenceCropDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelReferenceCrop("PDF crop cancelled; project unchanged");
});
deleteWallButton.addEventListener("click", openWallDeleteDialog);
deleteComponentButton.addEventListener("click", openComponentDeleteDialog);
deleteComponentDialog.addEventListener("close", applyComponentDeleteChoice);
clearVentilationButton.addEventListener("click", openClearVentilationDialog);
clearVentilationDialog.addEventListener("close", applyClearVentilationChoice);
rotateComponentButton.addEventListener("click", rotateSelectedComponent);
componentRoomAssignment.addEventListener("change", changeSelectedTerminalRoom);
singleComponentDuctRunButton.addEventListener("click", () => setSelectedTerminalDuctRuns(1));
twinComponentDuctRunButton.addEventListener("click", () => setSelectedTerminalDuctRuns(2));
clearComponentDuctRunsButton.addEventListener("click", clearSelectedTerminalDuctRuns);
singleRouteRunButton.addEventListener("click", () => setSelectedRouteParallelRuns(1));
twinRouteRunButton.addEventListener("click", () => setSelectedRouteParallelRuns(2));
clearRouteRunButton.addEventListener("click", () => setSelectedRouteParallelRuns(null));
automaticRouteButton.addEventListener("click", () => automaticRouteSystem.value === "epp" ? openAutomaticEppPreview() : openAutomaticRadialPreview());
automaticRouteSystem.addEventListener("change", renderRoutingWorkflow);
automaticRouteStyle.addEventListener("change", () => {
  updateAutomaticRoutingStyle({ suggestIfEmpty: true });
  renderRoutingWorkflow();
  if (automaticRadialDialog.open) openAutomaticRadialPreview();
  if (automaticEppDialog.open) refreshAutomaticEppPreview();
});
automaticRouteAxis.addEventListener("change", () => {
  automaticRouteAxisDetail.textContent = automaticRouteAxis.value === "" ? "Confirm the building axis before previewing." : "User-confirmed building axis for this preview.";
  if (automaticRadialDialog.open) openAutomaticRadialPreview();
  if (automaticEppDialog.open) refreshAutomaticEppPreview();
});
suggestBuildingAxisButton.addEventListener("click", () => applyOutlineAxisSuggestion());
cancelAutomaticRadialButton.addEventListener("click", cancelAutomaticRadialPreview);
applyAutomaticRadialButton.addEventListener("click", applyAutomaticRadialPreview);
automaticRadialDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelAutomaticRadialPreview();
});
automaticEppStart.addEventListener("change", refreshAutomaticEppPreview);
automaticEppEnd.addEventListener("change", refreshAutomaticEppPreview);
cancelAutomaticEppButton.addEventListener("click", cancelAutomaticEppPreview);
applyAutomaticEppButton.addEventListener("click", applyAutomaticEppPreview);
automaticEppDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelAutomaticEppPreview();
});
addRoutingExclusionButton.addEventListener("click", () => {
  routingExclusionDraftStart = null;
  setTool("routing-exclusion");
  interactionMessage = "Click two opposite corners of the routing exclusion rectangle";
  render();
});
applyRoutingClearanceButton.addEventListener("click", applyRoutingClearance);
routingExclusionHeightMode.addEventListener("change", () => { routingExclusionHeightFields.hidden = routingExclusionHeightMode.value !== "solid-range"; });
routingExclusionForm.addEventListener("submit", applyRoutingExclusionDialog);
cancelRoutingExclusionButton.addEventListener("click", cancelRoutingExclusionDialog);
routingExclusionDialog.addEventListener("cancel", (event) => { event.preventDefault(); cancelRoutingExclusionDialog(); });
removeRoutePointButton.addEventListener("click", removeSelectedRoutePoint);
applyComponentElevationButton.addEventListener("click", applySelectedComponentElevation);
clearComponentElevationButton.addEventListener("click", clearSelectedComponentElevation);
projectNavigationButton.addEventListener("click", () => setTask("project"));
planNavigationButton.addEventListener("click", () => setTask("plan"));
ventilationNavigationButton.addEventListener("click", openVentilationTask);
threeDNavigationButton.addEventListener("click", () => setTask("three-d"));
catalogueNavigationButton.addEventListener("click", () => setTask("catalogue"));
checksNavigationButton.addEventListener("click", () => setTask("checks"));
checksReturnVentilationButton.addEventListener("click", () => setTask("ventilation"));
checksEngineeringForm.addEventListener("submit", applyEngineeringDutyInput);
checksEngineeringClear.addEventListener("click", clearEngineeringDutyInput);
sheetsNavigationButton.addEventListener("click", openSheetPreview);
threeDReturnButton.addEventListener("click", () => setTask("ventilation"));
threeDHeightForm.addEventListener("submit", applyThreeDHeights);
exportThreeDButton.addEventListener("click", exportThreeDDrawing);
threeDViewButtons.forEach((button) => button.addEventListener("click", () => adjustThreeDView(button.dataset.threeDView)));
threeDHost.addEventListener("wheel", handleThreeDWheel, { passive: false });
threeDHost.addEventListener("pointerdown", startThreeDPointer);
threeDHost.addEventListener("pointermove", moveThreeDPointer);
threeDHost.addEventListener("pointerup", endThreeDPointer);
threeDHost.addEventListener("pointercancel", endThreeDPointer);
printSheetPreviewButton.addEventListener("click", printSheetPreview);
closeSheetPreviewButton.addEventListener("click", closeSheetPreview);
workflowOpenPlanButton.addEventListener("click", () => setTask("plan"));
workflowOpenVentilationButton.addEventListener("click", openVentilationTask);
workflowStartPreliminaryButton.addEventListener("click", startPreliminaryLayout);
workflowConvertButton.addEventListener("click", openProjectConversionDialog);
workflowStartDetailedButton.addEventListener("click", startDetailedDesign);
workflowLinkOutletsButton.addEventListener("click", linkExistingOutletsByPosition);
workflowUploadPlanButton.addEventListener("click", () => {
  setTask("plan");
  pdfReferenceFileInput.click();
});
workflowSetScaleButton.addEventListener("click", () => {
  setTask("plan");
  startCalibration();
});
workflowDrawPerimeterButton.addEventListener("click", () => {
  setTask("plan");
  setTool("floor-area");
});
workflowMarkupMvhrButton.addEventListener("click", openVentilationTask);
quoteInputForm.addEventListener("submit", saveQuoteInputs);
convertProjectDialog.addEventListener("close", applyProjectConversionChoice);
roomForm.addEventListener("submit", applyRoomDialog);
adoptRequiredAirflowButton.addEventListener("click", adoptRequiredAirflowInForm);
cancelRoomButton.addEventListener("click", () => cancelRoomDialog("Room or zone change cancelled; project unchanged"));
editRoomButton.addEventListener("click", openSelectedRoomEditor);
reassignRoomButton.addEventListener("click", beginRoomReassignment);
removeRoomButton.addEventListener("click", openRemoveRoomDialog);
removeRoomDialog.addEventListener("close", applyRemoveRoomChoice);
floorAreaForm.addEventListener("submit", applyFloorAreaDialog);
cancelFloorAreaButton.addEventListener("click", () => cancelFloorAreaDialog("Floor area change cancelled; project unchanged"));
editFloorAreaButton.addEventListener("click", openFloorAreaEditor);
removeFloorAreaButton.addEventListener("click", openRemoveFloorAreaDialog);
removeFloorAreaDialog.addEventListener("close", applyRemoveFloorAreaChoice);
renderCataloguePalette();
catalogueSearchInput.addEventListener("input", renderCataloguePalette);
catalogueLibrarySearch.addEventListener("input", renderCatalogueLibrary);
for (const button of routeButtons) {
  button.addEventListener("click", () => setTool("route", {
    ductKind: button.dataset.ductKind,
  }));
}
openConfirmDialog.addEventListener("close", async () => {
  const transition = pendingProjectTransition;
  pendingProjectTransition = null;
  if (!transition) return;
  if (openConfirmDialog.returnValue === "save") {
    if (await saveExplicit()) transition();
    return;
  }
  if (openConfirmDialog.returnValue === "discard") {
    transition();
    return;
  }
  interactionMessage = "Action cancelled; current project preserved";
  render();
});
deleteWallDialog.addEventListener("close", applyWallDeleteChoice);
calibrationForm.addEventListener("submit", applyCalibration);
cancelCalibrationButton.addEventListener("click", () => cancelCalibration("Calibration cancelled; model unchanged"));

document.querySelector("#zoom-in").addEventListener("click", () => zoomAtCentre(0.8));
document.querySelector("#zoom-out").addEventListener("click", () => zoomAtCentre(1.25));
document.querySelector("#fit-view").addEventListener("click", fitView);
document.querySelector("#pan-left").addEventListener("click", () => panBy(-0.15, 0));
document.querySelector("#pan-up").addEventListener("click", () => panBy(0, -0.15));
document.querySelector("#pan-down").addEventListener("click", () => panBy(0, 0.15));
document.querySelector("#pan-right").addEventListener("click", () => panBy(0.15, 0));

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  initialCameraFit.cancel();
  const anchor = clientPointToCamera(camera, { x: event.clientX, y: event.clientY }, canvas.getBoundingClientRect());
  camera = zoomCameraAt(camera, anchor, event.deltaY > 0 ? 1.15 : 0.87);
  interactionMessage = "View zoom changed; project geometry unchanged";
  render();
}, { passive: false });

canvas.addEventListener("pointerdown", (event) => {
  if (event.button === 2) return;
  canvas.focus();
  if (event.button === 1 || (event.button === 0 && (spacePressed || activeTool === "pan"))) {
    initialCameraFit.cancel();
    panState = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  if (activeTask === "plan" && activeTool === "crop-reference" && event.button === 0) {
    const reference = selectedReference();
    const asset = reference && history.present.referenceAssets.find((candidate) => candidate.id === reference.assetId);
    if (!reference || !asset || asset.source?.kind !== "pdf-page" || !referenceCropState) return;
    const sourcePoint = referenceSourcePointFromEvent(event, reference);
    if (!sourcePointInsideAsset(sourcePoint, asset)) {
      interactionMessage = "Start the crop inside the PDF page";
      updateStatus();
      return;
    }
    referenceCropState = {
      ...referenceCropState,
      pointerId: event.pointerId,
      startSourcePoint: sourcePoint,
      currentSourcePoint: sourcePoint,
      stagedSourceRectPx: null,
    };
    canvas.setPointerCapture(event.pointerId);
    interactionMessage = "Drag around the floor plan · release to review · Esc cancels";
    event.preventDefault();
    render();
    return;
  }
  const routePointHandle = event.target.closest?.(".route-point-handle.intermediate");
  if (activeTask === "ventilation" && activeTool === "select" && routePointHandle) {
    const routeId = routePointHandle.dataset.routeId;
    const pointIndex = Number.parseInt(routePointHandle.dataset.pointIndex, 10);
    const route = history.present.routes.find((candidate) => candidate.id === routeId);
    const point = route?.points[pointIndex];
    if (!route || !point || pointIndex < 1 || pointIndex >= route.points.length - 1) return;
    selectedRouteId = route.id;
    selectedRoutePointIndex = pointIndex;
    mechanicalState = clearMechanicalSelection(mechanicalState);
    routePointDragState = {
      routeId: route.id,
      pointIndex,
      pointerId: event.pointerId,
      start: { x: point.x, y: point.y },
      preview: { x: point.x, y: point.y },
    };
    canvas.setPointerCapture(event.pointerId);
    interactionMessage = "Route point move preview · release to commit one edit · Esc cancels";
    event.preventDefault();
    render();
    return;
  }
  const mechanicalHit = mechanicalHitFromTarget(event.target);
  if (activeTask === "ventilation" && activeTool === "select" && (mechanicalHit?.kind === "component" || mechanicalHit?.kind === "port")) {
    const componentId = mechanicalHit.componentId;
    const component = history.present.components.find((candidate) => candidate.id === componentId);
    if (!component) return;
    mechanicalState = handleMechanicalCanvasClick(mechanicalState, {
      point: { x: component.positionMm.x, y: component.positionMm.y },
      hit: mechanicalHit,
    }).state;
    selectedWallId = null;
    selectedNodeId = null;
    selectedFloorAreaId = null;
    selectedRouteId = null;
    selectedRoutePointIndex = null;
    const assembly = equipmentAssemblyForComponent(history.present, componentId);
    componentDragState = {
      componentId,
      pointerStart: eventToSvgWorld(event),
      assemblyId: assembly?.id ?? null,
      memberIds: assembly?.componentIds ?? [componentId],
      pointerId: event.pointerId,
      start: { x: component.positionMm.x, y: component.positionMm.y },
      preview: { x: component.positionMm.x, y: component.positionMm.y },
    };
    canvas.setPointerCapture(event.pointerId);
    interactionMessage = assembly
      ? "Equipment assembly move preview · release to commit · Esc cancels"
      : "Catalogue component move preview · release to commit · Esc cancels";
    event.preventDefault();
    render();
    return;
  }
  if (activeTask !== "plan") return;
  if (activeTool === "select" && event.target.classList.contains("floor-area-vertex")) {
    const outlineId = event.target.dataset.floorAreaId;
    const vertexId = event.target.dataset.vertexId;
    const outline = history.present.floorAreaOutlines.find((candidate) => candidate.id === outlineId);
    const vertex = outline?.vertices.find((candidate) => candidate.id === vertexId);
    if (!outline || !vertex) return;
    selectedFloorAreaId = outline.id;
    selectedWallId = null;
    selectedNodeId = null;
    selectedRoomId = null;
    selectedZoneId = null;
    floorAreaDragState = {
      outlineId,
      vertexId,
      pointerId: event.pointerId,
      start: { x: vertex.positionMm.x, y: vertex.positionMm.y },
      preview: { x: vertex.positionMm.x, y: vertex.positionMm.y },
    };
    canvas.setPointerCapture(event.pointerId);
    interactionMessage = "Building-outline vertex preview · release to commit · Esc cancels";
    event.preventDefault();
    render();
    return;
  }
  if (activeTool !== "select" || !event.target.classList.contains("wall-node")) return;
  const nodeId = event.target.dataset.nodeId;
  const node = history.present.wallNodes.find((candidate) => candidate.id === nodeId);
  if (!node) return;
  selectedNodeId = nodeId;
  selectedWallId = null;
  selectedFloorAreaId = null;
  mechanicalState = clearMechanicalSelection(mechanicalState);
  dragState = {
    nodeId,
    pointerId: event.pointerId,
    start: { x: node.positionMm.x, y: node.positionMm.y },
    preview: { x: node.positionMm.x, y: node.positionMm.y },
  };
  canvas.setPointerCapture(event.pointerId);
  interactionMessage = "Point edit preview · release to commit · Esc cancels";
  event.preventDefault();
  render();
});

canvas.addEventListener("pointermove", (event) => {
  if (panState && event.pointerId === panState.pointerId) {
    const rect = canvas.getBoundingClientRect();
    const delta = {
      x: -((event.clientX - panState.clientX) / rect.width) * camera.width,
      y: -((event.clientY - panState.clientY) / rect.height) * camera.height,
    };
    camera = panCamera(camera, delta);
    panState.clientX = event.clientX;
    panState.clientY = event.clientY;
    interactionMessage = "View panned; project geometry unchanged";
    renderCamera();
    updateStatus();
    return;
  }
  if (referenceCropState?.pointerId === event.pointerId) {
    const reference = selectedReference();
    if (!reference) return;
    referenceCropState.currentSourcePoint = referenceSourcePointFromEvent(event, reference);
    render();
    return;
  }
  if (routePointDragState && event.pointerId === routePointDragState.pointerId) {
    routePointDragState.preview = eventToGridWorld(event);
    cursorStatus.textContent = `X ${formatMm(routePointDragState.preview.x)} · Y ${formatMm(routePointDragState.preview.y)}`;
    render();
    return;
  }
  if (componentDragState && event.pointerId === componentDragState.pointerId) {
    const proposed = layoutPointerPosition(eventToSvgWorld(event), {
      snapEnabled, gridMm: GRID_SNAP_MM,
      drag: { pointerStart: componentDragState.pointerStart, start: componentDragState.start },
    });
    const component=history.present.components.find(c=>c.id===componentDragState.componentId);
    grilleAlignmentPreview=!componentDragState.assemblyId ? grilleAlignment(component,proposed) : null;
    componentDragState.preview = grilleAlignmentPreview?.point ?? proposed;
    mechanicalState = updateMechanicalPointer(mechanicalState, componentDragState.preview);
    cursorStatus.textContent = `X ${formatMm(componentDragState.preview.x)} · Y ${formatMm(componentDragState.preview.y)}`;
    render();
    return;
  }
  if (dragState && event.pointerId === dragState.pointerId) {
    dragState.preview = eventToGridWorld(event);
    cursorStatus.textContent = `X ${formatMm(dragState.preview.x)} · Y ${formatMm(dragState.preview.y)}`;
    render();
    return;
  }
  if (floorAreaDragState && event.pointerId === floorAreaDragState.pointerId) {
    floorAreaDragState.preview = resolvePointerPoint(event);
    cursorStatus.textContent = `X ${formatMm(floorAreaDragState.preview.x)} · Y ${formatMm(floorAreaDragState.preview.y)}`;
    render();
    return;
  }
  hoverPoint = resolvePointerPoint(event);
  cursorStatus.textContent = `X ${formatMm(hoverPoint.x)} · Y ${formatMm(hoverPoint.y)}`;
  if ((activeTool === "wall" || activeTool === "room-divider") && draftPoints.length > 0) renderDraft();
  if (activeTool === "floor-area" && floorAreaDraftPoints.length > 0) renderDraft();
  if (activeTool === "routing-exclusion" && routingExclusionDraftStart) renderDraft();
  if (activeTool === "place-component" || activeTool === "place-assembly" || activeTool === "route") {
    const hoverPort=activeTool==="route"?mechanicalHitFromPointerEvent(event):null;
    const proposed=hoverPort?.positionMm??eventToGridWorld(event);
    grilleAlignmentPreview=grillePlacementAlignment(proposed);
    mechanicalState = updateMechanicalPointer(mechanicalState, grilleAlignmentPreview?.point??proposed);
    renderDraft();
  }
});

canvas.addEventListener("pointerup", (event) => {
  if (panState && event.pointerId === panState.pointerId) {
    panState = null;
    suppressNextClick = true;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  if (referenceCropState?.pointerId === event.pointerId) {
    const reference = selectedReference();
    const asset = reference && history.present.referenceAssets.find((candidate) => candidate.id === reference.assetId);
    const completed = referenceCropState;
    completed.currentSourcePoint = reference ? referenceSourcePointFromEvent(event, reference) : completed.currentSourcePoint;
    completed.pointerId = null;
    suppressNextClick = true;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    const crop = cropRectFromPoints(completed.startSourcePoint, completed.currentSourcePoint);
    const endedInsidePage = sourcePointInsideAsset(completed.currentSourcePoint, asset);
    if (!asset || !endedInsidePage || crop.width < 1 || crop.height < 1) {
      completed.startSourcePoint = null;
      completed.currentSourcePoint = null;
      completed.stagedSourceRectPx = null;
      interactionMessage = !asset || !endedInsidePage
        ? "Crop must stay inside the PDF page; drag a new rectangle"
        : "Crop is empty; drag a rectangle with visible width and height";
      render();
      event.preventDefault();
      return;
    }
    completed.stagedSourceRectPx = crop;
    referenceCropSummary.textContent = `${Math.round(crop.width)} × ${Math.round(crop.height)} px from the selected page. The original PDF and page transform remain unchanged.`;
    referenceCropError.textContent = "";
    referenceCropDialog.showModal();
    interactionMessage = "Review the crop · Apply is the only project change";
    render();
    event.preventDefault();
    return;
  }
  if (routePointDragState && event.pointerId === routePointDragState.pointerId) {
    const completedDrag = routePointDragState;
    routePointDragState = null;
    suppressNextClick = true;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (completedDrag.preview.x !== completedDrag.start.x || completedDrag.preview.y !== completedDrag.start.y) {
      commitCommand({
        type: "route.movePoint",
        routeId: completedDrag.routeId,
        pointIndex: completedDrag.pointIndex,
        xMm: completedDrag.preview.x,
        yMm: completedDrag.preview.y,
      }, "Route centreline point moved; endpoint attachments preserved");
    } else {
      interactionMessage = "Route point selected; model unchanged";
      render();
    }
    event.preventDefault();
    return;
  }
  if (componentDragState && event.pointerId === componentDragState.pointerId) {
    const completedDrag = componentDragState;
    componentDragState = null;
    grilleAlignmentPreview = null;
    suppressNextClick = true;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (completedDrag.preview.x !== completedDrag.start.x || completedDrag.preview.y !== completedDrag.start.y) {
      const delta = {
        x: completedDrag.preview.x - completedDrag.start.x,
        y: completedDrag.preview.y - completedDrag.start.y,
      };
      commitCommand(
        completedDrag.assemblyId
          ? {
              type: "equipmentAssembly.moveBy",
              assemblyId: completedDrag.assemblyId,
              dxMm: delta.x,
              dyMm: delta.y,
            }
          : {
              ...componentMoveIntent(mechanicalState, completedDrag.preview),
              autoAssignTerminalSpace: true,
            },
        completedDrag.assemblyId
          ? "Equipment assembly moved as one group; attached endpoints updated"
          : "Catalogue component move committed; attached endpoints updated",
      );
    } else {
      interactionMessage = "Catalogue component selected; model unchanged";
      render();
    }
    event.preventDefault();
    return;
  }
  if (floorAreaDragState && event.pointerId === floorAreaDragState.pointerId) {
    const completedDrag = floorAreaDragState;
    floorAreaDragState = null;
    suppressNextClick = true;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (completedDrag.preview.x !== completedDrag.start.x || completedDrag.preview.y !== completedDrag.start.y) {
      commitCommand({
        type: "floorArea.moveVertex",
        outlineId: completedDrag.outlineId,
        vertexId: completedDrag.vertexId,
        xMm: completedDrag.preview.x,
        yMm: completedDrag.preview.y,
      }, "Building-outline vertex move committed");
    } else {
      interactionMessage = "Building outline selected; model unchanged";
      render();
    }
    event.preventDefault();
    return;
  }
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const completedDrag = dragState;
  dragState = null;
  suppressNextClick = true;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (completedDrag.preview.x !== completedDrag.start.x || completedDrag.preview.y !== completedDrag.start.y) {
    commitCommand({
      type: "wall.moveNode",
      nodeId: completedDrag.nodeId,
      xMm: completedDrag.preview.x,
      yMm: completedDrag.preview.y,
    }, "Shared endpoint move committed");
  } else {
    interactionMessage = "Endpoint selected; model unchanged";
    render();
  }
  event.preventDefault();
});

canvas.addEventListener("pointercancel", cancelActivePointer);
canvas.addEventListener("lostpointercapture", () => {
  if (dragState) cancelPointEdit();
  if (floorAreaDragState) cancelFloorAreaPointEdit();
  if (componentDragState) cancelComponentMove();
  if (routePointDragState) cancelRoutePointMove();
  if (routePointDragState) cancelRoutePointMove();
  if (referenceCropState?.pointerId !== null && referenceCropState?.pointerId !== undefined) {
    referenceCropState.pointerId = null;
    referenceCropState.startSourcePoint = null;
    referenceCropState.currentSourcePoint = null;
    interactionMessage = "Crop drag cancelled; project unchanged";
    render();
  }
  panState = null;
});

canvas.addEventListener("click", (event) => {
  canvas.focus();
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  if (activeTask === "ventilation") {
    if (activeTool === "routing-exclusion") {
      addRoutingExclusionCorner(eventToGridWorld(event));
      return;
    }
    const exclusionId = event.target?.dataset?.routingExclusionId;
    if (activeTool === "select" && exclusionId) {
      selectedRoutingExclusionId = exclusionId;
      selectedRouteId = null;
      mechanicalState = clearMechanicalSelection(mechanicalState);
      interactionMessage = "Routing exclusion selected; use Edit or Remove in Routing coordination";
      render();
      return;
    }
    const addPointTarget = event.target.closest?.(".route-add-point");
    if (activeTool === "select" && addPointTarget) {
      addRoutePointAtSegment(addPointTarget);
      return;
    }
    if (activeTool === "place-component" || activeTool === "place-assembly" || activeTool === "route") {
      handleMechanicalClick(event);
      return;
    }
    const mechanicalHit = mechanicalHitFromTarget(event.target);
    if (mechanicalHit?.kind === "component" || mechanicalHit?.kind === "port") {
      mechanicalState = handleMechanicalCanvasClick(mechanicalState, {
        point: eventToGridWorld(event),
        hit: mechanicalHit,
      }).state;
      selectedFloorAreaId = null;
      selectedRouteId = null;
      selectedRoutePointIndex = null;
      interactionMessage = "Catalogue component selected";
    } else {
      const routeId = routeIdFromPointerEvent(event);
      mechanicalState = clearMechanicalSelection(mechanicalState);
      selectedRouteId = routeId;
      selectedRoutePointIndex = null;
      interactionMessage = routeId
        ? "Duct route selected; its drawn single/twin arrangement can be edited in the inspector"
        : "Building geometry is locked in Ventilation; use Plan to edit walls, rooms and zones";
    }
    render();
    return;
  }
  if (activeTool === "calibrate") {
    addCalibrationPoint(event);
    return;
  }
  if (activeTool === "wall" || activeTool === "room-divider") {
    addDraftPoint(event);
    return;
  }
  if (activeTool === "floor-area") {
    addFloorAreaDraftPoint(event);
    return;
  }
  if (activeTool === "place-component" || activeTool === "place-assembly" || activeTool === "route") {
    handleMechanicalClick(event);
    return;
  }
  const mechanicalHit = mechanicalHitFromTarget(event.target);
  if (mechanicalHit?.kind === "component" || mechanicalHit?.kind === "port") {
    mechanicalState = handleMechanicalCanvasClick(mechanicalState, {
      point: eventToGridWorld(event),
      hit: mechanicalHit,
    }).state;
    selectedWallId = null;
    selectedNodeId = null;
    selectedFloorAreaId = null;
    selectedRouteId = null;
    selectedRoutePointIndex = null;
    interactionMessage = "Catalogue component selected";
    render();
    return;
  }
  if (
    event.target?.dataset?.roomId ||
    event.target?.dataset?.zoneId ||
    event.target?.dataset?.roomBoundaryKey ||
    event.target?.dataset?.zoneBoundaryKey
  ) {
    handleRoomCanvasClick(event);
    return;
  }
  if (event.target?.dataset?.floorAreaId) {
    selectedFloorAreaId = event.target.dataset.floorAreaId;
    selectedWallId = null;
    selectedNodeId = null;
    selectedRoomId = null;
    selectedZoneId = null;
    mechanicalState = clearMechanicalSelection(mechanicalState);
    interactionMessage = "Preliminary building outline selected";
    render();
    return;
  }
  if (event.target.classList.contains("wall-node")) {
    selectedNodeId = event.target.dataset.nodeId;
    selectedWallId = null;
    selectedRoomId = null;
    selectedZoneId = null;
    selectedFloorAreaId = null;
    mechanicalState = clearMechanicalSelection(mechanicalState);
  } else if (event.target.classList.contains("wall")) {
    selectedWallId = event.target.dataset.wallId;
    selectedNodeId = null;
    selectedRoomId = null;
    selectedZoneId = null;
    selectedFloorAreaId = null;
    mechanicalState = clearMechanicalSelection(mechanicalState);
  } else {
    selectedWallId = null;
    selectedNodeId = null;
    selectedRoomId = null;
    selectedZoneId = null;
    selectedFloorAreaId = null;
    mechanicalState = clearMechanicalSelection(mechanicalState);
  }
  interactionMessage = "";
  render();
});

document.addEventListener("keydown", (event) => {
  if (mvhrDialog.open) return;
  if (!sheetPreviewPanel.hidden) {
    if (event.key === "Escape") {
      closeSheetPreview();
      event.preventDefault();
    }
    return;
  }
  if (deleteWallDialog.open) {
    if (event.key === "Escape") {
      deleteWallDialog.close("cancel");
      event.preventDefault();
    }
    return;
  }
  if (deleteComponentDialog.open) {
    if (event.key === "Escape") {
      deleteComponentDialog.close("cancel");
      event.preventDefault();
    }
    return;
  }
  if (clearVentilationDialog.open) {
    if (event.key === "Escape") {
      clearVentilationDialog.close("cancel");
      event.preventDefault();
    }
    return;
  }
  if (openConfirmDialog.open) {
    if (event.key === "Escape") {
      openConfirmDialog.close("cancel");
      event.preventDefault();
    }
    return;
  }
  if (calibrationDialog.open) {
    if (event.key === "Escape") {
      cancelCalibration("Calibration cancelled; model unchanged");
      event.preventDefault();
    }
    return;
  }
  if (roomDialog.open) {
    if (event.key === "Escape") {
      cancelRoomDialog("Room or zone change cancelled; project unchanged");
      event.preventDefault();
    }
    return;
  }
  if (floorAreaDialog.open) {
    if (event.key === "Escape") {
      cancelFloorAreaDialog("Floor area change cancelled; project unchanged");
      event.preventDefault();
    }
    return;
  }
  if (removeFloorAreaDialog.open) {
    if (event.key === "Escape") {
      removeFloorAreaDialog.close("cancel");
      event.preventDefault();
    }
    return;
  }
  if (removeRoomDialog.open) {
    if (event.key === "Escape") {
      removeRoomDialog.close("cancel");
      event.preventDefault();
    }
    return;
  }
  if (event.code === "Space" && !isTextInput(event.target)) {
    spacePressed = true;
    event.preventDefault();
    return;
  }
  if (isTextInput(event.target)) return;
  if (activeTask === "ventilation") {
    if (event.key.toLowerCase() === "v") {
      setTool("select");
      event.preventDefault();
    } else if (event.key === "0") {
      fitView();
      event.preventDefault();
    } else if ((event.key === "Delete" || event.key === "Backspace") && activeTool === "select" && mechanicalState.selectedComponentId) {
      openComponentDeleteDialog();
      event.preventDefault();
    } else if ((event.key === "Delete" || event.key === "Backspace") && activeTool === "select" && selectedRouteId) {
      deleteSelectedDuctRun();
      event.preventDefault();
    } else if (event.key.toLowerCase() === "r" && activeTool === "select" && mechanicalState.selectedComponentId) {
      rotateSelectedComponent();
      event.preventDefault();
    } else if (event.key === "Escape") {
      if (routePointDragState) {
        cancelRoutePointMove();
      } else if (componentDragState) {
        cancelComponentMove();
      } else if (activeTool === "place-component" || activeTool === "place-assembly" || activeTool === "route") {
        mechanicalState = cancelMechanicalOperation(mechanicalState);
        setTool("select");
        interactionMessage = "Ventilation operation cancelled; committed model unchanged";
        render();
      } else {
        setTool("select");
      }
      event.preventDefault();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      if (event.shiftKey ? canRedo(history) : canUndo(history)) {
        applyHistoryChange(event.shiftKey ? redoCommand(history) : undoCommand(history), event.shiftKey ? "Redo saved locally" : "Undo saved locally");
      }
      event.preventDefault();
    }
    return;
  }
  if (!event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "w") {
    setTool("wall");
    event.preventDefault();
  } else if (!event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "a") {
    setTool("floor-area");
    event.preventDefault();
  } else if (!event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "d") {
    setTool("room-divider");
    event.preventDefault();
  } else if (!event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "s") {
    toggleSnap();
    event.preventDefault();
  } else if (event.key.toLowerCase() === "v") {
    setTool("select");
    event.preventDefault();
  } else if (event.key === "0") {
    fitView();
    event.preventDefault();
  } else if (event.key === "Enter" && (activeTool === "wall" || activeTool === "room-divider")) {
    if (activeTool === "room-divider") commitRoomDivider();
    else commitWallChain();
    event.preventDefault();
  } else if (event.key === "Enter" && activeTool === "floor-area") {
    stageFloorAreaCreation();
    event.preventDefault();
  } else if (event.key === "Backspace" && (activeTool === "wall" || activeTool === "room-divider")) {
    draftPoints.pop();
    if (draftPoints.length === 0) activeChainId = null;
    interactionMessage = "Draft point removed; committed model unchanged";
    renderDraft();
    updateStatus();
    event.preventDefault();
  } else if (event.key === "Backspace" && activeTool === "floor-area") {
    floorAreaDraftPoints.pop();
    interactionMessage = "Building-outline draft point removed; committed model unchanged";
    renderDraft();
    updateStatus();
    event.preventDefault();
  } else if ((event.key === "Delete" || event.key === "Backspace") && activeTool === "select" && mechanicalState.selectedComponentId) {
    openComponentDeleteDialog();
    event.preventDefault();
  } else if ((event.key === "Delete" || event.key === "Backspace") && activeTool === "select" && selectedRouteId) {
    deleteSelectedDuctRun();
    event.preventDefault();
  } else if ((event.key === "Delete" || event.key === "Backspace") && activeTool === "select" && selectedWallId) {
    openWallDeleteDialog();
    event.preventDefault();
  } else if (event.key.toLowerCase() === "r" && activeTool === "select" && mechanicalState.selectedComponentId) {
    rotateSelectedComponent();
    event.preventDefault();
  } else if (event.key === "Escape") {
    if (activeTool === "crop-reference") {
      cancelReferenceCrop("PDF crop cancelled; project unchanged");
    } else if (activeTool === "calibrate") {
      cancelCalibration("Calibration cancelled; model unchanged");
    } else if (routePointDragState) {
      cancelRoutePointMove();
    } else if (componentDragState) {
      cancelComponentMove();
    } else if (dragState) {
      cancelPointEdit();
    } else if (floorAreaDragState) {
      cancelFloorAreaPointEdit();
    } else if (activeTool === "place-component" || activeTool === "place-assembly" || activeTool === "route") {
      mechanicalState = cancelMechanicalOperation(mechanicalState);
      setTool("select");
      interactionMessage = "Mechanical operation cancelled; committed model unchanged";
      render();
    } else if (draftPoints.length > 0 || floorAreaDraftPoints.length > 0) {
      cancelDraft("Drawing draft cancelled; committed model unchanged");
    } else if (reassignRoomId || reassignZoneId) {
      reassignRoomId = null;
      reassignZoneId = null;
      interactionMessage = "Boundary reassignment cancelled; project unchanged";
      render();
    } else {
      setTool("select");
    }
    event.preventDefault();
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    if (event.shiftKey ? !canRedo(history) : !canUndo(history)) {
      interactionMessage = event.shiftKey ? "Nothing to redo" : "Nothing to undo";
      updateStatus();
      event.preventDefault();
      return;
    }
    const nextHistory = event.shiftKey ? redoCommand(history) : undoCommand(history);
    applyHistoryChange(nextHistory, event.shiftKey ? "Redo saved locally" : "Undo saved locally");
    event.preventDefault();
  }
});

document.addEventListener("keyup", (event) => {
  if (event.code === "Space") spacePressed = false;
});

function createInitialProject(projectId = PROJECT_ID) {
  return applyCommand(createProject(projectId), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Synthetic Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "synthetic local shell") },
        orientation: identityQuaternion(),
      },
    },
  });
}

function setTask(task) {
  if (!["project", "plan", "ventilation", "three-d", "catalogue", "checks", "account"].includes(task)) throw new TypeError(`Unsupported task: ${task}`);
  if (!sheetPreviewPanel.hidden) {
    sheetPreviewPanel.hidden = true;
    sheetsNavigationButton.classList.remove("active");
  }
  activeTask = task;
  queueWorkingSession();
  document.querySelector("#account-workspace").hidden=task!=="account";
  document.querySelector("#account-nav").classList.toggle("active",task==="account");
  if(task==="ventilation" && history.present.components.some(c=>!c.ports.length&&["luna-grille","wall-grille"].includes(c.displaySymbol?.shape))) {
    commitCommand({type:"terminal.enableDrawingConnections"},"90 mm terminal drawing connections enabled · Undo restores prior symbols");
  }
  if(task==="ventilation" && history.present.components.some(pendingMountedCwConnections)) {
    commitCommand({type:"component.enableMountedCwDrawingConnections"},"CW DN90 drawing snap targets enabled · Undo restores prior symbols");
  }
  if(task==="ventilation" && history.present.components.some(needsCombinedGrilleSpacing)) {
    commitCommand({type:"component.matchCombinedGrilleSpacing"},"DN160 combined grille ports matched to Q350 spacing · connected ducts follow · Undo available");
  }
  projectNavigationButton.classList.toggle("active", task === "project");
  planNavigationButton.classList.toggle("active", task === "plan");
  ventilationNavigationButton.classList.toggle("active", task === "ventilation");
  threeDNavigationButton.classList.toggle("active", task === "three-d");
  catalogueNavigationButton.classList.toggle("active", task === "catalogue");
  checksNavigationButton.classList.toggle("active", task === "checks");
  projectWorkspace.hidden = task !== "project";
  planWorkspace.hidden = task === "project" || task === "catalogue" || task === "checks" || task === "three-d" || task === "account";
  catalogueWorkspace.hidden = task !== "catalogue";
  checksWorkspace.hidden = task !== "checks";
  threeDWorkspace.hidden = task !== "three-d";
  if (task === "account") {cancelActivePointer();return;}
  if (task === "project") {
    cancelActivePointer();
    mechanicalState = clearMechanicalSelection(mechanicalState);
    selectedWallId = null;
    selectedNodeId = null;
    selectedFloorAreaId = null;
    selectedRoomId = null;
    selectedZoneId = null;
    selectedRouteId = null;
    selectedRoutePointIndex = null;
    renderProjectWorkspace();
    workflowOpenPlanButton.focus();
    return;
  }
  if (task === "catalogue") {
    cancelActivePointer();
    mechanicalState = clearMechanicalSelection(mechanicalState);
    selectedWallId = null;
    selectedNodeId = null;
    selectedFloorAreaId = null;
    selectedRoomId = null;
    selectedZoneId = null;
    selectedRouteId = null;
    selectedRoutePointIndex = null;
    renderCatalogueLibrary();
    catalogueLibrarySearch.focus();
    return;
  }
  if (task === "checks") {
    cancelActivePointer();
    mechanicalState = clearMechanicalSelection(mechanicalState);
    selectedWallId = null;
    selectedNodeId = null;
    selectedFloorAreaId = null;
    selectedRoomId = null;
    selectedZoneId = null;
    selectedRouteId = null;
    selectedRoutePointIndex = null;
    renderChecksWorkspace();
    checksReturnVentilationButton.focus();
    return;
  }
  if (task === "three-d") {
    cancelActivePointer();
    mechanicalState = clearMechanicalSelection(mechanicalState);
    selectedWallId = null;
    selectedNodeId = null;
    selectedFloorAreaId = null;
    selectedRoomId = null;
    selectedZoneId = null;
    selectedRouteId = null;
    selectedRoutePointIndex = null;
    renderThreeDWorkspace();
    threeDReturnButton.focus();
    return;
  }
  drawToolsSection.hidden = task !== "plan";
  mechanicalToolsSection.hidden = task !== "ventilation";
  floorAreaToolsSection.hidden = task !== "plan";
  roomToolsSection.hidden = task !== "plan";
  referenceToolsSection.hidden = task !== "plan";
  selectedWallId = null;
  selectedNodeId = null;
  selectedFloorAreaId = null;
  selectedRouteId = null;
  selectedRoutePointIndex = null;
  mechanicalState = clearMechanicalSelection(mechanicalState);
  if (task !== "plan") {
    selectedRoomId = null;
    selectedZoneId = null;
    reassignRoomId = null;
    reassignZoneId = null;
  }
  setTool("select");
  interactionMessage = task === "ventilation"
      ? "MVHR system tools active; building geometry is visible and locked"
      : "Plan tools active: references, walls, room dividers and room naming share this canvas";
  render();
  initialCameraFit.request();
}

function startPreliminaryLayout() {
  if (history.present.workflow.stage !== "quick-quote") return;
  if (commitCommand({ type: "workflow.startPreliminaryLayout" }, "Preliminary ventilation layout stage started; rooms remain optional")) {
    setTask("ventilation");
  }
}

function openVentilationTask() {
  if (history.present.workflow.stage === "quick-quote") {
    startPreliminaryLayout();
    return;
  }
  setTask("ventilation");
}

function saveQuoteInputs(event) {
  event.preventDefault();
  quoteInputError.textContent = "";
  try {
    const quoteDraft = {
      ...history.present.quoteDraft,
      scopeExclusions: quoteExclusionsInput.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      scopeReviewed: quoteScopeReviewedInput.checked,
    };
    commitCommand({ type: "quote.updateDraft", quoteDraft }, "Scope notes updated; converted baselines remain unchanged");
    renderProjectWorkspace();
  } catch (error) {
    quoteInputError.textContent = error.message;
  }
}

function openProjectConversionDialog() {
  if (history.present.workflow.stage !== "preliminary-layout") return;
  const quote = inspectQuickQuote(history.present);
  convertProjectSummary.textContent = `${formatArea(quote.areaMm2)} serviced area across ${quote.outlineBasis.length} floor outline${quote.outlineBasis.length === 1 ? "" : "s"}. The current MVHR plan markup will carry forward unchanged.`;
  convertProjectDialog.showModal();
  confirmProjectConversionButton.focus();
}

function applyProjectConversionChoice() {
  if (convertProjectDialog.returnValue !== "convert") {
    interactionMessage = "Project conversion cancelled; project and quote baseline unchanged";
    renderProjectWorkspace();
    return;
  }
  if (history.present.workflow.convertedQuoteSnapshotId !== null) return;
  commitCommand({
    type: "workflow.convertToProject",
    quoteSnapshotId: `quote-baseline-${history.present.quoteSnapshots.length + 1}`,
    createdAtUtc: new Date().toISOString(),
  }, "Quote converted to a project without redrawing; immutable local baseline preserved");
  renderProjectWorkspace();
}

function startDetailedDesign() {
  if (history.present.workflow.stage !== "project-converted") return;
  commitCommand({ type: "workflow.startDetailedDesign" }, "Detailed room-design stage started; preliminary objects preserved");
  setTask("plan");
}

function linkExistingOutletsByPosition() {
  if (history.present.workflow.stage !== "detailed-design") return;
  commitCommand(
    { type: "terminal.assignUnassignedByPosition" },
    "Existing unassigned outlets linked to one compatible containing room where unambiguous; no airflow inferred",
  );
  renderProjectWorkspace();
}

function renderProjectWorkspace() {
  renderProjectLibrary();
  const details=history.present.projectDetails,form=document.querySelector("#project-details-form");
  for(const key of ["name","address","clientName","projectReference"])form.elements.namedItem(key).value=details[key] || (key==="name"?currentProjectName:"");
  const project = history.present;
  const quote = inspectQuickQuote(project);
  const detailed = inspectDetailedDesign(project);
  workflowStagePill.textContent = stageLabel(project.workflow.stage);
  workflowReadiness.textContent = stageReadiness(project, quote, detailed);
  workflowStartPreliminaryButton.disabled = project.workflow.stage !== "quick-quote";
  workflowConvertButton.disabled = project.workflow.stage !== "preliminary-layout" || !quote.spatialReady;
  workflowStartDetailedButton.disabled = project.workflow.stage !== "project-converted";
  workflowLinkOutletsButton.disabled = project.workflow.stage !== "detailed-design" || detailed.unassignedOutletCount === 0 || (detailed.roomCount + detailed.zoneCount === 0);

  quoteExclusionsInput.value = project.quoteDraft.scopeExclusions.join("\n");
  quoteScopeReviewedInput.checked = project.quoteDraft.scopeReviewed;
  workflowSetScaleButton.disabled = history.present.floorReferences.length === 0;

  renderWorkflowRows(quoteSummary, [
    ["Serviced floor area", formatArea(quote.areaMm2)],
    ["Floor outlines", String(quote.outlineBasis.length)],
    ["Scale", quote.outlineBasis.length === 0 ? "Set after upload" : quote.outlineBasis.every((item) => item.scaleEvidence !== "manual-project-grid") ? "Reference scale recorded" : "Manual project grid"],
    ["Scope exclusions", project.quoteDraft.scopeReviewed ? (project.quoteDraft.scopeExclusions.join(", ") || "Reviewed — none") : "Not reviewed"],
  ]);
  const missing = quote.missingSpatialInputs;
  quoteMissing.textContent = missing.length ? `Still needed: ${missing.join("; ")}.` : "";

  const snapshot = detailed.snapshot;
  renderWorkflowRows(quoteSnapshotSummary, snapshot === null ? [
    ["Baseline", "Not converted yet"],
  ] : [
    ["Baseline ID", snapshot.id],
    ["Created", new Date(snapshot.createdAtUtc).toLocaleString()],
    ["Serviced area", formatArea(snapshot.areaMm2)],
    ["Preliminary outlets / routes", `${snapshot.preliminaryAllowances.outletCount} / ${snapshot.preliminaryAllowances.routeCount}`],
  ]);

  const differenceText = detailed.differences === null
    ? "No converted baseline"
    : `${signedCount(detailed.differences.outletCount)} outlets · ${signedCount(detailed.differences.routeCount)} routes · ${signedCount(detailed.differences.knownDuctRunCount)} known duct runs`;
  renderWorkflowRows(detailedDesignSummary, [
    ["Rooms / zones", `${detailed.roomCount} / ${detailed.zoneCount}`],
    ["Assigned outlets", `${detailed.assignedOutletCount} of ${detailed.current.outletCount}`],
    ["Changes from baseline", differenceText],
  ]);
  detailedDesignUnresolved.textContent = detailed.unresolvedRequirements.join(" ");
}

function renderProjectLibrary() {
  currentProjectNameElement.textContent = currentProjectName;
  currentProjectIdElement.textContent = `${history.present.id} · ${projectHasUnsavedChanges() ? "unsaved changes" : "saved checkpoint"}`;
  const listed = projectLibrary.listProjects();
  document.querySelector("#legacy-device-projects").hidden=!listed.ok||listed.projects.length===0;
  if (!listed.ok) {
    const failure = document.createElement("p");
    failure.className = "project-library-empty";
    failure.textContent = `Project list unavailable: ${listed.message}`;
    projectLibraryList.replaceChildren(failure);
    return;
  }
  if (listed.projects.length === 0) {
    const empty = document.createElement("p");
    empty.className = "project-library-empty";
    empty.textContent = "No named projects have been saved in this browser yet.";
    projectLibraryList.replaceChildren(empty);
    return;
  }
  projectLibraryList.replaceChildren(...listed.projects.map((metadata) => {
    const row = document.createElement("div");
    row.className = `project-library-entry${metadata.id === history.present.id ? " active" : ""}`;
    const copy = document.createElement("div");
    copy.className = "project-library-entry-copy";
    const name = document.createElement("strong");
    name.textContent = metadata.name;
    const saved = document.createElement("span");
    saved.textContent = `Last saved ${formatSavedAt(metadata.lastSavedAtUtc)}`;
    const id = document.createElement("small");
    id.textContent = metadata.id;
    copy.append(name, saved, id);
    const open = document.createElement("button");
    open.type = "button";
    open.dataset.openProjectId = metadata.id;
    open.textContent = metadata.id === history.present.id && !projectHasUnsavedChanges() ? "Open" : "Open project";
    row.append(copy, open);
    return row;
  }));
}

function openProjectNameDialog(mode) {
  projectNameMode = mode;
  projectNameTitle.textContent = mode === "new" ? "New project" : mode === "rename" ? "Rename project" : "Save project as";
  projectNameSummary.textContent = mode === "new"
    ? "Start a new drawing. Choose Save to add it to your projects."
    : mode === "rename"
      ? "Change the project name."
      : "Save a separate copy of this drawing.";
  projectNameInput.value = mode === "new" ? "Untitled project" : mode === "save-as" ? `${currentProjectName} copy` : currentProjectName;
  projectNameError.textContent = "";
  projectNameDialog.showModal();
  projectNameInput.select();
}

function closeProjectNameDialog() {
  projectNameMode = null;
  projectNameDialog.close();
}

async function applyProjectNameChoice(event) {
  event.preventDefault();
  projectNameError.textContent = "";
  let name;
  try {
    name = validateProjectName(projectNameInput.value);
  } catch (error) {
    projectNameError.textContent = error.message;
    return;
  }
  const mode = projectNameMode;
  closeProjectNameDialog();
  if (mode === "new") {
    requestProjectTransition(() => createCleanProject(name), "Creating a new project will replace the current workspace and cancel incomplete drawing operations.");
    return;
  }
  if (mode === "rename") {
    currentProjectName = name;
    commitCommand({type:"project.updateDetails",details:{...history.present.projectDetails,name}},"Project renamed");
    await saveExplicit();
    render();
    return;
  }
  if (mode === "save-as") saveCurrentProjectAs(name);
}

function createCleanProject(name) {
  const project = createInitialProject(createOpaqueProjectId());
  project.projectDetails.name=name;
  currentProjectName = name;
  savedProjectName = null;
  savedProjectJson = null;
  portableDirty = true;
  applyLocalReopen({ project }, { named: false, message: `Created clean project “${name}”; choose Save to keep it in this browser` });
  savePresent("automatic");
}

async function saveCurrentProjectAs(name) {
  const copy = deserializeProject(serializeProject({
    ...structuredClone(history.present),
    id: createOpaqueProjectId(),
    projectDetails:{...history.present.projectDetails,name},
  }));
  if(cloudSession?.workspace) {
    const previousHistory=history,oldName=currentProjectName,oldRecord=currentCloudRecord;
    history=createCommandHistory(copy);currentProjectName=name;currentCloudRecord=null;cloudBindingVersion++;
    if(!await saveExplicit()){history=previousHistory;currentProjectName=oldName;currentCloudRecord=oldRecord;cloudBindingVersion++;}
    queueWorkingSession();render();return;
  }
  const saved = projectLibrary.saveProject(copy, name);
  if (!saved.ok) {
    storageState = { kind: "failed", label: "Save As failed", detail: "Current project preserved" };
    interactionMessage = `Save As failed; current project preserved: ${saved.message}`;
    render();
    return;
  }
  portableDirty = true;
  applyLocalReopen(saved, { named: true, message: `Created independent project copy “${name}”` });
  localStore.save(copy);
}

function openProjectFromLibraryClick(event) {
  const button = event.target.closest?.("[data-open-project-id]");
  if (!button) return;
  const projectId = button.dataset.openProjectId;
  if (projectId === history.present.id && !projectHasUnsavedChanges()) {
    interactionMessage = "That project is already open";
    render();
    return;
  }
  const loaded = projectLibrary.loadProject(projectId);
  if (!loaded.ok || !loaded.found) {
    interactionMessage = `Open failed; current project preserved: ${loaded.message ?? "saved project not found"}`;
    render();
    return;
  }
  requestProjectTransition(() => {
    portableDirty = true;
    document.querySelector("#cloud-projects-dialog").close();
    applyLocalReopen(loaded, { named: true });
  }, `Opening “${loaded.name}” will replace the current workspace and cancel incomplete drawing operations.`);
}

function requestProjectTransition(transition, message) {
  const needsGuard = requiresProjectReplacementConfirmation({
    committedProjectChanged: projectHasUnsavedChanges(),
    wallDraftPointCount: draftPoints.length + floorAreaDraftPoints.length,
    wallNodeDragActive: Boolean(dragState || floorAreaDragState),
    componentDragActive: Boolean(componentDragState || routePointDragState),
    routeDraftActive: Boolean(mechanicalState.routeDraft),
    calibrationActive: activeTool === "calibrate",
    placementActive: activeTool === "place-component" || activeTool === "place-assembly",
  });
  if (!needsGuard) {
    transition();
    return;
  }
  pendingProjectTransition = transition;
  openConfirmMessage.textContent = `${message} Save the current named project first, discard the changes, or cancel.`;
  openConfirmDialog.showModal();
}

function renderWorkflowRows(container, rows) {
  container.replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement("div");
    row.className = "workflow-data-row";
    const name = document.createElement("span");
    name.textContent = label;
    const detail = document.createElement("strong");
    detail.textContent = value;
    row.append(name, detail);
    return row;
  }));
}

function stageLabel(stage) {
  return ({
    "quick-quote": "Quick quote",
    "preliminary-layout": "Preliminary layout",
    "project-converted": "Converted project",
    "detailed-design": "Detailed design",
  })[stage];
}

function stageReadiness(project, quote, detailed) {
  if (project.workflow.stage === "quick-quote") {
    return quote.spatialReady
      ? "Serviced area and scope are ready. Mark up the MVHR system next; rooms are not required."
      : "Upload the floor plan, set scale, trace a closed serviced-area perimeter and review exclusions; rooms are not required.";
  }
  if (project.workflow.stage === "preliminary-layout") {
    return "Place provisional MVHR equipment, outlets and routes. Rooms and airflow calculations are not required at this stage.";
  }
  if (project.workflow.stage === "project-converted") {
    return "The plan, quote and preliminary layout are carried forward under stable identities. Start detailed design when room work is ready.";
  }
  return `${detailed.assignedOutletCount} of ${detailed.current.outletCount} outlets are linked to rooms or zones. Review every change from the converted baseline.`;
}

function signedCount(value) {
  return value > 0 ? `+${value}` : String(value);
}

function openSheetPreview() {
  try {
    const floor = history.present.floors.find((candidate) => candidate.id === "floor-ground")
      ?? history.present.floors[0];
    if (!floor) throw new TypeError("The project has no floor to preview");
    const sheet = createA3SheetModel(history.present, {
      floorId: floor.id,
      orientation: "landscape",
      projectName: history.present.projectDetails.name || currentProjectName,
      siteName: history.present.projectDetails.address || "Not set",
      clientName: history.present.projectDetails.clientName || "Not set",
      company:cloudSession?.companyProfile?.details,
      companyLogoDataUrl:cloudSession?.companyProfile?.logoDataUrl,
      includeSchedule:false,
      drawingTitle: `${floor.name} Manual MVHR Plan`,
      drawingId: `${history.present.projectDetails.projectReference || "V"}-01`,
      issueDate: new Date().toISOString().slice(0, 10),
      status: "Preliminary — not for construction",
      revision: "DRAFT",
      revisionText: "Working-draft preview",
      drawnBy: "",
      checkedBy: "",
    });
    const parser = new DOMParser();
    const partsPages=createA4PartsListPages(sheet);
    const drawingSvg=renderA3SheetSvg(sheet).replace('</svg>',`<text x="12" y="293" font-size="2.3" fill="#687880">Page 1 of ${partsPages.length+1} · A3</text></svg>`);
    const pages=[{svg:drawingSvg,className:"sheet-a3",label:"Page 1 · A3 drawing"},...partsPages.map(page=>({svg:renderA4PartsListSvg(sheet,page),className:"sheet-a4",label:`Page ${page.pageNumber} · A4 parts list`}))];
    const elements=pages.map(page=>{
      const documentSvg=parser.parseFromString(page.svg,"image/svg+xml");
      if(documentSvg.querySelector("parsererror"))throw new TypeError("Generated sheet SVG could not be parsed");
      const element=document.createElement("section");element.className=`sheet-page ${page.className}`;
      const label=document.createElement("div");label.className="sheet-page-label";label.textContent=page.label;
      element.append(label,document.importNode(documentSvg.documentElement,true));return element;
    });
    sheetPreviewHost.replaceChildren(...elements);
    sheetPreviewStatus.textContent = `${partsPages.length+1} pages · ${sheet.fit.label} · ${sheet.partsSchedule.componentLines.length} part lines · ${sheet.partsSchedule.routeLines.length} duct lines · scene ${sheet.printSceneFingerprint} · committed objects only`;
    projectWorkspace.hidden = true;
    document.querySelector("#account-workspace").hidden=true;
    document.querySelector("#account-nav").classList.remove("active");
    planWorkspace.hidden = true;
    catalogueWorkspace.hidden = true;
    checksWorkspace.hidden = true;
    sheetPreviewPanel.hidden = false;
    queueWorkingSession();
    projectNavigationButton.classList.remove("active");
    planNavigationButton.classList.remove("active");
    ventilationNavigationButton.classList.remove("active");
    catalogueNavigationButton.classList.remove("active");
    checksNavigationButton.classList.remove("active");
    sheetsNavigationButton.classList.add("active");
    closeSheetPreviewButton.focus();
  } catch (error) {
    interactionMessage = `Sheet preview unavailable: ${error.message}`;
    updateStatus();
  }
}

function closeSheetPreview() {
  setTask("plan");
}

function printSheetPreview() {
  if (sheetPreviewPanel.hidden) return;
  window.print();
}

function createStore() {
  try {
    compactExistingProjectStorage(window.localStorage);
    return createLocalProjectStore(createCompactProjectStorage(window.localStorage));
  } catch (error) {
    const unavailable = {
      getItem() { throw error; },
      setItem() { throw error; },
      removeItem() { throw error; },
    };
    return createLocalProjectStore(unavailable);
  }
}

function createProjectLibrary() {
  try {
    return createLocalProjectLibrary(createCompactProjectStorage(window.localStorage));
  } catch (error) {
    const unavailable = {
      getItem() { throw error; },
      setItem() { throw error; },
      removeItem() { throw error; },
    };
    return createLocalProjectLibrary(unavailable);
  }
}

function initialStorageState(result) {
  if (!result.ok) return { kind: "failed", label: "Local recovery unavailable", detail: result.message };
  if (!result.found && !result.savedAtUtc) return { kind: "unsaved", label: "Unsaved project · this browser", detail: "Choose Save to create a named project" };
  if (result.portableBudget?.portable === false) {
    return {
      kind: "warning",
      label: result.recoveredFromInvalidCurrent
        ? "Recovered oversized legacy save"
        : "Oversized legacy draft preserved",
      detail: `${result.portableBudget.totalBytes.toLocaleString()} / ${result.portableBudget.maximumBytes.toLocaleString()} portable bytes · export blocked`,
    };
  }
  if (result.recoveredFromInvalidCurrent) {
    return {
      kind: "warning",
      label: "Recovered previous device save",
      detail: `${formatSavedAt(result.savedAtUtc)} · current record was invalid`,
    };
  }
  return {
    kind: "saved",
    label: `Saved · ${result.name ?? currentProjectName}`,
    detail: `${formatSavedAt(result.savedAtUtc)} · this browser only · not cloud`,
  };
}

function setTool(tool, options = {}) {
  if (tool === "room-divider") {
    if (activeTask !== "plan") return;
    const selectedZone = history.present.zones.find((zone) => zone.id === selectedZoneId);
    if (selectedZone) selectedRoomId = selectedZone.parentRoomId;
    if (!history.present.rooms.some((room) => room.id === selectedRoomId)) {
      const currentRooms = history.present.rooms.filter(
        (room) => inspectRoomBoundary(history.present, room).status === "current",
      );
      if (currentRooms.length === 1) selectedRoomId = currentRooms[0].id;
      else {
        interactionMessage = "Select one confirmed room before drawing its nonphysical divider";
        updateStatus();
        return;
      }
    }
    selectedZoneId = null;
  }
  if (tool === "floor-area") {
    if (activeTask !== "plan") return;
    const floor = currentFloor();
    const existing = floor && history.present.floorAreaOutlines.find((outline) => outline.floorId === floor.id);
    if (existing) {
      selectedFloorAreaId = existing.id;
      selectedWallId = null;
      selectedNodeId = null;
      selectedRoomId = null;
      selectedZoneId = null;
      interactionMessage = "This floor already has its one supported outline; drag its vertices or remove it before drawing another";
      setTool("select");
      interactionMessage = "This floor already has its one supported outline; drag its vertices or remove it before drawing another";
      render();
      return;
    }
  }
  if (tool !== activeTool && (draftPoints.length > 0 || floorAreaDraftPoints.length > 0)) {
    cancelDraft("Changing tools cancelled the incomplete drawing draft");
  }
  if (tool !== "routing-exclusion") routingExclusionDraftStart = null;
  if (activeTool === "calibrate" && tool !== "calibrate") calibrationState = null;
  if (activeTool === "crop-reference" && tool !== "crop-reference" && !referenceCropDialog.open) {
    referenceCropState = null;
  }
  if (dragState) cancelPointEdit();
  if (floorAreaDragState) cancelFloorAreaPointEdit();
  if (componentDragState) cancelComponentMove();
  if (tool === "place-component" || tool === "place-assembly" || tool === "route") {
    mechanicalState = activateMechanicalTool(mechanicalState, tool, options);
  } else if (tool === "select") {
    mechanicalState = activateMechanicalTool(mechanicalState, "select");
  } else {
    mechanicalState = cancelMechanicalOperation(mechanicalState);
  }
  mvhrPlacementMounting = null;
  standaloneCwPlacement = null;
  terminalPlacementShape = null;
  externalGrillePlacement = null;
  grilleAlignmentPreview = null;
  activeTool = tool;
  if (tool !== "select") selectedRoutePointIndex = null;
  if (tool === "pan") interactionMessage = "";
  selectButton.classList.toggle("active", tool === "select");
  wallButton.classList.toggle("active", tool === "wall");
  roomDividerButton.classList.toggle("active", tool === "room-divider");
  floorAreaButton.classList.toggle("active", tool === "floor-area");
  addRoutingExclusionButton.classList.toggle("active", tool === "routing-exclusion");
  panToolButton.classList.toggle("active", tool === "pan");
  selectButton.setAttribute("aria-pressed", String(tool === "select"));
  wallButton.setAttribute("aria-pressed", String(tool === "wall"));
  roomDividerButton.setAttribute("aria-pressed", String(tool === "room-divider"));
  floorAreaButton.setAttribute("aria-pressed", String(tool === "floor-area"));
  panToolButton.setAttribute("aria-pressed", String(tool === "pan"));
  canvas.classList.toggle("wall-mode", tool === "wall" || tool === "room-divider" || tool === "floor-area");
  canvas.classList.toggle("routing-exclusion-mode", tool === "routing-exclusion");
  canvas.classList.toggle("calibration-mode", tool === "calibrate");
  canvas.classList.toggle("crop-mode", tool === "crop-reference");
  canvas.classList.toggle("mechanical-mode", tool === "place-component" || tool === "place-assembly" || tool === "route");
  canvas.classList.toggle("pan-mode", tool === "pan");
  for (const button of catalogueButtons) {
    const active = (
      tool === "place-component" && button.dataset.catalogueItemId === options.catalogueItemId
    ) || (
      tool === "place-assembly" && button.dataset.assemblyTemplateId === options.assemblyTemplateId
    );
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  for (const button of routeButtons) {
    const active = tool === "route" && button.dataset.ductKind === options.ductKind;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  render();
  canvas.focus();
}

function toggleSnap() {
  if (!["plan","ventilation"].includes(activeTask)) return;
  snapEnabled = !snapEnabled;
  hoverPoint = null;
  snapToggleButton.classList.toggle("active", snapEnabled);
  snapToggleButton.setAttribute("aria-pressed", String(snapEnabled));
  snapToggleLabel.textContent = snapEnabled ? "Snap on" : "Snap off";
  snapToggleDetail.textContent = snapEnabled
    ? "Endpoints · walls · grid · DXF"
    : "Free placement";
  interactionMessage = activeTask === "ventilation"
    ? (snapEnabled ? "Snap on · align components and duct connections" : "Snap off · free component placement")
    : snapEnabled
      ? "Snap enabled; crossings and acquired wall targets become shared topology"
      : "Snap disabled; new clicks use free coordinates and crossings remain disconnected";
  renderDraft();
  updateStatus();
  canvas.focus();
}

function addDraftPoint(event) {
  if (activeChainId === null) activeChainId = identityCounter++;
  const resolved = resolvePointerPoint(event);
  const nodeId = resolved.nodeId ?? `wall-node-${activeChainId}-${draftPoints.length + 1}`;
  const previous = draftPoints.at(-1);
  if (previous && previous.nodeId === nodeId) {
    interactionMessage = "Choose a different endpoint; zero-length walls are not committed";
    updateStatus();
    return;
  }
  const split = resolved.wallId
    ? {
        wallId: resolved.wallId,
        nodeId,
        newWallId: `wall-${activeChainId}-split-${draftPoints.length + 1}`,
        point: { x: resolved.x, y: resolved.y },
      }
    : null;
  draftPoints.push({ x: resolved.x, y: resolved.y, nodeId, snapKind: resolved.snapKind, split });
  interactionMessage = resolved.nodeId
    ? `Endpoint snapped to ${resolved.nodeId}`
    : resolved.wallId
      ? `Wall interior acquired; ${resolved.wallId} will split only when the chain is committed`
      : resolved.snapKind === "free"
        ? "Free point added; no snap target acquired"
        : "Grid point added to wall draft";
  renderDraft();
  updateStatus();
}

function addFloorAreaDraftPoint(event) {
  if (floorAreaDraftPoints.length >= 3) {
    const first = floorAreaDraftPoints[0];
    const closingTarget = closestEndpoint(event, [{ ...first, nodeId: "floor-area-draft-first" }]);
    if (closingTarget) {
      stageFloorAreaCreation();
      return;
    }
  }
  const resolved = resolvePointerPoint(event);
  if (floorAreaDraftPoints.some(
    (point) => Math.hypot(point.x - resolved.x, point.y - resolved.y) <= 1e-6,
  )) {
    interactionMessage = floorAreaDraftPoints.length >= 3
      ? "Click the first outline point to close, or choose a new vertex"
      : "Choose a different outline vertex";
    updateStatus();
    return;
  }
  floorAreaDraftPoints.push({ x: resolved.x, y: resolved.y, snapKind: resolved.snapKind });
  interactionMessage = resolved.nodeId
    ? `Outline vertex snapped to ${resolved.nodeId}`
    : resolved.wallId
      ? `Outline vertex snapped to ${resolved.wallId} centreline; no wall connection is created`
      : resolved.snapKind === "free"
        ? "Free outline vertex added; no snap target acquired"
        : resolved.snapKind === "reference"
          ? "Outline vertex snapped to locked reference geometry"
          : "Grid point added to building-outline draft";
  renderDraft();
  updateStatus();
}

function stageFloorAreaCreation() {
  if (floorAreaDraftPoints.length < 3) {
    interactionMessage = "Add at least three outline vertices before closing the floor area";
    updateStatus();
    return;
  }
  const floor = currentFloor();
  if (!floor) {
    interactionMessage = "No floor is available for the building outline";
    updateStatus();
    return;
  }
  try {
    const provisional = floorAreaOutlineRecord({
      id: "floor-area-preview",
      floorId: floor.id,
      name: `${floor.name} floor area`,
      points: floorAreaDraftPoints,
      identity: "preview",
    });
    const inspection = inspectFloorAreaOutline(provisional);
    pendingFloorAreaVertices = floorAreaDraftPoints.map((point) => ({ x: point.x, y: point.y }));
    editingFloorAreaId = null;
    floorAreaDialogTitle.textContent = "Confirm preliminary floor area";
    floorAreaDialogSummary.textContent = `${formatArea(inspection.areaMm2)} · ${formatMm(inspection.perimeterMm)} perimeter · ${floorAreaScaleEvidence(floor.id).dialog}`;
    floorAreaNameInput.value = `${floor.name} floor area`;
    floorAreaDialogError.textContent = "";
    floorAreaDialog.showModal();
    floorAreaNameInput.focus();
  } catch (error) {
    interactionMessage = error.message;
    updateStatus();
  }
}

function openFloorAreaEditor() {
  const outline = history.present.floorAreaOutlines.find((candidate) => candidate.id === selectedFloorAreaId);
  if (!outline) return;
  const inspection = inspectFloorAreaOutline(outline);
  pendingFloorAreaVertices = null;
  editingFloorAreaId = outline.id;
  floorAreaDialogTitle.textContent = "Edit building-outline name";
  floorAreaDialogSummary.textContent = `${formatArea(inspection.areaMm2)} · ${outline.vertices.length} editable vertices · geometry unchanged`;
  floorAreaNameInput.value = outline.name;
  floorAreaDialogError.textContent = "";
  floorAreaDialog.showModal();
  floorAreaNameInput.focus();
}

function applyFloorAreaDialog(event) {
  event.preventDefault();
  const name = floorAreaNameInput.value.trim();
  if (!name) {
    floorAreaDialogError.textContent = "Enter an outline name before applying.";
    return;
  }
  if (editingFloorAreaId) {
    const outlineId = editingFloorAreaId;
    if (commitCommand({
      type: "floorArea.updateMetadata",
      outlineId,
      name,
    }, "Building-outline name updated")) {
      floorAreaDialog.close();
      clearFloorAreaDialogState();
      selectedFloorAreaId = outlineId;
      render();
    }
    return;
  }
  const floor = currentFloor();
  if (!floor || !pendingFloorAreaVertices) {
    floorAreaDialogError.textContent = "The outline draft is no longer available.";
    return;
  }
  const identity = floorAreaIdentityCounter;
  const outline = floorAreaOutlineRecord({
    id: `floor-area-local-${identity}`,
    floorId: floor.id,
    name,
    points: pendingFloorAreaVertices,
    identity,
  });
  if (commitCommand({ type: "floorArea.create", outline }, "Preliminary building outline created independently of rooms")) {
    floorAreaIdentityCounter += 1;
    selectedFloorAreaId = outline.id;
    floorAreaDialog.close();
    clearFloorAreaDialogState();
    floorAreaDraftPoints = [];
    hoverPoint = null;
    setTool("select");
    render();
  } else {
    floorAreaDialogError.textContent = interactionMessage;
  }
}

function floorAreaOutlineRecord({ id, floorId, name, points, identity }) {
  return {
    id,
    floorId,
    name,
    geometrySource: "manual-floor-area-outline",
    purpose: "preliminary-quoting",
    areaConvention: "closed-plan-outline",
    measurementBasis: "floor-local-plan-mm",
    vertices: points.map((point, index) => ({
      id: `floor-area-vertex-${identity}-${index + 1}`,
      positionMm: {
        x: point.x,
        y: point.y,
        z: knownMm(0, "floor-local plan"),
      },
    })),
    holes: [],
  };
}

function cancelFloorAreaDialog(message) {
  const wasCreating = pendingFloorAreaVertices !== null;
  if (floorAreaDialog.open) floorAreaDialog.close();
  clearFloorAreaDialogState();
  if (wasCreating) {
    floorAreaDraftPoints = [];
    hoverPoint = null;
    setTool("select");
  }
  interactionMessage = message;
  render();
}

function clearFloorAreaDialogState() {
  pendingFloorAreaVertices = null;
  editingFloorAreaId = null;
  floorAreaDialogError.textContent = "";
}

function openRemoveFloorAreaDialog() {
  const outline = history.present.floorAreaOutlines.find((candidate) => candidate.id === selectedFloorAreaId);
  if (!outline) return;
  removeFloorAreaMessage.textContent = `Remove “${outline.name}”? Walls, rooms, zones and MVHR objects remain unchanged. This action is undoable.`;
  removeFloorAreaDialog.showModal();
}

function applyRemoveFloorAreaChoice() {
  const outlineId = selectedFloorAreaId;
  if (removeFloorAreaDialog.returnValue !== "remove") {
    interactionMessage = "Building-outline removal cancelled; project unchanged";
    render();
    return;
  }
  if (outlineId && commitCommand({
    type: "floorArea.remove",
    outlineId,
  }, "Building outline removed; walls, rooms and MVHR objects preserved")) {
    selectedFloorAreaId = null;
    render();
  }
}

function commitWallChain() {
  if (draftPoints.length < 2) {
    interactionMessage = "Add at least two points before pressing Enter";
    updateStatus();
    return;
  }
  const wallIds = draftPoints.slice(1).map((_, index) => `wall-${activeChainId}-${index + 1}`);
  try {
    const projectBeforeWallCommit = history.present;
    const wallCommand = {
      type: "wall.addChain",
      floorId: "floor-ground",
      nodeIds: draftPoints.map((point) => point.nodeId),
      wallIds,
      points: draftPoints.map((point) => pointForCommand(point)),
      splits: draftPoints.filter((point) => point.split).map((point) => point.split),
      thicknessMm: 140,
      heightMm: unknownMm("wall height not set in synthetic local shell"),
      referenceLine: "centreline",
      classification: "physical",
    };
    const committedWallCommand = snapEnabled
      ? planSnappedWallChain(history.present, wallCommand, {
          idPrefix: `wall-${activeChainId}-intersection`,
        })
      : wallCommand;
    history = executeCommand(history, committedWallCommand);
    portableDirty = true;
    draftPoints = [];
    activeChainId = null;
    hoverPoint = null;
    selectedWallId = committedWallCommand.wallIds.at(-1);
    selectedNodeId = null;
    mechanicalState = clearMechanicalSelection(mechanicalState);
    const newRoomBoundaries = newlyEligibleRoomBoundaries(
      projectBeforeWallCommit,
      history.present,
      "floor-ground",
    );
    interactionMessage = newRoomBoundaries.length === 1
      ? "Wall chain committed; new enclosed room boundary detected"
      : newRoomBoundaries.length > 1
        ? `Wall chain committed; ${newRoomBoundaries.length} new room boundaries need review`
        : "Wall chain committed; local save queued";
    render();
    savePresent("automatic");
    if (newRoomBoundaries.length === 1) {
      interactionMessage = "New enclosed boundary detected; confirm the room details or cancel";
      render();
      openRoomCreationDialog(newRoomBoundaries[0].key);
    } else if (newRoomBoundaries.length > 1) {
      interactionMessage = `${newRoomBoundaries.length} new enclosed boundaries detected; choose each shaded face explicitly`;
      render();
    }
  } catch (error) {
    interactionMessage = error.message;
    updateStatus();
  }
}

function commitRoomDivider() {
  const parentRoom = history.present.rooms.find((room) => room.id === selectedRoomId);
  if (!parentRoom) {
    interactionMessage = "Select one confirmed room before committing a room divider";
    updateStatus();
    return;
  }
  if (draftPoints.length < 2) {
    interactionMessage = "Add at least two divider points before pressing Enter";
    updateStatus();
    return;
  }
  const wallIds = draftPoints.slice(1).map((_, index) => `room-divider-${activeChainId}-${index + 1}`);
  try {
    const command = {
      type: "wall.addChain",
      floorId: parentRoom.floorId,
      parentRoomId: parentRoom.id,
      nodeIds: draftPoints.map((point) => point.nodeId),
      wallIds,
      points: draftPoints.map((point) => pointForCommand(point)),
      splits: draftPoints.filter((point) => point.split).map((point) => point.split),
      thicknessMm: 20,
      heightMm: unknownMm("nonphysical room divider has no wall height"),
      referenceLine: "centreline",
      classification: "virtual",
    };
    const committedCommand = snapEnabled
      ? planSnappedWallChain(history.present, command, {
          idPrefix: `room-divider-${activeChainId}-intersection`,
        })
      : command;
    history = executeCommand(history, committedCommand);
    portableDirty = true;
    draftPoints = [];
    activeChainId = null;
    hoverPoint = null;
    selectedWallId = committedCommand.wallIds.at(-1);
    selectedNodeId = null;
    selectedZoneId = null;
    const derivation = deriveZoneBoundaries(history.present, parentRoom.id);
    interactionMessage = derivation.candidates.length > 0
      ? `${derivation.candidates.length} zone faces detected; select each shaded face to name it`
      : "Room divider committed; continue or correct the divider until it fully partitions the selected room";
    render();
    savePresent("automatic");
    setTool("select");
  } catch (error) {
    interactionMessage = error.message;
    updateStatus();
  }
}

function pointForCommand(point) {
  const existing = history.present.wallNodes.find((node) => node.id === point.nodeId);
  return {
    x: point.x,
    y: point.y,
    z: existing?.positionMm.z ?? unknownMm("base elevation not set in synthetic local shell"),
  };
}

function commitCommand(command, message) {
  try {
    history = executeCommand(history, command);
    portableDirty = true;
    interactionMessage = message;
    render();
    savePresent("automatic");
    return true;
  } catch (error) {
    interactionMessage = `${message} failed: ${error.message}`;
    render();
    return false;
  }
}

function openAutomaticRadialPreview() {
  automaticEppPreview = null;
  if (automaticEppDialog.open) automaticEppDialog.close();
  const floorId = currentFloorId();
  automaticRadialPreview = inspectAutomaticRadialRouting(history.present, floorId, automaticRoutingOptions());
  automaticRadialResults.replaceChildren();
  const preview = automaticRadialPreview;
  automaticRadialSelectedKeys = new Set(preview.proposals.map(radialProposalKey));
  const routed = preview.proposals.length;
  automaticRadialSummary.textContent = preview.status === "blocked"
    ? preview.notes[0]
    : `${routed} ${routingStyleLabel()} route${routed === 1 ? "" : "s"} ready to preview${preview.unresolved.length ? ` · ${preview.unresolved.length} unresolved` : ""}.`;
  for (const proposal of preview.proposals) {
    const row = document.createElement("div");
    row.className = "automatic-radial-result route-choice";
    const choice = document.createElement("input");
    choice.type = "checkbox";
    choice.checked = true;
    choice.setAttribute("aria-label", `Apply route to ${proposal.destination.displayName}`);
    choice.addEventListener("change", () => {
      if (choice.checked) automaticRadialSelectedKeys.add(radialProposalKey(proposal));
      else automaticRadialSelectedKeys.delete(radialProposalKey(proposal));
      updateAutomaticRadialSelection();
    });
    const copy = document.createElement("label");
    const title = document.createElement("strong");
    title.textContent = `${proposal.stream === "supply" ? "Supply" : "Extract"} · ${proposal.source.displayName} → ${proposal.destination.displayName}`;
    const detail = document.createElement("span");
    detail.textContent = `${Math.round(proposal.lengthMm)} mm centreline · ${routingStyleLabel(proposal.routingStyle)} · full 90 mm drawing width checked inside outline`;
    copy.append(title, detail);
    row.append(choice, copy);
    automaticRadialResults.append(row);
  }
  for (const item of preview.unresolved) {
    const row = document.createElement("div");
    row.className = "automatic-radial-result";
    const title = document.createElement("strong");
    title.textContent = `Unresolved · ${item.displayName}`;
    const detail = document.createElement("span");
    detail.textContent = item.reason;
    row.append(title, detail);
    automaticRadialResults.append(row);
  }
  if (!preview.proposals.length && !preview.unresolved.length) {
    const row = document.createElement("div");
    row.className = "automatic-radial-result";
    row.textContent = preview.notes[0];
    automaticRadialResults.append(row);
  }
  updateAutomaticRadialSelection();
  if (!automaticRadialDialog.open) automaticRadialDialog.showModal();
  interactionMessage = preview.proposals.length ? "Automatic DN90 route preview shown; project unchanged" : preview.notes[0];
  render();
}

function radialProposalKey(proposal) {
  return `${proposal.destination.componentId}/${proposal.destination.portId}`;
}

function updateAutomaticRadialSelection() {
  const count = automaticRadialSelectedKeys.size;
  automaticRadialSelectionStatus.textContent = count
    ? `${count} route${count === 1 ? "" : "s"} selected. Applied routes keep their occupied typed endpoints; preview again to generate only the remainder.`
    : "No routes selected; project remains unchanged.";
  applyAutomaticRadialButton.disabled = count === 0;
  applyAutomaticRadialButton.textContent = count === 1 ? "Apply selected route" : `Apply ${count} selected routes`;
}

function cancelAutomaticRadialPreview() {
  automaticRadialPreview = null;
  automaticRadialSelectedKeys = new Set();
  if (automaticRadialDialog.open) automaticRadialDialog.close();
  interactionMessage = "Automatic routing cancelled; project unchanged";
  render();
}

function applyAutomaticRadialPreview() {
  if (!automaticRadialPreview?.proposals.length) return;
  const family = routeFamilyForKind("semi-rigid-radial");
  const proposals = automaticRadialPreview.proposals.filter((proposal) => automaticRadialSelectedKeys.has(radialProposalKey(proposal)));
  if (!proposals.length) return;
  const routes = proposals.map((proposal, index) => ({
    id: `route-synthetic-${routeIdentityCounter + index}`,
    floorId: currentFloorId(),
    system: proposal.system,
    stream: proposal.stream,
    role: proposal.role,
    ductKind: family.id,
    connectionInterface: family.connectionInterface,
    parallelRunCount: 1,
    startAttachment: { componentId: proposal.source.componentId, portId: proposal.source.portId },
    endAttachment: { componentId: proposal.destination.componentId, portId: proposal.destination.portId },
    points: proposal.points.map((point) => ({ ...point, z: unknownMm("automatic DN90 route elevation not set") })),
  }));
  const committed = commitCommand({ type: "route.addBatch", routes }, `${routes.length} automatic DN90 route${routes.length === 1 ? "" : "s"} applied in one undoable action`);
  if (!committed) return;
  routeIdentityCounter += routes.length;
  automaticRadialPreview = null;
  automaticRadialSelectedKeys = new Set();
  automaticRadialDialog.close();
  selectedRouteId = routes.at(-1).id;
  selectedRoutePointIndex = null;
  render();
}

function openAutomaticEppPreview() {
  automaticRadialPreview = null;
  if (automaticRadialDialog.open) automaticRadialDialog.close();
  automaticEppStart.value = "";
  automaticEppEnd.value = "";
  refreshAutomaticEppPreview();
  automaticEppDialog.showModal();
  interactionMessage = "Choose two free compatible EPP ports; project unchanged";
  render();
}

function refreshAutomaticEppPreview() {
  const startKey = automaticEppStart.value;
  const endKey = automaticEppEnd.value;
  automaticEppPreview = inspectAutomaticEppRouting(history.present, currentFloorId(), { startKey, endKey }, automaticRoutingOptions());
  const preview = automaticEppPreview;
  replaceEppOptions(automaticEppStart, preview.endpoints, "Choose a free EPP port…", startKey);
  replaceEppOptions(automaticEppEnd, preview.compatibleEnds, startKey ? "Choose a compatible destination…" : "Choose the first port above", endKey);
  automaticEppEnd.disabled = !startKey || preview.compatibleEnds.length === 0;
  automaticEppSummary.textContent = preview.message;
  automaticEppResult.replaceChildren();
  if (preview.proposal) {
    const row = document.createElement("div");
    row.className = "automatic-radial-result";
    const title = document.createElement("strong");
    title.textContent = `${preview.proposal.source.displayName} → ${preview.proposal.destination.displayName}`;
    const detail = document.createElement("span");
    detail.textContent = `DN${preview.proposal.diameterMm} ${preview.proposal.stream} · ${Math.round(preview.proposal.lengthMm)} mm centreline · ${routingStyleLabel(preview.proposal.routingStyle)} · ${preview.proposal.geometryStatus.replaceAll("-", " ")}`;
    row.append(title, detail);
    automaticEppResult.append(row);
  } else {
    const row = document.createElement("div");
    row.className = "automatic-radial-result";
    row.textContent = preview.message;
    automaticEppResult.append(row);
  }
  applyAutomaticEppButton.disabled = !preview.proposal;
  render();
}

function automaticRoutingOptions() {
  const routingStyle = automaticRouteStyle.value;
  if (routingStyle !== "building-aligned") return { routingStyle: "direct" };
  const degrees = automaticRouteAxis.value === "" ? Number.NaN : Number(automaticRouteAxis.value);
  return { routingStyle, buildingAxisRad: Number.isFinite(degrees) ? degrees * Math.PI / 180 : Number.NaN };
}

function routingStyleLabel(style = automaticRouteStyle.value) {
  return style === "building-aligned" ? "Building-aligned" : "Direct";
}

function updateAutomaticRoutingStyle({ suggestIfEmpty = false } = {}) {
  const aligned = automaticRouteStyle.value === "building-aligned";
  automaticRouteAxisRow.hidden = !aligned;
  if (aligned && suggestIfEmpty && automaticRouteAxis.value === "") applyOutlineAxisSuggestion({ refreshPreview: false });
}

function applyOutlineAxisSuggestion({ refreshPreview = true } = {}) {
  const floorId = currentFloorId();
  const outline = history.present.floorAreaOutlines.find((candidate) => candidate.floorId === floorId);
  if (!outline) {
    automaticRouteAxis.value = "";
    automaticRouteAxisDetail.textContent = "No building outline is available. Enter and confirm an axis explicitly.";
    return;
  }
  const suggestion = suggestBuildingAxis(inspectFloorAreaOutline(outline).polygon);
  if (!suggestion) {
    automaticRouteAxis.value = "";
    automaticRouteAxisDetail.textContent = "The outline has no reliable edge. Enter and confirm an axis explicitly.";
    return;
  }
  automaticRouteAxis.value = (suggestion.angleRad * 180 / Math.PI).toFixed(1);
  automaticRouteAxisDetail.textContent = `Suggested from the longest outline edge (${Math.round(suggestion.lengthMm)} mm). Review before previewing; this does not rotate the drawing.`;
  if (refreshPreview && automaticRadialDialog.open) openAutomaticRadialPreview();
  if (refreshPreview && automaticEppDialog.open) refreshAutomaticEppPreview();
}

function replaceEppOptions(select, endpoints, placeholder, selectedKey) {
  select.replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = placeholder;
  select.append(empty);
  for (const endpoint of endpoints) {
    const option = document.createElement("option");
    option.value = endpoint.key;
    option.textContent = endpoint.label;
    select.append(option);
  }
  select.value = endpoints.some((endpoint) => endpoint.key === selectedKey) ? selectedKey : "";
}

function cancelAutomaticEppPreview() {
  automaticEppPreview = null;
  if (automaticEppDialog.open) automaticEppDialog.close();
  interactionMessage = "Automatic EPP routing cancelled; project unchanged";
  render();
}

function applyAutomaticEppPreview() {
  const proposal = automaticEppPreview?.proposal;
  if (!proposal) return;
  const route = {
    id: `route-synthetic-${routeIdentityCounter}`,
    floorId: currentFloorId(),
    system: proposal.system,
    stream: proposal.stream,
    role: proposal.role,
    ductKind: proposal.ductKind,
    connectionInterface: proposal.connectionInterface,
    parallelRunCount: 1,
    startAttachment: { componentId: proposal.source.componentId, portId: proposal.source.portId },
    endAttachment: { componentId: proposal.destination.componentId, portId: proposal.destination.portId },
    points: proposal.points.map((point) => ({ ...point, z: unknownMm("automatic EPP route elevation not set") })),
  };
  const committed = commitCommand({ type: "route.add", route }, `Automatic DN${proposal.diameterMm} EPP route applied in one undoable action`);
  if (!committed) return;
  routeIdentityCounter += 1;
  automaticEppPreview = null;
  automaticEppDialog.close();
  selectedRouteId = route.id;
  selectedRoutePointIndex = null;
  render();
}

function addRoutingExclusionCorner(point) {
  if (!routingExclusionDraftStart) {
    routingExclusionDraftStart = point;
    interactionMessage = "First corner set · click the opposite corner · Esc cancels";
    render();
    return;
  }
  const x = Math.min(routingExclusionDraftStart.x, point.x);
  const y = Math.min(routingExclusionDraftStart.y, point.y);
  const width = Math.abs(point.x - routingExclusionDraftStart.x);
  const height = Math.abs(point.y - routingExclusionDraftStart.y);
  if (width < 1 || height < 1) {
    interactionMessage = "Exclusion rectangle needs visible width and height";
    return;
  }
  pendingRoutingExclusionId = null;
  routingExclusionName.value = `Routing exclusion ${history.present.routingExclusions.length + 1}`;
  routingExclusionKind.value = "beam";
  routingExclusionX.value = String(Math.round(x));
  routingExclusionY.value = String(Math.round(y));
  routingExclusionWidth.value = String(Math.round(width));
  routingExclusionHeight.value = String(Math.round(height));
  routingExclusionHeightMode.value = "all-height";
  routingExclusionHeightFields.hidden = true;
  routingExclusionBottom.value = "";
  routingExclusionTop.value = "";
  routingExclusionError.textContent = "";
  routingExclusionDraftStart = null;
  routingExclusionDialog.showModal();
  render();
}

function openRoutingExclusionEditor(exclusionId) {
  const exclusion = history.present.routingExclusions.find((candidate) => candidate.id === exclusionId);
  if (!exclusion) return;
  pendingRoutingExclusionId = exclusion.id;
  selectedRoutingExclusionId = exclusion.id;
  routingExclusionName.value = exclusion.name;
  routingExclusionKind.value = exclusion.kind;
  routingExclusionX.value = String(exclusion.geometry.x);
  routingExclusionY.value = String(exclusion.geometry.y);
  routingExclusionWidth.value = String(exclusion.geometry.width);
  routingExclusionHeight.value = String(exclusion.geometry.height);
  routingExclusionHeightMode.value = exclusion.verticalRange.mode;
  routingExclusionHeightFields.hidden = exclusion.verticalRange.mode !== "solid-range";
  routingExclusionBottom.value = exclusion.verticalRange.bottomMm?.state === "unknown" ? "" : String(exclusion.verticalRange.bottomMm?.valueMm ?? "");
  routingExclusionTop.value = exclusion.verticalRange.topMm?.state === "unknown" ? "" : String(exclusion.verticalRange.topMm?.valueMm ?? "");
  routingExclusionError.textContent = "";
  routingExclusionDialog.showModal();
  render();
}

function applyRoutingExclusionDialog(event) {
  event.preventDefault();
  const numeric = [routingExclusionX, routingExclusionY, routingExclusionWidth, routingExclusionHeight].map((input) => Number(input.value));
  if (!numeric.every(Number.isFinite) || numeric[2] <= 0 || numeric[3] <= 0) {
    routingExclusionError.textContent = "Enter finite coordinates and positive width/height.";
    return;
  }
  const measurement = (input, label) => input.value === "" ? unknownMm(`${label} not set`) : assumedMm(Number(input.value), `user-entered ${label}`);
  const verticalRange = routingExclusionHeightMode.value === "all-height" ? { mode: "all-height" } : {
    mode: "solid-range", bottomMm: measurement(routingExclusionBottom, "obstacle bottom elevation"), topMm: measurement(routingExclusionTop, "obstacle top elevation"),
  };
  const value = { floorId: currentFloorId(), name: routingExclusionName.value, kind: routingExclusionKind.value,
    geometry: { shape: "rectangle", x: numeric[0], y: numeric[1], width: numeric[2], height: numeric[3] }, verticalRange };
  const id = pendingRoutingExclusionId ?? `routing-exclusion-${Date.now().toString(36)}-${history.present.routingExclusions.length + 1}`;
  const command = pendingRoutingExclusionId
    ? { type: "routingExclusion.update", exclusionId: id, changes: value }
    : { type: "routingExclusion.add", exclusion: { id, ...value } };
  if (!commitCommand(command, `${value.name} routing exclusion ${pendingRoutingExclusionId ? "updated" : "added"}`)) return;
  selectedRoutingExclusionId = id;
  pendingRoutingExclusionId = null;
  routingExclusionDialog.close();
  setTool("select");
  render();
}

function cancelRoutingExclusionDialog() {
  pendingRoutingExclusionId = null;
  routingExclusionDraftStart = null;
  if (routingExclusionDialog.open) routingExclusionDialog.close();
  setTool("select");
  interactionMessage = "Routing exclusion change cancelled; project unchanged";
  render();
}

function removeRoutingExclusion(exclusionId) {
  const exclusion = history.present.routingExclusions.find((candidate) => candidate.id === exclusionId);
  if (!exclusion) return;
  if (commitCommand({ type: "routingExclusion.remove", exclusionId }, `${exclusion.name} removed; Undo restores it`)) {
    if (selectedRoutingExclusionId === exclusionId) selectedRoutingExclusionId = null;
  }
}

function applyRoutingClearance() {
  const value = routingClearanceInput.value;
  const measurement = value === "" ? unknownMm("parallel duct clear spacing not set") : assumedMm(Number(value), "user-entered parallel duct clear spacing");
  if (value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
    interactionMessage = "Clear spacing must be zero or a positive millimetre value";
    updateStatus();
    return;
  }
  commitCommand({ type: "routingClearance.set", floorId: currentFloorId(), clearSpacingMm: measurement }, value === "" ? "Parallel duct clear spacing returned to unresolved" : `${Number(value)} mm parallel duct clear spacing applied`);
}

function currentFloorId() {
  return history.present.floors.find((floor) => floor.id === "floor-ground")?.id ?? history.present.floors[0]?.id;
}

function handleMechanicalClick(event, selectedHit = null) {
  let hit = selectedHit ?? mechanicalHitFromPointerEvent(event);
  // A wall-mounted CA200 has top/bottom ports at the same XY, with distinct Z/roles.
  // Resolve their identity explicitly rather than inventing a visible port offset.
  const ca200Component=hit?.kind==="port" && history.present.components.find(component=>component.id===hit.componentId && component.displaySymbol?.ca200Profile?.mounting==="vertical");
  if(!selectedHit && ca200Component && activeTool==="route") {
    const target=floorPortTransform(history.present,hit.componentId,hit.portId).positionMm;
    const family=routeFamilyForKind(mechanicalState.ductKind)?.connectionInterface;
    const choices=ca200Component.ports.filter(port=>{
      const point=floorPortTransform(history.present,ca200Component.id,port.id).positionMm;
      return Math.hypot(point.x-target.x,point.y-target.y)<1e-6 && !portUsage(ca200Component.id,port.id).occupied && port.interface.family===family?.family && port.interface.nominalSizeMm===family?.nominalSizeMm && (!mechanicalState.routeDraft || port.stream===mechanicalState.routeDraft.stream);
    });
    const portHit=port=>({...hit,portId:port.id,system:port.system,stream:port.stream,role:port.role,interface:port.interface,direction:floorPortTransform(history.present,ca200Component.id,port.id).direction,occupied:false});
    if(choices.length===1)hit=portHit(choices[0]);
    else if(choices.length>1) {
      componentContext.replaceChildren();
      for(const port of choices){const button=document.createElement("button");button.type="button";button.setAttribute("role","menuitem");button.textContent=`${port.role} · ${port.positionMm.z>0?"top":"bottom"}`;button.addEventListener("click",()=>{closeComponentContext();handleMechanicalClick(event,portHit(port));});componentContext.append(button);}
      componentContext.style.left=`${Math.max(0,Math.min(event.clientX,window.innerWidth-290))}px`;
      componentContext.style.top=`${Math.max(0,Math.min(event.clientY,window.innerHeight-160))}px`;
      componentContext.hidden=false;componentContext.querySelector("button")?.focus();return;
    }
  }
  const point = hit?.kind === "port"
    ? hit.positionMm ?? portFloorPoint(hit.componentId, hit.portId)
    : eventToGridWorld(event);
  const priorState = mechanicalState;
  const result = handleMechanicalCanvasClick(mechanicalState, { point, hit });
  mechanicalState = result.state;
  interactionMessage = result.message;
  if (result.intent?.type === "component.place" && standaloneCwPlacement) { openCw(result.intent.point,event.shiftKey||event.ctrlKey);return; }
  if (result.intent?.type === "component.place" && externalGrillePlacement) {
    openExternalGrille(result.intent.point,event.shiftKey||event.ctrlKey);return;
  }
  if (result.intent?.type === "component.place" && terminalPlacementShape) {
    openTerminalPlacement(result.intent.point, event.shiftKey || event.ctrlKey);
    return;
  }
  if (result.intent?.type === "component.place" && mvhrPlacementMounting) {
    openMvhrPlacement(result.intent.point, event.shiftKey || event.ctrlKey);
    return;
  }
  if (result.intent?.type === "component.place") {
    const id = `component-catalogue-${componentIdentityCounter}`;
    const catalogueItem = findCatalogueItem(result.intent.catalogueItemId);
    const committed = commitCommand({
      type: "component.add",
      component: createCatalogueComponent(catalogueItem.id, {
        id,
        floorId: "floor-ground",
        xMm: result.intent.point.x,
        yMm: result.intent.point.y,
      }),
      autoAssignTerminalSpace: true,
    }, "Catalogue component placed with its pinned record snapshot");
    if (committed) {
      componentIdentityCounter += 1;
      const returnToSelect = !event.shiftKey && !event.ctrlKey && (catalogueItem.category === "mvhr-unit" || catalogueItem.category === "mvhr-unit-drawing-profile");
      mechanicalState = resolveComponentPlacementState(mechanicalState, {
        committed: true,
        componentId: id,
        returnToSelect,
      });
      if (returnToSelect) {
        setTool("select");
        interactionMessage = "MVHR unit placed and selected; move or rotate it with Select";
        render();
      }
    }
    else {
      mechanicalState = resolveComponentPlacementState(mechanicalState, {
        committed: false,
        componentId: id,
        returnToSelect: true,
      });
      mechanicalState = priorState;
      render();
    }
  } else if (result.intent?.type === "equipmentAssembly.place") {
    const id = `equipment-assembly-${equipmentAssemblyIdentityCounter}`;
    const value = createEquipmentAssembly(result.intent.assemblyTemplateId, {
      id,
      floorId: "floor-ground",
      xMm: result.intent.point.x,
      yMm: result.intent.point.y,
    });
    const committed = commitCommand({
      type: "equipmentAssembly.add",
      ...value,
    }, "Generic remote equipment assembly placed with explicit internal connections and a provisional service zone");
    if (committed) equipmentAssemblyIdentityCounter += 1;
    else {
      mechanicalState = priorState;
      render();
    }
  } else if (result.intent?.type === "route.commit") {
    const id = `route-synthetic-${routeIdentityCounter}`;
    const committed = commitCommand({
      type: "route.add",
      terminalEntrySelections:result.intent.terminalEntrySelections,
      route: {
        id,
        floorId: "floor-ground",
        system: result.intent.system,
        stream: result.intent.stream,
        role: result.intent.role,
        connectionInterface: result.intent.connectionInterface,
        ductKind: result.intent.ductKind,
        parallelRunCount: result.intent.parallelRunCount,
        startAttachment: result.intent.start,
        endAttachment: result.intent.end,
        points: result.intent.points.map((routePoint) => ({
          x: routePoint.x,
          y: routePoint.y,
          z: unknownMm("synthetic route elevation not set"),
        })),
      },
    }, `${routeFamilyForKind(result.intent.ductKind).name} route committed; engineering losses and exact product fit remain unverified`);
    if (committed) {
      routeIdentityCounter += 1;
      selectedRouteId = id;
      mechanicalState = clearMechanicalSelection(mechanicalState);
      selectedRoutePointIndex = null;
      render();
    }
    else {
      mechanicalState = priorState;
      render();
    }
  } else {
    render();
  }
}

function rotateSelectedComponent() {
  if (activeTool !== "select" || !mechanicalState.selectedComponentId) return;
  const assembly = equipmentAssemblyForComponent(history.present, mechanicalState.selectedComponentId);
  commitCommand(
    assembly
      ? { type: "equipmentAssembly.rotateFloorZ", assemblyId: assembly.id, angleRad: Math.PI / 2 }
      : componentRotationIntent(mechanicalState),
    assembly
      ? "Equipment assembly rotated 90° as one group; attached endpoints updated"
      : "Catalogue component rotated 90°; attached endpoints updated",
  );
}

function openComponentDeleteDialog() {
  const componentId = mechanicalState.selectedComponentId;
  if (activeTool !== "select" || !componentId || deleteComponentDialog.open) return;
  try {
    const inspection = inspectComponentDeletion(history.present, componentId);
    const component = history.present.components.find((candidate) => candidate.id === componentId);
    pendingComponentDeletion = inspection;
    deleteComponentDialog.querySelector("h2").textContent = inspection.assemblyId
      ? "Delete selected equipment assembly"
      : "Delete selected component";
    deleteComponentMessage.textContent = inspection.assemblyId
      ? `Delete the full “${inspection.assemblyName}” group (${countLabel(inspection.componentCount, "part")})? One assembly member cannot be deleted independently.`
      : `Delete “${component?.displayName ?? componentId}”?`;
    const routeScope = inspection.routeCount === 0
      ? "No attached duct routes will be removed."
      : `${countLabel(inspection.routeCount, "attached duct route")} will also be removed; components at their other ends remain.`;
    const connectionScope = inspection.connectionCount === 0
      ? "No direct connections will be removed."
      : `${countLabel(inspection.connectionCount, "direct connection")} will also be removed.`;
    const associationScope = inspection.associationCount === 0
      ? "No room or zone terminal assignment is affected."
      : `${countLabel(inspection.associationCount, "room or zone terminal assignment")} will be cleared.`;
    deleteComponentScope.textContent = `${routeScope} ${connectionScope} ${associationScope}`;
    deleteComponentDialog.showModal();
  } catch (error) {
    pendingComponentDeletion = null;
    interactionMessage = `Delete unavailable: ${error.message}`;
    render();
  }
}

function applyComponentDeleteChoice() {
  const inspection = pendingComponentDeletion;
  pendingComponentDeletion = null;
  if (!inspection) return;
  if (deleteComponentDialog.returnValue !== "delete") {
    interactionMessage = "Component deletion cancelled; project unchanged";
    render();
    return;
  }
  const deletedLabel = inspection.assemblyId
    ? `${inspection.assemblyName} assembly`
    : "Selected component";
  if (commitCommand({
    type: "component.delete",
    componentId: inspection.selectedComponentId,
    confirmedScope: {
      componentIds: inspection.componentIds,
      assemblyId: inspection.assemblyId,
      routeIds: inspection.routeIds,
      connectionIds: inspection.connectionIds,
    },
  }, `${deletedLabel} and its confirmed dependent scope deleted`)) {
    mechanicalState = clearMechanicalSelection(mechanicalState);
    selectedRouteId = null;
    selectedRoutePointIndex = null;
    componentDragState = null;
    routePointDragState = null;
    render();
  }
}

function applySelectedComponentElevation() {
  const componentId = mechanicalState.selectedComponentId;
  if (!componentId) return;
  const value = Number(componentElevationInput.value);
  if (!Number.isFinite(value)) {
    interactionMessage = "Enter a finite equipment elevation in millimetres";
    updateStatus();
    return;
  }
  const assembly = equipmentAssemblyForComponent(history.present, componentId);
  commitCommand(
    assembly
      ? { type: "equipmentAssembly.setElevation", assemblyId: assembly.id, elevationMm: knownMm(value, "manual equipment placement") }
      : { type: "component.setElevation", componentId, elevationMm: knownMm(value, "manual equipment placement") },
    assembly ? "Equipment assembly elevation set for every member" : "Component elevation set explicitly",
  );
}

function clearSelectedComponentElevation() {
  const componentId = mechanicalState.selectedComponentId;
  if (!componentId) return;
  const assembly = equipmentAssemblyForComponent(history.present, componentId);
  commitCommand(
    assembly
      ? { type: "equipmentAssembly.setElevation", assemblyId: assembly.id, elevationMm: unknownMm("equipment installation height not set") }
      : { type: "component.setElevation", componentId, elevationMm: unknownMm("component installation height not set") },
    assembly ? "Equipment assembly elevation returned to explicit unknown" : "Component elevation returned to explicit unknown",
  );
}

function changeSelectedTerminalRoom() {
  const componentId = mechanicalState.selectedComponentId;
  if (!componentId) return;
  const port = roomTerminalPort(history.present, componentId);
  if (!port) return;
  const assignment = terminalRoomAssignment(history.present, componentId);
  const target = componentRoomAssignment.value;
  if (!target) {
    if (!assignment) return;
    commitCommand({
      type: "terminal.unassignRoom",
      componentId,
      portId: port.id,
    }, "Terminal room or zone assignment removed; airflow remains unassigned");
    return;
  }
  const [kind, id] = target.split(":", 2);
  if (kind === "zone") {
    commitCommand({
      type: "terminal.assignZone",
      zoneId: id,
      componentId,
      portId: port.id,
    }, "Terminal assigned to ventilation zone manually; no airflow inferred");
  } else {
    commitCommand({
      type: "terminal.assignRoom",
      roomId: id,
      componentId,
      portId: port.id,
    }, "Terminal assigned to room manually; no airflow inferred");
  }
}

function setSelectedTerminalDuctRuns(ductRunCount) {
  const componentId = mechanicalState.selectedComponentId;
  if (!componentId || !roomTerminalPort(history.present, componentId)) return;
  commitCommand({
    type: "component.setDuctRunCount",
    componentId,
    ductRunCount,
  }, ductRunCount === 1
    ? "Terminal set to a single duct run; airflow remains unknown"
    : "Terminal set to a twin duct run; airflow remains unknown");
}

function clearSelectedTerminalDuctRuns() {
  const componentId = mechanicalState.selectedComponentId;
  if (!componentId || !roomTerminalPort(history.present, componentId)) return;
  commitCommand({
    type: "component.setDuctRunCount",
    componentId,
    ductRunCount: null,
  }, "Terminal duct-run demand cleared to unknown");
}

function setSelectedRouteParallelRuns(parallelRunCount) {
  if (!selectedRouteId) return;
  commitCommand({
    type: "route.setParallelRunCount",
    routeId: selectedRouteId,
    parallelRunCount,
  }, parallelRunCount === 1
    ? "Selected drawn route set to Single duct; terminal demand remains separate"
    : parallelRunCount === 2
      ? "Selected drawn route set to Twin duct; terminal demand remains separate"
      : "Selected drawn route arrangement returned to Not set; geometry and endpoints preserved");
}

function addRoutePointAtSegment(target) {
  const routeId = target.dataset.routeId;
  const segmentIndex = Number.parseInt(target.dataset.routeInsertIndex, 10);
  const route = history.present.routes.find((candidate) => candidate.id === routeId);
  if (!route || route.id !== selectedRouteId || !Number.isSafeInteger(segmentIndex)) return;
  const start = route.points[segmentIndex];
  const end = route.points[segmentIndex + 1];
  if (!start || !end) return;
  const pointIndex = segmentIndex + 1;
  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    z: interpolatedRouteElevation(start.z, end.z),
  };
  if (commitCommand({
    type: "route.insertPoint",
    routeId,
    segmentIndex,
    point: midpoint,
  }, "Route centreline point added at the selected segment midpoint; endpoints preserved")) {
    selectedRouteId = routeId;
    selectedRoutePointIndex = pointIndex;
    render();
  }
}

function removeSelectedRoutePoint() {
  const routeId = selectedRouteId;
  const pointIndex = selectedRoutePointIndex;
  if (!routeId || !Number.isSafeInteger(pointIndex)) return;
  if (commitCommand({
    type: "route.removePoint",
    routeId,
    pointIndex,
  }, "Intermediate route point removed; endpoint attachments preserved")) {
    selectedRoutePointIndex = null;
    render();
  }
}

function interpolatedRouteElevation(start, end) {
  if (start?.state === "unknown" || end?.state === "unknown") {
    return unknownMm("inserted route point lies on a segment with unknown elevation");
  }
  const valueMm = (start.valueMm + end.valueMm) / 2;
  if (start.state === "known" && end.state === "known") {
    return knownMm(valueMm, "interpolated from existing route segment");
  }
  return assumedMm(valueMm, "interpolated from an existing route segment with assumed elevation");
}

function mechanicalHitFromTarget(target) {
  const componentId = target?.dataset?.componentId;
  const portId = target?.dataset?.portId;
  if (componentId && portId) {
    const component = history.present.components.find((candidate) => candidate.id === componentId);
    const port = component?.ports.find((candidate) => candidate.id === portId);
    if (!component || !port) return null;
    const entry=terminalDrawingAnchors(component,port).find(e=>e.id===target.dataset.terminalEntry);
    return {
      ...(entry?{positionMm:entry.positionMm,terminalEntry:{componentId,portId,entryId:entry.id}}:{}),
      kind: "port",
      componentId,
      portId,
      system: port.system,
      stream: port.stream,
      role: port.role,
      interface: port.interface,
      direction: floorPortTransform(history.present, componentId, portId).direction,
      ceilingElbow: hasHrvCeilingElbow(component,port),
      occupied: portUsage(componentId, portId).occupied,
    };
  }
  if (componentId) return { kind: "component", componentId };
  if (target?.classList?.contains("wall") || target?.classList?.contains("wall-node")) {
    return { kind: "wall" };
  }
  return null;
}

function mechanicalHitFromPointerEvent(event) {
  const directHit = mechanicalHitFromTarget(event.target);
  if (activeTool !== "route") return directHit;
  const picked = pickPortAtClientPoint(
    { ...history.present, components: history.present.components.filter(componentIsVisible) },
    camera,
    canvas.getBoundingClientRect(),
    { x: event.clientX, y: event.clientY },
    { millimetresPerViewUnit: MILLIMETRES_PER_VIEW_UNIT, approachPoint:mechanicalState.routeDraft?.points.at(-1), ductKind:mechanicalState.ductKind, routeDraft:mechanicalState.routeDraft },
  );
  if (!picked) return directHit;
  const component = history.present.components.find((candidate) => candidate.id === picked.componentId);
  const port = component?.ports.find((candidate) => candidate.id === picked.portId);
  if (!component || !port) return directHit;
  return {
    ...(picked.entryId?{positionMm:picked.positionMm,terminalEntry:{componentId:component.id,portId:port.id,entryId:picked.entryId,...(picked.localPositionMm?{localPositionMm:picked.localPositionMm}:{})}}:{}),
    kind: "port",
    componentId: component.id,
    portId: port.id,
    system: port.system,
    stream: port.stream,
    role: port.role,
    interface: port.interface,
    direction: floorPortTransform(history.present, component.id, port.id).direction,
    ceilingElbow: hasHrvCeilingElbow(component,port),
    occupied: portUsage(component.id, port.id).occupied,
  };
}

function routeIdFromPointerEvent(event) {
  const directRouteId = event.target?.dataset?.routeId;
  if (directRouteId && history.present.routes.some((route) => route.id === directRouteId && routeIsVisible(route))) {
    return directRouteId;
  }
  const hit = pickRouteAtClientPoint(
    history.present.routes.filter(routeIsVisible),
    camera,
    canvas.getBoundingClientRect(),
    { x: event.clientX, y: event.clientY },
    {
      millimetresPerViewUnit: MILLIMETRES_PER_VIEW_UNIT,
      pointsForRoute: (route) => routeBodyGeometry(route).sampledCentreline,
    },
  );
  if (hit) return hit.routeId;
  return null;
}

function portFloorPoint(componentId, portId) {
  const position = floorPortTransform(history.present, componentId, portId).positionMm;
  return { x: position.x, y: position.y };
}

function clearMechanicalSelection(state) {
  return { ...state, selectedComponentId: null };
}

function handleRoomCanvasClick(event) {
  const roomId = event.target?.dataset?.roomId;
  const zoneId = event.target?.dataset?.zoneId;
  const boundaryKey = event.target?.dataset?.roomBoundaryKey;
  const zoneBoundaryKey = event.target?.dataset?.zoneBoundaryKey;
  const parentRoomId = event.target?.dataset?.parentRoomId;
  selectedFloorAreaId = null;
  if (zoneId) {
    const zone = history.present.zones.find((candidate) => candidate.id === zoneId);
    if (!zone) return;
    selectedZoneId = zone.id;
    selectedRoomId = zone.parentRoomId;
    reassignRoomId = null;
    reassignZoneId = null;
    selectedWallId = null;
    selectedNodeId = null;
    interactionMessage = "Ventilation zone selected";
    render();
    return;
  }
  if (roomId) {
    selectedRoomId = roomId;
    selectedZoneId = null;
    reassignRoomId = null;
    reassignZoneId = null;
    selectedWallId = null;
    selectedNodeId = null;
    interactionMessage = "Room selected";
    render();
    return;
  }
  if (zoneBoundaryKey && parentRoomId) {
    if (reassignZoneId) {
      const zoneIdToAssign = reassignZoneId;
      if (commitCommand({
        type: "zone.assignBoundary",
        zoneId: zoneIdToAssign,
        boundaryKey: zoneBoundaryKey,
      }, "Zone boundary reassigned; identity and metadata preserved")) {
        selectedZoneId = zoneIdToAssign;
        reassignZoneId = null;
        render();
      }
      return;
    }
    openZoneCreationDialog(parentRoomId, zoneBoundaryKey);
    return;
  }
  if (boundaryKey) {
    if (reassignRoomId) {
      const roomIdToAssign = reassignRoomId;
      if (commitCommand({
        type: "room.assignBoundary",
        roomId: roomIdToAssign,
        boundaryKey,
      }, "Room boundary reassigned; identity and metadata preserved")) {
        selectedRoomId = roomIdToAssign;
        selectedZoneId = null;
        reassignRoomId = null;
        render();
      }
      return;
    }
    openRoomCreationDialog(boundaryKey);
    return;
  }
  selectedRoomId = null;
  selectedZoneId = null;
  selectedFloorAreaId = null;
  interactionMessage = "No room or zone selected";
  render();
}

function openRoomCreationDialog(boundaryKey) {
  const derivation = deriveRoomBoundaries(history.present, "floor-ground");
  const candidate = derivation.candidates.find((item) => item.key === boundaryKey);
  if (!candidate) {
    interactionMessage = "That room boundary is no longer eligible; project unchanged";
    render();
    return;
  }
  pendingRoomBoundaryKey = boundaryKey;
  pendingZoneBoundaryKey = null;
  pendingZoneParentRoomId = null;
  editingRoomId = null;
  editingZoneId = null;
  setSpaceDialogLabels("room");
  roomDialogTitle.textContent = "Confirm room";
  roomBoundarySummary.textContent = `${formatArea(candidate.areaMm2)} from ${candidate.boundary.length} physical wall references. Area follows wall reference lines.`;
  roomNameInput.value = "";
  roomUseInput.value = "unspecified";
  roomVentilationRoleInput.value = "unassigned";
  setRoomAirflowForm(null);
  roomDialogError.textContent = "";
  roomDialog.showModal();
  roomNameInput.focus();
}

function openZoneCreationDialog(parentRoomId, boundaryKey) {
  const parent = history.present.rooms.find((room) => room.id === parentRoomId);
  const candidate = parent && deriveZoneBoundaries(history.present, parent.id).candidates.find(
    (item) => item.key === boundaryKey,
  );
  if (!parent || !candidate) {
    interactionMessage = "That zone boundary is no longer eligible; project unchanged";
    render();
    return;
  }
  pendingRoomBoundaryKey = null;
  pendingZoneBoundaryKey = boundaryKey;
  pendingZoneParentRoomId = parent.id;
  editingRoomId = null;
  editingZoneId = null;
  setSpaceDialogLabels("zone");
  roomDialogTitle.textContent = "Confirm ventilation zone";
  roomBoundarySummary.textContent = `${formatArea(candidate.areaMm2)} within “${parent.name}”. Zone areas partition the enclosure and are not added to its area.`;
  roomNameInput.value = "";
  roomUseInput.value = "unspecified";
  roomVentilationRoleInput.value = "unassigned";
  setRoomAirflowForm(null);
  roomDialogError.textContent = "";
  roomDialog.showModal();
  roomNameInput.focus();
}

function openSelectedRoomEditor() {
  const zone = history.present.zones.find((candidate) => candidate.id === selectedZoneId);
  if (zone) {
    const inspection = inspectZoneBoundary(history.present, zone);
    pendingRoomBoundaryKey = null;
    pendingZoneBoundaryKey = null;
    pendingZoneParentRoomId = null;
    editingRoomId = null;
    editingZoneId = zone.id;
    setSpaceDialogLabels("zone");
    roomDialogTitle.textContent = "Edit ventilation zone";
    roomBoundarySummary.textContent = inspection.areaMm2 === null
      ? `Boundary needs attention: ${inspection.reason}`
      : `${formatArea(inspection.areaMm2)} · child of ${history.present.rooms.find((room) => room.id === zone.parentRoomId)?.name ?? zone.parentRoomId} · not double counted`;
    roomNameInput.value = zone.name;
    roomUseInput.value = zone.use;
    roomVentilationRoleInput.value = zone.ventilationRole;
    setRoomAirflowForm(zone);
    roomDialogError.textContent = "";
    roomDialog.showModal();
    roomNameInput.focus();
    return;
  }
  const room = history.present.rooms.find((candidate) => candidate.id === selectedRoomId);
  if (!room) return;
  const inspection = inspectRoomBoundary(history.present, room);
  pendingRoomBoundaryKey = null;
  pendingZoneBoundaryKey = null;
  pendingZoneParentRoomId = null;
  editingRoomId = room.id;
  editingZoneId = null;
  setSpaceDialogLabels("room");
  roomDialogTitle.textContent = "Edit room";
  roomBoundarySummary.textContent = inspection.areaMm2 === null
    ? `Boundary needs attention: ${inspection.reason}`
    : `${formatArea(inspection.areaMm2)} · ${room.boundary.length} wall references · ${room.areaConvention.replaceAll("-", " ")}`;
  roomNameInput.value = room.name;
  roomUseInput.value = room.use;
  roomVentilationRoleInput.value = room.ventilationRole;
  setRoomAirflowForm(room);
  roomDialogError.textContent = "";
  roomDialog.showModal();
  roomNameInput.focus();
}

function applyRoomDialog(event) {
  event.preventDefault();
  roomDialogError.textContent = "";
  const name = roomNameInput.value.trim();
  if (!name) {
    roomDialogError.textContent = "Enter a name before applying.";
    return;
  }
  let airflowTargets;
  try {
    airflowTargets = airflowTargetsFromRoomForm();
  } catch (error) {
    roomDialogError.textContent = error instanceof Error ? error.message : "Airflow target is invalid.";
    return;
  }
  if (editingZoneId) {
    const zoneId = editingZoneId;
    if (commitCommand({
      type: "zone.updateMetadata",
      zoneId,
      name,
      use: roomUseInput.value,
      ventilationRole: roomVentilationRoleInput.value,
      airflowTargets,
    }, "Zone metadata updated")) {
      selectedZoneId = zoneId;
      roomDialog.close();
      clearRoomDialogState();
      render();
    }
    return;
  }
  if (editingRoomId) {
    const roomId = editingRoomId;
    if (commitCommand({
      type: "room.updateMetadata",
      roomId,
      name,
      use: roomUseInput.value,
      ventilationRole: roomVentilationRoleInput.value,
      airflowTargets,
    }, "Room metadata updated")) {
      selectedRoomId = roomId;
      roomDialog.close();
      clearRoomDialogState();
      render();
    }
    return;
  }
  if (pendingZoneBoundaryKey && pendingZoneParentRoomId) {
    const zoneId = `zone-local-${zoneIdentityCounter}`;
    if (commitCommand({
      type: "zone.createFromBoundary",
      zoneId,
      parentRoomId: pendingZoneParentRoomId,
      boundaryKey: pendingZoneBoundaryKey,
      name,
      use: roomUseInput.value,
      ventilationRole: roomVentilationRoleInput.value,
      airflowTargets,
    }, "Ventilation zone confirmed from room-divider boundary")) {
      zoneIdentityCounter += 1;
      selectedRoomId = pendingZoneParentRoomId;
      selectedZoneId = zoneId;
      roomDialog.close();
      clearRoomDialogState();
      render();
    }
    return;
  }
  if (!pendingRoomBoundaryKey) {
    roomDialogError.textContent = "The eligible boundary is no longer available.";
    return;
  }
  const roomId = `room-local-${roomIdentityCounter}`;
  if (commitCommand({
    type: "room.createFromBoundary",
    roomId,
    floorId: "floor-ground",
    boundaryKey: pendingRoomBoundaryKey,
    name,
    use: roomUseInput.value,
    ventilationRole: roomVentilationRoleInput.value,
    airflowTargets,
  }, "Room confirmed from eligible wall boundary")) {
    roomIdentityCounter += 1;
    selectedRoomId = roomId;
    selectedZoneId = null;
    roomDialog.close();
    clearRoomDialogState();
    render();
  }
}

function cancelRoomDialog(message) {
  if (roomDialog.open) roomDialog.close();
  clearRoomDialogState();
  interactionMessage = message;
  render();
}

function clearRoomDialogState() {
  pendingRoomBoundaryKey = null;
  pendingZoneBoundaryKey = null;
  pendingZoneParentRoomId = null;
  editingRoomId = null;
  editingZoneId = null;
  roomDialogError.textContent = "";
}

function setRoomAirflowForm(space) {
  setAirflowTargetInputs("required", space?.airflowTargets?.normal?.required ?? null);
  setAirflowTargetInputs("assigned", space?.airflowTargets?.normal?.assigned ?? null);
}

function setAirflowTargetInputs(kind, target) {
  const inputs = airflowFormInputs(kind);
  const known = target?.state === "known";
  inputs.value.value = known ? String(target.inputValue) : "";
  inputs.unit.value = known ? target.inputUnit : "l/s";
  inputs.basis.value = known ? target.basis : "";
  inputs.source.value = known ? target.source : "";
}

function airflowTargetsFromRoomForm() {
  return {
    normal: {
      required: airflowTargetFromForm("required"),
      assigned: airflowTargetFromForm("assigned"),
    },
  };
}

function airflowTargetFromForm(kind) {
  const inputs = airflowFormInputs(kind);
  const raw = inputs.value.value.trim();
  if (!raw) {
    if (inputs.basis.value.trim() || inputs.source.value.trim()) {
      throw new TypeError(`${formatRoomChoice(kind)} airflow needs a value, or clear its basis and source to leave it unresolved.`);
    }
    return unresolvedAirflowTarget(`${kind} normal airflow not provided`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${formatRoomChoice(kind)} airflow must be a positive number.`);
  }
  const basis = inputs.basis.value.trim();
  const source = inputs.source.value.trim();
  if (!basis || !source) {
    throw new TypeError(`${formatRoomChoice(kind)} airflow requires both a basis and source.`);
  }
  return airflowTargetFromInput(value, inputs.unit.value, basis, source);
}

function airflowFormInputs(kind) {
  return kind === "required"
    ? {
        value: roomRequiredAirflowInput,
        unit: roomRequiredAirflowUnitInput,
        basis: roomRequiredAirflowBasisInput,
        source: roomRequiredAirflowSourceInput,
      }
    : {
        value: roomAssignedAirflowInput,
        unit: roomAssignedAirflowUnitInput,
        basis: roomAssignedAirflowBasisInput,
        source: roomAssignedAirflowSourceInput,
      };
}

function adoptRequiredAirflowInForm() {
  roomDialogError.textContent = "";
  const required = airflowFormInputs("required");
  if (!required.value.value.trim()) {
    roomDialogError.textContent = "Enter a required airflow before adopting it as the assigned target.";
    return;
  }
  const assigned = airflowFormInputs("assigned");
  assigned.value.value = required.value.value;
  assigned.unit.value = required.unit.value;
  assigned.basis.value = "Explicitly adopted from required Normal target";
  assigned.source.value = required.source.value;
  roomDialogError.textContent = "Required target copied into the form. The project is unchanged until Apply saves it as the assigned target.";
}

function setSpaceDialogLabels(kind) {
  const label = kind === "zone" ? "Zone" : "Room";
  roomNameLabel.childNodes[0].nodeValue = `${label} name\n          `;
  roomUseLabel.childNodes[0].nodeValue = `${label} use\n          `;
  roomRoleLabel.childNodes[0].nodeValue = `MVHR ${label.toLowerCase()} role\n          `;
}

function beginRoomReassignment() {
  const zone = history.present.zones.find((candidate) => candidate.id === selectedZoneId);
  if (zone) {
    reassignZoneId = zone.id;
    reassignRoomId = null;
    interactionMessage = "Choose an eligible shaded face within the same parent room; Esc cancels";
    render();
    return;
  }
  const room = history.present.rooms.find((candidate) => candidate.id === selectedRoomId);
  if (!room) return;
  reassignRoomId = room.id;
  reassignZoneId = null;
  interactionMessage = "Choose an eligible shaded face for this room; Esc cancels";
  render();
}

function openRemoveRoomDialog() {
  const zone = history.present.zones.find((candidate) => candidate.id === selectedZoneId);
  if (zone) {
    pendingRemoveZoneId = zone.id;
    pendingRemoveRoomId = null;
    removeRoomDialog.querySelector("h2").textContent = "Remove ventilation zone";
    removeRoomDialog.querySelector('[value="remove"]').textContent = "Remove zone";
    removeRoomMessage.textContent = `Remove “${zone.name}” from the project? The nonphysical divider remains. This action is undoable.`;
    removeRoomDialog.showModal();
    return;
  }
  const room = history.present.rooms.find((candidate) => candidate.id === selectedRoomId);
  if (!room) return;
  pendingRemoveRoomId = room.id;
  pendingRemoveZoneId = null;
  removeRoomDialog.querySelector("h2").textContent = "Remove room";
  removeRoomDialog.querySelector('[value="remove"]').textContent = "Remove room";
  removeRoomMessage.textContent = `Remove “${room.name}” from the project? Walls remain unchanged. This action is undoable.`;
  removeRoomDialog.showModal();
}

function applyRemoveRoomChoice() {
  const roomId = pendingRemoveRoomId;
  const zoneId = pendingRemoveZoneId;
  pendingRemoveRoomId = null;
  pendingRemoveZoneId = null;
  if (removeRoomDialog.returnValue !== "remove") {
    interactionMessage = "Room removal cancelled; project unchanged";
    render();
    return;
  }
  if (zoneId && commitCommand({ type: "zone.remove", zoneId }, "Zone removed; room divider preserved")) {
    selectedZoneId = null;
    reassignZoneId = null;
    render();
    return;
  }
  if (roomId && commitCommand({ type: "room.remove", roomId }, "Room removed; physical walls preserved")) {
    selectedRoomId = null;
    selectedZoneId = null;
    reassignRoomId = null;
    render();
  }
}

function openWallDeleteDialog() {
  if (activeTool !== "select" || deleteWallDialog.open) return;
  const wall = history.present.walls.find((candidate) => candidate.id === selectedWallId);
  if (!wall) return;
  pendingDeleteWallId = wall.id;
  const isDivider = wall.classification === "virtual" && wall.boundaryRole === "room-divider";
  const connectedCount = wallConnectedComponentIds(history.present, wall.id).length;
  deleteWallDialog.querySelector('[value="delete-connected"]').hidden = isDivider;
  deleteWallDialog.querySelector('[value="delete-wall"]').textContent = isDivider ? "Delete divider segment" : "Delete wall only";
  deleteWallDialog.querySelector("h2").textContent = isDivider ? "Delete room divider" : "Delete selected wall";
  deleteWallMessage.textContent = isDivider
    ? `Delete ${wall.id}? Confirmed zones that reference this divider must be removed or reassigned first. Physical walls are never included.`
    : connectedCount === 1
    ? `Delete ${wall.id}? Both choices remove this one isolated wall. Cancel leaves the project unchanged.`
    : `Delete only ${wall.id} and preserve its ${connectedCount - 1} connected neighbour${connectedCount === 2 ? "" : "s"}, or delete the whole ${connectedCount}-wall connected chain. Shared junctions survive when remaining walls still use them.`;
  deleteWallDialog.showModal();
}

function applyWallDeleteChoice() {
  const choice = deleteWallDialog.returnValue;
  const wallId = pendingDeleteWallId;
  pendingDeleteWallId = null;
  if (choice !== "delete-wall" && choice !== "delete-connected") {
    interactionMessage = "Wall deletion cancelled; project unchanged";
    render();
    return;
  }
  if (!wallId || !history.present.walls.some((wall) => wall.id === wallId)) {
    interactionMessage = "Selected wall no longer exists; project unchanged";
    render();
    return;
  }
  const connected = choice === "delete-connected";
  const committed = commitCommand({
    type: connected ? "wall.deleteConnected" : "wall.delete",
    wallId,
  }, connected ? "Connected wall chain deleted" : "Selected wall deleted; connected neighbours preserved");
  if (committed) {
    selectedWallId = null;
    selectedNodeId = null;
    render();
  }
}

function openClearVentilationDialog() {
  if (activeTask !== "ventilation" || clearVentilationDialog.open) return;
  const floor = currentFloor();
  if (!floor) return;
  const inspection = inspectFloorVentilationClear(history.present, floor.id);
  if (inspection.isEmpty) {
    interactionMessage = `No ventilation objects exist on ${floor.name}; project unchanged`;
    render();
    return;
  }
  if (activeTool !== "select") setTool("select");
  pendingClearVentilationFloorId = floor.id;
  const details = [
    countLabel(inspection.componentCount, "part"),
    countLabel(inspection.terminalCount, "outlet"),
    countLabel(inspection.assemblyCount, "equipment assembly", "equipment assemblies"),
    countLabel(inspection.routeCount, "duct/route"),
    countLabel(inspection.connectionCount, "direct connection"),
    countLabel(inspection.associationCount, "room/zone association"),
    countLabel(inspection.ductRunSettingCount, "explicit outlet run setting"),
  ];
  clearVentilationMessage.textContent = `Clear ${floor.name}: ${details.join(" · ")}?`;
  const blocked = inspection.blockingConnectionIds.length > 0;
  clearVentilationWarning.textContent = blocked
    ? `Blocked: ${countLabel(inspection.blockingConnectionIds.length, "direct connection")} links this floor to equipment on another floor (${inspection.blockingConnectionIds.join(", ")}). Disconnect it explicitly before clearing.`
    : "Only ventilation objects on this floor will be removed.";
  confirmClearVentilationButton.disabled = blocked;
  clearVentilationDialog.showModal();
}

function applyClearVentilationChoice() {
  const floorId = pendingClearVentilationFloorId;
  pendingClearVentilationFloorId = null;
  if (clearVentilationDialog.returnValue !== "clear") {
    interactionMessage = "Ventilation clear cancelled; project unchanged";
    render();
    return;
  }
  const floor = history.present.floors.find((candidate) => candidate.id === floorId);
  if (!floor) {
    interactionMessage = "The active floor is no longer available; project unchanged";
    render();
    return;
  }
  if (commitCommand({
    type: "ventilation.clearFloor",
    floorId,
  }, `${floor.name} ventilation cleared; building and reference work preserved`)) {
    mechanicalState = clearMechanicalSelection(mechanicalState);
    selectedRouteId = null;
    selectedRoutePointIndex = null;
    componentDragState = null;
    routePointDragState = null;
    render();
  }
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function applyHistoryChange(nextHistory, message) {
  if (nextHistory.present === history.present) return;
  history = nextHistory;
  portableDirty = true;
  if (activeTool === "place-component" || activeTool === "place-assembly" || activeTool === "route") setTool("select");
  selectedWallId = null;
  selectedNodeId = null;
  selectedRoomId = null;
  selectedZoneId = null;
  selectedFloorAreaId = null;
  selectedRouteId = null;
  selectedRoutePointIndex = null;
  reassignRoomId = null;
  reassignZoneId = null;
  mechanicalState = clearMechanicalSelection(mechanicalState);
  cancelDraft("");
  interactionMessage = message;
  render();
  savePresent("automatic");
}

function savePresent(reason) {
  queueWorkingSession(true);
  storageState = { kind: "pending", label: reason === "explicit" ? "Saving project…" : "Storing recovery…", detail: "This browser only · not cloud" };
  renderStorageState();
  const result = reason === "explicit"
    ? projectLibrary.saveProject(history.present, currentProjectName)
    : {ok:true,recoveryPending:true,savedAtUtc:new Date().toISOString()};
  if (result.ok) {
    if (reason === "explicit") {
      currentProjectName = result.name;
      savedProjectName = result.name;
      savedProjectJson = serializeProject(history.present);
      interactionMessage = `“${currentProjectName}” saved in this browser`;
    }
    storageState = result.portableBudget?.portable === false
      ? {
          kind: "warning",
          label: "Oversized project preserved locally",
          detail: `${result.portableBudget.totalBytes.toLocaleString()} / ${result.portableBudget.maximumBytes.toLocaleString()} portable bytes · export blocked`,
        }
      : projectHasUnsavedChanges()
        ? {
            kind: "unsaved",
            label: result.recoveryPending?"Unsaved changes · storing recovery…":"Unsaved changes · recovery stored",
            detail: "This browser only · choose Save to update the named project",
          }
      : {
          kind: "saved",
          label: `Saved · ${currentProjectName}`,
          detail: `${formatSavedAt(result.savedAtUtc)} · this browser only · not cloud`,
        };
  } else {
    storageState = {
      kind: "failed",
      label: reason === "explicit" ? "Project save failed" : "Recovery save failed",
      detail: `${result.message}. ${result.previousValidRetained ? "Previous valid saved project retained" : "No durable save acknowledgement"}`,
    };
    interactionMessage = `Save failed: ${result.message}. Keep this drawing open and use Export project for a file backup before refreshing.`;
  }
  if(reason!=="explicit" && cloudSession?.workspace)storageState={kind:"unsaved",label:"Unsaved changes · choose Save",detail:currentCloudRecord?"Device recovery is separate from Save":result.ok?"Local recovery retained; cloud save not acknowledged":"Local recovery is full; keep this drawing open and choose Save or Export project"};
  renderStorageState();
  updateStatus();
  if (activeTask === "project") renderProjectWorkspace();
  return result.ok;
}

function projectHasUnsavedChanges() {
  return savedProjectJson !== serializeProject(history.present) || savedProjectName !== currentProjectName;
}

function applyLocalReopen(result, options = {}) {
  if(!workingRestoring)workingActivity++;
  queueWorkingSession();
  currentCloudRecord=null;cloudBindingVersion++;
  if (dragState) cancelPointEdit();
  if (floorAreaDragState) cancelFloorAreaPointEdit();
  if (componentDragState) cancelComponentMove();
  cancelDraft("");
  cancelCalibration("");
  history = createCommandHistory(result.project);
  portableDirty = true;
  identityCounter = nextIdentityCounter(result.project);
  referenceIdentityCounter = nextReferenceIdentityCounter(result.project);
  cadReferenceIdentityCounter = nextCadReferenceIdentityCounter(result.project);
  componentIdentityCounter = nextComponentIdentityCounter(result.project);
  equipmentAssemblyIdentityCounter = nextEquipmentAssemblyIdentityCounter(result.project);
  routeIdentityCounter = nextRouteIdentityCounter(result.project);
  roomIdentityCounter = nextRoomIdentityCounter(result.project);
  zoneIdentityCounter = nextZoneIdentityCounter(result.project);
  floorAreaIdentityCounter = nextFloorAreaIdentityCounter(result.project);
  mechanicalState = createMechanicalInteractionState();
  selectedWallId = null;
  selectedNodeId = null;
  selectedRoomId = null;
  selectedZoneId = null;
  selectedFloorAreaId = null;
  reassignRoomId = null;
  reassignZoneId = null;
  selectedReferenceId = result.project.floorReferences[0]?.id ?? null;
  dxfImportController.cancel();
  if (options.named !== false) {
    currentProjectName = result.name ?? result.metadata?.name ?? currentProjectName;
    savedProjectName = currentProjectName;
    savedProjectJson = serializeProject(result.project);
    projectLibrary.setActiveProject(result.project.id);
  }
  storageState = options.named === false
    ? { kind: "unsaved", label: "Unsaved imported project", detail: "This browser only · choose Save or Save As" }
    : initialStorageState(result);
  setTool("select");
  interactionMessage = options.message ?? (result.portableBudget?.portable === false
    ? "Reopened oversized legacy device save; data preserved locally; portable export is blocked and size-increasing edits are rejected"
    : result.recoveredFromInvalidCurrent
      ? "Reopened previous valid device save; undo history reset; current invalid record rejected"
      : `Opened “${currentProjectName}” from this browser; undo history reset`);
  initialCameraFit.arm();
  setTask("project");
  render();
}

async function exportProject() {
  exportButton.disabled = true;
  interactionMessage = "Validating portable project…";
  updateStatus();
  try {
    const encoded = await exportPortableProject(history.present, {
      pdfjs: pdfjsLib,
      pdfResourceUrls: PDF_RESOURCE_URLS,
    });
    const url = URL.createObjectURL(new Blob([encoded], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${history.present.id}.hiperstudio.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    portableDirty = false;
    interactionMessage = "Portable project exported with embedded reference bytes; no authority restored";
  } catch (error) {
    interactionMessage = `Export failed; open project preserved: ${error.message}`;
  } finally {
    exportButton.disabled = false;
    render();
  }
}

async function stagePortableOpen() {
  const file = portableFileInput.files?.[0];
  portableFileInput.value = "";
  if (!file) return;
  if (file.size > MAX_PORTABLE_TEXT_BYTES) {
    interactionMessage = `Open rejected: portable project exceeds the ${MAX_PORTABLE_TEXT_BYTES}-byte text limit`;
    render();
    return;
  }
  openButton.disabled = true;
  interactionMessage = "Validating portable project before replacement…";
  updateStatus();
  try {
    const imported = await importPortableProject(await file.text(), {
      pdfjs: pdfjsLib,
      pdfResourceUrls: PDF_RESOURCE_URLS,
    });
    pendingPortableOpen = imported;
    requestProjectTransition(() => {
      applyPortableOpen(imported);
      pendingPortableOpen = null;
    }, "Opening this portable backup will replace the current project and cancel incomplete drawing operations.");
  } catch (error) {
    pendingPortableOpen = null;
    interactionMessage = `Open failed; current project preserved: ${error.message}`;
    render();
  } finally {
    openButton.disabled = false;
  }
}

function applyPortableOpen(imported) {
  currentCloudRecord=null;cloudBindingVersion++;
  history = createCommandHistory(imported.project);
  identityCounter = nextIdentityCounter(imported.project);
  referenceIdentityCounter = nextReferenceIdentityCounter(imported.project);
  cadReferenceIdentityCounter = nextCadReferenceIdentityCounter(imported.project);
  componentIdentityCounter = nextComponentIdentityCounter(imported.project);
  equipmentAssemblyIdentityCounter = nextEquipmentAssemblyIdentityCounter(imported.project);
  routeIdentityCounter = nextRouteIdentityCounter(imported.project);
  roomIdentityCounter = nextRoomIdentityCounter(imported.project);
  zoneIdentityCounter = nextZoneIdentityCounter(imported.project);
  floorAreaIdentityCounter = nextFloorAreaIdentityCounter(imported.project);
  mechanicalState = createMechanicalInteractionState();
  selectedWallId = null;
  selectedNodeId = null;
  selectedRoomId = null;
  selectedZoneId = null;
  selectedFloorAreaId = null;
  reassignRoomId = null;
  reassignZoneId = null;
  selectedReferenceId = imported.project.floorReferences[0]?.id ?? null;
  dxfImportController.cancel();
  draftPoints = [];
  floorAreaDraftPoints = [];
  activeChainId = null;
  hoverPoint = null;
  dragState = null;
  floorAreaDragState = null;
  componentDragState = null;
  calibrationState = null;
  portableDirty = imported.portableBudget.portable === false;
  currentProjectName = imported.project.projectDetails.name || "Imported project";
  savedProjectName = null;
  savedProjectJson = null;
  setTool("select");
  savePresent("automatic");
  initialCameraFit.arm();
  interactionMessage = imported.portableBudget.portable === false
    ? `Portable project opened safely${imported.migration.migrated ? ` and migrated from schema ${imported.migration.fromSchemaVersion}` : ""}; migrated state exceeds the current portable budget, remains saved locally, and cannot grow`
    : imported.migration.migrated
      ? `Portable project opened and migrated from schema ${imported.migration.fromSchemaVersion}; undo history reset; no authority restored`
      : "Portable project opened; undo history reset; no authority restored";
  setTask("project");
  render();
}

async function addReferenceImage() {
  const file = referenceFileInput.files?.[0];
  referenceFileInput.value = "";
  if (!file) return;
  addReferenceButton.disabled = true;
  interactionMessage = "Validating PNG source…";
  updateStatus();
  try {
    if (file.type !== "image/png") throw new TypeError("Only PNG reference images are supported in this milestone");
    if (file.size > MAX_IMAGE_BYTES) throw new RangeError("PNG exceeds the 5 MiB prototype limit");
    const bytes = new Uint8Array(await file.arrayBuffer());
    validateImageBytes(bytes, file.type);
    const dimensions = pngDimensions(bytes);
    const bitmap = await createImageBitmap(file);
    if (bitmap.width !== dimensions.widthPx || bitmap.height !== dimensions.heightPx) {
      bitmap.close();
      throw new TypeError("Decoded PNG dimensions do not match its header");
    }
    bitmap.close();
    const suffix = referenceIdentityCounter++;
    const assetId = `reference-asset-${suffix}`;
    const referenceId = `floor-reference-${suffix}`;
    const added = commitCommand({
      type: "reference.addImage",
      asset: {
        id: assetId,
        kind: "image",
        fileName: file.name,
        mediaType: file.type,
        byteLength: bytes.byteLength,
        sha256: await sha256Hex(bytes),
        widthPx: dimensions.widthPx,
        heightPx: dimensions.heightPx,
        dataUrl: bytesToDataUrl(bytes, file.type),
      },
      reference: {
        id: referenceId,
        floorId: "floor-ground",
        assetId,
        visible: true,
        locked: true,
        opacity: 0.55,
        transform: {
          translationMm: { x: camera.x * MILLIMETRES_PER_VIEW_UNIT, y: camera.y * MILLIMETRES_PER_VIEW_UNIT },
          rotationRad: 0,
          scaleMmPerPixel: unknownMm("reference not calibrated"),
        },
        calibration: null,
      },
    }, "PNG reference embedded and placed on a locked, uncalibrated layer");
    if (added) {
      selectedReferenceId = referenceId;
      render();
      fitView();
    }
  } catch (error) {
    interactionMessage = `Reference import failed; current project preserved: ${error.message}`;
    render();
  } finally {
    addReferenceButton.disabled = false;
  }
}

async function stagePdfReference() {
  const file = pdfReferenceFileInput.files?.[0];
  pdfReferenceFileInput.value = "";
  if (!file) return;
  await discardPendingPdfReference();
  if (pdfImportDialog.open) pdfImportDialog.close();
  pdfImportError.textContent = "";
  acceptPdfImportButton.disabled = true;
  addPdfReferenceButton.disabled = true;
  interactionMessage = `Inspecting ${file.name} locally with PDF.js…`;
  updateStatus();
  try {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      throw new TypeError("Choose a PDF file");
    }
    if (file.size > MAX_PDF_SOURCE_BYTES) {
      throw new RangeError(`PDF exceeds the ${MAX_PDF_SOURCE_BYTES}-byte source limit`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const opened = await openPdfForReference(pdfjsLib, bytes, {
      fileName: file.name,
      ...PDF_RESOURCE_URLS,
    });
    pendingPdfImport = {
      bytes,
      descriptor: null,
      fileName: file.name,
      opened,
    };
    pdfImportSummary.textContent = `${file.name} · ${opened.pageCount} page${opened.pageCount === 1 ? "" : "s"} · original source retained locally in this project`;
    pdfPageChoice.replaceChildren();
    for (let pageNumber = 1; pageNumber <= opened.pageCount; pageNumber += 1) {
      const label = opened.pageLabels?.[pageNumber - 1];
      pdfPageChoice.append(new Option(
        label ? `Page ${pageNumber} · ${label}` : `Page ${pageNumber}`,
        String(pageNumber),
      ));
    }
    pdfPageChoice.value = "1";
    pdfImportDialog.showModal();
    await renderPendingPdfPage();
  } catch (error) {
    await discardPendingPdfReference();
    interactionMessage = `PDF import failed; current project preserved: ${error.message}`;
    render();
  } finally {
    addPdfReferenceButton.disabled = false;
  }
}

async function renderPendingPdfPage() {
  if (!pendingPdfImport) return;
  const revision = ++pdfRenderRevision;
  const pageNumber = Number.parseInt(pdfPageChoice.value, 10);
  acceptPdfImportButton.disabled = true;
  pdfPageChoice.disabled = true;
  pdfImportError.textContent = "";
  pdfPageDetail.textContent = `Preparing page ${pageNumber} within the bounded preview limits…`;
  try {
    const descriptor = await renderPdfPageToCanvas(
      pendingPdfImport.opened,
      pageNumber,
      pdfPagePreview,
    );
    if (revision !== pdfRenderRevision || !pendingPdfImport) return;
    pendingPdfImport.descriptor = descriptor;
    pdfPageDetail.textContent = `${descriptor.widthPt.toFixed(1)} × ${descriptor.heightPt.toFixed(1)} pt · ${descriptor.widthPx} × ${descriptor.heightPx} px render · page ${descriptor.pageNumber} of ${descriptor.pageCount}${descriptor.pageLabel ? ` · label ${descriptor.pageLabel}` : ""}`;
    acceptPdfImportButton.disabled = false;
  } catch (error) {
    if (revision !== pdfRenderRevision) return;
    pendingPdfImport.descriptor = null;
    pdfImportError.textContent = error.message;
    pdfPageDetail.textContent = "This page could not be prepared; no project data was changed.";
  } finally {
    if (revision === pdfRenderRevision) pdfPageChoice.disabled = false;
  }
}

async function acceptPdfReference(event) {
  event.preventDefault();
  if (!pendingPdfImport?.descriptor) {
    pdfImportError.textContent = "Wait for the selected page preview to finish.";
    return;
  }
  acceptPdfImportButton.disabled = true;
  pdfPageChoice.disabled = true;
  pdfImportError.textContent = "";
  try {
    const pngBytes = await canvasToPngBytes(pdfPagePreview);
    validateImageBytes(pngBytes, "image/png");
    const dimensions = pngDimensions(pngBytes);
    const suffix = referenceIdentityCounter;
    const pdfAssetId = `pdf-reference-source-${suffix}`;
    const assetId = `reference-asset-${suffix}`;
    const referenceId = `floor-reference-${suffix}`;
    const { bytes, descriptor, fileName, opened } = pendingPdfImport;
    const committed = commitCommand({
      type: "reference.addPdfPage",
      pdfAsset: {
        id: pdfAssetId,
        kind: "pdf",
        fileName,
        mediaType: "application/pdf",
        byteLength: bytes.byteLength,
        sha256: await sha256Hex(bytes),
        pageCount: opened.pageCount,
        importerId: PDF_IMPORTER.id,
        importerVersion: PDF_IMPORTER.version,
        dataUrl: bytesToDataUrl(bytes, "application/pdf"),
      },
      asset: {
        id: assetId,
        kind: "image",
        fileName: `${fileName} · page ${descriptor.pageNumber}`,
        mediaType: "image/png",
        byteLength: pngBytes.byteLength,
        sha256: await sha256Hex(pngBytes),
        widthPx: dimensions.widthPx,
        heightPx: dimensions.heightPx,
        dataUrl: bytesToDataUrl(pngBytes, "image/png"),
        source: {
          kind: "pdf-page",
          pdfAssetId,
          pageNumber: descriptor.pageNumber,
          pageCount: descriptor.pageCount,
          pageLabel: descriptor.pageLabel,
          widthPt: descriptor.widthPt,
          heightPt: descriptor.heightPt,
          rotationDeg: descriptor.rotationDeg,
          renderScale: descriptor.renderScale,
          rendererId: PDF_IMPORTER.id,
          rendererVersion: PDF_IMPORTER.version,
        },
      },
      reference: {
        id: referenceId,
        floorId: "floor-ground",
        assetId,
        visible: true,
        locked: true,
        opacity: 0.55,
        transform: {
          translationMm: {
            x: camera.x * MILLIMETRES_PER_VIEW_UNIT,
            y: camera.y * MILLIMETRES_PER_VIEW_UNIT,
          },
          rotationRad: 0,
          scaleMmPerPixel: unknownMm("PDF reference not calibrated"),
        },
        calibration: null,
      },
    }, `PDF page ${descriptor.pageNumber} embedded and placed on a locked, uncalibrated layer`);
    if (!committed) {
      pdfImportError.textContent = interactionMessage;
      return;
    }
    referenceIdentityCounter += 1;
    selectedReferenceId = referenceId;
    await discardPendingPdfReference();
    pdfImportDialog.close();
    fitView();
  } catch (error) {
    pdfImportError.textContent = error.message;
    interactionMessage = `PDF placement failed; current project preserved: ${error.message}`;
    updateStatus();
  } finally {
    if (pendingPdfImport) {
      acceptPdfImportButton.disabled = pendingPdfImport.descriptor === null;
      pdfPageChoice.disabled = false;
    }
  }
}

async function cancelPdfReference(message) {
  await discardPendingPdfReference();
  if (pdfImportDialog.open) pdfImportDialog.close();
  pdfImportError.textContent = "";
  if (message) interactionMessage = message;
  render();
}

async function discardPendingPdfReference() {
  pdfRenderRevision += 1;
  const pending = pendingPdfImport;
  pendingPdfImport = null;
  if (pending) await closePdfReference(pending.opened);
}

async function canvasToPngBytes(sourceCanvas) {
  const blob = await new Promise((resolve, reject) => {
    sourceCanvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new TypeError("The selected PDF page could not be encoded as PNG"));
    }, "image/png");
  });
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new RangeError(`Rendered PDF page exceeds the ${MAX_IMAGE_BYTES}-byte PNG limit`);
  }
  return new Uint8Array(await blob.arrayBuffer());
}

async function stageDxfReference() {
  const file = dxfReferenceFileInput.files?.[0];
  dxfReferenceFileInput.value = "";
  if (!file) return;
  dxfImportController.cancel();
  if (dxfImportDialog.open) dxfImportDialog.close();
  dxfImportError.textContent = "";
  if (!/\.dxf$/i.test(file.name)) {
    interactionMessage = "DXF import failed; current project preserved: choose a .dxf text file";
    render();
    return;
  }
  if (file.size > MAX_DXF_TEXT_BYTES) {
    interactionMessage = `DXF import failed; current project preserved: source exceeds the ${MAX_DXF_TEXT_BYTES}-byte prototype limit`;
    render();
    return;
  }
  interactionMessage = `Inspecting ${file.name} as bounded synthetic AC1015 DXF…`;
  updateStatus();
  const result = await dxfImportController.selectFile({
    fileName: file.name,
    loadText: () => file.text(),
  });
  if (result.stale) return;
  if (result.state.status === "failed") {
    interactionMessage = `DXF import failed; current project preserved: ${result.state.errorMessage}`;
    render();
    return;
  }
  showDxfReview(result.state);
}

function showDxfReview(state) {
  const candidate = state.candidate;
  dxfImportSummary.textContent = `${candidate.source.fileName} · ${candidate.counts.expandedEntities} supported geometry item${candidate.counts.expandedEntities === 1 ? "" : "s"} · ${candidate.counts.omittedEntities} omitted · ${candidate.source.byteLength.toLocaleString()} bytes`;
  dxfUnitChoice.value = "";
  for (const option of dxfUnitChoice.options) {
    option.disabled = Boolean(
      option.value &&
      candidate.declaredUnits.status === "declared-supported" &&
      option.value !== candidate.declaredUnits.unit
    );
  }
  dxfDeclaredUnits.textContent = candidate.declaredUnits.status === "declared-supported"
    ? `File declares ${candidate.declaredUnits.unit}; select it explicitly to confirm.`
    : `File units are ${candidate.declaredUnits.status}; choose the verified source unit explicitly.`;
  dxfLayerChoices.replaceChildren();
  for (const layer of candidate.layers) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = layer.name;
    input.addEventListener("change", updateDxfLayerChoices);
    const label = document.createElement("label");
    label.append(input, htmlText("span", `${layer.name} · ${layer.entityCount} item${layer.entityCount === 1 ? "" : "s"}`));
    dxfLayerChoices.append(label);
  }
  dxfDiagnostics.replaceChildren();
  if (candidate.diagnostics.length === 0) {
    dxfDiagnostics.append(htmlText("span", "No inspection diagnostics."));
  } else {
    for (const diagnostic of candidate.diagnostics) {
      const location = [
        diagnostic.sourceEntityType,
        diagnostic.sourceHandle ? `handle ${diagnostic.sourceHandle}` : null,
        diagnostic.layer ? `layer ${diagnostic.layer}` : null,
        diagnostic.sourceLine ? `line ${diagnostic.sourceLine}` : null,
      ].filter(Boolean).join(" · ");
      dxfDiagnostics.append(htmlText(
        "span",
        `${diagnostic.severity.toUpperCase()} · ${diagnostic.code}${location ? ` · ${location}` : ""} — ${diagnostic.message}`,
        diagnostic.severity,
      ));
    }
  }
  dxfPartialChoice.hidden = !candidate.partialAcceptanceRequired;
  dxfAcceptPartial.checked = false;
  dxfImportError.textContent = candidate.blockingDiagnosticCount > 0
    ? "This file has blocking diagnostics and cannot be placed. Cancel leaves the project unchanged."
    : "";
  updateDxfAcceptState();
  if (!dxfImportDialog.open) dxfImportDialog.showModal();
}

function updateDxfUnitChoice() {
  dxfImportError.textContent = "";
  try {
    if (dxfUnitChoice.value) dxfImportController.chooseUnits(dxfUnitChoice.value);
  } catch (error) {
    dxfUnitChoice.value = "";
    dxfImportError.textContent = error.message;
  }
  updateDxfAcceptState();
}

function updateDxfLayerChoices() {
  const selected = [...dxfLayerChoices.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => input.value);
  dxfImportController.chooseLayers(selected);
  dxfImportError.textContent = "";
  updateDxfAcceptState();
}

function updateDxfPartialAcceptance() {
  dxfImportController.acceptPartialImport(dxfAcceptPartial.checked);
  dxfImportError.textContent = "";
  updateDxfAcceptState();
}

function updateDxfAcceptState() {
  const state = dxfImportController.getState();
  acceptDxfImportButton.disabled = !(
    state.status === "review" &&
    state.unitChoiceConfirmed &&
    state.layerSelectionConfirmed &&
    state.includedLayers.length > 0 &&
    state.candidate.geometry.some((item) => state.includedLayers.includes(item.layer)) &&
    state.candidate.blockingDiagnosticCount === 0 &&
    (!state.candidate.partialAcceptanceRequired || state.partialImportAccepted)
  );
}

function acceptDxfReference(event) {
  event.preventDefault();
  const state = dxfImportController.getState();
  if (state.status !== "review") return;
  const bounds = state.candidate.sourceBoundsUnits;
  const localOriginSource = bounds
    ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
    : { x: 0, y: 0 };
  const suffix = cadReferenceIdentityCounter;
  try {
    const command = dxfImportController.prepareAcceptance({
      assetId: `cad-reference-asset-${suffix}`,
      referenceId: `floor-cad-reference-${suffix}`,
      floorId: "floor-ground",
      transform: {
        localOriginSource,
        translationMm: {
          x: (camera.x + camera.width / 2) * MILLIMETRES_PER_VIEW_UNIT,
          y: (camera.y + camera.height / 2) * MILLIMETRES_PER_VIEW_UNIT,
        },
        rotationRad: 0,
      },
      visible: true,
      opacity: 0.55,
    });
    const committed = commitCommand(
      command,
      state.candidate.partialAcceptanceRequired
        ? "Synthetic DXF reference placed with accepted diagnosed omissions; no walls created"
        : "Synthetic DXF reference placed on a locked layer; no walls created",
    );
    if (!committed) return;
    cadReferenceIdentityCounter += 1;
    dxfImportController.complete();
    dxfImportDialog.close();
    fitView();
  } catch (error) {
    dxfImportError.textContent = error.message;
    interactionMessage = `DXF placement failed; current project preserved: ${error.message}`;
    updateStatus();
  }
}

function cancelDxfReference(message) {
  dxfImportController.cancel();
  if (dxfImportDialog.open) dxfImportDialog.close();
  dxfImportError.textContent = "";
  interactionMessage = message;
  render();
}

function startCalibration() {
  const reference = selectedReference();
  if (!reference) return;
  cancelDraft("");
  const floorGeometry = floorPlanGeometryCount(reference.floorId);
  calibrationState = {
    referenceId: reference.id,
    sourcePoints: [],
    worldPoints: [],
    hasFloorGeometry: floorGeometry.total > 0,
    hasBlockingServiceGeometry: floorGeometry.components > 0 || floorGeometry.routePoints > 0,
  };
  calibrationScope.hidden = floorGeometry.total === 0;
  calibrationScopeSummary.textContent = floorGeometry.total === 0
    ? ""
    : `${floorGeometry.wallNodes} wall nodes, ${floorGeometry.floorAreaVertices} building-outline vertices, ${floorGeometry.components} placed parts and ${floorGeometry.routePoints} route points are on this floor. Choose explicitly; Cancel changes nothing.`;
  for (const option of document.querySelectorAll('input[name="calibration-scope"]')) option.checked = false;
  calibrationRescaleChoice.disabled = calibrationState.hasBlockingServiceGeometry;
  calibrationRescaleDetail.textContent = calibrationState.hasBlockingServiceGeometry
    ? "Unavailable while this floor contains placed parts or routes because scaling product offsets, typed dimensions and interior route geometry together is not yet defined. Choose Reference only or Cancel."
    : "Scale wall-node and building-outline XY positions uniformly about the first calibration point. Heights, Z values, wall thicknesses, other floors and independent references stay unchanged.";
  setTool("calibrate");
  interactionMessage = "Calibration: click two distinct points on the image; no change occurs until Apply";
  render();
}

function addCalibrationPoint(event) {
  const reference = selectedReference();
  const asset = reference && history.present.referenceAssets.find((candidate) => candidate.id === reference.assetId);
  if (!reference || !asset || !calibrationState) return;
  const world = eventToSvgWorld(event);
  const source = worldPointToSource(reference.transform, world, effectiveReferenceScale(reference));
  if (source.x < 0 || source.y < 0 || source.x > asset.widthPx || source.y > asset.heightPx) {
    interactionMessage = "Calibration point must be inside the selected image";
    updateStatus();
    return;
  }
  const prior = calibrationState.sourcePoints[0];
  if (prior && Math.hypot(source.x - prior.x, source.y - prior.y) < 1e-9) {
    interactionMessage = "Calibration points must be distinct";
    updateStatus();
    return;
  }
  calibrationState.sourcePoints.push(source);
  calibrationState.worldPoints.push(world);
  renderDraft();
  if (calibrationState.sourcePoints.length === 2) {
    calibrationDistance.value = "";
    calibrationUnit.value = "m";
    calibrationError.textContent = "";
    calibrationDialog.showModal();
    calibrationDistance.focus();
  } else {
    interactionMessage = "First calibration point set; click the second point";
    updateStatus();
  }
}

function applyCalibration(event) {
  event.preventDefault();
  const numericDistance = Number(calibrationDistance.value);
  if (!Number.isFinite(numericDistance) || numericDistance <= 0) {
    calibrationError.textContent = "Enter a finite distance greater than zero.";
    return;
  }
  if (!calibrationState || calibrationState.sourcePoints.length !== 2) {
    calibrationError.textContent = "Two image points are required.";
    return;
  }
  const scopeChoice = document.querySelector('input[name="calibration-scope"]:checked')?.value ?? null;
  if (calibrationState.hasFloorGeometry && scopeChoice === null) {
    calibrationError.textContent = "Choose whether to scale only the reference or this floor’s authored XY geometry too.";
    return;
  }
  const unit = calibrationUnit.value;
  const knownDistanceMm = unit === "m" ? numericDistance * 1000 : numericDistance;
  const reference = selectedReference();
  const [sourcePointApx, sourcePointBpx] = calibrationState.sourcePoints;
  const committed = commitCommand({
    type: "reference.calibrate",
    referenceId: calibrationState.referenceId,
    sourcePointApx,
    sourcePointBpx,
    knownDistanceMm,
    inputUnit: unit,
    acceptedAtUtc: new Date().toISOString(),
    previewScaleMmPerPixel: effectiveReferenceScale(reference),
    rescaleFloorModel: scopeChoice === "reference-and-floor-walls",
  }, scopeChoice === "reference-and-floor-walls"
    ? "Reference and this floor’s authored wall/outline XY geometry scaled about the calibration anchor"
    : "Reference calibrated; authoritative drawing geometry remains unchanged");
  if (!committed) {
    calibrationError.textContent = interactionMessage;
    return;
  }
  calibrationDialog.close();
  calibrationState = null;
  setTool("select");
  fitView();
}

function cancelCalibration(message) {
  if (calibrationDialog.open) calibrationDialog.close();
  calibrationState = null;
  if (activeTool === "calibrate") setTool("select");
  if (message) interactionMessage = message;
  render();
}

function startReferenceCrop() {
  const reference = selectedReference();
  const asset = reference && history.present.referenceAssets.find((candidate) => candidate.id === reference.assetId);
  if (!reference || !asset || asset.source?.kind !== "pdf-page") return;
  cancelDraft("");
  referenceCropState = {
    referenceId: reference.id,
    pointerId: null,
    startSourcePoint: null,
    currentSourcePoint: null,
    stagedSourceRectPx: null,
  };
  setTool("crop-reference");
  fitView();
  interactionMessage = reference.cropSourceRectPx
    ? "Adjust crop: the full PDF page is shown temporarily · drag a new rectangle · Esc cancels"
    : "Crop PDF: drag a rectangle around the floor plan · Esc cancels";
  render();
}

function applyReferenceCrop(event) {
  event.preventDefault();
  const crop = referenceCropState?.stagedSourceRectPx;
  if (!referenceCropState || !crop) {
    referenceCropError.textContent = "Drag a valid crop rectangle before applying.";
    return;
  }
  const referenceId = referenceCropState.referenceId;
  const committed = commitCommand({
    type: "reference.setCrop",
    referenceId,
    cropSourceRectPx: crop,
  }, "PDF crop applied; original bytes, calibration and authored geometry unchanged");
  if (!committed) {
    referenceCropError.textContent = interactionMessage;
    return;
  }
  referenceCropState = null;
  referenceCropDialog.close();
  setTool("select");
  fitView();
}

function resetReferenceCrop() {
  const reference = selectedReference();
  if (!reference?.cropSourceRectPx) return;
  if (commitCommand({
    type: "reference.resetCrop",
    referenceId: reference.id,
  }, "PDF crop reset; full page visible and original project geometry unchanged")) {
    fitView();
  }
}

function cancelReferenceCrop(message) {
  if (referenceCropDialog.open) referenceCropDialog.close();
  if (referenceCropState?.pointerId !== null && referenceCropState?.pointerId !== undefined && canvas.hasPointerCapture(referenceCropState.pointerId)) {
    canvas.releasePointerCapture(referenceCropState.pointerId);
  }
  referenceCropState = null;
  setTool("select");
  interactionMessage = message;
  render();
}

function referenceSourcePointFromEvent(event, reference) {
  return worldPointToSource(reference.transform, eventToSvgWorld(event), effectiveReferenceScale(reference));
}

function sourcePointInsideAsset(point, asset) {
  return Boolean(point && asset) && point.x >= 0 && point.y >= 0 && point.x <= asset.widthPx && point.y <= asset.heightPx;
}

function cropRectFromPoints(first, second) {
  return {
    x: roundCropCoordinate(Math.min(first.x, second.x)),
    y: roundCropCoordinate(Math.min(first.y, second.y)),
    width: roundCropCoordinate(Math.abs(second.x - first.x)),
    height: roundCropCoordinate(Math.abs(second.y - first.y)),
  };
}

function roundCropCoordinate(value) {
  return Math.round(value * 1000) / 1000;
}

function selectedReference() {
  return history.present.floorReferences.find((reference) => reference.id === selectedReferenceId) ?? null;
}

function effectiveReferenceScale(reference) {
  return referenceScaleMmPerPixel(reference) ?? PREVIEW_SCALE_MM_PER_PIXEL;
}

function floorPlanGeometryCount(floorId) {
  const wallNodes = history.present.wallNodes.filter((node) => node.floorId === floorId).length;
  const floorAreaVertices = history.present.floorAreaOutlines
    .filter((outline) => outline.floorId === floorId)
    .reduce((sum, outline) => sum + outline.vertices.length, 0);
  const components = history.present.components.filter((component) => component.floorId === floorId).length;
  const routePoints = history.present.routes
    .filter((route) => route.floorId === floorId)
    .reduce((sum, route) => sum + route.points.length, 0);
  return {
    wallNodes,
    floorAreaVertices,
    components,
    routePoints,
    total: wallNodes + floorAreaVertices + components + routePoints,
  };
}

function cancelDraft(message) {
  draftPoints = [];
  floorAreaDraftPoints = [];
  activeChainId = null;
  hoverPoint = null;
  if (message) interactionMessage = message;
  renderDraft();
  updateStatus();
}

function cancelPointEdit() {
  if (!dragState) return;
  const pointerId = dragState.pointerId;
  dragState = null;
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  interactionMessage = "Point edit cancelled; committed model unchanged";
  render();
}

function cancelFloorAreaPointEdit() {
  if (!floorAreaDragState) return;
  const pointerId = floorAreaDragState.pointerId;
  floorAreaDragState = null;
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  interactionMessage = "Building-outline vertex edit cancelled; committed model unchanged";
  render();
}

function cancelComponentMove() {
  if (!componentDragState) return;
  const pointerId = componentDragState.pointerId;
  componentDragState = null;
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  interactionMessage = "Catalogue component move cancelled; committed model unchanged";
  render();
}

function cancelRoutePointMove() {
  if (!routePointDragState) return;
  const pointerId = routePointDragState.pointerId;
  routePointDragState = null;
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  interactionMessage = "Route point move cancelled; committed model unchanged";
  render();
}

function cancelActivePointer() {
  if (dragState) cancelPointEdit();
  if (floorAreaDragState) cancelFloorAreaPointEdit();
  if (componentDragState) cancelComponentMove();
  if (routePointDragState) cancelRoutePointMove();
  if (referenceCropState?.pointerId !== null && referenceCropState?.pointerId !== undefined) {
    referenceCropState.pointerId = null;
    referenceCropState.startSourcePoint = null;
    referenceCropState.currentSourcePoint = null;
    interactionMessage = "Crop drag cancelled; project unchanged";
    render();
  }
  panState = null;
}

function applyThreeDHeights(event) {
  event.preventDefault();
  const equipment = Number(threeDEquipmentHeight.value);
  const outlet = Number(threeDOutletHeight.value);
  const duct = Number(threeDDuctHeight.value);
  if (![equipment, outlet, duct].every(Number.isFinite)) {
    threeDHeightStatus.textContent = "Enter finite millimetre elevations for equipment, outlets and duct routing.";
    return;
  }
  const basis = threeDHeightBasis.value;
  const measurement = basis === "known"
    ? (value, label) => knownMm(value, `${label} confirmed by designer in 3D setup`)
    : (value, label) => assumedMm(value, `${label} coordination assumption entered by designer`);
  commitCommand({
    type: "threeD.applyFloorHeights",
    floorId: currentFloorId(),
    equipmentElevationMm: measurement(equipment, "unit/CW elevation"),
    outletElevationMm: measurement(outlet, "outlet elevation"),
    ductElevationMm: measurement(duct, "duct routing elevation"),
  }, `3D heights applied as ${basis === "known" ? "confirmed measurements" : "explicit assumptions"} in one undoable action`);
}

function applyThreeDHeightItem(item, input, basis) {
  const value = Number(input.value);
  if (!Number.isFinite(value)) {
    threeDHeightStatus.textContent = `Enter a finite millimetre elevation for ${item.label}.`;
    input.focus();
    return;
  }
  const elevationMm = basis.value === "known"
    ? knownMm(value, `${item.label} elevation confirmed by designer in 3D setup`)
    : assumedMm(value, `${item.label} coordination elevation entered by designer`);
  const command = item.kind === "assembly"
    ? { type: "equipmentAssembly.setElevation", assemblyId: item.id, elevationMm }
    : item.kind === "assembly-component"
      ? { type: "equipmentAssembly.setMemberElevation", assemblyId: item.assemblyId, componentId: item.id, elevationMm }
    : item.kind === "component"
      ? { type: "component.setElevation", componentId: item.id, elevationMm }
      : { type: "route.setRoutingElevation", routeId: item.id, elevationMm };
  commitCommand(command, `${item.label} height updated for 3D coordination`);
}

function clearThreeDHeightItem(item) {
  const elevationMm = unknownMm(`${item.label} height not set`);
  const command = item.kind === "assembly"
    ? { type: "equipmentAssembly.setElevation", assemblyId: item.id, elevationMm }
    : item.kind === "assembly-component"
      ? { type: "equipmentAssembly.setMemberElevation", assemblyId: item.assemblyId, componentId: item.id, elevationMm }
    : item.kind === "component"
      ? { type: "component.setElevation", componentId: item.id, elevationMm }
      : { type: "route.setRoutingElevation", routeId: item.id, elevationMm };
  commitCommand(command, `${item.label} height returned to unknown`);
}

function renderThreeDHeightItems(scene) {
  threeDHeightItems.replaceChildren();
  if (!scene.heightItems.length) {
    const empty = document.createElement("p");
    empty.className = "checks-summary";
    empty.textContent = "Place MVHR equipment, outlets or routes to edit individual heights.";
    threeDHeightItems.append(empty);
    return;
  }
  for (const item of scene.heightItems) {
    const row = document.createElement("div");
    row.className = "three-d-height-item";
    row.dataset.heightKind = item.kind;
    row.dataset.heightId = item.id;
    const title = document.createElement("strong");
    title.textContent = item.label;
    title.title = `${item.kind} · ${item.measurement.state}${item.measurement.reason ? ` · ${item.measurement.reason}` : ""}`;
    const inputLabel = document.createElement("label");
    inputLabel.textContent = "Height mm";
    const input = document.createElement("input");
    input.type = "number";
    input.step = "1";
    input.placeholder = item.measurement.state === "mixed" ? "Mixed" : "Unknown";
    input.value = item.measurement.valueMm === null ? "" : String(item.measurement.valueMm);
    inputLabel.append(input);
    const basisLabel = document.createElement("label");
    basisLabel.textContent = "Basis";
    const basis = document.createElement("select");
    basis.append(new Option("Assumed", "assumed"), new Option("Confirmed", "known"));
    basis.value = item.measurement.state === "known" ? "known" : "assumed";
    basisLabel.append(basis);
    const apply = document.createElement("button");
    apply.type = "button";
    apply.textContent = "Apply";
    apply.addEventListener("click", () => applyThreeDHeightItem(item, input, basis));
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Unset";
    clear.disabled = item.measurement.state === "unknown";
    clear.addEventListener("click", () => clearThreeDHeightItem(item));
    row.append(title, inputLabel, basisLabel, apply, clear);
    threeDHeightItems.append(row);
  }
}

function adjustThreeDView(action) {
  if (action === "reset") threeDView = { ...createDefaultThreeDView() };
  if (action === "orbit-left") threeDView.azimuthRad -= Math.PI / 12;
  if (action === "orbit-right") threeDView.azimuthRad += Math.PI / 12;
  if (action === "pitch-up") threeDView.pitchRad = Math.min(1.35, threeDView.pitchRad + 0.12);
  if (action === "pitch-down") threeDView.pitchRad = Math.max(0.15, threeDView.pitchRad - 0.12);
  if (action === "zoom-in") threeDView.zoom = Math.min(4, threeDView.zoom * 1.2);
  if (action === "zoom-out") threeDView.zoom = Math.max(0.35, threeDView.zoom / 1.2);
  renderThreeDWorkspace();
}

function handleThreeDWheel(event) {
  event.preventDefault();
  threeDView.zoom = Math.max(0.35, Math.min(4, threeDView.zoom * Math.exp(-event.deltaY * 0.0015)));
  renderThreeDWorkspace();
}

function startThreeDPointer(event) {
  if (event.button !== 0 && event.button !== 1) return;
  threeDPointer = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, mode: event.shiftKey || event.button === 1 ? "pan" : "orbit" };
  threeDHost.setPointerCapture(event.pointerId);
}

function moveThreeDPointer(event) {
  if (!threeDPointer || event.pointerId !== threeDPointer.pointerId) return;
  const dx = event.clientX - threeDPointer.x, dy = event.clientY - threeDPointer.y;
  threeDPointer.x = event.clientX;
  threeDPointer.y = event.clientY;
  if (threeDPointer.mode === "pan") {
    threeDView.panX += dx;
    threeDView.panY += dy;
  } else {
    threeDView.azimuthRad += dx * 0.008;
    threeDView.pitchRad = Math.max(0.15, Math.min(1.35, threeDView.pitchRad - dy * 0.006));
  }
  renderThreeDWorkspace();
}

function endThreeDPointer(event) {
  if (!threeDPointer || event.pointerId !== threeDPointer.pointerId) return;
  if (threeDHost.hasPointerCapture(event.pointerId)) threeDHost.releasePointerCapture(event.pointerId);
  threeDPointer = null;
}

function renderThreeDWorkspace() {
  const floorId = currentFloorId();
  if (!floorId) {
    threeDDatum.textContent = "No floor is available.";
    threeDHost.replaceChildren();
    exportThreeDButton.disabled = true;
    return;
  }
  const scene = createThreeDDrawingScene(history.present, floorId);
  const svg = renderThreeDDrawingSvg(scene, { view: threeDView });
  threeDHost.innerHTML = svg;
  exportThreeDButton.disabled = scene.components.length === 0 && scene.routes.length === 0;
  threeDDatum.textContent = scene.floorDatumMm === null
    ? `${scene.floorName} · building datum unknown · inputs are relative to floor-local 0 mm`
    : `${scene.floorName} · floor-local 0 mm = building Z ${Math.round(scene.floorDatumMm)} mm (${scene.floorDatumState})`;
  threeDHeightStatus.textContent = `${scene.components.length} component${scene.components.length === 1 ? "" : "s"} and ${scene.routes.length} route${scene.routes.length === 1 ? "" : "s"} shown · ${scene.diagnostics.length} unresolved item${scene.diagnostics.length === 1 ? "" : "s"}.`;
  renderThreeDHeightItems(scene);
  threeDDiagnostics.replaceChildren();
  if (!scene.diagnostics.length) {
    const item = document.createElement("p");
    item.textContent = "No unresolved height inputs for visible 3D objects.";
    threeDDiagnostics.append(item);
  } else {
    for (const diagnostic of scene.diagnostics) {
      const item = document.createElement("p");
      item.textContent = `${diagnostic.objectId}: ${diagnostic.issue}`;
      threeDDiagnostics.append(item);
    }
  }
}

function exportThreeDDrawing() {
  const floorId = currentFloorId();
  if (!floorId) return;
  const scene = createThreeDDrawingScene(history.present, floorId);
  const svg = renderThreeDDrawingSvg(scene, { view: threeDView });
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${history.present.id}-${floorId}-3d-coordination.svg`;
  anchor.click();
  URL.revokeObjectURL(url);
  interactionMessage = "Schematic 3D SVG exported from the current saved design state";
}

function render() {
  if(activeTask==="account"){renderStorageState();updateStatus();return;}
  if (activeTask === "three-d") {
    renderThreeDWorkspace();
    renderStorageState();
    return;
  }
  if (activeTask === "project") {
    renderProjectWorkspace();
    renderStorageState();
    updateStatus();
    return;
  }
  renderCamera();
  renderReferences();
  renderFloorAreas();
  renderRoutingExclusions();
  renderRooms();
  modelLayer.replaceChildren();
  const nodesById = new Map(history.present.wallNodes.map((node) => [node.id, node]));
  const displayPosition = (nodeId) => {
    const position = nodesById.get(nodeId).positionMm;
    return dragState?.nodeId === nodeId ? dragState.preview : position;
  };
  for (const wall of history.present.walls) {
    const start = displayPosition(wall.startNodeId);
    const end = displayPosition(wall.endNodeId);
    const divider = wall.classification === "virtual" && wall.boundaryRole === "room-divider";
    modelLayer.append(svgElement("line", {
      x1: toView(start.x), y1: toView(start.y), x2: toView(end.x), y2: toView(end.y),
      "stroke-width": divider ? 2 : Math.max(3, toView(wall.thicknessMm)),
      class: `wall${divider ? " room-divider" : ""}${activeTask === "ventilation" ? " locked-context" : ""}${selectedWallId === wall.id ? " selected" : ""}`,
      "data-wall-id": wall.id,
      "data-boundary-kind": divider ? "room-divider" : "physical-wall",
    }));
  }
  if (activeTask === "ventilation") {
    for (const assembly of history.present.equipmentAssemblies) renderEquipmentAssemblyServiceZone(assembly);
    for (const route of history.present.routes.filter(route=>!/^epp-rigid-dn/.test(route.ductKind) && route.ductKind!=="semi-rigid-radial")) renderDuctRoute(route);
    for (const component of history.present.components) renderComponent(component);
    // EPP and DN90 radial ducts remain visible when their plan routes cross equipment.
    for (const route of history.present.routes.filter(route=>/^epp-rigid-dn/.test(route.ductKind) || route.ductKind==="semi-rigid-radial")) renderDuctRoute(route);
    const selectedRoute = history.present.routes.find((route) => route.id === selectedRouteId);
    if (selectedRoute && routeIsVisible(selectedRoute) && activeTool === "select") renderRouteEditHandles(selectedRoute);
    if(grilleAlignmentPreview && (componentDragState || activeTool==="place-component")) {
      const unitsPerPixel=camera.width/Math.max(canvas.getBoundingClientRect().width,1);
      for(const guide of grilleAlignmentPreview.guides)modelLayer.append(svgElement("line",{x1:toView(guide.from.x),y1:toView(guide.from.y),x2:toView(guide.to.x),y2:toView(guide.to.y),stroke:guide.stream==="intake"?"#359a78":"#89617d","stroke-width":1.5*unitsPerPixel,"stroke-dasharray":`${6*unitsPerPixel} ${4*unitsPerPixel}`,"pointer-events":"none","data-grille-alignment-guide":guide.stream}));
      const p=grilleAlignmentPreview.point,label=svgElement("text",{x:toView(p.x),y:toView(p.y)-30*unitsPerPixel,"font-size":11*unitsPerPixel,"text-anchor":"middle",fill:"#29434d",stroke:"white","stroke-width":3*unitsPerPixel,"paint-order":"stroke","pointer-events":"none"});
      label.textContent="Intake + exhaust aligned";modelLayer.append(label);
    }
    const displayedRoutes=history.present.routes.filter(routeIsVisible).map(route=>({...route,points:routeDisplayPoints(route)}));
    for(const elbow of deriveHrvCeilingElbows(displayedRoutes,history.present.components.filter(componentIsVisible))) {
      const drawing=svgElement("g",{transform:`translate(${toView(elbow.xMm)} ${toView(elbow.yMm)}) rotate(${elbow.angleDegrees}) scale(${1/MILLIMETRES_PER_VIEW_UNIT})`,"data-hrv-ceiling-elbow":elbow.portId,"data-route-id":elbow.routeId,"aria-label":"90° HRV top elbow to ceiling · provisional height"});
      for(const shape of hrvCeilingElbowShapes(elbow))drawing.append(svgElement(shape.tag,{...shape.attributes,"data-route-id":elbow.routeId}));
      const title=svgElement("title",{});title.textContent="90° top elbow to ceiling · included in HRV port allowance · height pending";drawing.append(title);modelLayer.append(drawing);
      const unitsPerPixel=camera.width/Math.max(canvas.getBoundingClientRect().width,1);
      const label=svgElement("text",{x:toView(elbow.xMm),y:toView(elbow.yMm-elbow.nominalSizeMm/2)-6*unitsPerPixel,"font-size":10*unitsPerPixel,fill:"#29434d",stroke:"white","stroke-width":3*unitsPerPixel,"paint-order":"stroke","text-anchor":"middle","pointer-events":"none"});
      label.textContent="90° ↑";
      if (!hiddenVentilationGroups.has("bend-labels")) modelLayer.append(label);
    }
  }
  for (const node of activeTask === "plan" ? history.present.wallNodes : []) {
    const position = displayPosition(node.id);
    modelLayer.append(svgElement("circle", {
      cx: toView(position.x), cy: toView(position.y), r: selectedNodeId === node.id ? 7 : 5,
      class: `wall-node${selectedNodeId === node.id ? " selected" : ""}`,
      "data-node-id": node.id,
    }));
  }
  renderDraft();
  renderReferenceList();
  renderCadReferenceList();
  renderInspector();
  renderConnectionDemand();
  renderRoutingWorkflow();
  renderRouteGuidance();
  renderClearVentilationControl();
  renderStorageState();
  updateStatus();
  if (activeTask === "checks") renderChecksWorkspace();
}

function renderFloorAreas() {
  floorAreaLayer.replaceChildren();
  const floor = currentFloor();
  const outline = floor && history.present.floorAreaOutlines.find((candidate) => candidate.floorId === floor.id);
  if (!floor || !outline) {
    floorAreaSummary.textContent = "No preliminary building outline on this floor.";
    const evidence = floorAreaScaleEvidence(floor?.id);
    floorAreaScale.textContent = evidence.panel;
    floorAreaScale.classList.toggle("verified", evidence.verified);
    return;
  }
  const inspection = inspectFloorAreaOutline(outline);
  const displayVertices = outline.vertices.map((vertex) => (
    floorAreaDragState?.outlineId === outline.id && floorAreaDragState.vertexId === vertex.id
      ? floorAreaDragState.preview
      : vertex.positionMm
  ));
  floorAreaLayer.append(svgElement("polygon", {
    points: displayVertices.map((point) => `${toView(point.x)},${toView(point.y)}`).join(" "),
    class: `floor-area-outline${selectedFloorAreaId === outline.id ? " selected" : ""}${activeTask === "ventilation" ? " locked-context" : ""}`,
    "data-floor-area-id": outline.id,
    "aria-label": `${outline.name}, ${formatArea(inspection.areaMm2)} preliminary floor area`,
  }));
  if (activeTask === "plan") {
    for (const [index, vertex] of outline.vertices.entries()) {
      const point = displayVertices[index];
      floorAreaLayer.append(svgElement("circle", {
        cx: toView(point.x),
        cy: toView(point.y),
        r: floorAreaDragState?.vertexId === vertex.id ? 7 : 5,
        class: `floor-area-vertex${floorAreaDragState?.vertexId === vertex.id ? " selected" : ""}`,
        "data-floor-area-id": outline.id,
        "data-vertex-id": vertex.id,
      }));
    }
  }
  const label = svgElement("text", {
    x: toView(inspection.centroidMm.x),
    y: toView(inspection.centroidMm.y) - 3,
    class: "floor-area-label",
  });
  const name = svgElement("tspan", { x: toView(inspection.centroidMm.x), dy: 0 });
  name.textContent = outline.name;
  const area = svgElement("tspan", { x: toView(inspection.centroidMm.x), dy: 13 });
  area.textContent = `${formatArea(inspection.areaMm2)} · preliminary`;
  label.append(name, area);
  floorAreaLayer.append(label);
  floorAreaSummary.textContent = `${formatArea(inspection.areaMm2)} · ${outline.vertices.length} vertices · one outline on ${floor.name}`;
  const evidence = floorAreaScaleEvidence(floor.id);
  floorAreaScale.textContent = evidence.panel;
  floorAreaScale.classList.toggle("verified", evidence.verified);
}

function renderRoutingExclusions() {
  routingExclusionLayer.replaceChildren();
  routingExclusionList.replaceChildren();
  const floor = currentFloor();
  if (!floor) return;
  const exclusions = history.present.routingExclusions.filter((candidate) => candidate.floorId === floor.id);
  for (const exclusion of exclusions) {
    const { x, y, width, height } = exclusion.geometry;
    routingExclusionLayer.append(svgElement("rect", { x: toView(x), y: toView(y), width: toView(width), height: toView(height),
      class: `routing-exclusion${selectedRoutingExclusionId === exclusion.id ? " selected" : ""}`, "data-routing-exclusion-id": exclusion.id,
      "aria-label": `${exclusion.name}, ${exclusion.kind}, ${exclusion.verticalRange.mode === "all-height" ? "all heights" : "height range"}` }));
    const label = svgElement("text", { x: toView(x + width / 2), y: toView(y + height / 2), class: "routing-exclusion-label" });
    label.textContent = `${exclusion.name} · ${exclusion.kind}`;
    routingExclusionLayer.append(label);
    const row = document.createElement("div");
    row.className = "routing-exclusion-item";
    const copy = document.createElement("span");
    copy.textContent = `${exclusion.name} · ${exclusion.verticalRange.mode === "all-height" ? "all heights" : heightRangeLabel(exclusion.verticalRange)}`;
    const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "Edit"; edit.addEventListener("click", () => openRoutingExclusionEditor(exclusion.id));
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove"; remove.className = "danger-action"; remove.addEventListener("click", () => removeRoutingExclusion(exclusion.id));
    row.append(copy, edit, remove); routingExclusionList.append(row);
  }
  if (!exclusions.length) routingExclusionList.append(htmlText("span", "No marked beams, voids or routing exclusions."));
  const setting = history.present.routingClearanceSettings.find((candidate) => candidate.floorId === floor.id);
  routingClearanceInput.value = setting?.clearSpacingMm?.state === "unknown" ? "" : String(setting?.clearSpacingMm?.valueMm ?? "");
  routingClearanceStatus.textContent = setting?.clearSpacingMm?.state === "unknown" || !setting
    ? "Not set · checks prevent envelope overlap only and report this limitation."
    : `${setting.clearSpacingMm.valueMm} mm additional clear gap · ${setting.clearSpacingMm.state}.`;
  const coordination = inspectRoutingCoordination(history.present, floor.id);
  const errors = coordination.diagnostics.filter((item) => item.severity === "error").length;
  const warnings = coordination.diagnostics.filter((item) => item.severity === "warning").length;
  routingCoordinationStatus.textContent = errors || warnings
    ? `${errors} coordination conflict${errors === 1 ? "" : "s"} · ${warnings} height review warning${warnings === 1 ? "" : "s"}. Open Checks for details.`
    : "No clashes found against marked exclusions or modelled duct envelopes on this floor.";
}

function heightRangeLabel(range) {
  const value = (measurement) => measurement?.state === "unknown" ? "?" : `${measurement.valueMm} mm`;
  return `${value(range.bottomMm)} to ${value(range.topMm)}`;
}

function floorAreaScaleEvidence(floorId) {
  const calibratedReference = history.present.floorReferences.find(
    (reference) => reference.floorId === floorId && reference.calibration !== null,
  );
  if (calibratedReference) {
    return {
      verified: true,
      panel: "Two-point calibrated PNG reference available. Outline area is calculated in floor-local millimetres.",
      dialog: "calibrated PNG scale evidence is available",
    };
  }
  const dxfReference = history.present.floorCadReferences.find((reference) => reference.floorId === floorId);
  if (dxfReference) {
    return {
      verified: true,
      panel: `Explicit ${dxfReference.units.unit} DXF unit choice available. Bounded synthetic-fixture support only.`,
      dialog: `explicit ${dxfReference.units.unit} DXF units are recorded`,
    };
  }
  return {
    verified: false,
    panel: "No calibrated reference scale. Area uses manual project-grid millimetres and is not reference-verified.",
    dialog: "manual project-grid scale only; not reference-verified",
  };
}

function currentFloor() {
  return history.present.floors.find((candidate) => candidate.id === "floor-ground")
    ?? history.present.floors[0]
    ?? null;
}

function renderRooms() {
  roomLayer.replaceChildren();
  const floor = currentFloor();
  if (!floor) return;
  const derivation = deriveRoomBoundaries(history.present, floor.id);
  const currentAssignedKeys = new Set();
  const roomLabels = [];
  const allZoneDiagnostics = [];
  let unassignedZoneFaces = 0;
  let currentZoneCount = 0;
  for (const room of history.present.rooms.filter((candidate) => candidate.floorId === floor.id)) {
    const inspection = inspectRoomBoundary(history.present, room, derivation);
    if (inspection.status === "current") currentAssignedKeys.add(inspection.key);
    if (inspection.polygon.length === 0) continue;
    const zoneDerivation = inspection.status === "current"
      ? deriveZoneBoundaries(history.present, room.id)
      : { candidates: [], diagnostics: [] };
    allZoneDiagnostics.push(...zoneDerivation.diagnostics);
    const assignedZoneKeys = new Set();
    for (const zone of history.present.zones.filter((candidate) => candidate.parentRoomId === room.id)) {
      const zoneInspection = inspectZoneBoundary(history.present, zone, zoneDerivation);
      if (zoneInspection.status === "current") {
        assignedZoneKeys.add(zoneInspection.key);
        currentZoneCount += 1;
      }
      if (zoneInspection.polygon.length === 0) continue;
      roomLayer.append(svgElement("polygon", {
        points: zoneInspection.polygon.map((point) => `${toView(point.x)},${toView(point.y)}`).join(" "),
        class: `zone-boundary${selectedZoneId === zone.id ? " selected" : ""}${zoneInspection.status !== "current" ? " reassignment-required" : ""}`,
        "data-zone-id": zone.id,
        "data-parent-room-id": room.id,
        "aria-label": `${zone.name} zone, ${zoneInspection.areaMm2 === null ? "area unavailable" : formatArea(zoneInspection.areaMm2)}`,
      }));
      if (zoneInspection.centroidMm) roomLabels.push({ space: zone, inspection: zoneInspection, kind: "zone" });
    }
    const polygon = svgElement("polygon", {
      points: inspection.polygon.map((point) => `${toView(point.x)},${toView(point.y)}`).join(" "),
      class: `room-boundary${zoneDerivation.candidates.length > 0 ? " partitioned" : ""}${selectedRoomId === room.id && !selectedZoneId ? " selected" : ""}${inspection.status !== "current" ? " reassignment-required" : ""}`,
      "data-room-id": room.id,
      "aria-label": `${room.name}, ${inspection.areaMm2 === null ? "area unavailable" : formatArea(inspection.areaMm2)}`,
    });
    roomLayer.prepend(polygon);
    if (inspection.centroidMm && zoneDerivation.candidates.length === 0) {
      roomLabels.push({ space: room, inspection, kind: "room" });
    }
    if (activeTask === "plan") {
      for (const candidate of zoneDerivation.candidates) {
        if (assignedZoneKeys.has(candidate.key)) continue;
        unassignedZoneFaces += 1;
        roomLayer.append(svgElement("polygon", {
          points: candidate.polygon.map((point) => `${toView(point.x)},${toView(point.y)}`).join(" "),
          class: `zone-candidate${reassignZoneId ? " reassign-target" : ""}`,
          "data-zone-boundary-key": candidate.key,
          "data-parent-room-id": room.id,
          "aria-label": `Eligible ventilation zone, ${formatArea(candidate.areaMm2)}`,
        }));
      }
    }
  }
  if (activeTask === "plan") {
    for (const candidate of derivation.candidates) {
      if (currentAssignedKeys.has(candidate.key)) continue;
      roomLayer.append(svgElement("polygon", {
        points: candidate.polygon.map((point) => `${toView(point.x)},${toView(point.y)}`).join(" "),
        class: `room-candidate${reassignRoomId ? " reassign-target" : ""}`,
        "data-room-boundary-key": candidate.key,
        "aria-label": `Eligible room boundary, ${formatArea(candidate.areaMm2)}`,
      }));
    }
  }
  for (const label of roomLabels) appendSpaceLabel(label.space, label.inspection, label.kind);
  renderRoomSummary(derivation, currentAssignedKeys, {
    currentZoneCount,
    unassignedZoneFaces,
    diagnostics: allZoneDiagnostics,
  });
}

function appendSpaceLabel(space, inspection, kind) {
  const label = svgElement("text", {
    x: toView(inspection.centroidMm.x),
    y: toView(inspection.centroidMm.y) - 3,
    class: `room-label ${kind}`,
  });
  const name = svgElement("tspan", { x: toView(inspection.centroidMm.x), dy: 0 });
  name.textContent = space.name;
  const area = svgElement("tspan", {
    x: toView(inspection.centroidMm.x),
    dy: 13,
    class: "room-area-label",
  });
  area.textContent = inspection.areaMm2 === null ? "Area unavailable" : formatArea(inspection.areaMm2);
  label.append(name, area);
  roomLayer.append(label);
}

function renderRoomSummary(derivation, assignedKeys, zoneState) {
  const floor = history.present.floors.find((candidate) => candidate.id === "floor-ground")
    ?? history.present.floors[0];
  const currentRoomCount = floor
    ? history.present.rooms.filter((room) => room.floorId === floor.id)
      .filter((room) => inspectRoomBoundary(history.present, room, derivation).status === "current").length
    : 0;
  if (activeTask === "ventilation") {
    const terminalAssignmentCount = [...history.present.rooms, ...history.present.zones].reduce(
      (count, room) => count + room.terminalAssociations.length,
      0,
    );
    ventilationReadiness.textContent = currentRoomCount > 0
      ? `${currentRoomCount} current room boundar${currentRoomCount === 1 ? "y" : "ies"} · ${zoneState.currentZoneCount} zone${zoneState.currentZoneCount === 1 ? "" : "s"} · ${terminalAssignmentCount} assigned terminal${terminalAssignmentCount === 1 ? "" : "s"}. Airflows are not inferred.`
      : "Preliminary layout: rooms are not required yet. Equipment, outlets and indicative routes remain provisional until detailed room design.";
  }
  if (activeTask !== "plan") return;
  const eligibleCount = derivation.candidates.filter((candidate) => !assignedKeys.has(candidate.key)).length;
  roomSummary.textContent = `${history.present.rooms.length} room${history.present.rooms.length === 1 ? "" : "s"} · ${history.present.zones.length} zone${history.present.zones.length === 1 ? "" : "s"} · ${eligibleCount} room face${eligibleCount === 1 ? "" : "s"} to confirm · ${zoneState.unassignedZoneFaces} zone face${zoneState.unassignedZoneFaces === 1 ? "" : "s"} to name`;
  roomIssues.replaceChildren();
  const diagnostics = [...derivation.diagnostics, ...zoneState.diagnostics];
  if (diagnostics.length === 0) {
    roomIssues.append(htmlText("span", "No open-endpoint or crossing diagnostics on this floor."));
    return;
  }
  for (const diagnostic of diagnostics.slice(0, 8)) {
    roomIssues.append(htmlText("span", diagnostic.message, diagnostic.severity));
  }
  if (diagnostics.length > 8) {
    roomIssues.append(htmlText("span", `${diagnostics.length - 8} more topology diagnostics`));
  }
}

function renderDuctRoute(route) {
  if (!routeIsVisible(route)) return;
  const family = routeFamilyForKind(route.ductKind);
  const geometry = routeBodyGeometry(route, family);
  const serviceClass = ductServiceClass(route);
  const selectedClass = selectedRouteId === route.id ? " selected" : "";
  const arrangementClass = geometry.arrangement === "unset" ? " arrangement-unset" : "";
  const lanePointStrings = geometry.lanes.map(routePointString);
  if (geometry.scaled) {
    const bodyWidth = toView(geometry.diameterMm);
    for (const points of lanePointStrings) {
      modelLayer.append(svgElement("polyline", {
        points,
        class: "duct-body-underlay",
        "stroke-width": bodyWidth + 2,
        "aria-hidden": "true",
      }));
    }
    for (const points of lanePointStrings) {
      modelLayer.append(svgElement("polyline", {
        points,
        class: `duct-body ${serviceClass}${arrangementClass}${selectedClass}`,
        "stroke-width": bodyWidth,
        "data-route-id": route.id,
        "data-diameter-basis": geometry.diameterBasis,
        "aria-hidden": "true",
      }));
    }
  }
  const sweepPoints = routePointString(geometry.sampledCentreline);
  modelLayer.append(svgElement("polyline", {
    points: sweepPoints,
    class: `mechanical-route ${route.ductKind} ${serviceClass}${selectedClass}`,
    "data-route-id": route.id,
    "aria-hidden": "true",
  }));
  for (const elbow of geometry.elbows ?? []) {
    for (const seam of elbow.seams) modelLayer.append(svgElement("line", {
      x1:toView(seam.a.x), y1:toView(seam.a.y), x2:toView(seam.b.x), y2:toView(seam.b.y),
      stroke:"#263f46", "stroke-width":1.2, "data-route-id":route.id, "data-epp-elbow-joint":"true",
    }));
    if (elbow.halfCutGuide) {
      const cut = elbow.halfCutGuide;
      modelLayer.append(svgElement("line", {x1:toView(cut.a.x),y1:toView(cut.a.y),x2:toView(cut.b.x),y2:toView(cut.b.y),
        stroke:"#263f46","stroke-width":0.8,"stroke-dasharray":"2 1.5","data-epp-half-cut-guide":"true","pointer-events":"none"}));
    }
    const label = svgElement("text", {x:toView(elbow.vertex.x)+8,y:toView(elbow.vertex.y)-8,"font-size":9,fill:elbow.drawable ? "#263f46" : "#a04b22",stroke:"white","stroke-width":3,"paint-order":"stroke","data-route-id":route.id});
    label.textContent = elbow.drawable ? `${elbow.angleDegrees}°` : "Review bend";
    if (!hiddenVentilationGroups.has("bend-labels")) modelLayer.append(label);
  }
  const hitLines = geometry.arrangement === "twin" ? lanePointStrings : [sweepPoints];
  for (const points of hitLines) {
    modelLayer.append(svgElement("polyline", {
      points,
      class: "mechanical-route-hit",
      "data-route-id": route.id,
      "aria-label": `${family.name} route · ${ductBodyDisplayLabel(geometry)} · ${geometry.rigidEpp ? "rigid runs with drawn elbows" : "smooth visual sweep"}`,
    }));
  }
}

function routeBodyGeometry(route, family = routeFamilyForKind(route.ductKind)) {
  const displayPoints = routeDisplayPoints(route);
  return deriveDuctBodyGeometry({
    ...route,
    points: displayPoints.map((point, index) => ({ ...route.points[index], ...point })),
  }, family);
}

function routePointString(points) {
  return points.map((point) => `${toView(point.x)},${toView(point.y)}`).join(" ");
}

function ductServiceClass(route) {
  if (route.role === "Outdoor intake" || route.stream === "outdoor-intake" || route.stream === "intake") return "service-intake";
  if (route.role === "Outdoor exhaust" || route.stream === "outdoor-exhaust" || route.stream === "exhaust") return "service-exhaust";
  if (route.stream === "supply") return "service-supply";
  if (route.stream === "extract") return "service-extract";
  return "service-generic";
}

function routeDisplayPoints(route) {
  const points = route.points.map((point) => ({ x: point.x, y: point.y }));
  if (routePointDragState?.routeId === route.id) {
    points[routePointDragState.pointIndex] = { ...routePointDragState.preview };
  }
  if (!componentDragState) return /^epp-rigid-dn/.test(route.ductKind) && routePointDragState?.routeId === route.id ? constrainEppPlanPoints(points) : points;
  const delta = {
    x: componentDragState.preview.x - componentDragState.start.x,
    y: componentDragState.preview.y - componentDragState.start.y,
  };
  if (componentDragState.memberIds.includes(route.startAttachment?.componentId)) {
    points[0].x += delta.x;
    points[0].y += delta.y;
  }
  if (componentDragState.memberIds.includes(route.endAttachment?.componentId)) {
    points[points.length - 1].x += delta.x;
    points[points.length - 1].y += delta.y;
  }
  return points;
}

function renderRouteEditHandles(route) {
  const points = routeDisplayPoints(route);
  const rect = canvas.getBoundingClientRect();
  const viewUnitsPerCssPixel = camera.width / Math.max(rect.width, 1);
  modelLayer.append(svgElement("polyline", {
    points: routePointString(points),
    class: "route-control-cage",
    "aria-hidden": "true",
  }));
  for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
    const start = points[segmentIndex];
    const end = points[segmentIndex + 1];
    const midpoint = { x: toView((start.x + end.x) / 2), y: toView((start.y + end.y) / 2) };
    const group = svgElement("g", {
      class: "route-add-point",
      "data-route-id": route.id,
      "data-route-insert-index": segmentIndex,
      "aria-label": `Add point to route segment ${segmentIndex + 1}`,
    });
    group.append(svgElement("circle", {
      cx: midpoint.x,
      cy: midpoint.y,
      r: 8 * viewUnitsPerCssPixel,
    }));
    group.append(svgElement("line", {
      x1: midpoint.x - 3.5 * viewUnitsPerCssPixel,
      y1: midpoint.y,
      x2: midpoint.x + 3.5 * viewUnitsPerCssPixel,
      y2: midpoint.y,
    }));
    group.append(svgElement("line", {
      x1: midpoint.x,
      y1: midpoint.y - 3.5 * viewUnitsPerCssPixel,
      x2: midpoint.x,
      y2: midpoint.y + 3.5 * viewUnitsPerCssPixel,
    }));
    modelLayer.append(group);
  }
  for (const [pointIndex, point] of points.entries()) {
    const intermediate = pointIndex > 0 && pointIndex < points.length - 1;
    modelLayer.append(svgElement("circle", {
      cx: toView(point.x),
      cy: toView(point.y),
      r: (intermediate && selectedRoutePointIndex === pointIndex ? 7 : 5) * viewUnitsPerCssPixel,
      class: `route-point-handle ${intermediate ? "intermediate" : "endpoint locked"}${intermediate && selectedRoutePointIndex === pointIndex ? " selected" : ""}`,
      "data-route-id": route.id,
      "data-point-index": pointIndex,
      "aria-label": intermediate
        ? `Drag route point ${pointIndex}`
        : `${pointIndex === 0 ? "Start" : "End"} route endpoint locked to its connection`,
    }));
  }
}

function renderComponent(component) {
  if (!componentIsVisible(component)) return;
  const selected = mechanicalState.selectedComponentId === component.id;
  const dragDelta = componentDisplayDragDelta(component.id);
  const position = {
    x: component.positionMm.x + dragDelta.x,
    y: component.positionMm.y + dragDelta.y,
  };
  const symbol = component.displaySymbol ?? { shape: "box", widthMm: 700, heightMm: 500 };
  const angleDegrees = componentYaw(component.orientation) * 180 / Math.PI;
  const group = svgElement("g", {
    transform: `translate(${toView(position.x)} ${toView(position.y)}) rotate(${angleDegrees})`,
    class: `component-group${selected ? " selected" : ""}`,
    "data-component-id": component.id,
  });
  const common = {
    class: "component-symbol",
    "data-component-id": component.id,
  };
  const planGraphic = deriveComponentPlanGraphic(component);
  if (planGraphic) {
    appendComponentPlanGraphic(group, planGraphic, {
      componentId: component.id,
      primaryClass: common.class,
    });
  } else if (symbol.shape === "circle") {
    group.append(svgElement("circle", {
      cx: 0,
      cy: 0,
      r: toView(symbol.widthMm) / 2,
      ...common,
    }));
  } else {
    group.append(svgElement("rect", {
      x: -toView(symbol.widthMm) / 2,
      y: -toView(symbol.heightMm) / 2,
      width: toView(symbol.widthMm),
      height: toView(symbol.heightMm),
      rx: 5,
      ...common,
    }));
  }
  const label = svgElement("text", {
    x: 0,
    y: toView(symbol.heightMm) / 2 + 16,
    class: "component-label",
    "text-anchor": "middle",
    "data-component-id": component.id,
  });
  const evidenceLabel = componentEvidenceLabel(component);
  const roomAssignment = terminalRoomAssignment(history.present, component.id);
  const assignedSpace = roomAssignment?.zoneId
    ? history.present.zones.find((zone) => zone.id === roomAssignment.zoneId)
    : roomAssignment?.roomId
      ? history.present.rooms.find((room) => room.id === roomAssignment.roomId)
      : null;
  const terminalPort = component.ports.length === 1 &&
    component.ports[0].system === "mvhr" &&
    (component.ports[0].stream === "supply" || component.ports[0].stream === "extract")
    ? component.ports[0]
    : null;
  label.textContent = [WALL_GRILLE_PLAN_GRAPHIC_ID, LUNA_GRILLE_PLAN_GRAPHIC_ID].includes(planGraphic?.graphicId)
    ? `${planGraphic.graphicId === LUNA_GRILLE_PLAN_GRAPHIC_ID ? "Luna" : "Aerofresh"} ${planGraphic.stream}`
    : terminalPort
    ? `${assignedSpace?.name ?? "Unassigned"} · ${formatRoomChoice(terminalPort.stream)}`
    : planGraphic?.graphicId === Q350_PLAN_GRAPHIC_ID
      ? `${planGraphic.modelName ?? "ComfoAir Q350"}${planGraphic.mountedCw ? ` + CW${planGraphic.mountedCw.size}` : ""} · ${planGraphic.handingLabel}${planGraphic.mountedDimensions?.envelopeStatus === "schematic-layout-allowance" ? " · provisional envelope" : ""}`
      : planGraphic?.graphicId === CA200_GRAPHIC_ID
        ? `ComfoAir 200 · ${planGraphic.handing === "left" ? "LH" : "RH"} · ${planGraphic.mounting}`
      : planGraphic?.graphicId === STANDALONE_CW_GRAPHIC_ID
        ? `CW${planGraphic.size} · ${planGraphic.stream} · ${planGraphic.orientation}`
      : planGraphic?.graphicId === GENERIC_CW_PLAN_GRAPHIC_ID
        ? `Generic ${planGraphic.serviceLabel.toLowerCase()} CW-style assembly · provisional`
      : `${component.displayName ?? component.id} · ${evidenceLabel}`;
  if (planGraphic) {
    label.setAttribute("x", toView(position.x));
    label.setAttribute("y", toView(position.y + Math.max(symbol.widthMm, symbol.heightMm) / 2) + 16);
    if ([EXTERNAL_GRILLE_PLAN_GRAPHIC_ID, WALL_GRILLE_PLAN_GRAPHIC_ID, LUNA_GRILLE_PLAN_GRAPHIC_ID].includes(planGraphic.graphicId)) {
      const unitsPerPixel = camera.width / Math.max(canvas.getBoundingClientRect().width, 1);
      label.style.fontSize = `${11 * unitsPerPixel}px`;
      label.setAttribute("y", toView(position.y + symbol.heightMm / 2) + 15 * unitsPerPixel);
    }
    if ([Q350_PLAN_GRAPHIC_ID, STANDALONE_CW_GRAPHIC_ID, CA200_GRAPHIC_ID].includes(planGraphic.graphicId)) {
      const unitsPerPixel = camera.width / Math.max(canvas.getBoundingClientRect().width, 1);
      const bounds = planGraphic.drawingBoundsMm ?? { minX: -symbol.widthMm/2, maxX: symbol.widthMm/2, minY: -symbol.heightMm/2, maxY: symbol.heightMm/2 };
      const angle = componentYaw(component.orientation);
      const corners = [bounds.minX, bounds.maxX].flatMap(x => [bounds.minY, bounds.maxY].map(y => ({ x: x*Math.cos(angle)-y*Math.sin(angle), y: x*Math.sin(angle)+y*Math.cos(angle) })));
      label.setAttribute("x", toView(position.x + (Math.min(...corners.map(p=>p.x))+Math.max(...corners.map(p=>p.x)))/2));
      label.setAttribute("y", toView(position.y + Math.max(...corners.map(p=>p.y))) + (planGraphic.graphicId === CA200_GRAPHIC_ID ? 34 : 20)*unitsPerPixel);
      label.style.fontSize = `${11*unitsPerPixel}px`;
      label.style.strokeWidth = `${3*unitsPerPixel}px`;
    }
    modelLayer.append(group);
    if (
      planGraphic.graphicId !== GENERIC_CW_PLAN_GRAPHIC_ID ||
      planGraphic.partType === "attenuator" ||
      planGraphic.partType === "combined"
    ) modelLayer.append(label);
  } else {
    group.append(label);
    modelLayer.append(group);
  }

  for (const port of component.ports) {
    if (component.displaySymbol?.ca200Profile?.mounting === "vertical" && port.positionMm.z < 0) continue;
    if (planGraphic?.mountedCw && port.interface?.nominalSizeMm !== 90 && ["supply", "extract"].includes(port.stream) && !portUsage(component.id, port.id).occupied) continue;
    if(port.drawingEntries?.length && component.displaySymbol?.shape==="luna-grille" && activeTool==="route") {
      const usage=portUsage(component.id,port.id),routeState=portRouteState(port,usage);
      const ring=svgElement("circle",{cx:toView(position.x),cy:toView(position.y),r:toView(component.displaySymbol.widthMm*.21+2),
        class:`component-port${usage.occupied?" occupied":""}${routeState?` route-${routeState}`:""}`,
        style:`fill:transparent;stroke:${port.stream==="supply"?"#2020ff":"#ff2020"};stroke-width:1.5;pointer-events:all`,
        "data-component-id":component.id,"data-port-id":port.id,"data-terminal-circle":"true",
        "aria-label":`${port.role} port, DN90, continuous circle rim, ${usage.occupied?"connected":"available"}`});
      modelLayer.append(ring);continue;
    }
    if(port.drawingEntries?.length && activeTool==="route") {
      const usage=portUsage(component.id,port.id),routeState=portRouteState(port,usage);
      for(const entry of terminalDrawingAnchors(component,port)) {
        const circle=svgElement("circle",{cx:toView(entry.positionMm.x+dragDelta.x),cy:toView(entry.positionMm.y+dragDelta.y),r:3,
          class:`component-port ${portRoleClass(port.role)}${usage.occupied?" occupied":""}${routeState?` route-${routeState}`:""}`,
          "data-component-id":component.id,"data-port-id":port.id,"data-terminal-entry":entry.id,
          "aria-label":`${port.role} port, DN90, ${entry.label}, ${usage.occupied?"connected":"available"}`});
        modelLayer.append(circle);
      }
      continue;
    }
    const portTransform = floorPortTransform(history.present, component.id, port.id);
    const portPosition = portTransform.positionMm;
    const usage = portUsage(component.id, port.id);
    const routeState = portRouteState(port, usage);
    const size = port.interface?.nominalSizeMm ? `DN${port.interface.nominalSizeMm}` : "size pending";
    const availability = usage.occupied ? `connected by ${usage.kind}` : routeState === "incompatible" ? "not compatible with selected route" : "available";
    const portClasses = `${portRoleClass(port.role)}${usage.occupied ? " occupied" : ""}${routeState ? ` route-${routeState}` : ""}`;
    if (isExpandedDrawingConnectionTarget(port)) {
      const canvasRect = canvas.getBoundingClientRect();
      const cssPixelsPerViewUnit = Math.min(
        canvasRect.width / camera.width,
        canvasRect.height / camera.height,
      );
      const minimumRadiusViewUnits = PORT_PICK_TOLERANCE_CSS_PX / Math.max(cssPixelsPerViewUnit, Number.EPSILON);
      const evidencedOutsideRadiusViewUnits = Number.isFinite(port.interface?.outsideDiameterMm)
        ? port.interface.outsideDiameterMm / 2 / MILLIMETRES_PER_VIEW_UNIT
        : 0;
      modelLayer.append(svgElement("circle", {
        cx: toView(portPosition.x + dragDelta.x),
        cy: toView(portPosition.y + dragDelta.y),
        r: Math.max(minimumRadiusViewUnits, evidencedOutsideRadiusViewUnits),
        class: `component-port-hit ${portClasses}`,
        "data-component-id": component.id,
        "data-port-id": port.id,
        "data-port-availability": availability,
        "aria-hidden": "true",
      }));
    }
    const circle = svgElement("circle", {
      cx: toView(portPosition.x + dragDelta.x),
      cy: toView(portPosition.y + dragDelta.y),
      r: (planGraphic?.mountedCw && port.interface?.nominalSizeMm===90) || planGraphic?.graphicId===STANDALONE_CW_GRAPHIC_ID ? 2 : planGraphic?.graphicId===EXTERNAL_GRILLE_PLAN_GRAPHIC_ID && planGraphic.combined ? 2 : 6,
      class: `component-port ${portClasses}`,
      "data-component-id": component.id,
      "data-port-id": port.id,
      "data-port-availability": availability,
      "aria-label": `${port.role} port, ${size}, ${availability}`,
    });
    const title = svgElement("title", {});
    title.textContent = `${port.role} · ${size} · ${availability}`;
    circle.append(title);
    modelLayer.append(circle);
    if (component.catalogueItemId === "synthetic-mvhr-placeholder" || isRemoteEppEndPlatePort(component, port)) {
      const direction = portTransform.direction;
      const remoteEpp = isRemoteEppEndPlatePort(component, port);
      const offsetMm = remoteEpp ? 175 : 115;
      const label = svgElement("text", {
        x: toView(portPosition.x + dragDelta.x + direction.x * offsetMm),
        y: toView(portPosition.y + dragDelta.y + direction.y * offsetMm) + 3,
        class: `component-port-label${remoteEpp ? " external-epp" : ""}${usage.occupied ? " occupied" : ""}`,
        "text-anchor": direction.x < -0.25 ? "end" : direction.x > 0.25 ? "start" : "middle",
        "aria-hidden": "true",
      });
      label.textContent = remoteEpp
        ? `${shortPortRole(port.role)} EPP ${size}`
        : `${shortPortRole(port.role)} ${size}`;
      modelLayer.append(label);
    }
  }
}

function isExpandedDrawingConnectionTarget(port) {
  return port.interface?.nominalSizeMm === 160 &&
    port.interface?.drawingConnectionClass === "circular-dn160";
}

function isRemoteEppEndPlatePort(component, port) {
  return component.catalogueItemId?.endsWith("-remote-round-end-plate") &&
    port.interface?.family === "rigid-epp" &&
    port.interface?.nominalSizeMm === 160;
}

function appendComponentPlanGraphic(group, graphic, options = {}) {
  if(graphic.graphicId===EXTERNAL_GRILLE_PLAN_GRAPHIC_ID) {
    const drawing=svgElement("g",{transform:`scale(${1/MILLIMETRES_PER_VIEW_UNIT})`,"data-plan-graphic":graphic.graphicId,"data-external-grille-handing":graphic.handing});
    for(const shape of externalGrilleShapes(graphic)) {
      const element=svgElement(shape.tag,{...shape.attributes,...(options.componentId?{"data-component-id":options.componentId}:{}),...(options.ghost?{opacity:.6}:{})});
      if(shape.text)element.textContent=shape.text;
      drawing.append(element);
    }
    group.append(drawing);return;
  }
  if ([WALL_GRILLE_PLAN_GRAPHIC_ID, LUNA_GRILLE_PLAN_GRAPHIC_ID].includes(graphic.graphicId)) {
    const drawing = svgElement("g", {
      transform: `scale(${1 / MILLIMETRES_PER_VIEW_UNIT})`,
      class: `wall-grille-graphic${options.ghost ? " ghost" : ""}`,
      style: `--grille-colour: ${graphic.colour}`,
      "data-plan-graphic": graphic.graphicId, "data-service": graphic.stream,
    });
    // Transparent hit area makes the complete symbol selectable and draggable.
    drawing.append(svgElement("rect", { x: -graphic.widthMm/2, y: -graphic.depthMm/2,
      width: graphic.widthMm, height: graphic.depthMm, fill: "transparent", stroke: "none",
      ...(options.componentId ? { "data-component-id": options.componentId } : {}) }));
    for (const [index, d] of graphic.paths.entries()) drawing.append(svgElement("path", {
      ...(graphic.strokeWidths ? { style: `stroke-width: ${graphic.strokeWidths[index]}` } : {}),
      d, class: options.primaryClass ?? "component-symbol",
      ...(options.componentId ? { "data-component-id": options.componentId } : {}),
    }));
    group.append(drawing);
    return;
  }
  if (graphic.graphicId === Q350_PLAN_GRAPHIC_ID) {
    appendQ350PlanGraphic(group, graphic, options);
    return;
  }
  if (graphic.graphicId === CA200_GRAPHIC_ID) {
    const drawing=svgElement("g",{transform:`scale(${1/MILLIMETRES_PER_VIEW_UNIT})`,"data-plan-graphic":graphic.graphicId});
    for(const shape of ca200Shapes(graphic)){const node=svgElement(shape.tag,{...shape.attributes,...(options.componentId?{"data-component-id":options.componentId}:{})});if(shape.text)node.textContent=shape.text;drawing.append(node);}
    group.append(drawing);return;
  }
  if (graphic.graphicId === STANDALONE_CW_GRAPHIC_ID) {
    const drawing=svgElement("g",{transform:`scale(${1/MILLIMETRES_PER_VIEW_UNIT})`,"data-plan-graphic":graphic.graphicId});
    for(const shape of standaloneCwShapes(graphic)){const node=svgElement(shape.tag,{...shape.attributes,...(options.componentId?{"data-component-id":options.componentId}:{})});if(shape.text)node.textContent=shape.text;drawing.append(node);}
    group.append(drawing);return;
  }
  if (graphic.graphicId === GENERIC_CW_PLAN_GRAPHIC_ID) {
    appendGenericCwPlanGraphic(group, graphic, options);
    return;
  }
  throw new TypeError(`Unsupported component plan graphic: ${String(graphic.graphicId)}`);
}

function appendQ350PlanGraphic(group, graphic, options = {}) {
  const componentId = options.componentId ?? null;
  const primaryClass = options.primaryClass ?? "component-symbol";
  const drawing = svgElement("g", {
    transform: `scale(${1 / MILLIMETRES_PER_VIEW_UNIT})`,
    class: `q350-plan-graphic${options.ghost ? " ghost" : ""}`,
    "data-plan-graphic": graphic.graphicId,
    "data-q350-handing": graphic.handing,
    "aria-hidden": "true",
  });
  drawing.append(svgElement("path", {
    d: q350CasingPath(graphic),
    class: primaryClass,
    ...(componentId ? { "data-component-id": componentId } : {}),
  }));
  drawing.append(svgElement("rect", {
    x: -graphic.widthMm / 2 + 14,
    y: -graphic.depthMm / 2 + 14,
    width: graphic.widthMm - 28,
    height: graphic.depthMm - 43,
    rx: 20,
    class: "q350-top-deck",
  }));
  drawing.append(svgElement("rect", {
    x: graphic.centrePanel.xMm,
    y: graphic.centrePanel.yMm,
    width: graphic.centrePanel.widthMm,
    height: graphic.centrePanel.heightMm,
    rx: graphic.centrePanel.cornerRadiusMm,
    class: "q350-centre-panel",
  }));
  for (const xMm of [graphic.centrePanel.xMm, graphic.centrePanel.xMm + graphic.centrePanel.widthMm]) {
    drawing.append(svgElement("line", {
      x1: xMm,
      y1: graphic.centrePanel.yMm + 20,
      x2: xMm,
      y2: graphic.centrePanel.yMm + graphic.centrePanel.heightMm - 20,
      class: "q350-panel-line",
    }));
  }
  for (const port of graphic.ports) {
    if (graphic.mountedCw && ["supply", "extract"].includes(port.stream)) continue;
    const outsideDiameterMm = port.displayOutsideDiameterMm ?? port.outsideDiameterMm ?? port.nominalDiameterMm;
    const boreDiameterMm = port.boreDiameterMm ?? port.nominalDiameterMm;
    if (outsideDiameterMm) {
      drawing.append(svgElement("circle", {
        cx: port.xMm,
        cy: port.yMm,
        r: outsideDiameterMm / 2,
        class: "q350-collar-outer",
        "data-q350-port-role": port.role,
      }));
    }
    if (boreDiameterMm) {
      drawing.append(svgElement("circle", {
        cx: port.xMm,
        cy: port.yMm,
        r: boreDiameterMm / 2,
        class: `q350-collar-bore service-${port.stream}`,
      }));
    }
  }
  const model = svgElement("text", {
    x: 0,
    y: 8,
    class: "q350-model-label",
    "text-anchor": "middle",
  });
  model.textContent = graphic.mountedCw ? "" : graphic.shortModelName ?? "Q350";
  drawing.append(model);
  const handing = svgElement("text", {
    x: 0,
    y: 42,
    class: "q350-handing-label",
    "text-anchor": "middle",
  });
  handing.textContent = graphic.mountedCw ? "" : graphic.handingLabel;
  drawing.append(handing);
  drawing.append(svgElement("line", {
    x1: 0,
    y1: graphic.frontCue.yMm - 34,
    x2: 0,
    y2: graphic.frontCue.arrowTipYmm,
    class: "q350-front-arrow",
  }));
  drawing.append(svgElement("path", {
    d: `M -10 ${graphic.frontCue.arrowTipYmm - 15} L 0 ${graphic.frontCue.arrowTipYmm} L 10 ${graphic.frontCue.arrowTipYmm - 15} Z`,
    class: "q350-front-arrow-head",
  }));
  const front = svgElement("text", {
    x: 0,
    y: graphic.frontCue.yMm - 42,
    class: "q350-front-label",
    "text-anchor": "middle",
  });
  front.textContent = "FRONT";
  drawing.append(front);
  drawing.append(svgElement("rect", {
    x: graphic.badge.xMm,
    y: graphic.badge.yMm,
    width: graphic.badge.widthMm,
    height: graphic.badge.heightMm,
    rx: 2,
    class: "q350-brand-badge",
  }));
  const brand = svgElement("text", {
    x: graphic.badge.xMm + graphic.badge.widthMm / 2,
    y: graphic.badge.yMm + 17,
    class: "q350-brand-letter",
    "text-anchor": "middle",
  });
  brand.textContent = graphic.brandLabel ?? "Z";
  drawing.append(brand);
  for (const shape of mountedCwShapes(graphic)) drawing.append(svgElement(shape.tag, shape.attributes));
  group.append(drawing);
  for (const port of graphic.ports) {
    if (graphic.mountedCw && ["supply", "extract"].includes(port.stream)) continue;
    const unitsPerPixel = camera.width / Math.max(canvas.getBoundingClientRect().width, 1);
    const layout = q350PortLabelLayout(port);
    group.append(svgElement("line", { x1: toView(layout.leaderStartXmm), y1: toView(layout.yMm), x2: toView(layout.leaderEndXmm), y2: toView(layout.yMm), class: "port-label-leader" }));
    const portCode = svgElement("text", {
      x: toView(layout.xMm), y: toView(layout.yMm),
      class: "q350-port-code", "text-anchor": layout.anchor,
      "dominant-baseline": "middle", style: `font-size: ${10 * unitsPerPixel}px; stroke-width: ${3 * unitsPerPixel}px`,
    });
    portCode.textContent = port.code;
    group.append(portCode);
  }
}

function appendGenericCwPlanGraphic(group, graphic, options = {}) {
  const componentId = options.componentId ?? null;
  const primaryClass = options.primaryClass ?? "component-symbol";
  const halfWidth = graphic.widthMm / 2;
  const halfDepth = graphic.depthMm / 2;
  const inset = graphic.casingInsetMm;
  const drawing = svgElement("g", {
    transform: `scale(${1 / MILLIMETRES_PER_VIEW_UNIT})`,
    class: `generic-cw-plan-graphic service-${graphic.stream}${options.ghost ? " ghost" : ""}`,
    "data-plan-graphic": graphic.graphicId,
    "data-generic-cw-part": graphic.partType,
    "data-generic-cw-service": graphic.stream,
    "aria-hidden": "true",
  });
  drawing.append(svgElement("rect", {
    x: -halfWidth,
    y: -halfDepth,
    width: graphic.widthMm,
    height: graphic.depthMm,
    rx: 8,
    class: `${primaryClass} generic-cw-casing`,
    ...(componentId ? { "data-component-id": componentId } : {}),
  }));
  drawing.append(svgElement("rect", {
    x: -halfWidth + inset,
    y: -halfDepth + inset,
    width: graphic.widthMm - inset * 2,
    height: graphic.depthMm - inset * 2,
    rx: 5,
    class: "generic-cw-top-panel",
  }));
  for (const xMm of [-halfWidth + graphic.railWidthMm, halfWidth - graphic.railWidthMm]) {
    drawing.append(svgElement("line", {
      x1: xMm,
      y1: -halfDepth + 8,
      x2: xMm,
      y2: halfDepth - 8,
      class: "generic-cw-clamp-rail",
    }));
  }
  if (graphic.partType === "attenuator" || graphic.partType === "combined") {
    drawing.append(svgElement("rect", {
      x: -halfWidth + 42,
      y: -halfDepth + 38,
      width: graphic.widthMm - 84,
      height: graphic.depthMm - 76,
      rx: 10,
      class: "generic-cw-access-panel",
    }));
    for (const xMm of [-halfWidth + 55, halfWidth - 55]) {
      drawing.append(svgElement("line", {
        x1: xMm,
        y1: -halfDepth + 54,
        x2: xMm,
        y2: halfDepth - 54,
        class: "generic-cw-panel-seam",
      }));
    }
  }
  for (const port of graphic.ports) {
    if (port.family === "rigid-epp") {
      const radius = port.outsideDiameterMm ? port.outsideDiameterMm / 2 : 28;
      drawing.append(svgElement("circle", {
        cx: port.xMm,
        cy: port.yMm,
        r: radius,
        class: `generic-cw-main-collar${port.outsideDiameterMm ? " evidenced" : " symbolic"}`,
        "data-generic-cw-port-role": port.role,
      }));
      drawing.append(svgElement("circle", {
        cx: port.xMm,
        cy: port.yMm,
        r: Math.max(12, radius - 9),
        class: `generic-cw-main-bore service-${port.stream}`,
      }));
    } else if (port.family === "semi-rigid-pe") {
      drawing.append(svgElement("circle", {
        cx: port.xMm,
        cy: port.yMm,
        r: 17,
        class: `generic-cw-radial-socket service-${port.stream}`,
      }));
    }
  }
  if (graphic.partType === "attenuator" || graphic.partType === "combined") {
    const identity = svgElement("text", { x: 0, y: -23, class: "generic-cw-identity", "text-anchor": "middle" });
    identity.textContent = graphic.displayIdentity;
    drawing.append(identity);
    const part = svgElement("text", { x: 0, y: 8, class: "generic-cw-part-label", "text-anchor": "middle" });
    part.textContent = graphic.partLabel;
    drawing.append(part);
    const service = svgElement("text", { x: 0, y: 35, class: "generic-cw-service-label", "text-anchor": "middle" });
    service.textContent = `${graphic.serviceLabel} · ${graphic.verificationLabel}`;
    drawing.append(service);
    const arrowStart = -34 * graphic.flowDirectionX;
    const arrowEnd = 34 * graphic.flowDirectionX;
    drawing.append(svgElement("line", {
      x1: arrowStart,
      y1: 60,
      x2: arrowEnd,
      y2: 60,
      class: "generic-cw-flow-arrow",
    }));
    drawing.append(svgElement("path", {
      d: `M ${arrowEnd - 12 * graphic.flowDirectionX} 50 L ${arrowEnd} 60 L ${arrowEnd - 12 * graphic.flowDirectionX} 70 Z`,
      class: "generic-cw-flow-arrow-head",
    }));
  }
  group.append(drawing);
}

function portUsage(componentId, portId) {
  const endpointMatches = (endpoint) => endpoint?.componentId === componentId && endpoint?.portId === portId;
  const route = history.present.routes.find((candidate) => (
    endpointMatches(candidate.startAttachment) || endpointMatches(candidate.endAttachment)
  ));
  if (route) return { occupied: true, kind: "route", id: route.id };
  const connection = history.present.connections.find((candidate) => (
    endpointMatches(candidate.from) || endpointMatches(candidate.to)
  ));
  if (connection) return { occupied: true, kind: "internal connection", id: connection.id };
  return { occupied: false, kind: null, id: null };
}

function portRouteState(port, usage) {
  if (activeTool !== "route" || !mechanicalState.ductKind) return null;
  if (usage.occupied) return "incompatible";
  const family = routeFamilyForKind(mechanicalState.ductKind);
  if (!interfacesCompatibleForDisplay(family.connectionInterface, port.interface)) return "incompatible";
  const draft = mechanicalState.routeDraft;
  if (draft && (port.system !== draft.system || port.stream !== draft.stream || port.role !== draft.role)) {
    return "incompatible";
  }
  return "compatible";
}

function interfacesCompatibleForDisplay(left, right) {
  if (left === null || right === null || left === undefined || right === undefined) return true;
  const samePhysicalFamily = left.family === right.family;
  const sameDrawingClass = (
    typeof left.drawingConnectionClass === "string" &&
    left.drawingConnectionClass.length > 0 &&
    left.drawingConnectionClass === right.drawingConnectionClass
  );
  if (!samePhysicalFamily && !sameDrawingClass) return false;
  if (left.nominalSizeMm === null || right.nominalSizeMm === null) return true;
  return left.nominalSizeMm === right.nominalSizeMm;
}

function shortPortRole(role) {
  if (role === "Dwelling supply") return "Supply";
  if (role === "Dwelling extract") return "Extract";
  if (role === "Outdoor intake") return "Intake";
  if (role === "Outdoor exhaust") return "Exhaust";
  return role;
}

function componentDisplayDragDelta(componentId) {
  if (!componentDragState?.memberIds.includes(componentId)) return { x: 0, y: 0 };
  return {
    x: componentDragState.preview.x - componentDragState.start.x,
    y: componentDragState.preview.y - componentDragState.start.y,
  };
}

function renderEquipmentAssemblyServiceZone(assembly) {
  const centre = equipmentAssemblyCentre(history.present, assembly);
  const firstComponent = history.present.components.find((component) => component.id === assembly.componentIds[0]);
  if (!firstComponent || !componentIsVisible(firstComponent)) return;
  const dragDelta = componentDisplayDragDelta(firstComponent.id);
  const angleRad = componentYaw(firstComponent.orientation);
  const angleDegrees = angleRad * 180 / Math.PI;
  const zone = assembly.serviceZoneMm;
  const group = svgElement("g", {
    transform: `translate(${toView(centre.x + dragDelta.x)} ${toView(centre.y + dragDelta.y)}) rotate(${angleDegrees})`,
    "data-equipment-assembly-id": assembly.id,
  });
  group.append(svgElement("rect", {
    x: toView(zone.minX),
    y: toView(zone.minY),
    width: toView(zone.maxX - zone.minX),
    height: toView(zone.maxY - zone.minY),
    rx: 8,
    class: "equipment-service-zone",
  }));
  const zoneCorners = [
    { x: zone.minX, y: zone.minY },
    { x: zone.maxX, y: zone.minY },
    { x: zone.maxX, y: zone.maxY },
    { x: zone.minX, y: zone.maxY },
  ].map((point) => ({
    x: centre.x + dragDelta.x + point.x * Math.cos(angleRad) - point.y * Math.sin(angleRad),
    y: centre.y + dragDelta.y + point.x * Math.sin(angleRad) + point.y * Math.cos(angleRad),
  }));
  const label = svgElement("text", {
    x: toView(Math.min(...zoneCorners.map((point) => point.x))) + 6,
    y: toView(Math.min(...zoneCorners.map((point) => point.y))) + 13,
    class: "equipment-service-zone-label",
  });
  label.textContent = `${assembly.stream} service allowance · provisional`;
  modelLayer.append(group, label);
}

function renderCamera() {
  canvas.setAttribute("viewBox", `${camera.x} ${camera.y} ${camera.width} ${camera.height}`);
}

function renderReferences() {
  referenceLayer.replaceChildren();
  for (const reference of history.present.floorReferences) {
    if (!reference.visible) continue;
    const asset = history.present.referenceAssets.find((candidate) => candidate.id === reference.assetId);
    if (!asset) continue;
    const scale = effectiveReferenceScale(reference) / MILLIMETRES_PER_VIEW_UNIT;
    const translation = reference.transform.translationMm;
    const transform = `translate(${toView(translation.x)} ${toView(translation.y)}) rotate(${reference.transform.rotationRad * 180 / Math.PI}) scale(${scale})`;
    const group = svgElement("g", { transform, "data-reference-id": reference.id });
    const editingCrop = activeTool === "crop-reference" && referenceCropState?.referenceId === reference.id;
    const visibleRect = !editingCrop && reference.cropSourceRectPx
      ? reference.cropSourceRectPx
      : { x: 0, y: 0, width: asset.widthPx, height: asset.heightPx };
    const image = svgElement("image", {
      href: asset.dataUrl,
      x: 0,
      y: 0,
      width: asset.widthPx,
      height: asset.heightPx,
      opacity: editingCrop ? Math.max(0.25, reference.opacity * 0.72) : reference.opacity,
      class: "reference-image",
      preserveAspectRatio: "none",
    });
    if (reference.cropSourceRectPx && !editingCrop) {
      const clipId = `reference-crop-${reference.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
      const defs = svgElement("defs", {});
      const clipPath = svgElement("clipPath", { id: clipId, clipPathUnits: "userSpaceOnUse" });
      clipPath.append(svgElement("rect", reference.cropSourceRectPx));
      defs.append(clipPath);
      image.setAttribute("clip-path", `url(#${clipId})`);
      group.append(defs);
    }
    group.append(
      image,
      svgElement("rect", {
        ...visibleRect,
        class: "reference-frame",
        "vector-effect": "non-scaling-stroke",
      }),
    );
    if (editingCrop && reference.cropSourceRectPx) {
      group.append(svgElement("rect", {
        ...reference.cropSourceRectPx,
        class: "reference-crop-existing",
        "vector-effect": "non-scaling-stroke",
      }));
    }
    referenceLayer.append(group);
  }
  for (const reference of history.present.floorCadReferences) {
    if (!reference.visible) continue;
    const asset = history.present.cadReferenceAssets.find((candidate) => candidate.id === reference.assetId);
    if (!asset) continue;
    const transformed = cachedCadReferenceProjection(asset, reference).transformed;
    const group = svgElement("g", {
      opacity: reference.opacity,
      class: asset.partialImportAccepted ? "cad-reference-partial" : "",
      "data-cad-reference-id": reference.id,
      "data-locked": "true",
    });
    for (const item of transformed.geometry) group.append(renderCadGeometryItem(item));
    referenceLayer.append(group);
  }
}

function renderCadGeometryItem(item) {
  const common = {
    class: item.kind === "text" ? "cad-reference-text" : "cad-reference-geometry",
    "data-cad-kind": item.kind,
    "data-cad-layer": item.layer,
    "data-source-handle": item.sourceHandle ?? "",
  };
  if (item.kind === "line") {
    return svgElement("line", {
      ...common,
      x1: toView(item.start.x), y1: toView(item.start.y),
      x2: toView(item.end.x), y2: toView(item.end.y),
    });
  }
  if (item.kind === "lwpolyline") {
    return svgElement("path", { ...common, d: dxfPolylinePath(item.vertices, item.closed, toView) });
  }
  if (item.kind === "circle") {
    return svgElement("circle", {
      ...common,
      cx: toView(item.center.x), cy: toView(item.center.y), r: toView(item.radiusMm),
    });
  }
  if (item.kind === "arc") {
    return svgElement("path", {
      ...common,
      d: dxfArcPath(item.center, item.radiusMm, item.startAngleRad, item.endAngleRad, toView),
    });
  }
  const text = svgElement("text", {
    ...common,
    x: toView(item.insertion.x),
    y: toView(item.insertion.y),
    "font-size": Math.max(2, toView(item.heightMm)),
    transform: `rotate(${item.rotationRad * 180 / Math.PI} ${toView(item.insertion.x)} ${toView(item.insertion.y)})`,
  });
  text.textContent = item.text;
  return text;
}

function cachedCadReferenceProjection(asset, reference) {
  const signature = `${asset.derivedFingerprint}\u0000${JSON.stringify({
    assetId: reference.assetId,
    includedLayers: reference.includedLayers,
    units: reference.units,
    transform: reference.transform,
  })}`;
  const cached = cadProjectionCache.get(reference.id);
  if (cached?.signature === signature) return cached;
  const value = {
    signature,
    transformed: transformDxfReferenceGeometry(asset, reference),
    snaps: dxfReferenceSnapPoints(asset, reference),
  };
  cadProjectionCache.set(reference.id, value);
  if (cadProjectionCache.size > 8) {
    for (const key of cadProjectionCache.keys()) {
      if (!history.present.floorCadReferences.some((candidate) => candidate.id === key)) {
        cadProjectionCache.delete(key);
      }
    }
  }
  return value;
}

function dxfArcPath(center, radius, startAngle, endAngle, coordinate) {
  const start = { x: center.x + radius * Math.cos(startAngle), y: center.y + radius * Math.sin(startAngle) };
  const end = { x: center.x + radius * Math.cos(endAngle), y: center.y + radius * Math.sin(endAngle) };
  const delta = positiveAngleDelta(startAngle, endAngle);
  return `M ${coordinate(start.x)} ${coordinate(start.y)} A ${coordinate(radius)} ${coordinate(radius)} 0 ${delta > Math.PI ? 1 : 0} 1 ${coordinate(end.x)} ${coordinate(end.y)}`;
}

function dxfPolylinePath(vertices, closed, coordinate) {
  if (!vertices.length) return "";
  const commands = [`M ${coordinate(vertices[0].x)} ${coordinate(vertices[0].y)}`];
  const segmentCount = closed ? vertices.length : vertices.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    if (Math.abs(start.bulge) < 1e-12) {
      commands.push(`L ${coordinate(end.x)} ${coordinate(end.y)}`);
      continue;
    }
    const chord = Math.hypot(end.x - start.x, end.y - start.y);
    const radius = chord * (1 + start.bulge ** 2) / (4 * Math.abs(start.bulge));
    const includedAngle = 4 * Math.atan(start.bulge);
    commands.push(`A ${coordinate(radius)} ${coordinate(radius)} 0 ${Math.abs(includedAngle) > Math.PI ? 1 : 0} ${start.bulge > 0 ? 1 : 0} ${coordinate(end.x)} ${coordinate(end.y)}`);
  }
  if (closed) commands.push("Z");
  return commands.join(" ");
}

function positiveAngleDelta(start, end) {
  const delta = (end - start) % (Math.PI * 2);
  return delta < 0 ? delta + Math.PI * 2 : delta;
}

function renderDraft() {
  draftLayer.replaceChildren();
  if (activeTask === "ventilation" && activeTool === "routing-exclusion" && routingExclusionDraftStart && hoverPoint) {
    const x = Math.min(routingExclusionDraftStart.x, hoverPoint.x), y = Math.min(routingExclusionDraftStart.y, hoverPoint.y);
    draftLayer.append(svgElement("rect", { x: toView(x), y: toView(y), width: toView(Math.abs(hoverPoint.x - routingExclusionDraftStart.x)), height: toView(Math.abs(hoverPoint.y - routingExclusionDraftStart.y)), class: "routing-exclusion-draft" }));
  }
  if (activeTask === "ventilation" && automaticRadialPreview?.proposals.length) {
    for (const proposal of automaticRadialPreview.proposals) {
      const swept = deriveSweptCentreline(proposal.points).points;
      draftLayer.append(svgElement("polyline", {
        points: routePointString(swept),
        class: `automatic-route-preview ${proposal.stream}`,
        "stroke-width": toView(proposal.diameterMm),
        "data-automatic-route-preview": proposal.destination.componentId,
      }));
      draftLayer.append(svgElement("polyline", {
        points: routePointString(swept),
        class: "automatic-route-preview-centre",
        "data-automatic-route-preview-centre": proposal.destination.componentId,
      }));
    }
  }
  if (activeTask === "ventilation" && automaticEppPreview?.proposal) {
    const proposal = automaticEppPreview.proposal;
    const swept = deriveSweptCentreline(proposal.points).points;
    draftLayer.append(svgElement("polyline", {
      points: routePointString(swept),
      class: `automatic-route-preview epp ${proposal.stream}`,
      "stroke-width": toView(proposal.diameterMm),
      "data-automatic-epp-preview": proposal.destination.componentId,
    }));
    draftLayer.append(svgElement("polyline", {
      points: routePointString(swept),
      class: "automatic-route-preview-centre epp",
      "data-automatic-epp-preview-centre": proposal.destination.componentId,
    }));
  }
  if (activeTool === "crop-reference" && referenceCropState) {
    const reference = selectedReference();
    const crop = referenceCropState.stagedSourceRectPx ?? (
      referenceCropState.startSourcePoint && referenceCropState.currentSourcePoint
        ? cropRectFromPoints(referenceCropState.startSourcePoint, referenceCropState.currentSourcePoint)
        : null
    );
    if (reference && crop) {
      const sourceCorners = [
        { x: crop.x, y: crop.y },
        { x: crop.x + crop.width, y: crop.y },
        { x: crop.x + crop.width, y: crop.y + crop.height },
        { x: crop.x, y: crop.y + crop.height },
      ];
      const points = sourceCorners
        .map((point) => sourcePointToWorld(reference.transform, point, effectiveReferenceScale(reference)))
        .map((point) => `${toView(point.x)},${toView(point.y)}`)
        .join(" ");
      draftLayer.append(svgElement("polygon", {
        points,
        class: "reference-crop-draft",
        "vector-effect": "non-scaling-stroke",
      }));
    }
  }
  if (calibrationState?.worldPoints.length) {
    const points = calibrationState.worldPoints;
    if (points.length === 2) {
      draftLayer.append(svgElement("line", {
        x1: toView(points[0].x), y1: toView(points[0].y), x2: toView(points[1].x), y2: toView(points[1].y),
        class: "calibration-line",
      }));
    }
    for (const point of points) {
      draftLayer.append(svgElement("circle", { cx: toView(point.x), cy: toView(point.y), r: 6, class: "calibration-point" }));
    }
  }
  if (activeTool === "place-component" && mechanicalState.pointer && mechanicalState.placement) {
    const item = findCatalogueItem(mechanicalState.placement.catalogueItemId);
    const symbol = item.symbol;
    const attributes = {
      class: "component-ghost",
      "pointer-events": "none",
    };
    const planGraphic = deriveComponentPlanGraphic(grilleAlignmentPreview?.component ?? item);
    if (planGraphic) {
      const group = svgElement("g", {
        transform: `translate(${toView(mechanicalState.pointer.x)} ${toView(mechanicalState.pointer.y)}) rotate(${grilleAlignmentPreview ? componentYaw(grilleAlignmentPreview.component.orientation)*180/Math.PI : 0})`,
        "pointer-events": "none",
      });
      appendComponentPlanGraphic(group, planGraphic, {
        primaryClass: "component-ghost",
        ghost: true,
      });
      draftLayer.append(group);
    } else if (symbol.shape === "circle") {
      draftLayer.append(svgElement("circle", {
        cx: toView(mechanicalState.pointer.x),
        cy: toView(mechanicalState.pointer.y),
        r: toView(symbol.widthMm) / 2,
        ...attributes,
      }));
    } else {
      draftLayer.append(svgElement("rect", {
        x: toView(mechanicalState.pointer.x) - toView(symbol.widthMm) / 2,
        y: toView(mechanicalState.pointer.y) - toView(symbol.heightMm) / 2,
        width: toView(symbol.widthMm),
        height: toView(symbol.heightMm),
        rx: 5,
        ...attributes,
      }));
    }
  }
  if (activeTool === "place-assembly" && mechanicalState.pointer && mechanicalState.placement) {
    const value = createEquipmentAssembly(mechanicalState.placement.assemblyTemplateId, {
      id: "draft-equipment-assembly",
      floorId: "floor-ground",
      xMm: mechanicalState.pointer.x,
      yMm: mechanicalState.pointer.y,
    });
    const zone = value.assembly.serviceZoneMm;
    draftLayer.append(svgElement("rect", {
      x: toView(mechanicalState.pointer.x + zone.minX),
      y: toView(mechanicalState.pointer.y + zone.minY),
      width: toView(zone.maxX - zone.minX),
      height: toView(zone.maxY - zone.minY),
      rx: 8,
      class: "equipment-service-zone component-ghost",
      "pointer-events": "none",
    }));
    for (const component of value.components) {
      const group = svgElement("g", {
        transform: `translate(${toView(component.positionMm.x)} ${toView(component.positionMm.y)})`,
        "pointer-events": "none",
      });
      appendComponentPlanGraphic(group, deriveComponentPlanGraphic(component), {
        primaryClass: "component-ghost",
        ghost: true,
      });
      draftLayer.append(group);
    }
  }
  if (activeTool === "route" && mechanicalState.routeDraft) {
    const preview = mechanicalState.pointer
      ? [...mechanicalState.routeDraft.points, mechanicalState.pointer]
      : mechanicalState.routeDraft.points;
    const sweptPreview = preview.length >= 2 ? deriveDuctBodyGeometry({ductKind:mechanicalState.ductKind,points:preview,parallelRunCount:1},routeFamilyForKind(mechanicalState.ductKind)).sampledCentreline : preview;
    draftLayer.append(svgElement("polyline", {
      points: routePointString(sweptPreview),
      class: `draft-route ${mechanicalState.routeDraft.ductKind}`,
    }));
  }
  if (
    (activeTool === "wall" || activeTool === "room-divider" || activeTool === "floor-area") &&
    snapEnabled &&
    hoverPoint &&
    ["endpoint", "wall", "reference"].includes(hoverPoint.snapKind)
  ) {
    draftLayer.append(svgElement("circle", {
      cx: toView(hoverPoint.x),
      cy: toView(hoverPoint.y),
      r: 9,
      class: `snap-target ${hoverPoint.snapKind}`,
      "aria-hidden": "true",
    }));
  }
  if (activeTool === "floor-area") {
    if (floorAreaDraftPoints.length === 0) return;
    const previewPoints = hoverPoint ? [...floorAreaDraftPoints, hoverPoint] : floorAreaDraftPoints;
    draftLayer.append(svgElement("polygon", {
      points: previewPoints.map((point) => `${toView(point.x)},${toView(point.y)}`).join(" "),
      class: "draft-floor-area",
    }));
    for (const point of floorAreaDraftPoints) {
      draftLayer.append(svgElement("circle", {
        cx: toView(point.x),
        cy: toView(point.y),
        r: 5,
        class: `draft-node${point.snapKind === "endpoint" ? " snapped" : point.snapKind === "wall" ? " junction" : point.snapKind === "reference" ? " reference" : ""}`,
      }));
    }
    return;
  }
  if (draftPoints.length === 0) return;
  const previewPoints = hoverPoint ? [...draftPoints, hoverPoint] : draftPoints;
  draftLayer.append(svgElement("polyline", {
    points: previewPoints.map((point) => `${toView(point.x)},${toView(point.y)}`).join(" "),
    class: `draft-wall${activeTool === "room-divider" ? " room-divider" : ""}`,
  }));
  for (const point of draftPoints) {
    draftLayer.append(svgElement("circle", {
      cx: toView(point.x), cy: toView(point.y), r: 5,
      class: `draft-node${point.snapKind === "endpoint" ? " snapped" : point.snapKind === "wall" ? " junction" : point.snapKind === "reference" ? " reference" : ""}`,
    }));
  }
}

function renderReferenceList() {
  referenceList.replaceChildren();
  const reference = selectedReference();
  if (!reference) {
    referenceList.append(htmlText("span", "No reference"));
    calibrateReferenceButton.disabled = true;
    cropReferenceButton.disabled = true;
    resetReferenceCropButton.disabled = true;
    cancelReferenceCropButton.hidden = true;
    return;
  }
  const asset = history.present.referenceAssets.find((candidate) => candidate.id === reference.assetId);
  const pdfSource = asset?.source?.kind === "pdf-page"
    ? history.present.pdfReferenceAssets.find((candidate) => candidate.id === asset.source.pdfAssetId)
    : null;
  const scale = referenceScaleMmPerPixel(reference);
  const scaleScope = reference.calibration?.modelScaleMode === "reference-and-floor-walls"
    ? "authored wall/outline XY rescaled"
    : "reference only";
  referenceList.append(
    htmlText("strong", pdfSource ? `${pdfSource.fileName} · page ${asset.source.pageNumber}` : asset?.fileName ?? reference.assetId),
    htmlText("span", pdfSource
      ? `Locked PDF page render · original ${pdfSource.pageCount}-page source preserved · below authoritative model`
      : "Locked · below authoritative model"),
    htmlText("span", scale === null ? "Not calibrated" : `${formatScale(scale)} · two-point calibration · ${scaleScope}`, scale === null ? "uncalibrated" : "calibrated"),
    htmlText("span", pdfSource
      ? `${asset?.widthPx ?? "?"} × ${asset?.heightPx ?? "?"} px · rendered with ${asset.source.rendererId} ${asset.source.rendererVersion}`
      : `${asset?.widthPx ?? "?"} × ${asset?.heightPx ?? "?"} px · source embedded`),
    ...(pdfSource ? [htmlText("span", reference.cropSourceRectPx
      ? `Cropped to ${Math.round(reference.cropSourceRectPx.width)} × ${Math.round(reference.cropSourceRectPx.height)} px · original page retained`
      : "Full PDF page visible · crop available before or after calibration")] : []),
  );
  calibrateReferenceButton.disabled = false;
  cropReferenceButton.disabled = !pdfSource || activeTool === "crop-reference";
  cropReferenceButton.textContent = reference.cropSourceRectPx ? "Adjust PDF crop" : "Crop PDF floor plan";
  resetReferenceCropButton.disabled = !pdfSource || !reference.cropSourceRectPx || activeTool === "crop-reference";
  cancelReferenceCropButton.hidden = activeTool !== "crop-reference";
}

function renderCadReferenceList() {
  cadReferenceList.replaceChildren();
  const references = history.present.floorCadReferences;
  if (references.length === 0) {
    cadReferenceList.append(htmlText("span", "No DXF reference"));
    return;
  }
  for (const [index, reference] of references.entries()) {
    const asset = history.present.cadReferenceAssets.find((candidate) => candidate.id === reference.assetId);
    if (!asset) continue;
    if (index > 0) cadReferenceList.append(document.createElement("hr"));
    const warningCount = asset.diagnostics.filter((item) => item.severity === "warning" || item.severity === "error").length;
    cadReferenceList.append(
      htmlText("strong", asset.fileName),
      htmlText("span", "Locked synthetic DXF reference · never authoritative walls"),
      htmlText("span", `${reference.units.unit} · ${reference.includedLayers.length} selected layer${reference.includedLayers.length === 1 ? "" : "s"} · ${asset.counts.expandedEntities} parsed item${asset.counts.expandedEntities === 1 ? "" : "s"}`),
      htmlText(
        "span",
        asset.partialImportAccepted
          ? `${asset.counts.omittedEntities} diagnosed omission${asset.counts.omittedEntities === 1 ? "" : "s"} accepted · warning remains on sheet`
          : `${warningCount} diagnostic${warningCount === 1 ? "" : "s"} · no accepted omissions`,
        asset.partialImportAccepted ? "uncalibrated" : "calibrated",
      ),
    );
  }
}

function htmlText(name, value, className = "") {
  const element = document.createElement(name);
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

function renderCataloguePalette() {
  const query = catalogueSearchInput.value.trim().toLowerCase();
  const allEntries = [
    ...["vertical", "horizontal"].map((mounting) => ({
      id: `mvhr-${mounting}`, group: "Units", category: "mvhr-placement", mounting,
      name: `${mounting === "vertical" ? "Vertical" : "Horizontal"} MVHR`,
      searchTerms: "CA200 ComfoAir 200 Q350 Zehnder Aerofresh 450 HRV ERV CW ComfoWell attenuators", placeable: true,
    })),
    ...["round", "rectangular"].map(shape => ({
      id: `terminal-${shape}`, group: "Terminals", terminalSection:"Internal", category: "terminal-placement", terminalShape: shape,
      name: shape === "round" ? "Round" : "Rectangle",
      searchTerms: shape === "round" ? "internal Luna supply extract grille round terminal" : "internal Aerofresh magnetic cover supply extract wall bulkhead rectangular terminal",
      placeable: true,
    })),
    ...["individual","combined"].map(kind=>({
      id:`external-grille-${kind}-tool`,group:"Terminals",terminalSection:"External",category:"external-grille-placement",isExternalGrille:true,externalGrilleKind:kind,
      name:kind==="individual"?"Individual":"Combined",searchTerms:`external outdoor grille intake exhaust ${kind} facade terminal`,placeable:true,
    })),
    ...["horizontal","vertical"].map(orientation=>({id:`standalone-cw-${orientation}-tool`,group:"Attenuation & distribution",category:"standalone-cw-placement",cwOrientation:orientation,name:`${orientation==="horizontal"?"Horizontal":"Vertical"} CW`,searchTerms:"ComfoWell 220 320 420 520 625 standalone remote attenuator distribution supply extract",placeable:true})),
    ...COMPONENT_CATALOGUE.filter((item) => !item.assemblyOnly && item.category !== "attenuator-manifold" && !["Units", "Terminals"].includes(item.group)),
    // Legacy generic remote assemblies remain readable in saved projects and the library.

  ];
  const groups = [...new Set(allEntries.map((item) => item.group)), "Duct"];
  if (!groups.includes(selectedCatalogueGroup)) selectedCatalogueGroup = groups[0];
  catalogueCategories.replaceChildren();
  for (const groupName of groups) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "parts-category";
    button.classList.toggle("active", groupName === selectedCatalogueGroup);
    button.setAttribute("aria-pressed", String(groupName === selectedCatalogueGroup));
    button.append(
      htmlText("strong", catalogueGroupGlyph(groupName)),
      htmlText("span", compactGroupName(groupName)),
    );
    button.addEventListener("click", () => {
      selectedCatalogueGroup = groupName;
      queueWorkingSession();
      catalogueSearchInput.value = "";
      renderCataloguePalette();
    });
    catalogueCategories.append(button);
  }
  const entries = allEntries.filter((item) => {
    if (!query) return item.group === selectedCatalogueGroup;
    return [item.name, item.manufacturer, item.productId, item.group, item.category, item.status, item.searchTerms]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
  const ductPanel=document.querySelector("#duct-parts");
  const matchingDuctButtons=routeButtons.filter(button=>!query || button.textContent.toLowerCase().includes(query));
  const showDuct=query ? matchingDuctButtons.length>0 : selectedCatalogueGroup==="Duct";
  ductPanel.hidden=!showDuct;
  for(const button of routeButtons)button.hidden=Boolean(query) && !matchingDuctButtons.includes(button);
  catalogueGroups.replaceChildren();
  let terminalSection=null;
  for (const item of entries) {
    if(item.terminalSection && item.terminalSection!==terminalSection) {
      catalogueGroups.append(htmlText("h3",item.terminalSection,"terminal-menu-heading"));
      terminalSection=item.terminalSection;
    }
    const tile = document.createElement(item.placeable ? "button" : "div");
    if (item.placeable) tile.type = "button";
    tile.className = `parts-product-tile${item.placeable ? " catalogue-tool" : " catalogue-candidate"}`;
    if (item.placeable) {
      if (item.cwOrientation) tile.dataset.cwOrientation = item.cwOrientation;
      else if (item.isExternalGrille) tile.dataset.externalGrille = item.externalGrilleKind;
      else if (item.terminalShape) tile.dataset.terminalShape = item.terminalShape;
      else if (item.mounting) tile.dataset.mvhrMounting = item.mounting;
      else if (item.isAssemblyTemplate) tile.dataset.assemblyTemplateId = item.id;
      else tile.dataset.catalogueItemId = item.id;
      const active = item.cwOrientation ? standaloneCwPlacement === item.cwOrientation : item.isExternalGrille ? externalGrillePlacement === item.externalGrilleKind : item.terminalShape ? terminalPlacementShape === item.terminalShape : item.mounting ? mvhrPlacementMounting === item.mounting : item.isAssemblyTemplate
        ? activeTool === "place-assembly" && mechanicalState.placement?.assemblyTemplateId === item.id
        : activeTool === "place-component" && mechanicalState.placement?.catalogueItemId === item.id;
      tile.setAttribute("aria-pressed", String(active));
      tile.classList.toggle("active", active);
      tile.addEventListener("click", () => {
        if (item.cwOrientation) {
          setTool("place-component",{catalogueItemId:"generic-supply-attenuation-distribution-160"});
          standaloneCwPlacement=item.cwOrientation;renderCataloguePalette();
          interactionMessage="Click to place a standalone CW · choose size and air service · Shift/Ctrl repeats";render();
        } else if (item.isExternalGrille) {
          externalGrilleDefault={...externalGrilleDefault,service:item.externalGrilleKind==="combined"?"combined":externalGrilleDefault.service==="combined"?"intake":externalGrilleDefault.service};
          setTool("place-component",{catalogueItemId:externalGrilleRecordId(externalGrilleDefault)});
          externalGrillePlacement=item.externalGrilleKind;renderCataloguePalette();
          interactionMessage=`Click outside the building to place ${item.externalGrilleKind === "combined" ? "a combined grille" : "an individual intake or exhaust grille"}`;render();
        } else if (item.terminalShape) {
          const service = terminalDefaults.get(item.terminalShape) ?? "supply";
          setTool("place-component", { catalogueItemId: terminalRecordId(item.terminalShape, service) });
          terminalPlacementShape = item.terminalShape;
          renderCataloguePalette();
          interactionMessage = "Click the plan to configure a terminal · room/zone selects air service · Shift/Ctrl repeats";
          render();
        } else if (item.mounting) {
          setTool("place-component", { catalogueItemId: "synthetic-mvhr-placeholder" });
          mvhrPlacementMounting = item.mounting;
          renderCataloguePalette();
          interactionMessage = `Click the plan to configure a ${item.mounting} MVHR · Shift/Ctrl repeats placement`;
          render();
        } else if (item.isAssemblyTemplate) setTool("place-assembly", { assemblyTemplateId: item.id });
        else setTool("place-component", { catalogueItemId: item.id });
      });
    }
    const glyph = catalogueThumbnail(item);
    glyph.setAttribute("aria-hidden", "true");
    tile.append(
      glyph,
      htmlText("strong", item.name),
      htmlText("small", item.cwOrientation ? "Choose CW size & air service" : item.isExternalGrille ? item.externalGrilleKind === "individual" ? "Intake or exhaust" : "Intake + exhaust" : item.terminalShape ? item.terminalShape === "round" ? "Luna · Supply or Extract" : "Aerofresh magnetic cover · Supply or Extract" : item.mounting
        ? item.mounting === "vertical" ? "Place, then choose model & layout" : "CA200 or generic planning unit"
        : item.isAssemblyTemplate
        ? `${item.componentCount} grouped parts · service zone`
        : item.placeable
        ? cataloguePlacementSummary(item)
        : item.candidateSummary
          ? `${item.productId} · ${item.candidateSummary}`
          : `${item.productId} · evidence pending`),
    );
    catalogueGroups.append(tile);
  }
  if (entries.length === 0 && !showDuct) {
    catalogueGroups.append(htmlText("p", "No catalogue records match this search.", "catalogue-empty"));
  }
  catalogueButtons = [...catalogueGroups.querySelectorAll(".catalogue-tool")];
}

function cataloguePlacementSummary(item) {
  if (item.symbol?.shape === "luna-grille") return "Round grille · drawing symbol";
  if (item.symbol?.shape === "wall-grille") return "Wall / bulkhead · magnetic cover · drawing symbol";
  if (item.id === "synthetic-mvhr-placeholder") {
    return "Generic drafting HRV · 4 typed DN160 ports";
  }
  if (item.status === "verified-dimensional-setout-routable-ports-pending") {
    return `${item.productId} · 725 × 570 setout · 4 × 160/190 connections · roles/coordinates pending`;
  }
  if (item.status === "source-backed-drawing-profile-installation-review-required") {
    const side = item.handing.endsWith("-left") ? "left" : "right";
    return `${item.productId} · ${side}-hand drawing profile · 4 typed DN160 ports · installation fit unverified`;
  }
  if (item.status === "synthetic-not-manufacturer-verified") {
    return `Generic · ${item.ports.length} typed port${item.ports.length === 1 ? "" : "s"}`;
  }
  return `${item.productId ?? item.id} · placement status pending`;
}

function renderConnectionDemand() {
  const demand = deriveVentilationConnectionDemand(history.present);
  renderDemandSide(demand.supply, supplyRunDemand, supplyRunDetail, "supply");
  renderDemandSide(demand.extract, extractRunDemand, extractRunDetail, "extract");
  cwSuggestionStatus.textContent = `CW suggestion: evidence pending. ${demand.cwSuggestion.note}`;
}

function renderRoutingWorkflow() {
  const workflow = inspectEquipmentFirstRouting(history.present, currentFloorId());
  for (const step of workflow.steps) {
    const item = routingWorkflowSteps.querySelector(`[data-routing-step="${step.id}"]`);
    if (!item) continue;
    item.dataset.status = step.status;
    const detail = item.querySelector("span");
    if (detail) detail.textContent = step.detail;
  }
  updateAutomaticRoutingStyle();
  const systemLabel = automaticRouteSystem.value === "epp" ? "EPP" : "DN90";
  automaticRouteButton.textContent = `Preview ${systemLabel} auto routes`;
  automaticRouteSetupStatus.textContent = workflow.status === "ready"
    ? `${routingStyleLabel()} preview is ready. Existing manual and accepted routes remain unchanged.`
    : "You can open the preview to see exact missing equipment or constraints; no route is committed until Apply.";
}

function renderRouteGuidance() {
  if (activeTool !== "route" || !mechanicalState.ductKind) {
    routeGuidance.classList.remove("active");
    routeGuidance.textContent = "Use rigid EPP DN160 between the generic HRV and each remote main, then semi-rigid DN90 from each radial branch to an outlet. A handed Q350 profile may use DN160 for drawing topology only; installation fit remains unverified. Click one free labelled port, then a matching free port.";
    return;
  }
  const family = routeFamilyForKind(mechanicalState.ductKind);
  routeGuidance.classList.add("active");
  const draft = mechanicalState.routeDraft;
  routeGuidance.textContent = draft
    ? `${family.name}: route started from ${draft.role}. Finish on a highlighted free port with the same role and selected route family. Grey ports are connected or incompatible.`
    : `${family.name}: highlighted ports are free and compatible. Click one to start. Grey ports are connected or need a different route family or an explicit adapter.`;
}

function renderClearVentilationControl() {
  const floor = currentFloor();
  if (!floor) {
    clearVentilationButton.disabled = true;
    clearVentilationButton.title = "No active floor";
    return;
  }
  const inspection = inspectFloorVentilationClear(history.present, floor.id);
  clearVentilationButton.disabled = inspection.isEmpty;
  clearVentilationButton.title = inspection.isEmpty
    ? `No ventilation objects on ${floor.name}`
    : `Clear only the ventilation objects on ${floor.name}`;
}

function renderDemandSide(side, countElement, detailElement, label) {
  countElement.textContent = side.outletsMissingRunCount > 0
    ? side.knownRunCount > 0 ? `${side.knownRunCount}+?` : "?"
    : String(side.knownRunCount);
  detailElement.textContent = side.outletCount === 0
    ? `No ${label} outlets`
    : `${side.outletCount} outlet${side.outletCount === 1 ? "" : "s"} · ${side.outletsMissingRunCount} count${side.outletsMissingRunCount === 1 ? "" : "s"} pending`;
}

function renderCatalogueLibrary() {
  const query = catalogueLibrarySearch.value.trim().toLowerCase();
  const entries = [
    ...EQUIPMENT_ASSEMBLY_TEMPLATES.map((item) => ({ ...item, isAssemblyTemplate: true })),
    ...COMPONENT_CATALOGUE,
    ...CATALOGUE_CANDIDATES,
  ].filter((item) => (
    !query || [item.name, item.manufacturer, item.productId, item.group, item.category, item.status]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query))
  ));
  catalogueLibraryRecords.replaceChildren();
  for (const item of entries) {
    const card = document.createElement("article");
    card.className = "catalogue-library-card";
    const glyph = catalogueThumbnail(item);
    glyph.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    copy.className = "record-copy";
    const status = htmlText("small", formatCatalogueStatus(item), `record-status${item.placeable ? "" : " pending"}`);
    copy.append(
      htmlText("strong", item.name),
      htmlText("span", [item.manufacturer, item.productId, item.group].filter(Boolean).join(" · ")),
      status,
      ...(catalogueEvidenceDetails(item) ? [htmlText("small", catalogueEvidenceDetails(item), "record-evidence")] : []),
      ...(catalogueSourceDetails(item) ? [htmlText("small", catalogueSourceDetails(item), "record-evidence")] : []),
      ...(catalogueDimensionDetails(item) ? [htmlText("small", catalogueDimensionDetails(item), "record-evidence")] : []),
      htmlText("small", item.note),
    );
    card.append(glyph, copy);
    catalogueLibraryRecords.append(card);
  }
  if (entries.length === 0 && !showDuct) {
    catalogueLibraryRecords.append(htmlText("p", "No catalogue records match this search.", "catalogue-empty"));
  }
}

function renderChecksWorkspace() {
  const floor = currentFloor();
  if (!floor) {
    checksStatusPill.textContent = "No active floor";
    checksStatusPill.className = "checks-status-pill warning";
    checksPartsSummary.textContent = "The project has no floor to inspect.";
    checksAssemblyGroups.replaceChildren();
    checksPartsList.replaceChildren();
    checksRoutesSummary.textContent = "No routes to inspect.";
    checksRoutesList.replaceChildren();
    checksDiagnosticSummary.textContent = "Connection checks need an active floor.";
    checksSpareBranches.replaceChildren();
    checksDiagnostics.replaceChildren();
    checksEvidenceBoundary.textContent = "No engineering conclusion is available.";
    checksScheduleSummary.textContent = "The project has no floor to schedule.";
    checksScheduleParts.replaceChildren();
    checksScheduleRoutes.replaceChildren();
    checksScheduleUnresolved.replaceChildren();
    checksScheduleBoundary.textContent = "No quantity or product conclusion is available.";
    checksConnectionEvidenceSummary.textContent = "The project has no floor to inspect.";
    checksConnectionEvidence.replaceChildren();
    checksConnectionEvidenceBoundary.textContent = "No connection or accessory conclusion is available.";
    checksAirflowSummary.textContent = "The project has no floor to total.";
    checksAirflowSpaces.replaceChildren();
    checksAirflowIssues.replaceChildren();
    checksAirflowBoundary.textContent = "No airflow or balance conclusion is available.";
    checksEngineeringForm.querySelectorAll("input, select, button").forEach((element) => { element.disabled = true; });
    checksEngineeringInputStatus.textContent = "No active floor.";
    checksEngineeringSummary.textContent = "No duty or pressure evidence is available.";
    checksEngineeringIssues.replaceChildren();
    checksEngineeringBoundary.textContent = "No engineering conclusion is available.";
    checksCostingSummary.textContent = "The project has no floor to cost.";
    checksCostingLines.replaceChildren();
    checksCostingIssues.replaceChildren();
    checksCostingBoundary.textContent = "No costing conclusion is available.";
    checksInstallerSummary.textContent = "The project has no floor for an installer data pack.";
    checksInstallerSections.replaceChildren();
    checksInstallerIssues.replaceChildren();
    checksInstallerBoundary.textContent = "No installer-document conclusion is available.";
    return;
  }

  const audit = auditVentilation(history.present, floor.id);
  const schedule = createPartsSchedule(history.present, { floorId: floor.id });
  const connectionEvidence = inspectConnectionAccessoryEvidence(history.present, floor.id);
  const airflow = inspectAirflowBalance(history.present, floor.id);
  const sizing = inspectSizingPressureEvidence(history.present, floor.id);
  const costing = inspectProductCostingReadiness(history.present, floor.id);
  const installer = createInstallerDocumentFoundation(history.present, floor.id);
  const issueCount = audit.diagnosticCounts.error + audit.diagnosticCounts.warning;
  checksStatusPill.textContent = audit.parts.componentCount === 0 && audit.routes.routeCount === 0
    ? "No ventilation model"
    : issueCount === 0
    ? "No topology issues"
    : `${issueCount} ${issueCount === 1 ? "issue" : "issues"}`;
  checksStatusPill.className = `checks-status-pill${audit.diagnosticCounts.error > 0 ? " error" : audit.diagnosticCounts.warning > 0 ? " warning" : ""}`;

  checksPartsSummary.textContent = `${audit.parts.componentCount} placed part ${audit.parts.componentCount === 1 ? "record" : "records"} · ${audit.parts.assemblyGroupCount} equipment ${audit.parts.assemblyGroupCount === 1 ? "group" : "groups"} organise ${audit.parts.groupedComponentCount} of them · ${audit.parts.independentComponentCount} independent.`;
  checksAssemblyGroups.replaceChildren();
  for (const group of audit.parts.assemblyGroups) {
    checksAssemblyGroups.append(checksListRow(
      group.name,
      `${group.componentCount} constituent part ${group.componentCount === 1 ? "record" : "records"} · group is not an extra quantity`,
    ));
  }
  checksPartsList.replaceChildren();
  for (const line of audit.parts.lines) {
    const split = [
      line.groupedCount > 0 ? `${line.groupedCount} in equipment groups` : null,
      line.independentCount > 0 ? `${line.independentCount} independent` : null,
    ].filter(Boolean).join(" · ");
    checksPartsList.append(checksListRow(line.name, `${line.count} placed${split ? ` · ${split}` : ""}`));
  }
  if (audit.parts.lines.length === 0) checksPartsList.append(htmlText("p", "No ventilation parts are placed on this floor.", "catalogue-empty"));

  checksRoutesSummary.textContent = `${audit.routes.routeCount} modelled ${audit.routes.routeCount === 1 ? "route" : "routes"} · ${formatDrawingLength(audit.routes.projectedMm)} drawing plan length · ${audit.routes.developedState === "known" ? `${formatDrawingLength(audit.routes.developedMm)} developed length` : "developed length pending elevations"}.`;
  checksRoutesList.replaceChildren();
  for (const group of audit.routes.groups) {
    checksRoutesList.append(checksListRow(
      group.name,
      `${group.routeCount} ${group.routeCount === 1 ? "route" : "routes"} · ${formatDrawingLength(group.projectedMm)} plan${group.developedState === "known" ? ` · ${formatDrawingLength(group.developedMm)} developed` : " · developed pending"}`,
    ));
  }
  if (audit.routes.groups.length === 0) checksRoutesList.append(htmlText("p", "No ventilation routes are modelled on this floor.", "catalogue-empty"));

  checksScheduleSummary.textContent = `${schedule.summary.componentQuantity} placed component ${schedule.summary.componentQuantity === 1 ? "record" : "records"}: ${schedule.summary.verifiedComponentQuantity} verified regional catalogue, ${schedule.summary.sourceBackedProvisionalQuantity} source-backed provisional, ${schedule.summary.unmatchedProvisionalQuantity} unmatched provisional. ${schedule.summary.routeCount} drawn ${schedule.summary.routeCount === 1 ? "route" : "routes"}.`;
  checksScheduleParts.replaceChildren();
  for (const line of schedule.componentLines) {
    const evidence = line.evidenceClass === "verified-catalogue"
      ? "verified regional match"
      : line.evidenceClass === "source-backed-provisional"
        ? "source-backed · review required"
        : "generic/unmatched · provisional";
    const identifiers = [
      line.partNumber ? `part number ${line.partNumber}` : line.productId ? `local ID ${line.productId}` : "no verified product ID",
      line.manufacturerArticle ? `manufacturer article ${line.manufacturerArticle} · crosswalk unverified` : null,
      line.groupedQuantity > 0 ? `${line.groupedQuantity} grouped` : null,
      line.independentQuantity > 0 ? `${line.independentQuantity} independent` : null,
    ].filter(Boolean).join(" · ");
    checksScheduleParts.append(checksListRow(
      `${line.ref} · ${line.description}`,
      `${line.quantity} placed · ${evidence} · ${identifiers}`,
    ));
  }
  if (schedule.componentLines.length === 0) {
    checksScheduleParts.append(htmlText("p", "No placed component records on this floor.", "catalogue-empty"));
  }
  checksScheduleRoutes.replaceChildren();
  for (const line of schedule.routeLines) {
    const arrangements = [
      line.arrangements.single.routeCount > 0 ? `${line.arrangements.single.routeCount} Single` : null,
      line.arrangements.twin.routeCount > 0 ? `${line.arrangements.twin.routeCount} Twin` : null,
      line.arrangements.unset.routeCount > 0 ? `${line.arrangements.unset.routeCount} unset` : null,
    ].filter(Boolean).join(" · ");
    const multiplied = line.pendingParallelRunRouteCount === line.routeCount
      ? `multiplied duct quantity pending for ${formatDrawingLength(line.pendingParallelRunCentrelineMm)} centreline`
      : `${formatDrawingLength(line.knownMultipliedPlanMm)} known multiplied plan quantity${line.pendingParallelRunRouteCount > 0 ? ` · ${formatDrawingLength(line.pendingParallelRunCentrelineMm)} centreline still pending arrangement` : ""}`;
    checksScheduleRoutes.append(checksListRow(
      `${line.ref} · ${formatRoomChoice(line.stream)} · ${line.description}`,
      `${line.routeCount} ${line.routeCount === 1 ? "route" : "routes"} · ${arrangements} · ${formatDrawingLength(line.savedCentrelinePlanMm)} saved centreline · ${multiplied}`,
    ));
  }
  if (schedule.routeLines.length === 0) {
    checksScheduleRoutes.append(htmlText("p", "No measured duct routes on this floor.", "catalogue-empty"));
  }
  if (schedule.eppTakeoff.length > 0) {
    checksScheduleRoutes.append(htmlText("h3", "EPP material allowance"));
    for (const line of schedule.eppTakeoff) {
      const count = value => value === null ? "pending run count" : String(value);
      checksScheduleRoutes.append(checksListRow(
        `${line.routeId} · DN${line.nominalSizeMm} · ${formatRoomChoice(line.stream)}`,
        `${formatDrawingLength(line.centrelinePerRunMm)} per run · ${line.basis === "plan-only-allowance" ? "plan estimate; vertical lengths/bends pending" : "developed centreline allowance"} · ${count(line.stockLengthQuantity)} × 1 m lengths · ${count(line.elbow90Quantity)} × 90° bends · ${count(line.elbow45Quantity)} × 45° half-elbows · ${count(line.extraSleeveQuantity)} extra sleeves${line.bendsPerRun.other ? ` · ${line.bendsPerRun.other} other bends per run: select fittings` : ""}`,
      ));
    }
    for (const line of schedule.eppUnitConnectionAllowances) checksScheduleRoutes.append(checksListRow(
      `${line.componentName} · ${line.portRole} · DN${line.nominalSizeMm} · ceiling allowance`,
      "Additional 1 × 1 m EPP length + 1 × 90° elbow + 4 sleeves · one socket included with the length · provisional until unit/ceiling heights are added",
    ));
    for (const stock of schedule.eppElbowStock) checksScheduleRoutes.append(checksListRow(
      `DN${stock.nominalSizeMm} · 90° elbow stock`,
      `${stock.elbow90StockQuantity} whole elbows = ${stock.full90Quantity} full bends + ${stock.half45Quantity} halves cut for 45° bends · ${stock.spareHalfQuantity} spare half${stock.pendingRouteCount ? ` · ${stock.pendingRouteCount} routes pending run counts` : ""}`,
    ));
    checksScheduleRoutes.append(htmlText("p", "Each 1 m length includes a socket. One extra sleeve per bend. A 45° bend is half a 90° elbow; halves are shared across routes of the same diameter. Whole lengths rounded up per route; no bend deductions, offcut reuse or waste added. Connected HRV ports also receive a separate 1 m duct, one 90° elbow and four-sleeve ceiling allowance per port; these elbows are included in the stock total. Review against actual heights later. Allowances are separate from placed parts.", "checks-evidence-boundary"));
  }
  checksScheduleUnresolved.replaceChildren();
  for (const item of schedule.unresolved) {
    checksScheduleUnresolved.append(checksListRow(`${item.ref} · ${item.code.replaceAll("-", " ")}`, item.detail));
  }
  if (schedule.unresolved.length === 0) {
    checksScheduleUnresolved.append(htmlText("p", "No unresolved schedule items in the bounded evidence model.", "checks-diagnostic-empty"));
  }
  checksScheduleBoundary.textContent = `${schedule.lengthBasis} ${schedule.evidenceBoundary}`;

  checksConnectionEvidenceSummary.textContent = connectionEvidence.summary.inspectedConnectionCount === 0
    ? "No persisted routes or direct connections exist on this floor yet."
    : `${connectionEvidence.summary.inspectedConnectionCount} persisted ${connectionEvidence.summary.inspectedConnectionCount === 1 ? "connection" : "connections"} inspected · ${connectionEvidence.summary.installationReadyCount} installation-evidence complete · ${connectionEvidence.summary.drawingOnlyCount} drawing-only · ${connectionEvidence.summary.syntheticFixtureCount} synthetic fixture · ${connectionEvidence.summary.explicitTransitionCount} explicit ${connectionEvidence.summary.explicitTransitionCount === 1 ? "transition" : "transitions"} required.`;
  checksConnectionEvidence.replaceChildren();
  if (connectionEvidence.items.length === 0) {
    checksConnectionEvidence.append(htmlText(
      "div",
      "Place and connect ventilation parts to begin joint-by-joint evidence review.",
      "checks-diagnostic-empty",
    ));
  } else {
    for (const item of connectionEvidence.items) {
      checksConnectionEvidence.append(renderConnectionEvidence(item));
    }
  }
  checksConnectionEvidenceBoundary.textContent = connectionEvidence.evidenceBoundary;

  renderAirflowChecks(airflow);
  renderEngineeringChecks(sizing);
  renderCostingReadiness(costing);
  renderInstallerFoundation(installer);

  checksDiagnosticSummary.textContent = audit.parts.componentCount === 0 && audit.routes.routeCount === 0
    ? "No ventilation topology exists on this floor yet."
    : issueCount === 0
    ? "No current connection-topology issues were found in the bounded generic check."
    : `${audit.diagnosticCounts.error} ${audit.diagnosticCounts.error === 1 ? "error" : "errors"} · ${audit.diagnosticCounts.warning} ${audit.diagnosticCounts.warning === 1 ? "warning" : "warnings"}. Select Show on plan to inspect a flagged component.`;
  checksSpareBranches.replaceChildren();
  for (const spare of audit.spareBranches) {
    checksSpareBranches.append(htmlText(
      "div",
      `${spare.count} unused ${spare.stream} DN90 manifold ${spare.count === 1 ? "branch" : "branches"} · allowed spare capacity, not a disconnected-path fault · no cap installation is inferred`,
      "checks-spare-note",
    ));
  }
  checksDiagnostics.replaceChildren();
  if (audit.diagnostics.length === 0) {
    checksDiagnostics.append(htmlText(
      "div",
      audit.parts.componentCount === 0 && audit.routes.routeCount === 0
        ? "Place ventilation parts and routes to begin the read-only topology check."
        : "The modelled generic supply and extract paths are connected. This is a topology result, not airflow, pressure, acoustic or product-fit validation.",
      "checks-diagnostic-empty",
    ));
  } else {
    for (const item of audit.diagnostics) checksDiagnostics.append(renderCheckDiagnostic(item));
  }
  checksEvidenceBoundary.textContent = audit.evidenceBoundary;
}

function applyEngineeringDutyInput(event) {
  event.preventDefault();
  const floor = currentFloor();
  if (!floor) return;
  const rawPressure = checksEngineeringPressure.value.trim();
  const basis = checksEngineeringBasis.value.trim();
  const source = checksEngineeringSource.value.trim();
  const filterCondition = checksEngineeringFilter.value.trim();
  let externalStaticPressure;
  if (!rawPressure) {
    if (basis || source || filterCondition) {
      checksEngineeringInputStatus.textContent = "Enter pressure in Pa, or clear basis, source and filter condition to leave it unresolved.";
      return;
    }
    externalStaticPressure = unresolvedExternalStaticPressure();
  } else {
    const valuePa = Number(rawPressure);
    if (!Number.isFinite(valuePa) || valuePa < 0) {
      checksEngineeringInputStatus.textContent = "External static pressure must be a non-negative number in Pa.";
      return;
    }
    if (!basis || !source || !filterCondition) {
      checksEngineeringInputStatus.textContent = "Known pressure requires a basis, source and filter condition.";
      return;
    }
    externalStaticPressure = externalStaticPressureFromInput(valuePa, basis, source, filterCondition);
  }
  commitCommand({
    type: "engineering.setFloorDuty",
    duty: {
      floorId: floor.id,
      mode: "normal",
      unitComponentId: checksEngineeringUnit.value || null,
      externalStaticPressure,
    },
  }, "Normal engineering duty input updated; no pressure calculation inferred");
}

function clearEngineeringDutyInput() {
  const floor = currentFloor();
  if (!floor) return;
  if (!history.present.engineeringInputs.floorDuties.some((duty) => duty.floorId === floor.id)) return;
  commitCommand({ type: "engineering.clearFloorDuty", floorId: floor.id }, "Normal engineering duty input cleared");
}

function renderEngineeringChecks(sizing) {
  checksEngineeringForm.querySelectorAll("input, select, button").forEach((element) => { element.disabled = false; });
  const selected = sizing.duty?.unitComponentId ?? "";
  checksEngineeringUnit.replaceChildren(new Option("Not selected", ""));
  for (const unit of sizing.availableUnits) {
    checksEngineeringUnit.append(new Option(
      `${unit.name}${unit.manufacturerArticle ? ` · art ${unit.manufacturerArticle}` : " · performance unavailable"}`,
      unit.componentId,
    ));
  }
  checksEngineeringUnit.value = selected;
  const pressure = sizing.duty?.externalStaticPressure;
  checksEngineeringPressure.value = pressure?.state === "known" ? String(pressure.inputValue) : "";
  checksEngineeringBasis.value = pressure?.state === "known" ? pressure.basis : "";
  checksEngineeringSource.value = pressure?.state === "known" ? pressure.source : "";
  checksEngineeringFilter.value = pressure?.state === "known" ? pressure.filterCondition : "";
  checksEngineeringClear.disabled = sizing.duty === null;
  checksEngineeringInputStatus.textContent = sizing.duty === null
    ? "No saved Normal-mode engineering duty. Drawing and preliminary quoting remain available."
    : pressure.state === "known"
      ? `${formatNumberValue(pressure.valuePa)} Pa external static · ${pressure.filterCondition} · source: ${pressure.source}`
      : `External static pressure unresolved — ${pressure.reason}`;
  const flow = sizing.assignedFlow.unitDutyAirflowM3h;
  checksEngineeringSummary.textContent = `${sizing.unitPerformance.unit?.name ?? "Unit not selected"} · ${flow === null ? "manual room-target screening input unresolved" : `${formatNumberValue(flow)} m³/h manual assigned room-target total for screening`} · ${formatEngineeringPerformanceStatus(sizing.unitPerformance.status)}. Network pressure result: not calculated.`;
  checksEngineeringIssues.replaceChildren();
  for (const blocker of sizing.blockers) {
    checksEngineeringIssues.append(airflowIssue("Blocked / review required", blocker));
  }
  if (sizing.blockers.length === 0) {
    checksEngineeringIssues.append(htmlText("div", "No input blocker remains, but technical review is still required.", "checks-diagnostic-empty"));
  }
  checksEngineeringBoundary.textContent = `${sizing.evidenceBoundary} Manufacturer evidence: ${sizing.unitPerformance.manufacturerEvidence.source.title}, pages ${sizing.unitPerformance.manufacturerEvidence.source.pages.join(", ")}.`;
}

function formatEngineeringPerformanceStatus(status) {
  if (status === "source-statement-alignment-review-required") return "source statement alignment only — review required";
  if (status === "blocked-no-reviewed-performance-evidence") return "no reviewed article-specific performance evidence";
  if (status === "blocked-airflow-duty-unresolved") return "manual room-target screening input unresolved";
  if (status === "blocked-above-published-maximum-airflow") return "above published maximum airflow";
  if (status === "blocked-external-static-pressure-unresolved") return "external-static input unresolved";
  if (status === "blocked-fan-curve-required") return "checked fan curve required";
  if (status === "blocked-unit-not-selected") return "unit not selected";
  return formatRoomChoice(status);
}

function renderCostingReadiness(costing) {
  checksCostingSummary.textContent = `${costing.summary.lineCount} model-derived ${costing.summary.lineCount === 1 ? "line" : "lines"} · 0 priced · total unresolved.`;
  checksCostingLines.replaceChildren();
  for (const line of costing.lines) {
    const identity = [line.productId, line.manufacturerArticle ? `art ${line.manufacturerArticle}` : null]
      .filter(Boolean).join(" · ") || "product match unresolved";
    const quantity = line.quantity === null ? `${formatNumberValue(line.knownQuantity)}+ m known · quantity incomplete` : `${formatNumberValue(line.quantity)} ${line.unit}`;
    checksCostingLines.append(checksListRow(`${line.ref} · ${line.description}`, `${quantity} · ${identity} · unpriced`));
  }
  if (costing.lines.length === 0) checksCostingLines.append(htmlText("p", "No model-derived lines.", "catalogue-empty"));
  checksCostingIssues.replaceChildren();
  for (const blocker of costing.blockers) checksCostingIssues.append(airflowIssue("Costing unresolved", blocker));
  checksCostingBoundary.textContent = `${costing.evidenceBoundary} Exclusions: ${costing.exclusions.join("; ")}.`;
}

function renderInstallerFoundation(installer) {
  checksInstallerSummary.textContent = `${installer.floorName} · working draft only · ${installer.airflowSchedule.length} airflow ${installer.airflowSchedule.length === 1 ? "row" : "rows"} · ${installer.materialsSchedule.componentLines.length + installer.materialsSchedule.routeLines.length} material/route ${installer.materialsSchedule.componentLines.length + installer.materialsSchedule.routeLines.length === 1 ? "line" : "lines"} · ${installer.commissioningRows.length} blank commissioning ${installer.commissioningRows.length === 1 ? "row" : "rows"}.`;
  checksInstallerSections.replaceChildren();
  checksInstallerSections.append(
    checksListRow("Airflow schedule", "Required and assigned retained; predicted and measured remain blank"),
    checksListRow("Materials schedule", "Model quantities and evidence status retained; prices excluded"),
    checksListRow("Pressure/sizing screening", `${formatRoomChoice(installer.unitDutyAndPressure.status)}; calculated network loss remains blank`),
    checksListRow("Commissioning", "Measurement, instrument, calibration, installer, date and result fields start blank"),
  );
  checksInstallerIssues.replaceChildren();
  for (const blocker of installer.blockers) checksInstallerIssues.append(airflowIssue("Installer pack incomplete", blocker));
  checksInstallerBoundary.textContent = installer.evidenceBoundary;
}

function renderAirflowChecks(airflow) {
  const supply = airflow.totals.supply;
  const extract = airflow.totals.extract;
  const completeness = airflow.assignedBalanceState === "incomplete"
    ? "Incomplete — known subtotals are shown but unresolved targets remain"
    : "All supply/extract assigned room targets are known — numeric difference only, with no tolerance applied";
  checksAirflowSummary.textContent = airflow.lines.length === 0
    ? "No confirmed rooms or ventilation zones exist on this floor. Preliminary room-free markup remains valid."
    : `Normal mode · assigned supply ${formatAirflowLps(supply.assignedKnownLps)} · assigned extract ${formatAirflowLps(extract.assignedKnownLps)} · difference ${formatSignedAirflowLps(airflow.assignedImbalanceLps)} (supply − extract). ${completeness}.`;

  checksAirflowSpaces.replaceChildren();
  for (const line of airflow.lines) {
    const role = formatRoomChoice(line.ventilationRole);
    const delta = line.assignedMinusRequiredLps === null
      ? "required/assigned difference unresolved"
      : `assigned − required ${formatSignedAirflowLps(line.assignedMinusRequiredLps)}`;
    checksAirflowSpaces.append(checksListRow(
      `${line.name} · ${role}`,
      `Required ${formatAirflowTarget(line.required)} · Assigned ${formatAirflowTarget(line.assigned)} · ${line.terminalCount} associated ${line.terminalCount === 1 ? "terminal" : "terminals"} · ${delta}`,
    ));
  }
  if (airflow.lines.length === 0) {
    checksAirflowSpaces.append(htmlText("p", "Add confirmed rooms or zones when room-level airflow design is needed.", "catalogue-empty"));
  }

  const linesById = new Map(airflow.lines.map((line) => [line.id, line]));
  checksAirflowIssues.replaceChildren();
  for (const spaceId of airflow.missingAssignedTargetSpaceIds) {
    const line = linesById.get(spaceId);
    checksAirflowIssues.append(airflowIssue(
      "Assigned target unresolved",
      `${line?.name ?? spaceId} has no explicit assigned Normal airflow. Edit the ${line?.kind ?? "space"} to enter a value, unit, basis and source.`,
    ));
  }
  for (const spaceId of airflow.targetWithoutTerminalSpaceIds) {
    const line = linesById.get(spaceId);
    checksAirflowIssues.append(airflowIssue(
      "Target has no terminal",
      `${line?.name ?? spaceId} has an assigned target but no associated ${line?.ventilationRole ?? "supply/extract"} terminal. No terminal or allocation is inferred.`,
    ));
  }
  for (const spaceId of airflow.terminalWithoutTargetSpaceIds) {
    const line = linesById.get(spaceId);
    checksAirflowIssues.append(airflowIssue(
      "Terminal has no assigned target",
      `${line?.name ?? spaceId} has ${line?.terminalCount ?? 0} associated terminal${line?.terminalCount === 1 ? "" : "s"}, but its assigned Normal airflow is unresolved.`,
    ));
  }
  for (const terminal of airflow.unassignedTerminals) {
    checksAirflowIssues.append(airflowIssue(
      "Terminal is not assigned to a room or zone",
      `${terminal.componentName} (${formatRoomChoice(terminal.stream)}) is outside, on a boundary, spatially ambiguous, incompatible, or not manually assigned.`,
    ));
  }
  for (const suggestion of airflow.suggestions) {
    const line = linesById.get(suggestion.spaceId);
    checksAirflowIssues.append(airflowIssue(
      "Explicit action available — not applied",
      `${line?.name ?? suggestion.spaceId} has a required target that can be copied into Assigned from the room/zone editor. The project is unchanged until Apply is pressed.`,
    ));
  }
  if (checksAirflowIssues.childElementCount === 0) {
    checksAirflowIssues.append(htmlText(
      "div",
      airflow.lines.length === 0
        ? "No room-airflow issues are evaluated without confirmed spaces."
        : "No unresolved room-target or terminal-association issues were found.",
      "checks-diagnostic-empty",
    ));
  }
  checksAirflowBoundary.textContent = airflow.evidenceBoundary;
}

function airflowIssue(title, detail) {
  const card = document.createElement("article");
  card.className = "checks-diagnostic warning";
  const copy = document.createElement("div");
  copy.className = "checks-diagnostic-copy";
  copy.append(htmlText("strong", title), htmlText("span", detail));
  card.append(copy);
  return card;
}

function renderConnectionEvidence(item) {
  const card = document.createElement("article");
  card.className = `checks-diagnostic${item.status === "explicit-transition-required" || item.status === "incomplete-topology" ? " error" : " warning"}`;
  const copy = document.createElement("div");
  copy.className = "checks-diagnostic-copy";
  const status = item.status.replaceAll("-", " ");
  const sourceIds = [...new Set(item.endpoints
    .filter(Boolean)
    .flatMap((endpoint) => endpoint.catalogueEvidence.sourceRecords.map((source) => source.sourceId)))];
  const knownDimensions = item.endpoints
    .filter((endpoint) => endpoint?.catalogueEvidence.knownDimensions?.body)
    .map((endpoint) => {
      const body = endpoint.catalogueEvidence.knownDimensions.body;
      const values = [body.width, body.depth, body.height].filter((value) => value !== null);
      return values.length > 0 ? `${endpoint.componentName} ${values.join(" × ")} mm` : null;
    })
    .filter(Boolean);
  const evidence = item.accessoryDecision.requiredEvidence.map((entry) => entry.label).join("; ");
  copy.append(
    htmlText("strong", `${item.label} · ${status}`),
    htmlText("span", `${item.service}. ${item.verifiedFacts.join(". ")}.`),
    ...(sourceIds.length > 0 ? [htmlText("span", `Pinned source provenance: ${sourceIds.join(" · ")}.`)] : []),
    ...(knownDimensions.length > 0 ? [htmlText("span", `Known drawing dimensions: ${knownDimensions.join(" · ")}.`)] : []),
    htmlText("span", `Still required: ${evidence}. No accessory item or quantity has been inferred.`),
  );
  card.append(copy);
  const componentId = item.endpoints.find(Boolean)?.componentId;
  if (componentId) {
    const focus = htmlText("button", "Show on plan", "diagnostic-focus");
    focus.type = "button";
    focus.addEventListener("click", () => focusCheckTarget({ componentId }));
    card.append(focus);
  }
  return card;
}

function checksListRow(label, value) {
  const row = document.createElement("div");
  row.className = "checks-list-row";
  row.append(htmlText("strong", label), htmlText("span", value));
  return row;
}

function renderCheckDiagnostic(item) {
  const card = document.createElement("article");
  card.className = `checks-diagnostic ${item.severity}`;
  const copy = document.createElement("div");
  copy.className = "checks-diagnostic-copy";
  copy.append(htmlText("strong", item.title), htmlText("span", item.detail));
  card.append(copy);
  if (item.componentId) {
    const focus = htmlText("button", "Show on plan", "diagnostic-focus");
    focus.type = "button";
    focus.addEventListener("click", () => focusCheckTarget(item));
    card.append(focus);
  }
  return card;
}

function focusCheckTarget(item) {
  const component = history.present.components.find((candidate) => candidate.id === item.componentId);
  if (!component) return;
  setTask("ventilation");
  mechanicalState = { ...clearMechanicalSelection(mechanicalState), selectedComponentId: component.id };
  const centre = { x: toView(component.positionMm.x), y: toView(component.positionMm.y) };
  camera = {
    ...camera,
    x: centre.x - camera.width / 2,
    y: centre.y - camera.height / 2,
  };
  interactionMessage = `Showing checked item: ${component.displayName ?? component.id}`;
  render();
  canvas.focus();
}

function formatDrawingLength(valueMm) {
  return `${Number((valueMm / 1000).toFixed(2)).toLocaleString()} m`;
}

function formatCatalogueStatus(item) {
  if (item.status === "source-backed-owner-drawing-profile-installation-review-required") return "Owner drawing profile · installation review required";
  if (item.status === "source-backed-symbol-profile-interface-pending") return "Drawing symbol · connection pending";
  if (item.status === "synthetic-not-manufacturer-verified") return "Generic test record · placeable";
  if (item.status === "verified-dimensional-setout-routable-ports-pending") return "Source-backed setout · ports pending";
  if (item.status === "source-backed-drawing-profile-installation-review-required") return "Source-backed drawing profile · installation review required";
  if (item.status === "source-backed-candidate-variant-conflict") return "Evidence candidate · variant conflict";
  if (item.status === "source-backed-dimensional-candidate-interface-pending") return "Source-backed dimensions · interface pending";
  if (item.status === "source-backed-distribution-design-incomplete") return "Current UK distribution evidence · plan setout pending";
  return "Evidence candidate · not placeable";
}

function catalogueEvidenceDetails(item) {
  if (item.distributionDesign) {
    const component = item.distributionDesign.componentEvidence;
    const envelope = component.manufacturerEnvelopeMm;
    const portGap = component.branchConnections
      ? ` Socket count/layout is verified (${component.branchConnections.layout.rows} × ${component.branchConnections.layout.columns}), but individual plan centres are not dimensioned.`
      : component.mainConnection
        ? " The main connection is centred on its plate, but installed direction and mating profile remain unresolved."
        : " Module joints use clamping strips; RapidLock applies to the semi-rigid branch sockets, not the module-to-module joint.";
    return `Verified manufacturer envelope H/W/D ${envelope.height} × ${envelope.width} × ${envelope.depth} mm · ${item.distributionDesign.connectionSummary}.${portGap} This envelope is not an installed plan footprint and has no routable ports.`;
  }
  if (item.connectionSetout) {
    if (item.connectionSetout.connectionScope === "drawing-only") {
      return `Verified for drawing: ${item.connectionSetout.connectionCount} handed ports · ${item.connectionSetout.nominalInternalDiameterMm} mm inside · ${item.connectionSetout.externalDiameterMm} mm outside · 580 mm column centres · ${item.connectionSetout.frontToRearRowCentreSpacingMm} mm row centres. Installation fit, adapters, seals, supports, service clearance and the local SKU/article crosswalk remain unverified.`;
    }
    return `Verified: ${item.connectionSetout.connectionCount} connections · ${item.connectionSetout.nominalInternalDiameterMm} mm inside · ${item.connectionSetout.externalDiameterMm} mm outside · row centres ${item.connectionSetout.frontToRearRowCentreSpacingMm} mm. Not verified: local port origin, coordinates and handed roles.`;
  }
  const setout = item.dimensions?.setout;
  if (!setout) return "";
  if (item.productId === "ZEN-MSCW-320") {
    return `Verified setout: ${setout.assemblyPlateWidthMm} × ${setout.assemblyLengthMm} mm · 2 × nominal ${setout.nominalConnectionDiameterMm}. Not placeable until the exact article/variant and interfaces are confirmed.`;
  }
  if (item.productId === "ZEN-ACWS-320") {
    return `Verified setout: ${setout.lengthMm} × ${setout.widthMm} × ${setout.depthMm} mm · rectangular module interfaces. Separate end plates are required.`;
  }
  if (item.productId === "ZEN-MPCWM-320-6X90") {
    return `Verified setout: ${setout.branchCount} branches in ${setout.branchLayout.rows} × ${setout.branchLayout.columns} at ${setout.branchLayout.horizontalPitchMm} mm pitch. Edge offsets remain unknown.`;
  }
  if (item.productId === "ZEN-MP320-160") {
    return `Verified setout: ${setout.widthMm} × ${setout.heightMm} mm · 1 × nominal DN${setout.nominalConnectionDiameterMm}. Exact port centre and mating profile remain unknown.`;
  }
  return "";
}

function catalogueSourceDetails(item) {
  const sources = collectCatalogueSourceRecords(item.source);
  if (sources.length === 0) return "";
  return `Pinned provenance: ${sources.map((source) => (
    `${source.title ?? source.sourceId}${source.verificationStatus ? ` · ${source.verificationStatus.replaceAll("-", " ")}` : ""}`
  )).join("; ")}.`;
}

function collectCatalogueSourceRecords(source) {
  if (!source || typeof source !== "object") return [];
  if (typeof source.sourceId === "string") return [source];
  return Object.values(source).flatMap(collectCatalogueSourceRecords);
}

function catalogueDimensionDetails(item) {
  const manufacturerEnvelope = item.dimensions?.manufacturerEnvelope;
  if (manufacturerEnvelope) {
    return `Manufacturer H/W/D envelope: ${manufacturerEnvelope.height} × ${manufacturerEnvelope.width} × ${manufacturerEnvelope.depth} mm · installed plan footprint unresolved.`;
  }
  const body = item.dimensions?.body;
  if (!body) return "";
  const values = [body.width, body.depth, body.height].filter((value) => Number.isFinite(value));
  if (values.length === 0) return "";
  return `Recorded drawing dimensions: ${values.join(" × ")} mm · ${(item.dimensions.evidenceStatus ?? "evidence status pending").replaceAll("-", " ")}.`;
}

function catalogueGroupGlyph(groupName) {
  if (groupName === "Units") return "▣";
  if (groupName === "Terminals") return "●";
  if (groupName === "Attenuation & distribution") return "⋮";
  if (groupName.includes("Duct")) return "⌁";
  return "◇";
}

function compactGroupName(groupName) {
  if (groupName === "Attenuation & distribution") return "Distribution";
  if (groupName === "Ducts & fittings") return "Duct fittings";
  return groupName;
}

function catalogueThumbnail(item) {
  if (!["wall-grille", "luna-grille"].includes(item.symbol?.shape)) return htmlText("span", catalogueGlyph(item), `product-thumbnail${catalogueGlyphClass(item)}`);
  const graphic = deriveComponentPlanGraphic(item);
  const icon = svgElement("svg", { viewBox: `-170 -150 340 300`, class: "product-thumbnail", "aria-hidden": "true" });
  for (const [index, d] of graphic.paths.entries()) icon.append(svgElement("path", { d, fill: "none", stroke: graphic.colour, "stroke-width": graphic.strokeWidths ? graphic.strokeWidths[index] * 5 : 8 }));
  return icon;
}

function catalogueGlyph(item) {
  if (item.cwOrientation) return item.cwOrientation === "horizontal" ? "▭" : "▯";
  if (item.isExternalGrille) return item.externalGrilleKind === "combined" ? "▥" : "▤";
  if (item.terminalShape) return item.terminalShape === "round" ? "◯" : "▭";
  if (item.symbol?.shape === "wall-grille") return item.symbol.stream === "supply" ? "▱ ↑↑↑" : "↓↓↓ ▱";
  if (item.mounting) return item.mounting === "horizontal" ? "▭" : "▯";
  if (item.category === "mvhr-unit") return "▣";
  if (item.category === "terminal") return "●";
  if (item.category === "attenuator-manifold") return "⋮";
  return "◇";
}

function catalogueGlyphClass(item) {
  if (item.name.toLowerCase().includes("supply")) return " supply";
  if (item.name.toLowerCase().includes("extract")) return " extract";
  return "";
}

function componentEvidenceLabel(component) {
  if (component.displaySymbol?.cwProfile) return "source-sized CW drawing · provisional setout";
  if (component.catalogueStatus === "source-backed-symbol-profile-interface-pending") return "drawing symbol · connection pending";
  if (component.catalogueStatus === "synthetic-not-manufacturer-verified") return "generic test";
  if (component.catalogueStatus === "verified-dimensional-setout-routable-ports-pending") {
    return "verified setout · ports pending";
  }
  return "unclassified";
}

function componentEvidenceDescription(component) {
  if (component.displaySymbol?.ca200Profile) return "Owner-selected CA200 manual dimensions and manufacturer handed role map · DN125 drawing ports · centred port setout interpretation and installation fit require review";
  if (component.displaySymbol?.cwProfile) return `${component.displaySymbol.cwProfile.generation} manufacturer module dimensions · assembled seating and branch-centre offsets provisional · installed elevation and acoustic selection require review`;
  if (component.catalogueStatus === "source-backed-owner-drawing-profile-installation-review-required") return component.catalogueSnapshot?.connectionSetout?.orientationConvention === "manufacturer" ? "Manufacturer orientation and manual port centres · owner-confirmed 160 mm EPP connections" : "Saved Aerofresh 450 drawing convention · schematic port centres · DN160 drawing snap targets";
  if (component.catalogueStatus === "source-backed-terminal-drawing-connection") return "Owner-approved DN90 drawing entry · one logical terminal connection · physical housing dimensions and mating remain unverified";
  if (component.catalogueStatus === "source-backed-symbol-profile-interface-pending") {
    if (component.ports.some(p=>p.drawingEntries)) return "Owner-approved DN90 drawing entries added to saved symbol; physical housing dimensions and mating remain unverified";
    if (component.displaySymbol?.shape === "luna-grille") return "Owner-supplied Luna drawing symbol. Product identity retained; housing geometry, connection locations, airflow and losses pending.";
    const specification = component.catalogueSnapshot?.terminalSpecification;
    return `Owner-supplied wall/bulkhead symbol. Housing: ${specification?.housingOptions.map(item => item.productId).join(" / ")}. Magnetic cover: ${specification?.coverOptions.map(item => item.productId).join(" / ")}. Selection, dimensions and duct connections pending.`;
  }
  if (component.catalogueStatus === "source-backed-drawing-profile-installation-review-required") {
    return "Source-backed handed drawing profile · installation fit and service clearance unverified";
  }
  const version = component.catalogueRecordVersionId
    ? ` · pinned ${component.catalogueRecordVersionId}`
    : "";
  if (component.catalogueStatus === "synthetic-not-manufacturer-verified") {
    return `Generic test fixture · not manufacturer verified${version}`;
  }
  if (component.catalogueStatus === "verified-dimensional-setout-routable-ports-pending") {
    return `Source-backed Q350/Q450 body setout · handed typed port map still required${version}`;
  }
  return `Unclassified imported/domain component${version}`;
}

function renderInspector() {
  const wall = history.present.walls.find((candidate) => candidate.id === selectedWallId);
  const node = history.present.wallNodes.find((candidate) => candidate.id === selectedNodeId);
  const component = history.present.components.find(
    (candidate) => candidate.id === mechanicalState.selectedComponentId,
  );
  const route = history.present.routes.find((candidate) => candidate.id === selectedRouteId);
  const room = history.present.rooms.find((candidate) => candidate.id === selectedRoomId);
  const zone = history.present.zones.find((candidate) => candidate.id === selectedZoneId);
  const floorArea = history.present.floorAreaOutlines.find(
    (candidate) => candidate.id === selectedFloorAreaId,
  );
  const space = zone ?? room;
  const roomInspection = zone
    ? inspectZoneBoundary(history.present, zone)
    : room
      ? inspectRoomBoundary(history.present, room)
      : null;
  inspectorEmpty.hidden = Boolean(wall || node || component || route || floorArea || space);
  wallInspector.hidden = !wall;
  wallActions.hidden = !wall;
  nodeInspector.hidden = !node;
  componentInspector.hidden = !component;
  componentActions.hidden = !component;
  const combinedExternal=component && /external.*grille|grille.*external/.test(component.catalogueItemId??"") && component.ports.filter(p=>["intake","exhaust"].includes(p.stream)).length===2;
  document.querySelector("#external-grille-handing-label").hidden=!combinedExternal;
  if(combinedExternal)document.querySelector("#external-grille-handing").value=component.externalGrilleHanding??"left";
  routeInspector.hidden = !route;
  routeActions.hidden = !route || activeTool !== "select";
  floorAreaInspector.hidden = !floorArea;
  floorAreaActions.hidden = !floorArea;
  roomInspector.hidden = !space;
  roomActions.hidden = !space;
  if (!wall && !node && !component && !route && !floorArea && !space) {
    inspectorEmpty.querySelector("p").textContent = activeTask === "ventilation"
        ? "Select an MVHR component or drawn duct route to inspect it. Building walls and rooms are locked context in this workspace."
        : "Select a building outline, physical wall, room divider, room or zone to inspect its model identity.";
  }
  if (wall) {
    const nodesById = new Map(history.present.wallNodes.map((candidate) => [candidate.id, candidate]));
    const start = nodesById.get(wall.startNodeId).positionMm;
    const end = nodesById.get(wall.endNodeId).positionMm;
    const isDivider = wall.classification === "virtual" && wall.boundaryRole === "room-divider";
    document.querySelector("#wall-kind").textContent = isDivider
      ? "Room divider · nonphysical"
      : wall.classification === "physical"
        ? "Physical wall"
        : "Legacy virtual boundary";
    document.querySelector("#wall-id").textContent = wall.id;
    document.querySelector("#wall-length").textContent = formatMm(Math.hypot(end.x - start.x, end.y - start.y));
    document.querySelector("#wall-thickness").textContent = isDivider ? "Not a wall quantity" : formatMm(wall.thicknessMm);
    document.querySelector("#wall-reference").textContent = wall.referenceLine;
    document.querySelector("#wall-height").textContent = isDivider
      ? "Not applicable"
      : wall.heightMm.state === "unknown" ? "Unknown" : formatMm(wall.heightMm.valueMm);
  }
  if (node) {
    const incidentCount = history.present.walls.filter((wallCandidate) => wallCandidate.startNodeId === node.id || wallCandidate.endNodeId === node.id).length;
    document.querySelector("#node-id").textContent = node.id;
    document.querySelector("#node-position").textContent = `${formatMm(node.positionMm.x)}, ${formatMm(node.positionMm.y)}`;
    document.querySelector("#node-elevation").textContent = node.positionMm.z.state === "unknown" ? "Unknown" : formatMm(node.positionMm.z.valueMm);
    document.querySelector("#node-incidence").textContent = `${incidentCount} wall${incidentCount === 1 ? "" : "s"}`;
  }
  if (component) {
    const assembly = equipmentAssemblyForComponent(history.present, component.id);
    document.querySelector("#component-name").textContent = component.displayName ?? component.id;
    document.querySelector("#component-id").textContent = component.id;
    document.querySelector("#component-position").textContent = `${formatMm(component.positionMm.x)}, ${formatMm(component.positionMm.y)}`;
    document.querySelector("#component-elevation").textContent = component.positionMm.z.state === "unknown"
      ? "Unknown"
      : formatMm(component.positionMm.z.valueMm);
    componentElevationInput.value = component.positionMm.z.state === "unknown"
      ? ""
      : String(component.positionMm.z.valueMm);
    clearComponentElevationButton.disabled = component.positionMm.z.state === "unknown";
    componentElevationDetail.textContent = assembly
      ? `Applies to all ${assembly.componentIds.length} grouped parts. Unknown remains explicit.`
      : "Applies to this component. Unknown remains explicit.";
    document.querySelector("#component-assembly").textContent = assembly
      ? `${assembly.name} · ${assembly.id} · grouped move/rotation/elevation`
      : "Independent component";
    document.querySelector("#component-ports").textContent = component.ports.length > 0
      ? component.ports.map((port) => {
          const size = port.interface?.nominalSizeMm ? ` DN${port.interface.nominalSizeMm}` : "";
          const usage = portUsage(component.id, port.id);
          return `${port.role}${size} · ${usage.occupied ? "connected" : "free"}`;
        }).join(" · ")
      : ["wall-grille", "luna-grille"].includes(component.displaySymbol?.shape)
        ? "Drawing symbol only; housing connection positions and sizes are not established."
        : "No routable ports. This branded body is setout-only while handed role evidence is pending; use Generic test MVHR unit for generic routing.";
    const intent = component.mvhrDesignIntent;
    document.querySelector("#component-evidence").textContent = componentEvidenceDescription(component) + (intent
      ? ` · ${intent.mounting} planning intention · ${MVHR_LAYOUTS[intent.layout] ?? intent.layout}${intent.layout === "unit-mounted-cw" ? ` · CW${intent.cwSize ?? "320"} schematic · DN90 drawing connections enabled` : intent.assemblyState === "layout-pending" ? " · accessory layout pending; unit only placed" : ""}`
      : "");
    renderComponentRoomAssignment(component);
    renderComponentDuctRunControl(component);
  }
  if (route) renderRouteInspector(route);
  if (floorArea) {
    const inspection = inspectFloorAreaOutline(floorArea);
    document.querySelector("#floor-area-name-value").textContent = floorArea.name;
    document.querySelector("#floor-area-value").textContent = `${formatArea(inspection.areaMm2)} · not certified TFA`;
    document.querySelector("#floor-area-perimeter-value").textContent = formatMm(inspection.perimeterMm);
    document.querySelector("#floor-area-basis-value").textContent = "Closed plan outline · floor-local mm · preliminary quoting";
    document.querySelector("#floor-area-vertices-value").textContent = `${floorArea.vertices.length} editable vertices · no holes or exclusions`;
    document.querySelector("#floor-area-id-value").textContent = floorArea.id;
  }
  if (space) {
    document.querySelector("#room-type-value").textContent = zone
      ? `Ventilation zone · child of ${room?.name ?? zone.parentRoomId}`
      : history.present.zones.some((candidate) => candidate.parentRoomId === room.id)
        ? "Physical enclosure · partitioned into zones"
        : "Physical room enclosure";
    document.querySelector("#room-name-value").textContent = space.name;
    document.querySelector("#room-use-value").textContent = formatRoomChoice(space.use);
    document.querySelector("#room-role-value").textContent = formatRoomChoice(space.ventilationRole);
    document.querySelector("#room-area-value").textContent = roomInspection.areaMm2 === null
      ? "Unavailable"
      : `${formatArea(roomInspection.areaMm2)} · wall reference lines`;
    document.querySelector("#room-boundary-value").textContent = roomInspection.status === "current"
      ? `${space.boundary.length} boundary references · current`
      : `${formatRoomChoice(roomInspection.status)} · ${roomInspection.reason}`;
    document.querySelector("#room-terminals-value").textContent = space.terminalAssociations.length === 0
      ? "None assigned"
      : `${space.terminalAssociations.length} terminal assignment${space.terminalAssociations.length === 1 ? "" : "s"} · no per-terminal split inferred`;
    document.querySelector("#room-airflow-value").textContent = `Normal required ${formatAirflowTarget(space.airflowTargets.normal.required)} · assigned ${formatAirflowTarget(space.airflowTargets.normal.assigned)}`;
    document.querySelector("#room-id-value").textContent = space.id;
    editRoomButton.textContent = zone ? "Edit zone" : "Edit room";
    reassignRoomButton.textContent = zone
      ? reassignZoneId === zone.id ? "Choose a face…" : "Reassign zone boundary"
      : reassignRoomId === room.id ? "Choose a face…" : "Reassign room boundary";
    removeRoomButton.textContent = zone ? "Remove zone…" : "Remove room…";
  }
}

function renderRouteInspector(route) {
  document.querySelector("#realign-epp-connections").hidden=!/^epp-rigid-dn/.test(route.ductKind);
  const family = routeFamilyForKind(route.ductKind);
  const bodyGeometry = routeBodyGeometry(route, family);
  document.querySelector("#route-kind-value").textContent = family.name;
  document.querySelector("#route-id-value").textContent = route.id;
  document.querySelector("#route-service-value").textContent = `${formatRoomChoice(route.stream)} · ${route.role ?? "role not set"}`;
  document.querySelector("#route-endpoints-value").textContent = [route.startAttachment, route.endAttachment]
    .map((endpoint, index) => endpoint
      ? `${index === 0 ? "Start" : "End"}: ${endpoint.componentId} / ${endpoint.portId}`
      : `${index === 0 ? "Start" : "End"}: free`)
    .join(" · ");
  const planLengthMm = route.points.slice(1).reduce((sum, point, index) => (
    sum + Math.hypot(point.x - route.points[index].x, point.y - route.points[index].y)
  ), 0);
  const sweepDifference = Math.abs(bodyGeometry.visualSweepLengthMm - planLengthMm);
  document.querySelector("#route-geometry-value").textContent = `${route.points.length} control points · ${formatMm(planLengthMm)} saved polyline length · ${formatMm(bodyGeometry.visualSweepLengthMm)} visual sweep${sweepDifference < 0.5 ? "" : " · display length only"}`;
  document.querySelector("#route-body-value").textContent = `${ductBodyDisplayLabel(bodyGeometry)} · ${bodyGeometry.rigidEpp ? "Straight EPP runs with plain-ended 90°/45° elbows, no fixed sleeve; dashed centre mark shows the 45° cut. Radius remains schematic" : "Smooth bounded sweep is visual only; no compliant radius or fitting is inferred"}${bodyGeometry.fallbackCornerCount > 0 ? ` · ${bodyGeometry.fallbackCornerCount} corner${bodyGeometry.fallbackCornerCount === 1 ? "" : "s"} need review (angle or space)` : ""}.`;
  const selectedIntermediate = Number.isSafeInteger(selectedRoutePointIndex) &&
    selectedRoutePointIndex > 0 && selectedRoutePointIndex < route.points.length - 1;
  removeRoutePointButton.disabled = !selectedIntermediate;
  routeEditDetail.textContent = selectedIntermediate
    ? `Point ${selectedRoutePointIndex} selected. Drag its round handle or remove it; start and end connections remain locked.`
    : "Use the + controls on route segments to add a point, then drag round intermediate handles. Attached start and end points stay locked.";
  singleRouteRunButton.setAttribute("aria-pressed", String(route.parallelRunCount === 1));
  twinRouteRunButton.setAttribute("aria-pressed", String(route.parallelRunCount === 2));
  clearRouteRunButton.setAttribute("aria-pressed", String(route.parallelRunCount === null));
  const arrangement = route.parallelRunCount === 1
    ? "Single duct"
    : route.parallelRunCount === 2
      ? "Twin duct"
      : "Not set";
  const terminalDemand = routeTerminalDemandSummary(route);
  routeRunDetail.textContent = `${arrangement} controls this selected drawn route only. ${terminalDemand} Changing it does not alter outlet demand, route points or endpoints.`;
}

function routeTerminalDemandSummary(route) {
  const attachedDemands = [route.startAttachment, route.endAttachment]
    .filter(Boolean)
    .map((endpoint) => history.present.components.find((component) => component.id === endpoint.componentId))
    .filter((component) => component && component.ports.length === 1)
    .map((component) => component.ductRunCount)
    .filter((value) => value !== undefined);
  if (attachedDemands.length === 0) return "No single-port outlet demand is attached to this route.";
  return `Attached outlet demand is ${attachedDemands.map((value) => (
    value === null ? "not set" : value === 1 ? "Single" : value === 2 ? "Twin" : `${value} custom runs`
  )).join(" and ")}.`;
}

function renderComponentDuctRunControl(component) {
  const terminalPort = roomTerminalPort(history.present, component.id);
  const enabled = Boolean(terminalPort);
  singleComponentDuctRunButton.disabled = !enabled;
  twinComponentDuctRunButton.disabled = !enabled;
  clearComponentDuctRunsButton.disabled = !enabled || component.ductRunCount === null;
  singleComponentDuctRunButton.setAttribute("aria-pressed", String(enabled && component.ductRunCount === 1));
  twinComponentDuctRunButton.setAttribute("aria-pressed", String(enabled && component.ductRunCount === 2));
  componentDuctRunDetail.textContent = enabled
    ? component.ductRunCount === null
      ? `${formatRoomChoice(terminalPort.stream)} outlet · duct arrangement not selected · no airflow inferred`
      : component.ductRunCount === 1
        ? `${formatRoomChoice(terminalPort.stream)} outlet · Single duct · no airflow inferred`
        : component.ductRunCount === 2
          ? `${formatRoomChoice(terminalPort.stream)} outlet · Twin duct · no airflow inferred`
          : `${formatRoomChoice(terminalPort.stream)} outlet · ${component.ductRunCount} legacy/custom duct runs · no airflow inferred`
    : "Available only for a component with one MVHR supply or extract terminal port.";
}

function renderComponentRoomAssignment(component) {
  componentRoomAssignment.replaceChildren();
  const port = roomTerminalPort(history.present, component.id);
  if (!port) {
    componentRoomAssignment.append(new Option("Not a room terminal", ""));
    componentRoomAssignment.disabled = true;
    componentRoomDetail.textContent = "Only a component with one MVHR supply or extract terminal port can be assigned.";
    return;
  }
  componentRoomAssignment.disabled = false;
  componentRoomAssignment.append(new Option("Unassigned", ""));
  for (const room of history.present.rooms.filter((candidate) => {
    if (candidate.floorId !== component.floorId) return false;
    if (history.present.zones.some((zone) => zone.parentRoomId === candidate.id)) return false;
    if (candidate.ventilationRole === "none" || candidate.ventilationRole === "transfer") return false;
    return candidate.ventilationRole === "unassigned" || candidate.ventilationRole === port.stream;
  })) {
    const inspection = inspectRoomBoundary(history.present, room);
    const suffix = inspection.status === "current" ? "" : " · boundary needs reassignment";
    componentRoomAssignment.append(new Option(`Room · ${room.name} · ${formatRoomChoice(room.ventilationRole)}${suffix}`, `room:${room.id}`));
  }
  for (const zone of history.present.zones.filter((candidate) => {
    if (candidate.floorId !== component.floorId) return false;
    if (candidate.ventilationRole === "none" || candidate.ventilationRole === "transfer") return false;
    return candidate.ventilationRole === "unassigned" || candidate.ventilationRole === port.stream;
  })) {
    const inspection = inspectZoneBoundary(history.present, zone);
    const suffix = inspection.status === "current" ? "" : " · boundary needs reassignment";
    componentRoomAssignment.append(new Option(`Zone · ${zone.name} · ${formatRoomChoice(zone.ventilationRole)}${suffix}`, `zone:${zone.id}`));
  }
  const assignment = terminalRoomAssignment(history.present, component.id);
  componentRoomAssignment.value = assignment?.zoneId
    ? `zone:${assignment.zoneId}`
    : assignment?.roomId
      ? `room:${assignment.roomId}`
      : "";
  const assignedSpace = assignment?.zoneId
    ? history.present.zones.find((zone) => zone.id === assignment.zoneId)
    : assignment?.roomId
      ? history.present.rooms.find((room) => room.id === assignment.roomId)
      : null;
  componentRoomDetail.textContent = assignedSpace
    ? `${formatRoomChoice(port.stream)} terminal · ${assignment.assignmentMethod === "spatial" ? "positioned in" : "manually assigned to"} ${assignedSpace.name} · stable ${assignment.zoneId ? "zone" : "room"} ID ${assignedSpace.id} · no airflow inferred.`
    : `${formatRoomChoice(port.stream)} terminal · Unassigned because it is outside, on a boundary, ambiguous, or incompatible with the containing space · no airflow inferred.`;
}

function renderStorageState() {
  localState.dataset.state = storageState.kind;
  localStateLabel.textContent = storageState.label;
  localState.title = `${storageState.detail}. Local prototype storage is not company authentication or cloud storage.`;
  saveButton.disabled = storageState.kind === "pending";
}

function updateStatus() {
  const isWall = activeTool === "wall";
  const isDivider = activeTool === "room-divider";
  const isFloorArea = activeTool === "floor-area";
  const isPan = activeTool === "pan";
  const isCalibration = activeTool === "calibrate";
  const isReferenceCrop = activeTool === "crop-reference";
  const isPlacement = activeTool === "place-component" || activeTool === "place-assembly";
  const isRoute = activeTool === "route";
  toolStatus.textContent = `Tool: ${reassignZoneId ? "Zone boundary reassignment" : reassignRoomId ? "Room boundary reassignment" : componentDragState ? "Equipment move" : floorAreaDragState ? "Building-outline vertex editing" : dragState ? "Point editing" : isReferenceCrop ? "PDF crop" : isCalibration ? "Reference calibration" : isWall ? "Wall chain" : isDivider ? "Room divider" : isFloorArea ? "Floor area outline" : isPan ? "Pan view" : isPlacement ? activeTool === "place-assembly" ? "Equipment assembly placement" : "Catalogue component placement" : isRoute ? "Mechanical route" : activeTask === "ventilation" ? "Ventilation select" : "Select"}`;
  draftStatus.textContent = mechanicalState.routeDraft
    ? `${mechanicalState.routeDraft.points.length} route point${mechanicalState.routeDraft.points.length === 1 ? "" : "s"} · not saved`
    : draftPoints.length
    ? `${draftPoints.length} draft point${draftPoints.length === 1 ? "" : "s"} · not saved`
    : floorAreaDraftPoints.length
      ? `${floorAreaDraftPoints.length} outline vertex${floorAreaDraftPoints.length === 1 ? "" : "es"} · not saved`
      : `${history.present.floorAreaOutlines.length} outline${history.present.floorAreaOutlines.length === 1 ? "" : "s"} · ${history.present.walls.filter((wall) => wall.classification === "physical").length} walls · ${history.present.walls.filter((wall) => wall.boundaryRole === "room-divider").length} dividers · ${history.present.rooms.length} rooms · ${history.present.zones.length} zones · ${history.present.components.length} parts · ${history.present.routes.length} routes · ${portableDirty ? "not exported" : "exported"}`;
  snapStatus.textContent = snapEnabled
    ? "Snap on · 12 px beyond visible wall edge · Grid 100 mm"
    : "Snap off · free placement · crossings disconnected";
  modePrompt.textContent = interactionMessage || (isPan
    ? "Pan tool · drag the drawing view · project geometry remains unchanged · Esc returns to Select"
    : activeTask === "ventilation" && !isPlacement && !isRoute
      ? "Select an MVHR component · building geometry is locked · switch to Plan to edit it"
    : isReferenceCrop
    ? "Drag a rectangle around the floor plan · release to review · Apply commits · Esc cancels"
    : isCalibration
    ? "Click two image points · Apply is the only commit"
    : isWall
      ? snapEnabled
        ? "Wall tool · Snap on joins endpoints, wall hits and true crossings · target ring confirms acquisition · Enter commits one topology command"
        : "Wall tool · Snap off uses free points and leaves crossings disconnected · Enter commits · Esc cancels"
      : isDivider
        ? snapEnabled
          ? "Room Divider · endpoints and visible wall edges anchor to shared topology · Enter commits · Esc cancels"
          : "Room Divider · free placement may leave an incomplete partition · Enter commits · Esc cancels"
      : isFloorArea
        ? "Floor area outline · add at least three vertices · click the first point or press Enter to close · Esc cancels"
      : isPlacement
        ? "Placement owns clicks · click to place repeatedly · Esc cancels"
        : isRoute
          ? "Start at a typed port · add intermediate points · finish at a compatible port · Esc cancels"
          : activeTask === "ventilation"
            ? "Select MVHR parts · drag to move · R rotates · building geometry is locked"
            : "Select walls or endpoints · drag to edit · wheel zoom · choose Pan to move the view · Space-drag pans");
  undoButton.disabled = !canUndo(history);
  redoButton.disabled = !canRedo(history);
}

function resolvePointerPoint(event) {
  const raw = eventToSvgWorld(event);
  if (!snapEnabled) return { ...raw, nodeId: null, snapKind: "free" };
  const eligibleNodeIds = activeTool === "room-divider"
    ? new Set(eligibleRoomDividerWalls().flatMap((wall) => [wall.startNodeId, wall.endNodeId]))
    : null;
  const endpoint = closestEndpoint(event, [
    ...history.present.wallNodes
      .filter((node) => !eligibleNodeIds || eligibleNodeIds.has(node.id))
      .map((node) => ({ x: node.positionMm.x, y: node.positionMm.y, nodeId: node.id })),
    ...draftPoints,
  ]);
  if (endpoint) return { ...endpoint, snapKind: "endpoint" };
  const wallInterior = closestWallInterior(event);
  if (wallInterior) {
    const wall = history.present.walls.find((candidate) => candidate.id === wallInterior.wallId);
    const nearEndpoint = wall
      ? [wall.startNodeId, wall.endNodeId]
        .map((nodeId) => history.present.wallNodes.find((node) => node.id === nodeId))
        .find((node) => node && Math.hypot(
          node.positionMm.x - wallInterior.x,
          node.positionMm.y - wallInterior.y,
        ) <= 1)
      : null;
    if (nearEndpoint) {
      return {
        x: nearEndpoint.positionMm.x,
        y: nearEndpoint.positionMm.y,
        nodeId: nearEndpoint.id,
        snapKind: "endpoint",
      };
    }
    return { ...wallInterior, nodeId: null, snapKind: "wall" };
  }
  const cadReferenceSnap = closestCadReferenceSnap(event);
  if (cadReferenceSnap) return { ...cadReferenceSnap.point, nodeId: null, snapKind: "reference" };
  return { x: gridSnap(raw.x), y: gridSnap(raw.y), nodeId: null, snapKind: "grid" };
}

function closestCadReferenceSnap(event) {
  const matrix = canvas.getScreenCTM();
  if (!matrix) return null;
  const candidates = [];
  for (const reference of history.present.floorCadReferences) {
    if (!reference.visible || reference.floorId !== "floor-ground") continue;
    const asset = history.present.cadReferenceAssets.find((candidate) => candidate.id === reference.assetId);
    if (!asset) continue;
    for (const snap of cachedCadReferenceProjection(asset, reference).snaps) {
      const point = canvas.createSVGPoint();
      point.x = toView(snap.point.x);
      point.y = toView(snap.point.y);
      const screen = point.matrixTransform(matrix);
      candidates.push({ ...snap, screenX: screen.x, screenY: screen.y });
    }
  }
  return closestScreenCandidate(
    { x: event.clientX, y: event.clientY },
    candidates,
    WALL_SNAP_RADIUS_CSS_PX,
  );
}

function closestWallInterior(event) {
  const matrix = canvas.getScreenCTM();
  if (!matrix) return null;
  const canvasRect = canvas.getBoundingClientRect();
  const screenScalePxPerViewUnit = Math.min(
    canvasRect.width / camera.width,
    canvasRect.height / camera.height,
  );
  const nodesById = new Map(history.present.wallNodes.map((node) => [node.id, node]));
  const raw = eventToSvgWorld(event);
  const candidates = [];
  const walls = activeTool === "room-divider" ? eligibleRoomDividerWalls() : history.present.walls;
  for (const wall of walls) {
    const start = nodesById.get(wall.startNodeId)?.positionMm;
    const end = nodesById.get(wall.endNodeId)?.positionMm;
    if (!start || !end) continue;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) continue;
    const fraction = ((raw.x - start.x) * dx + (raw.y - start.y) * dy) / lengthSquared;
    if (fraction <= 0 || fraction >= 1) continue;
    const projected = { x: start.x + dx * fraction, y: start.y + dy * fraction };
    const point = canvas.createSVGPoint();
    point.x = toView(projected.x);
    point.y = toView(projected.y);
    const screen = point.matrixTransform(matrix);
    const divider = wall.classification === "virtual" && wall.boundaryRole === "room-divider";
    const strokeWidthViewUnits = divider ? 2 : Math.max(3, toView(wall.thicknessMm));
    candidates.push({
      ...projected,
      wallId: wall.id,
      screenX: screen.x,
      screenY: screen.y,
      radiusPx: wallInteriorSnapRadiusPx(
        WALL_SNAP_RADIUS_CSS_PX,
        strokeWidthViewUnits,
        screenScalePxPerViewUnit,
        { nonScalingStroke: divider },
      ),
    });
  }
  return closestScreenCandidate(
    { x: event.clientX, y: event.clientY },
    candidates,
    WALL_SNAP_RADIUS_CSS_PX,
  );
}

function eligibleRoomDividerWalls() {
  const room = history.present.rooms.find((candidate) => candidate.id === selectedRoomId);
  if (!room) return [];
  const boundaryWallIds = new Set(room.boundary.map((entry) => entry.wallId));
  return history.present.walls.filter(
    (wall) => boundaryWallIds.has(wall.id) ||
      (wall.classification === "virtual" && wall.parentRoomId === room.id),
  );
}

function closestEndpoint(event, candidates) {
  const matrix = canvas.getScreenCTM();
  if (!matrix) return null;
  const targetNodeId = event.target?.dataset?.nodeId;
  const targetNode = targetNodeId
    ? candidates.find((candidate) => candidate.nodeId === targetNodeId)
    : null;
  if (targetNode) return targetNode;
  const raw = eventToSvgWorld(event);
  const canvasRect = canvas.getBoundingClientRect();
  if (!(canvasRect.width > 0 && canvasRect.height > 0)) return null;
  const millimetresPerPixel = Math.max(
    camera.width * MILLIMETRES_PER_VIEW_UNIT / canvasRect.width,
    camera.height * MILLIMETRES_PER_VIEW_UNIT / canvasRect.height,
  );
  const radiusMm = Math.max(
    1,
    ENDPOINT_SNAP_RADIUS_CSS_PX * millimetresPerPixel,
  );
  let closest = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distanceMm = Math.hypot(candidate.x - raw.x, candidate.y - raw.y);
    if (distanceMm <= radiusMm && distanceMm < closestDistance) {
      closest = candidate;
      closestDistance = distanceMm;
    }
  }
  return closest;
}

function eventToGridWorld(event) {
  const raw = eventToSvgWorld(event);
  return layoutPointerPosition(raw, { snapEnabled, gridMm: GRID_SNAP_MM });
}

function eventToSvgWorld(event) {
  const point = canvas.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = canvas.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const local = point.matrixTransform(matrix.inverse());
  return { x: local.x * MILLIMETRES_PER_VIEW_UNIT, y: local.y * MILLIMETRES_PER_VIEW_UNIT };
}

function zoomAtCentre(factor) {
  initialCameraFit.cancel();
  camera = zoomCameraAt(camera, { x: camera.x + camera.width / 2, y: camera.y + camera.height / 2 }, factor);
  interactionMessage = "View zoom changed; project geometry unchanged";
  render();
}

function panBy(xFraction, yFraction) {
  initialCameraFit.cancel();
  camera = panCamera(camera, { x: camera.width * xFraction, y: camera.height * yFraction });
  interactionMessage = "View panned; project geometry unchanged";
  renderCamera();
  updateStatus();
}

function fitView() {
  initialCameraFit.cancel();
  applyCameraFit(canvas.getBoundingClientRect(), "View fitted; project geometry unchanged");
}

function applyCameraFit(rect, message) {
  const aspectRatio = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1.5;
  camera = fitCameraToBounds(projectBounds(), aspectRatio, 55);
  interactionMessage = message;
  render();
}

function projectBounds() {
  const points = history.present.wallNodes.map((node) => ({ x: toView(node.positionMm.x), y: toView(node.positionMm.y) }));
  for (const outline of history.present.floorAreaOutlines) {
    for (const vertex of outline.vertices) {
      points.push({ x: toView(vertex.positionMm.x), y: toView(vertex.positionMm.y) });
    }
  }
  for (const component of history.present.components) {
    points.push({ x: toView(component.positionMm.x), y: toView(component.positionMm.y) });
    const bounds = deriveComponentPlanGraphic(component)?.drawingBoundsMm;
    if (bounds) {
      const angle = componentYaw(component.orientation);
      for (const x of [bounds.minX, bounds.maxX]) for (const y of [bounds.minY, bounds.maxY]) {
        points.push({ x: toView(component.positionMm.x + x*Math.cos(angle)-y*Math.sin(angle)), y: toView(component.positionMm.y + x*Math.sin(angle)+y*Math.cos(angle)) });
      }
    }
  }
  for (const route of history.present.routes) {
    const geometry = deriveDuctBodyGeometry(route, routeFamilyForKind(route.ductKind));
    for (const lane of geometry.lanes) {
      for (const point of lane) points.push({ x: toView(point.x), y: toView(point.y) });
    }
  }
  for (const reference of history.present.floorReferences) {
    if (!reference.visible) continue;
    const asset = history.present.referenceAssets.find((candidate) => candidate.id === reference.assetId);
    if (!asset) continue;
    const scale = effectiveReferenceScale(reference);
    const crop = activeTool === "crop-reference" && referenceCropState?.referenceId === reference.id
      ? null
      : reference.cropSourceRectPx;
    const minX = crop?.x ?? 0;
    const minY = crop?.y ?? 0;
    const maxX = crop ? crop.x + crop.width : asset.widthPx;
    const maxY = crop ? crop.y + crop.height : asset.heightPx;
    for (const sourcePoint of [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: minX, y: maxY }, { x: maxX, y: maxY }]) {
      const worldPoint = sourcePointToWorld(reference.transform, sourcePoint, scale);
      points.push({ x: toView(worldPoint.x), y: toView(worldPoint.y) });
    }
  }
  for (const reference of history.present.floorCadReferences) {
    if (!reference.visible) continue;
    const asset = history.present.cadReferenceAssets.find((candidate) => candidate.id === reference.assetId);
    if (!asset) continue;
    const bounds = cachedCadReferenceProjection(asset, reference).transformed.boundsMm;
    if (!bounds) continue;
    points.push(
      { x: toView(bounds.minX), y: toView(bounds.minY) },
      { x: toView(bounds.maxX), y: toView(bounds.maxY) },
    );
  }
  if (points.length === 0) return null;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function gridSnap(value) {
  return Math.round(value / GRID_SNAP_MM) * GRID_SNAP_MM;
}

function toView(valueMm) {
  return valueMm / MILLIMETRES_PER_VIEW_UNIT;
}

function formatMm(valueMm) {
  return `${Math.round(valueMm).toLocaleString()} mm`;
}

function formatArea(areaMm2) {
  return `${Number((areaMm2 / 1_000_000).toFixed(2)).toLocaleString()} m²`;
}

function formatNumberValue(value) {
  return Number(value.toFixed(2)).toLocaleString();
}

function formatAirflowLps(valueLps) {
  const lps = Number(valueLps.toFixed(2)).toLocaleString();
  const cubicMetresPerHour = Number((valueLps * 3.6).toFixed(2)).toLocaleString();
  return `${lps} L/s (${cubicMetresPerHour} m³/h)`;
}

function formatSignedAirflowLps(valueLps) {
  const prefix = valueLps > 0 ? "+" : "";
  return `${prefix}${formatAirflowLps(valueLps)}`;
}

function formatAirflowTarget(target) {
  if (target?.state !== "known") return `unresolved${target?.reason ? ` — ${target.reason}` : ""}`;
  const unit = target.inputUnit === "m3/h" ? "m³/h" : "L/s";
  return `${Number(target.inputValue.toFixed(2)).toLocaleString()} ${unit} · ${target.basis} · source: ${target.source}`;
}

function formatRoomChoice(value) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ");
}

function formatScale(value) {
  return `${Number(value.toFixed(6)).toLocaleString()} mm/px`;
}

function formatSavedAt(value) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function nextIdentityCounter(project) {
  let maximum = 0;
  for (const entity of [...project.wallNodes, ...project.walls]) {
    const match = entity.id.match(/^(?:wall|wall-node)-(\d+)-/);
    if (match) maximum = Math.max(maximum, Number.parseInt(match[1], 10));
  }
  return maximum + 1;
}

function nextReferenceIdentityCounter(project) {
  let maximum = 0;
  for (const entity of [...project.referenceAssets, ...project.floorReferences, ...project.pdfReferenceAssets]) {
    const match = entity.id.match(/^(?:reference-asset|floor-reference|pdf-reference-source)-(\d+)$/);
    if (match) maximum = Math.max(maximum, Number.parseInt(match[1], 10));
  }
  return maximum + 1;
}

function nextCadReferenceIdentityCounter(project) {
  let maximum = 0;
  for (const entity of [...project.cadReferenceAssets, ...project.floorCadReferences]) {
    const match = entity.id.match(/^(?:cad-reference-asset|floor-cad-reference)-(\d+)$/);
    if (match) maximum = Math.max(maximum, Number.parseInt(match[1], 10));
  }
  return maximum + 1;
}

function nextComponentIdentityCounter(project) {
  let maximum = 0;
  for (const component of project.components) {
    const match = component.id.match(/^component-(?:synthetic|catalogue)-(\d+)$/);
    if (match) maximum = Math.max(maximum, Number.parseInt(match[1], 10));
  }
  return maximum + 1;
}

function nextEquipmentAssemblyIdentityCounter(project) {
  let maximum = 0;
  for (const assembly of project.equipmentAssemblies) {
    const match = assembly.id.match(/^equipment-assembly-(\d+)$/);
    if (match) maximum = Math.max(maximum, Number.parseInt(match[1], 10));
  }
  return maximum + 1;
}

function nextRouteIdentityCounter(project) {
  let maximum = 0;
  for (const route of project.routes) {
    const match = route.id.match(/^route-synthetic-(\d+)$/);
    if (match) maximum = Math.max(maximum, Number.parseInt(match[1], 10));
  }
  return maximum + 1;
}

function nextRoomIdentityCounter(project) {
  let maximum = 0;
  for (const room of project.rooms) {
    const match = room.id.match(/^room-local-(\d+)$/);
    if (match) maximum = Math.max(maximum, Number.parseInt(match[1], 10));
  }
  return maximum + 1;
}

function nextZoneIdentityCounter(project) {
  let maximum = 0;
  for (const zone of project.zones) {
    const match = zone.id.match(/^zone-local-(\d+)$/);
    if (match) maximum = Math.max(maximum, Number.parseInt(match[1], 10));
  }
  return maximum + 1;
}

function nextFloorAreaIdentityCounter(project) {
  let maximum = 0;
  for (const outline of project.floorAreaOutlines) {
    const match = outline.id.match(/^floor-area-local-(\d+)$/);
    if (match) maximum = Math.max(maximum, Number.parseInt(match[1], 10));
  }
  return maximum + 1;
}

function componentYaw(quaternion) {
  return Math.atan2(
    2 * (quaternion.w * quaternion.z + quaternion.x * quaternion.y),
    1 - 2 * (quaternion.y * quaternion.y + quaternion.z * quaternion.z),
  );
}

function portRoleClass(role) {
  if (role === "Dwelling supply") return "supply";
  if (role === "Dwelling extract") return "extract";
  if (role === "Outdoor intake") return "intake";
  if (role === "Outdoor exhaust") return "exhaust";
  return "generic";
}

function svgElement(name, attributes) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function isTextInput(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable === true;
}

initialCameraFit.arm();
setTask("project");
render();


async function saveExplicit() {
  if(cloudSession?.loading){interactionMessage="Checking sign-in; please wait before saving.";updateStatus();return false;}
  if(cloudSavePending)return cloudSavePending;
  if(!cloudSession?.workspace){document.querySelector("#account-button").click();return false;}
  const project=deserializeProject(serializeProject(history.present)),name=currentProjectName;
  const workspaceId=cloudSession.workspace.id,userId=cloudSession.user.id,binding=cloudBindingVersion;
  storageState={kind:"pending",label:"Saving to cloud…",detail:"Wait for the cloud save acknowledgement"};renderStorageState();
  cloudSavePending=(async()=>{
    try {
      const result=await cloudSession.store.save({project,name,workspaceId,userId,record:currentCloudRecord});
      if(cloudSession?.user?.id!==userId || cloudSession?.workspace?.id!==workspaceId || binding!==cloudBindingVersion)return false;
      currentCloudRecord=result.record;savedProjectJson=result.projectJson;savedProjectName=name;
      storageState=projectHasUnsavedChanges()?{kind:"unsaved",label:"Cloud saved · newer changes unsaved",detail:"Choose Save again"}:{kind:"saved",label:`Saved to cloud · ${name}`,detail:`Version ${result.record.save_version} · ${new Date(result.record.updated_at).toLocaleString()}`};
      interactionMessage=`“${name}” saved to your private cloud workspace`;return true;
    }catch(error){storageState={kind:"failed",label:"Cloud save failed",detail:error.message};interactionMessage=`Cloud save failed: ${error.message}. Current drawing remains open; Export project makes a file backup.`;return false;}
    finally{cloudSavePending=null;queueWorkingSession();renderStorageState();updateStatus();if(activeTask==="project")renderProjectWorkspace();}
  })();
  return cloudSavePending;
}

cloudSession=initializeCloudUI({
  client:getStudioClient(),
  initialAccess:getBootAccess(),
  onAccount(){setTask("account");},
  onChange(state){
    handleWorkingSessionState(state);
    saveButton.textContent=state.workspace?"Save":"Sign in to save";
    projectSaveButton.textContent=state.workspace?"Save":"Sign in to save";
    saveAsButton.hidden=!state.workspace;document.querySelector("#project-save-as").hidden=!state.workspace;
    document.querySelector("#project-cloud-open").disabled=false;
    document.querySelector("#project-signin").hidden=Boolean(state.workspace);
    document.querySelector("#project-storage-note").textContent=state.workspace?`Cloud workspace: ${state.workspace.name}. Choose Save to keep your latest changes.`:"Sign in to save and reopen drawings across devices.";
    saveButton.disabled=state.loading || Boolean(cloudSavePending) || (!workingReady&&Boolean(workingContext(state)));
    projectSaveButton.disabled=saveButton.disabled;
    if(state.user && !state.workspace && !state.loading){interactionMessage="This account has no invited Studio workspace. Your drawing remains open.";updateStatus();}
  },
  onOpen(loaded){
    requestProjectTransition(()=>{
      applyLocalReopen(loaded,{named:false,message:`Opened “${loaded.name}” from cloud`});
      currentProjectName=loaded.name;savedProjectName=loaded.name;savedProjectJson=serializeProject(loaded.project);currentCloudRecord=loaded.record;
      storageState={kind:"saved",label:`Saved to cloud · ${loaded.name}`,detail:`Version ${loaded.record.save_version}`};renderStorageState();render();
    },`Opening “${loaded.name}” will replace the current drawing.`);
  },
  async beforeSignOut(){
    await workingSessions.flush().catch(()=>{});
    if(cloudSavePending)throw new Error("Wait for the current cloud save before signing out.");
    if(cloudSession?.workspace && projectHasUnsavedChanges())throw new Error("Save your drawing before signing out. Export backup is also available.");
  },
  onSignedOut(){if(currentCloudRecord){currentCloudRecord=null;cloudBindingVersion++;createCleanProject("Untitled project");}window.location.replace("/login/?signedout=1");},
  onAccessLost(reason){window.location.replace(`/login/?reason=${encodeURIComponent(reason)}`);}
});


function workingContext(state=cloudSession){
 if(!state||state.loading||(state.user&&!state.workspace))return null;
 return {userId:state.user?.id??null,workspaceId:state.workspace?.id??null};
}
function queueWorkingSession(modelChanged=false){
 if(workingRestoring)return;
 if(modelChanged)workingActivity++;
 if(!workingReady||workingQueued||!workingContext())return;
 workingQueued=true;
 queueMicrotask(()=>{
  workingQueued=false;const context=workingContext();if(!context||workingRestoring)return;
  if(currentCloudRecord&&currentCloudRecord.workspace_id!==context.workspaceId)return;
  try{
   if(workingModel!==history.present){workingModel=history.present;workingJson=serializeProject(history.present);}
   const snapshot={projectJson:workingJson,name:currentProjectName,dirty:workingJson!==savedProjectJson||currentProjectName!==savedProjectName,
    cloudRecord:currentCloudRecord?structuredClone(currentCloudRecord):null,
    task:sheetPreviewPanel.hidden?activeTask:"sheets",camera:{...camera},catalogueGroup:selectedCatalogueGroup};
   const model=history.present;workingWrites++;
   workingSessions.write(context,snapshot).then(()=>{
    workingRecoveryError="";
    if(history.present===model&&currentProjectName===snapshot.name&&workingContext()&&workingContextKey(workingContext())===workingContextKey(context)&&storageState.kind==="unsaved"&&projectHasUnsavedChanges()){
     storageState={kind:"unsaved",label:cloudSession?.workspace?"Unsaved changes · choose Save":"Unsaved changes · recovery stored",detail:"Current drawing recovered on this device; Save keeps the cloud copy updated"};renderStorageState();
    }
   }).catch(workingSessionFailed).finally(()=>workingWrites--);
  }catch(error){workingSessionFailed(error);}
 });
}
function workingSessionFailed(error){
 workingRecoveryError=error.message;interactionMessage=`Browser recovery unavailable: ${error.message}. Save or export before refreshing.`;updateStatus();
}
function handleWorkingSessionState(state){
 const context=workingContext(state);if(!context)return;
 const key=workingContextKey(context);
 if(workingOwnerKey&&workingOwnerKey!==key&&workingOwnerKey.startsWith("account:")){currentCloudRecord=null;cloudBindingVersion++;createCleanProject("Untitled project");}
 workingOwnerKey=key;
 if(!workingRestoreStarted){workingRestoreStarted=true;restoreWorkingSession(context);}
 else if(workingReady)queueWorkingSession();
}
async function restoreWorkingSession(context){
 const previousStorage=storageState,pendingStorage={kind:"pending",label:"Reopening current drawing…",detail:"Checking browser recovery and your saved project"};
 storageState=pendingStorage;renderStorageState();
 try{
  let recovered=await workingSessions.read(context);
  if(!recovered&&context.userId&&workingActivity===0){
   const records=await cloudSession.store.list(context.workspaceId);
   const recent=records.find(record=>record.updated_by===context.userId);
   if(recent){const loaded=await cloudSession.store.open(recent);recovered={project:loaded.project,projectJson:serializeProject(loaded.project),name:loaded.name,dirty:false,cloudRecord:loaded.record,task:"project",camera:{...camera}};}
  }
  const current=workingContext();
  if(!current||workingContextKey(current)!==workingContextKey(context))return;
  if(recovered&&workingActivity===0){
   workingRestoring=true;
   applyLocalReopen({project:recovered.project},{named:false});
   currentProjectName=recovered.name;savedProjectName=recovered.dirty?null:recovered.name;
   savedProjectJson=recovered.dirty?null:serializeProject(recovered.project);
   currentCloudRecord=recovered.cloudRecord??null;cloudBindingVersion++;
   camera={...recovered.camera};
   if(typeof recovered.catalogueGroup==="string")selectedCatalogueGroup=recovered.catalogueGroup;
   if(recovered.task==="sheets")openSheetPreview();else setTask(recovered.task);
   const dirty=projectHasUnsavedChanges();storageState={kind:dirty?"unsaved":"saved",label:`${dirty?"Recovered unsaved changes":"Reopened"} · ${recovered.name}`,detail:currentCloudRecord?`Cloud version ${currentCloudRecord.save_version} · device recovery is separate from Save`:"Current drawing restored from this browser"};
   interactionMessage=`Continued “${recovered.name}” where you left it${dirty?" · changes still need saving":""}`;
   render();renderStorageState();updateStatus();
  }
 }catch(error){workingSessionFailed(error);}
 finally{
  workingRestoring=false;
  if(storageState===pendingStorage)storageState=previousStorage;
  renderStorageState();
  const current=workingContext();
  if(!current||workingContextKey(current)!==workingContextKey(context)){
   workingRestoreStarted=false;workingReady=false;
   if(current)queueMicrotask(()=>handleWorkingSessionState(cloudSession));
  }else{workingReady=true;queueWorkingSession();}
  saveButton.disabled=Boolean(cloudSession?.loading)||Boolean(cloudSavePending);projectSaveButton.disabled=saveButton.disabled;
 }
}
window.addEventListener("pagehide",()=>queueWorkingSession());
document.addEventListener("visibilitychange",()=>{if(document.hidden)queueWorkingSession();});
canvas.addEventListener("pointerup",()=>queueWorkingSession());
canvas.addEventListener("wheel",()=>queueWorkingSession(),{passive:true});
document.querySelector('.drawing-view-toolbar')?.addEventListener("click",()=>queueWorkingSession());

window.addEventListener("beforeunload",event=>{
 if(cloudSavePending||workingQueued||workingWrites||(!workingReady&&workingActivity>0)||(workingRecoveryError&&projectHasUnsavedChanges())){event.preventDefault();event.returnValue="";}
});
