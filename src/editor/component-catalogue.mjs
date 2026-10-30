import { COMBINED_DN160_PORT_PITCH_MM } from "../domain/combined-grille-drawing-spacing.mjs";
import { ca200Records } from "./ca200-profile.mjs";
import { standaloneCwRecords } from "./standalone-cw.mjs";
import { decentralisedMvhrRecords } from "./decentralised-mvhr.mjs";
import { terminalDrawingPortDefinition } from "../domain/terminal-drawing-connections.mjs";
import { EXTERNAL_GRILLE_EVIDENCE } from "./external-grille-evidence.mjs";
import { AEROFRESH_MANUAL_EVIDENCE } from "./aerofresh-manual-evidence.mjs";
import { identityQuaternion, unknownMm } from "../domain/spatial.mjs";
import {
  DISTRIBUTION_BOX_PROFILES,
  inspectDistributionBoxDesign,
} from "./distribution-box-design.mjs";

export const CATALOGUE_ID = "hiper-studio-component-catalogue";
export const CATALOGUE_VERSION = "2026-10-30.1";

const INTERNAL_IDENTIFIER_SOURCE = Object.freeze({
  sourceId: "internal-product-identifiers-rev-6a",
  sourceKind: "sanitized-internal-product-list",
  verificationStatus: "identifier-and-description-only",
});

const Q_SET_OUT_SOURCE = Object.freeze({
  sourceId: "zehnder-q350-q450-setout",
  sourceKind: "supplied-dimensional-pdf",
  title: "Zehnder Q350/450 setout",
  page: 1,
  revision: null,
  verificationStatus: "visually-reviewed-dimensional-setout",
});

const Q350_TECHNICAL_SOURCE = Object.freeze({
  sourceId: "zehnder-comfoair-q350-tr-technical-specification",
  sourceKind: "official-manufacturer-technical-specification",
  title: "Zehnder ComfoAir Q350 TR",
  url: "https://zehnder.hu/wp-content/uploads/2021/03/TS135_ComfoAir_Q350_en_screen.pdf",
  pages: [10, 11],
  releaseDate: "2017-01-25",
  verificationStatus: "visually-reviewed-dimensions-and-handed-air-directions",
});

const Q_DE_BIM_SOURCE = Object.freeze({
  sourceId: "mepcontent-zehnder-comfoair-q-de-ifc4-2026-10-24",
  sourceKind: "owner-supplied-manufacturer-bim-download",
  catalogueMarket: "DE",
  format: "IFC4",
  viewDefinition: "CoordinationView_V2.0",
  units: "mm",
  authoringApplication: "Autodesk Revit 2023",
  verificationStatus: "hash-pinned-identity-mesh-and-distribution-ports-reviewed",
  evidenceBoundary: "Exact German article/type only; no export or Australian SKU equivalence, performance, CW fit or installation clearance is inferred.",
});

const GENERIC_FIXTURE_SOURCE = Object.freeze({
  sourceId: "hiper-generic-test-fixture",
  sourceKind: "synthetic-test-fixture",
  verificationStatus: "not-manufacturer-verified",
});

const Q600_RESEARCH_SOURCE = Object.freeze({
  sourceId: "sanitized-q600-research-2026-10-19",
  sourceKind: "sanitized-research-workbook",
  verificationStatus: "connection-dimensions-verified-variant-conflict-unresolved",
});

const Q350_CW320_RESEARCH_SOURCE = Object.freeze({
  sourceId: "sanitized-q350-cw320-research-2026-10-19",
  sourceKind: "sanitized-research-workbook",
  verificationStatus: "dimensions-reviewed-local-sku-crosswalk-unverified",
});

const COMFOWELL_320_TECHNICAL_SOURCE = Object.freeze({
  sourceId: "zehnder-comfowell-320-technical-specification",
  sourceKind: "official-manufacturer-technical-specification",
  title: "Zehnder ComfoWell 320",
  url: "https://zehnder.hu/wp-content/uploads/2023/05/Zehnder_CSY_ComfoWell_320_TES_SI_en.pdf",
  corroboratingUrls: [
    "https://zehnderamerica.com/wp-content/uploads/2024/08/Zehnder-ComfoWell-320-specifications-2021.02.18-1.pdf",
    "https://www.zehnder.co.uk/en/indoor-ventilation/solutions/air-distribution/zehnder-comfowell-220/zehnder-comfowell-attenuator-cw-s-320",
  ],
  pages: [2, 3, 4, 5, 10],
  verificationStatus: "visually-reviewed-article-table-and-dimensional-drawings",
});

const COMFOTUBE_FLOW_TECHNICAL_SOURCE = Object.freeze({
  sourceId: "zehnder-comfotube-flow-technical-specification-v0825",
  sourceKind: "official-manufacturer-technical-specification",
  title: "Zehnder ComfoTube Flow — Technische Spezifikation",
  productPageUrl: "https://www.zehnder-systems.de/de/zuhause-profi/produkte-zubehoer/produkte-wohnraumlueftung/luftverteilsystem/zehnder-comfotube-flow",
  url: "https://www.zehnder-systems.de/download/bff2a5c9007a4ced9460614ef501d1b1",
  documentCode: "Z-DE-V0825-CSY-TES-TS010-ComfoTube",
  revision: "V0825",
  portalDocumentDate: "2026-06-17",
  language: "de",
  verificationStatus: "text-and-table-reviewed-graph-not-digitized",
});

export const COMFOTUBE_FLOW_90_EVIDENCE = deepFreeze({
  evidenceId: "zehnder-comfotube-flow-90.v1",
  manufacturerItem: "ComfoTube Flow Ø 90 mm, roll 50 m",
  manufacturerArticle: "990328101",
  source: COMFOTUBE_FLOW_TECHNICAL_SOURCE,
  identityPages: [2, 4],
  outsideDiameterMm: 90,
  insideDiameterMm: 77,
  rollLengthM: 50,
  recommendedNormalVentilationMaximum: {
    airflowM3h: 45,
    airVelocityMs: 2.7,
    sourcePage: 2,
    meaning: "manufacturer-marked recommended maximum at normal ventilation",
  },
  pressureLossEvidence: {
    sourcePage: 3,
    tubeAxisUnits: { airflow: "m3/h", pressureLoss: "Pa/10m" },
    fittingAxisUnits: { airflow: "m3/h", pressureLoss: "Pa" },
    state: "graph-only-no-tabulated-ordinates",
    numericalPoints: null,
    interpolationPolicy: "blocked",
    calculable: false,
  },
  currentGenerationStatement: "The official product page describes ComfoTube Flow as the further development of ComfoTube.",
  localSkuCrosswalkStatus: "unverified",
  note: "Exact identity, diameters, roll length and the recommended normal-ventilation maximum are retained. No pressure-loss values are digitized from the graph and no predecessor ComfoTube curve is reused.",
});

export const COMFOWELL_320_PRESSURE_EVIDENCE = deepFreeze({
  evidenceId: "zehnder-comfowell-320-pressure-graph.v1",
  source: {
    ...COMFOWELL_320_TECHNICAL_SOURCE,
    documentCode: "CDE-FLYERTS222",
    revision: "V1116",
    pressureGraphPage: 12,
  },
  familyMaximumNormalVentilationAirflowM3h: 240,
  familyMaximumSourcePage: 2,
  graphConfigurationLabel: "ComfoWell attenuator CW-S 320 with end plate CW-P – DN150",
  graphSeries: ["ComfoWell 320", "2 x ComfoWell 320 in series"],
  axisUnits: { airflow: "m3/h", pressureLoss: "Pa" },
  numericalPoints: null,
  interpolationPolicy: "blocked",
  calculable: false,
  applicableToCurrentNamedDn160SixBy90Chain: false,
  gaps: [
    "The graph has no tabulated ordinates.",
    "The graph label specifies DN150 while the selected evidence candidates use CW-P 320 DN160 and CW-M 320 6 x 90/P.",
    "The graph does not define the full selected chain, branch flow split, installation orientation or interpolation method.",
  ],
});

export const COMFOWELL_320_ARTICLE_EVIDENCE = deepFreeze([
  {
    localProductId: "ZEN-MSCW-320",
    manufacturerItem: "CW-K 320 – ComfoAir Q350/450 TR",
    manufacturerArticle: "990323644",
    function: "direct-unit-mounting-set",
    officialClaim: "Named mounting set for ComfoAir Q350/450 TR",
    manufacturerIdentityStatus: "verified-official-manufacturer-source",
    localSkuCrosswalkStatus: "unverified",
    australianAvailabilityStatus: "unverified",
    installationCompatibilityStatus: "review-required",
    source: COMFOWELL_320_TECHNICAL_SOURCE,
  },
  {
    localProductId: "ZEN-ACWS-320",
    manufacturerItem: "CW-S 320",
    manufacturerArticle: "990323501",
    function: "attenuator-module",
    officialClaim: "ComfoWell 320 attenuator module; end plates or mounting plates are separate",
    manufacturerIdentityStatus: "verified-official-manufacturer-source",
    localSkuCrosswalkStatus: "unverified",
    australianAvailabilityStatus: "unverified",
    installationCompatibilityStatus: "review-required",
    source: COMFOWELL_320_TECHNICAL_SOURCE,
  },
  {
    localProductId: "ZEN-MPCWM-320-6X90",
    manufacturerItem: "CW-M 320 – 6 × 90/P",
    manufacturerArticle: "990323613",
    function: "six-port-comfotube-mounting-plate",
    officialClaim: "Mounting plate for six Zehnder ComfoTube 90 flexible ducts",
    manufacturerIdentityStatus: "verified-official-manufacturer-source",
    localSkuCrosswalkStatus: "unverified",
    australianAvailabilityStatus: "unverified",
    installationCompatibilityStatus: "review-required",
    source: COMFOWELL_320_TECHNICAL_SOURCE,
  },
  {
    localProductId: "ZEN-MP320-160",
    manufacturerItem: "CW-P 320 – DN160",
    manufacturerArticle: "990323512",
    function: "round-duct-end-plate",
    officialClaim: "End plate for connecting the ComfoWell system to a DN160 round duct",
    manufacturerIdentityStatus: "verified-official-manufacturer-source",
    localSkuCrosswalkStatus: "unverified",
    australianAvailabilityStatus: "unverified",
    installationCompatibilityStatus: "generic-epp-mating-unverified",
    source: COMFOWELL_320_TECHNICAL_SOURCE,
  },
]);

export const Q350_PERFORMANCE_EVIDENCE = deepFreeze({
  evidenceId: "zehnder-comfoair-q350-tr-sensible-performance.v2",
  manufacturer: "Zehnder",
  model: "ComfoAir Q350 TR",
  applicableManufacturerArticles: ["471502110"],
  excludedManufacturerArticles: [{
    manufacturerArticle: "471502111",
    reason: "The reviewed pages do not explicitly bind the 40 m³/h at 10 Pa statement to the enthalpy article.",
  }],
  source: {
    ...Q350_TECHNICAL_SOURCE,
    pages: [2, 7],
    verificationStatus: "visually-reviewed-published-airflow-pressure-statements",
  },
  publishedOperatingPoints: [
    {
      airflowM3h: 350,
      externalStaticPressurePa: 200,
      statement: "maximum air volume flow at stated external pressure",
      sourcePage: 2,
    },
    {
      airflowM3h: 40,
      externalStaticPressurePa: 10,
      statement: "minimum air volume flow at stated external pressure",
      sourcePage: 7,
    },
  ],
  soundMeasurementOperatingPoints: {
    sourcePage: 8,
    purpose: "sound measurement conditions only",
    airflowAndExternalPressure: [
      [150, 25],
      [200, 50],
      [245, 50],
      [250, 100],
      [300, 100],
      [350, 100],
      [250, 150],
      [250, 200],
      [300, 200],
      [350, 200],
    ].map(([airflowM3h, externalPressurePa]) => ({ airflowM3h, externalPressurePa })),
    fanCurveUse: "blocked",
    interpolationPolicy: "blocked",
    note: "These pairs identify acoustic measurement conditions. The source does not present them as a fan-performance curve or define an interpolation method.",
  },
  maximumPublishedAirflowM3h: 350,
  fanCurveStatus: "not-digitized-or-reviewed-for-interpolation",
  interpolationPolicy: "blocked",
  note: "The two statements are retained only for sensible article 471502110. They are source-alignment evidence, not a reconstructed fan curve, rectangular operating envelope or whole-network suitability result.",
});

const PRIVATE_PRICING = Object.freeze({
  status: "private-source-not-imported",
  amount: null,
  currency: null,
  sourceRevision: null,
});

const UNKNOWN_PERFORMANCE = Object.freeze({
  status: "not-provided",
  values: null,
});

const EPP_160 = interfaceDefinition("rigid-epp", 160, "generic-test-fixture-only", {
  drawingConnectionClass: "circular-dn160",
  installationCompatibilityStatus: "unverified",
});
const SEMI_RIGID_90 = interfaceDefinition("semi-rigid-pe", 90, "generic-test-fixture-only");
const GENERIC_CW_320 = interfaceDefinition("generic-cw-module", 320, "generic-placeholder-not-product-compatible");
const Q350_TR_DN160 = deepFreeze({
  family: "zehnder-q-tr-rotating-round",
  nominalSizeMm: 160,
  boreMm: 160,
  outsideDiameterMm: 190,
  matingProfile: null,
  verificationStatus: "manufacturer-dimensioned-drawing-only",
  drawingConnectionClass: "circular-dn160",
  installationCompatibilityStatus: "unverified",
});
const Q450_DE_BIM_CONNECTION = deepFreeze({
  family: "zehnder-q-tr-rotating-round",
  nominalSizeMm: 180,
  boreMm: 180,
  outsideDiameterMm: 200,
  matingProfile: null,
  verificationStatus: "IFC-Diameter-1-and-mesh-envelope-with-conflicting-160-190-text-properties",
  drawingConnectionClass: "circular-dn180",
  installationCompatibilityStatus: "source-property-conflict-review-required",
});

export const COMPONENT_CATALOGUE = deepFreeze([
  ...ca200Records().map(componentRecord),
  ...standaloneCwRecords().map(componentRecord),
  ...decentralisedMvhrRecords().map(componentRecord),
  componentRecord({
    id: "synthetic-mvhr-placeholder",
    versionId: "generic-mvhr-unit.v2",
    group: "Units",
    category: "mvhr-unit",
    manufacturer: null,
    productId: null,
    name: "Generic test MVHR unit",
    status: "synthetic-not-manufacturer-verified",
    source: GENERIC_FIXTURE_SOURCE,
    dimensions: dimensions(900, 650, null, "generic drawing fixture only"),
    symbol: { shape: "box", widthMm: 900, heightMm: 650 },
    ports: [
      port("dwelling-supply", -450, -180, -1, 0, "supply", "Dwelling supply", EPP_160),
      port("dwelling-extract", -450, 180, -1, 0, "extract", "Dwelling extract", EPP_160),
      port("outdoor-intake", 450, -180, 1, 0, "intake", "Outdoor intake", EPP_160),
      port("outdoor-exhaust", 450, 180, 1, 0, "exhaust", "Outdoor exhaust", EPP_160),
    ],
    note: "Routable test fixture; no manufacturer geometry, duty or fit is claimed.",
  }),
  qSetoutRecord("zehnder-q350-hrv-setout", "ZEN-Q350HRV", "ComfoAir Q350 TR - sensible", "Price List!A2:C2"),
  qSetoutRecord("zehnder-q350-erv-setout", "ZEN-Q350ERV", "ComfoAir Q350 TR - enthalpy", "Price List!A3:C3"),
  q350DrawingProfileRecord("zehnder-q350-hrv-left-drawing-profile", "ZEN-Q350HRV", "ComfoAir Q350 TR - sensible", "Price List!A2:C2", "471502110", "left"),
  q350DrawingProfileRecord("zehnder-q350-hrv-right-drawing-profile", "ZEN-Q350HRV", "ComfoAir Q350 TR - sensible", "Price List!A2:C2", "471502110", "right"),
  q350DrawingProfileRecord("zehnder-q350-erv-left-drawing-profile", "ZEN-Q350ERV", "ComfoAir Q350 TR - enthalpy", "Price List!A3:C3", "471502111", "left"),
  q350DrawingProfileRecord("zehnder-q350-erv-right-drawing-profile", "ZEN-Q350ERV", "ComfoAir Q350 TR - enthalpy", "Price List!A3:C3", "471502111", "right"),
  ...["hrv", "erv"].flatMap((type) => ["left", "right"].map((handing) => qDeBimProfileRecord("350", type, handing))),
  qSetoutRecord("zehnder-q450-hrv-setout", "ZEN-Q450HRV", "ComfoAir Q450 TR - sensible", "Price List!A4:C4"),
  qSetoutRecord("zehnder-q450-erv-setout", "ZEN-Q450ERV", "ComfoAir Q450 TR - enthalpy", "Price List!A5:C5"),
  ...["hrv", "erv"].flatMap((type) => ["left", "right"].map((handing) => qDeBimProfileRecord("450", type, handing))),
  ...remoteAssemblyRecords("supply", "Dwelling supply"),
  ...remoteAssemblyRecords("extract", "Dwelling extract"),
  componentRecord({
    id: "generic-supply-attenuation-distribution-160",
    versionId: "generic-supply-attenuation-distribution-160.v1",
    group: "Attenuation & distribution",
    category: "attenuator-manifold",
    manufacturer: null,
    productId: null,
    name: "Generic supply attenuator / manifold",
    status: "synthetic-not-manufacturer-verified",
    source: GENERIC_FIXTURE_SOURCE,
    dimensions: dimensions(720, 320, null, "generic drawing fixture only"),
    symbol: { shape: "box", widthMm: 720, heightMm: 320 },
    ports: [
      port("main", -360, 0, -1, 0, "supply", "Dwelling supply", EPP_160),
      ...radialPorts("branch", 360, "supply", "Dwelling supply"),
    ],
    note: "One independently placeable supply-side fixture; no automatic count or pairing.",
  }),
  componentRecord({
    id: "generic-extract-attenuation-distribution-160",
    versionId: "generic-extract-attenuation-distribution-160.v1",
    group: "Attenuation & distribution",
    category: "attenuator-manifold",
    manufacturer: null,
    productId: null,
    name: "Generic extract attenuator / manifold",
    status: "synthetic-not-manufacturer-verified",
    source: GENERIC_FIXTURE_SOURCE,
    dimensions: dimensions(720, 320, null, "generic drawing fixture only"),
    symbol: { shape: "box", widthMm: 720, heightMm: 320 },
    ports: [
      port("main", -360, 0, -1, 0, "extract", "Dwelling extract", EPP_160),
      ...radialPorts("branch", 360, "extract", "Dwelling extract"),
    ],
    note: "One independently placeable extract-side fixture; no automatic count or pairing.",
  }),
  ...["hrv", "erv"].flatMap(type => ["left", "right"].map(handing => aerofresh450Record(type, handing))),
  ...[125,160].flatMap(size => ["intake","exhaust","combined"].map(service=>externalGrilleRecord(size,service))),
  ...[125,160].flatMap(size => ["intake","exhaust"].map(service=>zehnderSingleGrilleRecord(size,service))),
  lunaGrilleRecord("supply"),
  lunaGrilleRecord("extract"),
  aerofreshGrilleRecord("supply"),
  aerofreshGrilleRecord("extract"),
  componentRecord({
    id: "synthetic-supply-terminal",
    versionId: "generic-supply-terminal-90.v2",
    group: "Terminals",
    category: "terminal",
    manufacturer: null,
    productId: null,
    name: "Generic supply terminal",
    status: "synthetic-not-manufacturer-verified",
    source: GENERIC_FIXTURE_SOURCE,
    dimensions: dimensions(300, 300, null, "generic drawing fixture only"),
    symbol: { shape: "circle", widthMm: 300, heightMm: 300 },
    ports: [port("supply", 0, 0, 1, 0, "supply", "Dwelling supply", SEMI_RIGID_90)],
    note: "Generic DN90 connection fixture; not a TVA or Luna geometry claim.",
  }),
  componentRecord({
    id: "synthetic-extract-terminal",
    versionId: "generic-extract-terminal-90.v2",
    group: "Terminals",
    category: "terminal",
    manufacturer: null,
    productId: null,
    name: "Generic extract terminal",
    status: "synthetic-not-manufacturer-verified",
    source: GENERIC_FIXTURE_SOURCE,
    dimensions: dimensions(300, 300, null, "generic drawing fixture only"),
    symbol: { shape: "circle", widthMm: 300, heightMm: 300 },
    ports: [port("extract", 0, 0, 1, 0, "extract", "Dwelling extract", SEMI_RIGID_90)],
    note: "Generic DN90 connection fixture; not a TVA or Luna geometry claim.",
  }),
  componentRecord({
    id: "generic-supply-epp-inline-fitting-160",
    versionId: "generic-supply-epp-inline-fitting-160.v1",
    group: "Fittings",
    category: "inline-fitting",
    manufacturer: null,
    productId: null,
    name: "Generic supply EPP inline fitting",
    status: "synthetic-not-manufacturer-verified",
    source: GENERIC_FIXTURE_SOURCE,
    dimensions: dimensions(320, 200, null, "generic drawing fixture only"),
    symbol: { shape: "box", widthMm: 320, heightMm: 200 },
    ports: [
      port("a", -160, 0, -1, 0, "supply", "Dwelling supply", EPP_160),
      port("b", 160, 0, 1, 0, "supply", "Dwelling supply", EPP_160),
    ],
    note: "Generic connectivity fixture; it is not a branded sleeve, elbow or adapter.",
  }),
  componentRecord({
    id: "generic-extract-epp-inline-fitting-160",
    versionId: "generic-extract-epp-inline-fitting-160.v1",
    group: "Fittings",
    category: "inline-fitting",
    manufacturer: null,
    productId: null,
    name: "Generic extract EPP inline fitting",
    status: "synthetic-not-manufacturer-verified",
    source: GENERIC_FIXTURE_SOURCE,
    dimensions: dimensions(320, 200, null, "generic drawing fixture only"),
    symbol: { shape: "box", widthMm: 320, heightMm: 200 },
    ports: [
      port("a", -160, 0, -1, 0, "extract", "Dwelling extract", EPP_160),
      port("b", 160, 0, 1, 0, "extract", "Dwelling extract", EPP_160),
    ],
    note: "Generic connectivity fixture; it is not a branded sleeve, elbow or adapter.",
  }),
]);

export const CATALOGUE_CANDIDATES = deepFreeze([
  q600Candidate("zehnder-q600-hrv-candidate", "ZEN-Q600HRV", "ComfoAir Q600 TR - sensible (Pre-order required)", "Price List!A6:C6"),
  q600Candidate("zehnder-q600-erv-candidate", "ZEN-Q600ERV", "ComfoAir Q600 TR - enthalpy (Pre-order required)", "Price List!A7:C7"),
  candidate("aerofresh-300-hrv", "Units", "Aerofresh", "AER-300HRV", "Aerofresh 300 HRV c/w controller", "Price List!A177:C177"),
  candidate("aerofresh-300-erv", "Units", "Aerofresh", "AER-300ERV", "Aerofresh 300 HRV c/w controller", "Price List!A179:C179"),
  candidate("aerofresh-450-hrv", "Units", "Aerofresh", "AER-450HRV", "Aerofresh 450 HRV c/w controller", "Price List!A178:C178"),
  candidate("aerofresh-450-erv", "Units", "Aerofresh", "AER-450ERV", "Aerofresh 450 HRV c/w controller", "Price List!A180:C180"),
  comfoWell320Candidate("comfowell-cwk-320-q350-q450", "ZEN-MSCW-320", "Mounting set CW-K 320 Q350/450", "Price List!A107:C107", {
    manufacturerItem: "CW-K 320 – ComfoAir Q350/450 TR",
    manufacturerArticleCandidate: "990323644",
    setout: {
      assemblyPlateWidthMm: 336,
      assemblyLengthMm: 511,
      individualPlateLengthMm: 230,
      maximumBracketProjectionMm: 227,
      spigotProjectionMm: 57,
      roundConnectionCount: 2,
      nominalConnectionDiameterMm: 160,
      portCentreFromLeftEdgeMm: 213,
      portCentreFromNearestEndMm: 115,
      portCentreSpacingAlongAssemblyMm: 281,
    },
    candidateSummary: "CW-K320 setout · 2 × nominal 160 · exact article/variant crosswalk pending",
    note: "The mounting-set dimensions and two nominal 160 mm connections are source-backed. The local code omits TR/ST variant detail, so exact article identity and mating compatibility remain unverified.",
  }),
  comfoWell320Candidate("comfowell-cws-320", "ZEN-ACWS-320", "Attenuator CW-S 320", "Price List!A108:C108", {
    manufacturerItem: "CW-S 320",
    manufacturerArticleCandidate: "990323501",
    setout: {
      lengthMm: 500,
      widthMm: 320,
      depthMm: 230,
      depthIncludingMountingLugsMm: 350,
      interfaceType: "rectangular-comfowell-module",
    },
    candidateSummary: "500 × 320 × 230 mm · rectangular module interfaces · end plates required",
    note: "Source-backed body dimensions only. Round ports require separate end plates; local SKU crosswalk, mating profile, acoustic duty and service clearance remain unverified.",
  }),
  comfoWell320Candidate("comfowell-cwm-320-6x90", "ZEN-MPCWM-320-6X90", "Mounting plate CW-M 320 - 6 x 90", "Price List!A109:C109", {
    manufacturerItem: "CW-M 320 – 6 × 90",
    manufacturerArticleCandidate: "990323613",
    setout: {
      widthMm: 336,
      heightMm: 230,
      projectionMm: 41,
      branchCount: 6,
      branchDrawingDiameterMm: 90,
      branchLayout: { rows: 2, columns: 3, horizontalPitchMm: 102.5, verticalPitchMm: 102.5 },
      edgeToFirstBranchCentreMm: null,
    },
    candidateSummary: "336 × 230 mm · 6 × drawn Ø90 · absolute branch coordinates pending",
    note: "The six-branch layout and 102.5 mm pitches are source-backed. Edge offsets are not dimensioned, so absolute branch coordinates and the meaning of drawn Ø90 are not inferred.",
  }),
  comfoWell320Candidate("comfowell-cwp-320-dn160", "ZEN-MP320-160", "End plate CW-P 320 - DN 160", "Price List!A114:C114", {
    manufacturerItem: "CW-P 320 – DN160",
    manufacturerArticleCandidate: "990323512",
    setout: {
      widthMm: 336,
      heightMm: 230,
      projectionMm: 51,
      roundConnectionCount: 1,
      nominalConnectionDiameterMm: 160,
      exactPortCentre: null,
    },
    candidateSummary: "336 × 230 mm · 1 × nominal DN160 · exact port centre pending",
    note: "The plate envelope and one nominal DN160 connection are source-backed. Exact port coordinates, mating profile, local SKU crosswalk and adapter requirements remain unverified.",
  }),
  ...currentUkDistributionCandidates("zehnder-uk-comfowell-320-rapidlock-2026-v1"),
  ...currentUkDistributionCandidates("zehnder-uk-comfowell-420-rapidlock-2026-v1"),
  candidate("comfowell-cws-520", "Attenuation & distribution", "Zehnder", "ZEN-ACWS-520", "Attenuator CW-S 520", "Price List!A120:C120"),
  candidate("comfowell-cwm-520-10x90", "Attenuation & distribution", "Zehnder", "ZEN-MPCWM-520-10X90", "Mounting plate CW-M 520 - 10 x 90", "Price List!A121:C121"),
  candidate("comfowell-cwp-520-dn160", "Attenuation & distribution", "Zehnder", "ZEN-MP520-160", "End plate CW-P 520 - DN 160", "Price List!A123:C123"),
  candidate("tva-housing-90-300", "Terminals", "Zehnder", "ZEN-H-TVA90-300", "Grille housing TVA-P 90 x 300 mm", "Price List!A142:C142"),
  comfoTubeFlow90Candidate(),
  candidate("semi-rigid-pe-dn90-50m", "Ducts", null, "DUCT90-50M-SRIG", "White 90 mm semi-rigid PE duct x 50 m", "Price List!A100:C100"),
  candidate("supaflo-epp-dn125-straight", "Ducts & fittings", "Aerofresh", "AER-DUC-DN125-1MSL", "Supaflo DN125 rigid EPP duct x 1 m", "Price List!A208:C208"),
  candidate("supaflo-epp-dn125-elbow", "Ducts & fittings", "Aerofresh", "AER-DUC-DN125-B90", "Supaflo DN125 rigid EPP 90 degree elbow", "Price List!A209:C209"),
  candidate("supaflo-epp-dn125-sleeve", "Ducts & fittings", "Aerofresh", "AER-DUC-DN125-SL", "Supaflo DN125 rigid EPP duct sleeve", "Price List!A210:C210"),
  candidate("supaflo-epp-dn160-straight", "Ducts & fittings", "Aerofresh", "AER-DUC-DN160-1MSL", "Supaflo DN160 rigid EPP duct x 1 m", "Price List!A211:C211"),
  candidate("supaflo-epp-dn160-elbow", "Ducts & fittings", "Aerofresh", "AER-DUC-DN160-B90", "Supaflo DN160 rigid EPP 90 degree elbow", "Price List!A212:C212"),
  candidate("supaflo-epp-dn160-sleeve", "Ducts & fittings", "Aerofresh", "AER-DUC-DN160-SL", "Supaflo DN160 rigid EPP duct sleeve", "Price List!A213:C213"),
  candidate("flexible-duct-dn150-6m", "Ducts", null, "DUCT150-6M", "150 mm flexible duct x 6 m", "Price List!A188:C188"),
]);

export const DUCT_ROUTE_FAMILIES = deepFreeze([
  routeFamily("semi-rigid-radial", "Semi-rigid radial DN90", "semi-rigid-pe", 90, "Generic test route; no pressure loss or product fit claimed."),
  routeFamily("epp-rigid-dn125", "Rigid EPP DN125", "rigid-epp", 125, "Generic test route; suited to the Aerofresh 300 nominal-size rule only after exact interfaces are verified."),
  routeFamily("epp-rigid-dn160", "Rigid EPP DN160", "rigid-epp", 160, "Drawing route only; nominal circular DN160 alignment may be drawn, while exact mating profiles, adapters and installation compatibility remain unverified.", true, {
    drawingConnectionClass: "circular-dn160",
    connectionScope: "drawing-only",
    installationCompatibilityStatus: "unverified",
  }),
  routeFamily("flexible-round-dn150", "Flexible round DN150", "flexible-round", 150, "Generic test route; no installed length, bend or pressure-loss method is claimed."),
  routeFamily("generic-duct", "Legacy generic duct", null, null, "Compatibility-free legacy schematic route.", false),
]);

export const TYPICAL_SYSTEM_GUIDANCE = deepFreeze({
  attenuatorCount: 2,
  meaning: "informational-typical-only",
  automaticPlacement: false,
  automaticQuantity: false,
  note: "A typical system may use two attenuators, but each item must be selected and placed explicitly.",
});

export const UNIT_ATTENUATOR_MOUNTING_POLICIES = deepFreeze({
  "aerofresh-300": mountingPolicy(125, ["remote-via-epp"], "user-rule-2026-10-19", "Direct/unit-mounted ComfoWell is prohibited."),
  "aerofresh-450": mountingPolicy(160, ["direct-unit-mounted", "remote-via-epp"], "user-rule-2026-10-19", "Direct mounting still requires verified CW variant, adapter, support and port evidence."),
  "zehnder-q350": mountingPolicy(160, ["direct-unit-mounted", "remote-via-epp"], "user-size-rule-and-supplied-setout", "The supplied PDF shows combined Q350/450 with CW layouts; exact SKU mating and stream semantics remain to be verified."),
  "zehnder-q450": mountingPolicy(160, ["direct-unit-mounted", "remote-via-epp"], "user-size-rule-and-supplied-setout", "The supplied PDF shows combined Q350/450 with CW layouts; exact SKU mating and stream semantics remain to be verified."),
});

export function findCatalogueItem(id) {
  const item = COMPONENT_CATALOGUE.find((candidateItem) => candidateItem.id === id)
    ?? CATALOGUE_CANDIDATES.find((candidateItem) => candidateItem.id === id);
  if (!item) throw new TypeError(`Catalogue item not found: ${String(id)}`);
  return item;
}

export function createCatalogueComponent(catalogueItemId, placement) {
  const item = findCatalogueItem(catalogueItemId);
  if (!item.placeable) {
    throw new TypeError(`Catalogue item requires geometry and port evidence before placement: ${item.productId ?? item.id}`);
  }
  if (item.assemblyOnly && placement?.allowAssemblyOnly !== true) {
    throw new TypeError(`Catalogue item can only be placed through its equipment assembly: ${item.id}`);
  }
  requireId(placement?.id, "Component ID");
  requireId(placement?.floorId, "Component floor ID");
  const x = requireFinite(placement?.xMm, "Component placement x");
  const y = requireFinite(placement?.yMm, "Component placement y");
  const snapshot = {
    catalogueId: CATALOGUE_ID,
    catalogueVersion: CATALOGUE_VERSION,
    recordId: item.id,
    recordVersionId: item.versionId,
    productId: item.productId,
    manufacturer: item.manufacturer,
    manufacturerArticle: item.manufacturerArticle ?? null,
    manufacturerArticleCandidate: item.manufacturerArticleCandidate ?? null,
    localSkuCrosswalkStatus: item.localSkuCrosswalkStatus ?? null,
    handing: item.handing ?? null,
    displayName: item.name,
    status: item.status,
    source: item.source,
    dimensions: item.dimensions,
    symbol: item.symbol,
    ports: item.ports,
    connectionSetout: item.connectionSetout ?? null,
    manufacturerGeometryAsset: item.manufacturerGeometryAsset ?? null,
    ...(item.terminalSpecification ? { terminalSpecification: item.terminalSpecification } : {}),
    ...(item.decentralisedSpecification ? { decentralisedSpecification: item.decentralisedSpecification } : {}),
  };
  return {
    id: placement.id,
    floorId: placement.floorId,
    catalogueItemId: item.id,
    catalogueRecordVersionId: item.versionId,
    catalogueStatus: item.status,
    catalogueSnapshot: structuredClone(snapshot),
    productId: item.productId,
    manufacturer: item.manufacturer,
    displayName: item.name,
    displaySymbol: structuredClone(item.symbol),
    ductRunCount: null,
    positionMm: {
      x,
      y,
      z: unknownMm("component installation height not set"),
    },
    orientation: identityQuaternion(),
    ports: item.ports.map((definition) => ({
      id: `${placement.id}-port-${definition.key}`,
      definitionId: `${item.id}-${item.versionId}-port-${definition.key}`,
      positionMm: structuredClone(definition.positionMm),
      direction: structuredClone(definition.direction),
      system: definition.system,
      stream: definition.stream,
      role: definition.role,
      interface: structuredClone(definition.interface),
      ...(definition.coordinateEvidence ? { coordinateEvidence: definition.coordinateEvidence } : {}),
      ...(definition.drawingEntries ? {drawingEntries:structuredClone(definition.drawingEntries),drawingEntryId:definition.drawingEntryId,drawingConnectionVersion:definition.drawingConnectionVersion} : {}),
      evidence: item.status === "synthetic-not-manufacturer-verified"
        ? "generic test fixture only"
        : "catalogue record snapshot",
    })),
    ...(item.decentralisedSpecification ? {
      decentralisedMvhr: {
        systemKind: item.decentralisedSpecification.systemKind,
        operatingMode: item.decentralisedSpecification.operatingMode,
        controllerReferenceRequired: item.decentralisedSpecification.controller.referenceRequired,
        pairGroupId: null,
        controllerReference: null,
        roomId: null,
        zoneId: null,
      },
    } : {}),
  };
}

export function deriveVentilationConnectionDemand(project) {
  const demand = {
    supply: { outletCount: 0, knownRunCount: 0, outletsMissingRunCount: 0 },
    extract: { outletCount: 0, knownRunCount: 0, outletsMissingRunCount: 0 },
  };
  for (const component of project?.components ?? []) {
    const terminalPorts = (component.ports ?? []).filter((port) => (
      port.system === "mvhr" && (port.stream === "supply" || port.stream === "extract")
    ));
    if (terminalPorts.length !== 1) continue;
    const side = demand[terminalPorts[0].stream];
    side.outletCount += 1;
    if (Number.isSafeInteger(component.ductRunCount) && component.ductRunCount > 0) {
      side.knownRunCount += component.ductRunCount;
    } else {
      side.outletsMissingRunCount += 1;
    }
  }
  return deepFreeze({
    ...demand,
    cwSuggestion: {
      status: "evidence-pending",
      recommendations: [],
      note: "Demand is counted independently, but no CW size or endplate is suggested until verified port capacity, diameter, adapter and unit compatibility evidence is available.",
    },
  });
}

export function validateAttenuatorMountingChoice(unitFamilyId, mode) {
  const policy = UNIT_ATTENUATOR_MOUNTING_POLICIES[unitFamilyId];
  if (!policy) throw new TypeError(`No approved mounting policy for unit family: ${String(unitFamilyId)}`);
  if (mode !== "direct-unit-mounted" && mode !== "remote-via-epp") {
    throw new TypeError(`Unsupported attenuator mounting mode: ${String(mode)}`);
  }
  const allowed = policy.allowedModes.includes(mode);
  return {
    allowed,
    unitFamilyId,
    mode,
    nominalEppSizeMm: policy.nominalEppSizeMm,
    sizeMeaning: "nominal-only-not-bore-od-or-mating-profile",
    evidence: policy.evidence,
    requiresVerifiedMatingSupportAndClearance: allowed,
    reason: allowed ? policy.note : `${mode} is not allowed for ${unitFamilyId}. ${policy.note}`,
  };
}

export function routeFamilyForKind(id) {
  const family = DUCT_ROUTE_FAMILIES.find((candidateFamily) => candidateFamily.id === id);
  if (!family) throw new TypeError(`Unsupported route duct kind: ${String(id)}`);
  return family;
}

function qSetoutRecord(id, productId, name, identifierLocator) {
  return componentRecord({
    id,
    versionId: `${id}.v2`,
    group: "Units",
    category: "mvhr-unit",
    manufacturer: "Zehnder",
    productId,
    name,
    status: "verified-dimensional-setout-routable-ports-pending",
    source: {
      identifier: { ...INTERNAL_IDENTIFIER_SOURCE, locator: identifierLocator },
      geometry: Q_SET_OUT_SOURCE,
    },
    dimensions: {
      unit: "mm",
      body: { width: 725, depth: 570, height: 745 },
      drawingEnvelope: { width: 725, depth: 570 },
      overallHeightWithTopConnections: 849.7,
      evidenceStatus: "verified-from-supplied-setout-page-1",
      note: "Body and overall height are distinct. Four connections are shown as DN160 internal / DN190 external.",
    },
    symbol: { shape: "box", widthMm: 725, heightMm: 570 },
    ports: [],
    connectionSetout: {
      connectionCount: 4,
      nominalInternalDiameterMm: 160,
      externalDiameterMm: 190,
      connectorOrientation: "rotating-top-or-side-configuration-dependent",
      frontToRearRowCentreSpacingMm: 280.5,
      rearRowCentreOffsetFromBackMm: 123,
      coordinateOriginStatus: "unverified",
      localPortCoordinatesStatus: "unverified",
      roleMapStatus: "unresolved-by-handedness",
      routable: false,
      note: "The supplied page shows left/right variants but does not safely establish a typed local role map for this catalogue record.",
    },
    note: "Placeable dimensioned setout only; routing remains blocked until port roles and handing are verified.",
  });
}

function q350DrawingProfileRecord(id, productId, name, identifierLocator, manufacturerArticle, handing) {
  const isLeft = handing === "left";
  const portDefinitions = isLeft
    ? [
      ["left-rear", -290, -162, -1, 0, "extract", "Dwelling extract"],
      ["left-front", -290, 118.5, -1, 0, "supply", "Dwelling supply"],
      ["right-rear", 290, -162, 1, 0, "exhaust", "Outdoor exhaust"],
      ["right-front", 290, 118.5, 1, 0, "intake", "Outdoor intake"],
    ]
    : [
      ["left-rear", -290, -162, -1, 0, "intake", "Outdoor intake"],
      ["left-front", -290, 118.5, -1, 0, "exhaust", "Outdoor exhaust"],
      ["right-rear", 290, -162, 1, 0, "supply", "Dwelling supply"],
      ["right-front", 290, 118.5, 1, 0, "extract", "Dwelling extract"],
    ];
  return componentRecord({
    id,
    versionId: `${id}.v1`,
    group: "Units",
    category: "mvhr-unit-drawing-profile",
    manufacturer: "Zehnder",
    productId,
    name: `${name} · supply/extract ${handing}`,
    status: "source-backed-drawing-profile-installation-review-required",
    source: {
      identifier: { ...INTERNAL_IDENTIFIER_SOURCE, locator: identifierLocator },
      geometry: Q_SET_OUT_SOURCE,
      manufacturerTechnical: Q350_TECHNICAL_SOURCE,
    },
    manufacturerArticleCandidate: manufacturerArticle,
    localSkuCrosswalkStatus: "unverified",
    handing: `supply-and-extract-air-to-${handing}`,
    dimensions: {
      unit: "mm",
      body: { width: 725, depth: 570, height: 745 },
      drawingEnvelope: { width: 725, depth: 570 },
      overallHeightWithTopConnections: 849.7,
      evidenceStatus: "manufacturer-dimensioned-drawing-profile",
      note: "The plan symbol uses the 725 × 570 mm body envelope. Height and top/side connector configuration remain separate installation properties.",
    },
    symbol: { shape: "box", widthMm: 725, heightMm: 570 },
    ports: portDefinitions.map(([key, x, y, directionX, directionY, stream, role]) => (
      port(key, x, y, directionX, directionY, stream, role, Q350_TR_DN160)
    )),
    connectionSetout: {
      connectionCount: 4,
      nominalInternalDiameterMm: 160,
      externalDiameterMm: 190,
      connectorOrientation: "rotating-top-or-side-configuration-dependent",
      horizontalPortCentreSpacingMm: 580,
      frontToRearRowCentreSpacingMm: 280.5,
      rearRowCentreOffsetFromBackMm: 123,
      coordinateOrigin: "centre-of-725-by-570-plan-body-envelope",
      coordinateAxes: "+x right; +y front in the plan symbol",
      localPortCoordinatesStatus: "derived-exactly-from-dimensioned-centres",
      roleMapStatus: "manufacturer-diagram-for-selected-handed-profile",
      routable: true,
      connectionScope: "drawing-only",
      installationCompatibilityStatus: "unverified",
      note: "Port centres and roles support explicit drawing topology. Matching nominal DN160 does not approve a physical joint, adapter, seal, support or installation arrangement.",
    },
    note: "Placeable handed drawing profile. The manufacturer article is source-backed, but its crosswalk to the local catalogue code and all physical installation compatibility remain unverified.",
  });
}

function qDeBimProfileRecord(size, type, handing) {
  const isLeft = handing === "left";
  const sensible = type === "hrv";
  const manufacturerArticle = size === "350"
    ? sensible ? "471502009" : "471502010"
    : sensible ? "471502011" : "471502012";
  const assetId = `q${size}-de-${type}-${handing}`;
  const connector = size === "350" ? Q350_TR_DN160 : Q450_DE_BIM_CONNECTION;
  const portDefinitions = isLeft
    ? [
      ["left-rear", -290, -162, -1, 0, "extract", "Dwelling extract"],
      ["left-front", -290, 118.5, -1, 0, "supply", "Dwelling supply"],
      ["right-rear", 290, -162, 1, 0, "exhaust", "Outdoor exhaust"],
      ["right-front", 290, 118.5, 1, 0, "intake", "Outdoor intake"],
    ]
    : [
      ["left-rear", -290, -162, -1, 0, "intake", "Outdoor intake"],
      ["left-front", -290, 118.5, -1, 0, "exhaust", "Outdoor exhaust"],
      ["right-rear", 290, -162, 1, 0, "supply", "Dwelling supply"],
      ["right-front", 290, 118.5, 1, 0, "extract", "Dwelling extract"],
    ];
  const ports = portDefinitions.map(([key, x, y, directionX, directionY, stream, role]) => {
    const value = port(key, x, y, directionX, directionY, stream, role, connector);
    value.positionMm.z = size === "350" ? 850 : 850.049;
    value.coordinateEvidence = "IFC4 distribution-port placement registered to the 725 x 570 mm body centre; plan approach direction remains a drawing convention because TR connectors rotate";
    return value;
  });
  return componentRecord({
    id: `zehnder-q${size}-de-${type}-${handing}-bim-profile`,
    versionId: `zehnder-q${size}-de-${type}-${handing}-bim-profile.v1`,
    group: "Units",
    category: "mvhr-unit-bim-profile",
    manufacturer: "Zehnder",
    productId: null,
    manufacturerArticle,
    name: `ComfoAir Q${size} TR DE · ${sensible ? "sensible" : "enthalpy"} · ${handing}`,
    status: "source-backed-exact-german-bim-profile-local-crosswalk-unverified",
    source: {
      bim: Q_DE_BIM_SOURCE,
      manufacturerCataloguePage: {
        url: `https://www.mepcontent.com/en/bim-files/detail/${size === "350" ? "27574/comfoair-q350" : "27575/comfoair-q450"}/?ccc=DE&clc=WW`,
        verificationStatus: "German-market-variant-selection",
      },
    },
    localSkuCrosswalkStatus: "not-assigned-exact-german-article-only",
    handing: `manufacturer-${handing}`,
    dimensions: {
      unit: "mm",
      body: { width: 725, depth: 570, height: 850 },
      drawingEnvelope: { width: 725, depth: 570 },
      geometryBounds: { width: 800, depth: 581, height: 850.049 },
      evidenceStatus: "manufacturer-IFC4-declared-envelope-and-reviewed-tessellated-solid",
      note: "The 850 mm IFC height includes the configured rotating-connector geometry. The 800 x 581 mm mesh bounds include protrusions beyond the 725 x 570 mm body.",
    },
    symbol: { shape: "box", widthMm: 725, heightMm: 570 },
    ports,
    manufacturerGeometryAsset: {
      assetId,
      manufacturerArticle,
      identityScope: "exact-German-article-and-handed-type",
      persistedAssetReferenceOnly: true,
    },
    connectionSetout: {
      connectionCount: 4,
      nominalInternalDiameterMm: connector.nominalSizeMm,
      externalDiameterMm: connector.outsideDiameterMm,
      connectorOrientation: "configured-rotating-TR-geometry-in-reviewed-IFC4",
      horizontalPortCentreSpacingMm: 580,
      frontToRearRowCentreSpacingMm: 280.5,
      rearRowCentreOffsetFromBackMm: 123,
      coordinateOrigin: "centre-of-725-by-570-body-envelope",
      coordinateAxes: "+x right; +y front; +z above unit base",
      localPortCoordinatesStatus: "IFC4-distribution-port-placement-checked-against-dimensioned-setout",
      roleMapStatus: "reviewed-IFC-flow-direction-and-manufacturer-handed-type",
      routable: size === "350",
      connectionScope: "drawing-only",
      installationCompatibilityStatus: size === "350" ? "unverified" : "source-property-conflict-review-required",
      note: size === "350"
        ? "IFC distribution-port centres agree with the existing dimensioned Q350 setout. TR connector rotation and physical mating remain installation decisions."
        : "The Q450 IFC contains conflicting connector metadata: Diameter 1 = 180 mm and the reviewed mesh has a 200 mm outside envelope, while other copied properties still say 160|190. DN180/200 is retained for this exact BIM record and no DN160 adapter or local equivalence is inferred.",
    },
    note: "Exact German BIM identity with reviewed solid and connector placements. It is separate from export/local catalogue records and carries no performance or CW compatibility claim.",
  });
}

function comfoWell320Candidate(id, productId, name, locator, evidence) {
  const articleEvidence = COMFOWELL_320_ARTICLE_EVIDENCE.find((item) => item.localProductId === productId);
  if (!articleEvidence || articleEvidence.manufacturerArticle !== evidence.manufacturerArticleCandidate) {
    throw new TypeError(`ComfoWell article evidence is inconsistent for ${productId}`);
  }
  return {
    id,
    versionId: `${id}.evidence.v1`,
    group: "Attenuation & distribution",
    category: "source-backed-candidate",
    manufacturer: "Zehnder",
    productId,
    name,
    placeable: false,
    status: "source-backed-dimensional-candidate-interface-pending",
    source: {
      identifier: { ...INTERNAL_IDENTIFIER_SOURCE, locator },
      research: Q350_CW320_RESEARCH_SOURCE,
      manufacturerTechnical: COMFOWELL_320_TECHNICAL_SOURCE,
    },
    dimensions: {
      unit: "mm",
      body: null,
      evidenceStatus: "named-setout-dimensions-only-not-placeable-geometry",
      setout: evidence.setout,
    },
    manufacturerItem: evidence.manufacturerItem,
    manufacturerArticleCandidate: evidence.manufacturerArticleCandidate,
    manufacturerArticle: articleEvidence.manufacturerArticle,
    manufacturerIdentityStatus: articleEvidence.manufacturerIdentityStatus,
    localSkuCrosswalkStatus: articleEvidence.localSkuCrosswalkStatus,
    australianAvailabilityStatus: articleEvidence.australianAvailabilityStatus,
    installationCompatibilityStatus: articleEvidence.installationCompatibilityStatus,
    officialFunctionClaim: articleEvidence.officialClaim,
    symbol: null,
    ports: [],
    commercial: { pricing: PRIVATE_PRICING },
    performance: UNKNOWN_PERFORMANCE,
    candidateSummary: evidence.candidateSummary,
    note: evidence.note,
  };
}

function currentUkDistributionCandidates(profileId) {
  const profile = DISTRIBUTION_BOX_PROFILES.find((candidateProfile) => candidateProfile.id === profileId);
  if (!profile) throw new TypeError(`Distribution-box profile not found: ${profileId}`);
  const design = inspectDistributionBoxDesign(profile.id);
  return ["attenuator", "manifold", "mountingPlate90", "endPlate160"].map((componentKey) => {
    const component = profile.components[componentKey];
    const branch = component.branchConnections ?? null;
    const main = component.mainConnection ?? null;
    const connectionSummary = branch
      ? `${branch.count} × RapidLock nominal ${branch.nominalDuctDiameterMm}`
      : main
        ? `centred DN${main.nominalDiameterMm}`
        : "ComfoWell clamping-strip module interfaces";
    return {
      id: `${profile.id}-${componentKey}`,
      versionId: `${profile.id}-${componentKey}.evidence.v1`,
      group: "Attenuation & distribution",
      category: "source-backed-distribution-candidate",
      manufacturer: "Zehnder",
      productId: component.manufacturerArticle,
      name: `${component.name} · current UK evidence`,
      placeable: false,
      status: "source-backed-distribution-design-incomplete",
      source: profile.source,
      dimensions: {
        unit: "mm",
        body: null,
        manufacturerEnvelope: component.manufacturerEnvelopeMm,
        installedPlanFootprint: null,
        evidenceStatus: "manufacturer-envelope-not-installed-plan-footprint",
      },
      manufacturerArticle: component.manufacturerArticle,
      localSkuCrosswalkStatus: "not-assigned-current-uk-evidence-only",
      australianAvailabilityStatus: "unverified-distinct-market-generation",
      installationCompatibilityStatus: "review-required",
      distributionDesign: {
        profileId: profile.id,
        componentKey,
        sourceRevision: profile.source.revision,
        connectionSummary,
        componentEvidence: component,
        connectionSequence: design.connectionSequence,
        installedPlanFootprint: design.installedPlanFootprint,
        blockers: design.blockers,
        routeReady: false,
      },
      symbol: null,
      ports: [],
      commercial: { pricing: PRIVATE_PRICING },
      performance: UNKNOWN_PERFORMANCE,
      candidateSummary: `${profile.source.revision} · H/W/D ${component.manufacturerEnvelopeMm.height}/${component.manufacturerEnvelopeMm.width}/${component.manufacturerEnvelopeMm.depth} mm · ${connectionSummary} · plan setout pending`,
      note: "Current UK manufacturer evidence is kept separate from the Australian/local-code candidates and synthetic generic assembly. It is not placeable until installed orientation, complete footprint and routable port coordinates are approved.",
    };
  });
}

function aerofresh450Record(type, handing) {
  const definitions = handing === "left"
    ? [["outdoor-intake",-164,-117,-1,"intake","Outdoor intake"],["outdoor-exhaust",-229,144,-1,"exhaust","Outdoor exhaust"],["dwelling-supply",229,-144,1,"supply","Dwelling supply"],["dwelling-extract",164,117,1,"extract","Dwelling extract"]]
    : [["dwelling-extract",-164,-117,-1,"extract","Dwelling extract"],["dwelling-supply",-229,144,-1,"supply","Dwelling supply"],["outdoor-exhaust",229,-144,1,"exhaust","Outdoor exhaust"],["outdoor-intake",164,117,1,"intake","Outdoor intake"]];
  const drawingInterface = interfaceDefinition("rigid-epp", 160, "owner-confirmed-160mm-epp-fit", { drawingConnectionClass: "circular-dn160", installationCompatibilityStatus: "owner-confirmed", reducerInferred: false });
  return componentRecord({
    id: `aerofresh-450-${type}-${handing}-drawing-profile`, versionId: `aerofresh-450-${type}-${handing}.drawing.v3`,
    group: "Units", category: "mvhr-unit-drawing-profile", manufacturer: "Aerofresh",
    productId: type === "hrv" ? "AER-450HRV" : "AER-450ERV", name: `Aerofresh 450 ${type.toUpperCase()} · manufacturer ${handing}`,
    status: "source-backed-owner-drawing-profile-installation-review-required",
    source: { identifier: { ...INTERNAL_IDENTIFIER_SOURCE, locator: type === "hrv" ? "Price List!A178,C178" : "Price List!A180,C180" },
      manual: { sourceId: AEROFRESH_MANUAL_EVIDENCE["450"].sourceId, title: "Aerofresh 450/600 installation manual", pages: [4,5,43], verificationStatus: "visually-reviewed-body-dimensions-and-port-offsets" },
      brochure: { sourceId: "aerofresh-hrv-range-brochure-2025", page: 14, verificationStatus: "visually-reviewed-depth-and-native-spigot-diameter" },
      drawing: { sourceId: "owner-aerofresh-450-CW520-drawing-2026-10-23", sourceKind: "owner-supplied-dimensional-drawing", verificationStatus: "overall-envelope-and-owner-confirmed-handed-role-convention" } },
    dimensions: { unit: "mm", body: { ...AEROFRESH_MANUAL_EVIDENCE["450"].body }, spigotProtrusionMm: 50, nativeNominalSpigotDiameterMm: 200, service: { ...AEROFRESH_MANUAL_EVIDENCE["450"].service }, mountedCw520Envelope: { width: 870, depth: 650, height: 1400 }, drainAllowanceBelowMm: 150, evidenceStatus: "manual-and-2025-brochure-body-dimensions", note: "Body and complete CW assembly envelopes are distinct. Native spigots are 200 mm in the 2025 brochure; the owner confirms the unit spigots suit 160 mm EPP; no reducers are inferred. Service-boundary dimensions include body depth and are not extra front clearances." },
    symbol: { shape: "box", widthMm: 728, heightMm: 608 },
    handing: `manufacturer-${handing}`,
    ports: definitions.map(([key,x,y,direction,stream,role]) => port(key,x,y,direction,0,stream,role,drawingInterface)),
    connectionSetout: { routable: true, connectionScope: "drawing-only", localPortCoordinatesStatus: "manual-page-43-dimensioned-offsets", roleMapStatus: "manufacturer-manual-page-4", orientationConvention: "manufacturer", installationCompatibilityStatus: "owner-confirmed-160mm-epp-fit" },
    note: "Manufacturer Left/Right roles and manual dimensioned port centres apply to new placements. Owner confirms 160 mm EPP fits the unit spigots; no reducer is added. Manual 393 mm pitch differs by 1 mm from brochure. Existing snapshots remain unchanged.",
  });
}

function zehnderSingleGrilleRecord(size,service) {
  const evidence=EXTERNAL_GRILLE_EVIDENCE.single.variants[size];
  return componentRecord({
    id:`zehnder-external-grille-${service}-dn${size}`,versionId:`zehnder-external-grille-${service}-dn${size}.v1`,
    group:"Terminals",category:"external-grille",manufacturer:"Zehnder",productId:null,manufacturerArticle:evidence.manufacturerArticle,
    name:`Zehnder external ${service} grille · DN${size}`,status:"source-backed-external-grille-profile",
    source:{sourceId:EXTERNAL_GRILLE_EVIDENCE.single.sourceId,revision:EXTERNAL_GRILLE_EVIDENCE.single.revision,pages:[2,size===125?2:3],verificationStatus:"visually-reviewed-envelope-and-article"},
    dimensions:{unit:"mm",body:{width:evidence.widthMm,depth:evidence.overallDepthMm,height:evidence.heightMm},facadeFace:{widthMm:evidence.widthMm,heightMm:evidence.heightMm,frontOffsetMm:evidence.overallDepthMm/2},evidenceStatus:"manufacturer-envelope",note:"Overall depth includes the connector. Centred plan port projection is a drawing convention; exact fit remains unverified."},
    symbol:{shape:"box",widthMm:evidence.widthMm,heightMm:evidence.overallDepthMm},
    ports:[port(service,0,-evidence.overallDepthMm/2,0,-1,service,service==="intake"?"Outdoor intake":"Outdoor exhaust",interfaceDefinition("rigid-epp",size,"nominal-drawing-connection-only",{drawingConnectionClass:`circular-dn${size}`,installationCompatibilityStatus:"unverified"}))],
    note:"Manufacturer single grille envelope and article. Local SKU crosswalk, exact mating profile, wall placement and installation suitability remain unverified.",
  });
}

function externalGrilleRecord(size,service) {
  const combined=service === "combined";
  const matched=combined && size===160;
  const halfPitch=matched ? COMBINED_DN160_PORT_PITCH_MM/2 : 120;
  const outdoorInterface=interfaceDefinition("rigid-epp",size,"generic-external-grille-drawing",{drawingConnectionClass:`circular-dn${size}`,installationCompatibilityStatus:"unverified"});
  return componentRecord({
    id:`generic-external-grille-${service}-dn${size}`,versionId:`generic-external-grille-${service}-dn${size}.v${matched?2:1}`,
    group:"Terminals",category:"external-grille",manufacturer:null,productId:null,
    name:combined ? `Combined external grille · DN${size}` : `External ${service} grille · DN${size}`,
    status:"synthetic-not-manufacturer-verified",
    symbol:{shape:"box",widthMm:360,heightMm:combined?(matched?441:440):260,scaleMeaning:"schematic-only"},
    dimensions:{unit:"mm",body:null,evidenceStatus:"not-provided"},
    ports:(combined?["intake","exhaust"]:[service]).map((stream,index)=>port(stream,-180,combined?(index===0?-halfPitch:halfPitch):0,-1,0,stream,stream === "intake" ? "Outdoor intake" : "Outdoor exhaust",outdoorInterface)),
    ...(matched ? {connectionSetout:{portCentreSpacingMm:COMBINED_DN160_PORT_PITCH_MM,basis:"owner-matched-to-Q350-drawing-outlets",connectionScope:"drawing-only"}} : {}),
    note:"Generic exterior termination symbol. DN160 combined drawing spacing matches the Q350 at280.5mm centres. Combined grille has separate intake and exhaust ports. Dimensions, port spacing, manufacturer Left/Right mapping, weather protection, separation and installation fit require product selection. No route crossing implies a connection.",
  });
}

function lunaGrilleRecord(stream) {
  return componentRecord({
    id: `luna-${stream}`, versionId: `luna-${stream}.drawing.v2`,
    group: "Terminals", category: "terminal", manufacturer: "Zehnder",
    productId: stream === "supply" ? "ZEN-GR-LUNA" : "ZEN-GR-LUNA-EV",
    name: `Luna ${stream} grille`, status: "source-backed-terminal-drawing-connection",
    source: {
      identity: { ...INTERNAL_IDENTIFIER_SOURCE, locator: stream === "supply" ? "Price List!A137,C137" : "Price List!A138,C138" },
      symbol: { sourceId: "owner-luna-grille-symbol-2026-10-23", sourceKind: "owner-supplied-drawing-reference",
        verificationStatus: "owner-drawing-convention-only", title: "Luna supply and extract circle with five radial arrows" },
    },
    dimensions: { unit: "mm", body: null, evidenceStatus: "not-provided", note: "Schematic symbol size is not a physical grille diameter." },
    symbol: { shape: "luna-grille", widthMm: 300, heightMm: 300, stream, scaleMeaning: "schematic-only" },
    ports: [terminalDrawingPortDefinition({shape:"luna-grille",stream,widthMm:300,heightMm:300})],
    note: "Owner drawing convention: blue outward arrows for supply, red inward arrows for extract. Product identity is retained; housing dimensions, connector locations, airflow and pressure losses remain unknown.",
  });
}

function aerofreshGrilleRecord(stream) {
  const service = stream === "supply" ? "Supply" : "Extract";
  return componentRecord({
    id: `aerofresh-magnetic-wall-grille-${stream}`,
    versionId: `aerofresh-magnetic-wall-grille-${stream}.drawing.v2`,
    group: "Terminals", category: "terminal", manufacturer: "Aerofresh", productId: null,
    name: `Aerofresh ${service.toLowerCase()} box · magnetic cover`,
    status: "source-backed-terminal-drawing-connection",
    source: {
      identity: { ...INTERNAL_IDENTIFIER_SOURCE, locator: "Price List!A163:A166,C163:C166" },
      symbol: { sourceId: "owner-wall-bulkhead-grille-symbol-2026-10-23", sourceKind: "owner-supplied-drawing-reference",
        verificationStatus: "owner-drawing-convention-only", title: "Wall/bulkhead mounted supply and extract grille symbols" },
    },
    dimensions: { unit: "mm", body: null, evidenceStatus: "not-provided",
      note: "Symbol display size is schematic, not a product envelope or clearance." },
    symbol: { shape: "wall-grille", widthMm: 300, heightMm: 260, stream, scaleMeaning: "schematic-only" },
    terminalSpecification: {
      mounting: "wall-or-bulkhead", stream, selectionState: "housing-and-cover-unselected",
      housingOptions: [
        { productId: "AER-GR-RECT-BX90R", name: "Aerofresh Grille Housing Rear Entry", sourceLocator: "Price List!A163,C163" },
        { productId: "AER-GR-R-BX90E", name: "Aerofresh Grille Housing", sourceLocator: "Price List!A164,C164" },
      ],
      coverOptions: [
        { productId: "AER-GR-RECT-W", name: "Cool white magnetic cover", sourceLocator: "Price List!A165,C165" },
        { productId: "AER-GR-RECT-S", name: "Silver magnetic cover", sourceLocator: "Price List!A166,C166" },
      ],
    },
    ports: [terminalDrawingPortDefinition({shape:"wall-grille",stream,widthMm:300,heightMm:260})],
    note: `${service} wall/bulkhead drawing symbol for an Aerofresh housing and magnetic cover. Housing and cover remain unselected. Dimensions, typed connection locations, flow and losses are unknown.`,
  });
}

function componentRecord(value) {
  return {
    placeable: true,
    commercial: { pricing: PRIVATE_PRICING },
    performance: UNKNOWN_PERFORMANCE,
    ...value,
  };
}

function remoteAssemblyRecords(stream, role) {
  const label = stream === "supply" ? "Supply" : "Extract";
  return [
    componentRecord({
      id: `generic-${stream}-remote-round-end-plate`,
      versionId: `generic-${stream}-remote-round-end-plate.v3`,
      group: "Attenuation & distribution",
      category: "assembly-end-plate",
      assemblyOnly: true,
      manufacturer: null,
      productId: null,
      name: `${label} remote round end plate`,
      status: "synthetic-not-manufacturer-verified",
      source: {
        fixture: GENERIC_FIXTURE_SOURCE,
        dimensionalReference: COMFOWELL_320_TECHNICAL_SOURCE,
      },
      dimensions: dimensions(51, 336, null, "source-sized CW-P 320 envelope used by a generic fixture; exact port centre and mating remain unverified"),
      symbol: { shape: "box", widthMm: 51, heightMm: 336 },
      ports: [
        port("epp", -25.5, 0, -1, 0, stream, role, EPP_160),
        port("module", 25.5, 0, 1, 0, stream, role, GENERIC_CW_320),
      ],
      note: "Assembly-only generic end plate using the official CW-P 320 51 × 336 mm projection/envelope for drawing scale. Its centre, EPP mating and local SKU remain synthetic/unverified; it is not a CW-P product claim.",
    }),
    componentRecord({
      id: `generic-${stream}-remote-attenuator`,
      versionId: `generic-${stream}-remote-attenuator.v3`,
      group: "Attenuation & distribution",
      category: "assembly-attenuator",
      assemblyOnly: true,
      manufacturer: null,
      productId: null,
      name: `${label} remote attenuator`,
      status: "synthetic-not-manufacturer-verified",
      source: {
        fixture: GENERIC_FIXTURE_SOURCE,
        dimensionalReference: COMFOWELL_320_TECHNICAL_SOURCE,
      },
      dimensions: dimensions(500, 320, null, "source-sized CW-S 320 body envelope used by a generic fixture; acoustic selection and mating remain unverified"),
      symbol: { shape: "box", widthMm: 500, heightMm: 320 },
      ports: [
        port("in", -250, 0, -1, 0, stream, role, GENERIC_CW_320),
        port("out", 250, 0, 1, 0, stream, role, GENERIC_CW_320),
      ],
      note: "Assembly-only generic attenuator using the official CW-S 320 500 × 320 mm plan body for drawing scale. It is not a CW-S SKU, acoustic selection or verified mating claim.",
    }),
    componentRecord({
      id: `generic-${stream}-remote-radial-plate`,
      versionId: `generic-${stream}-remote-radial-plate.v3`,
      group: "Attenuation & distribution",
      category: "assembly-radial-plate",
      assemblyOnly: true,
      manufacturer: null,
      productId: null,
      name: `${label} remote radial plate`,
      status: "synthetic-not-manufacturer-verified",
      source: {
        fixture: GENERIC_FIXTURE_SOURCE,
        dimensionalReference: COMFOWELL_320_TECHNICAL_SOURCE,
      },
      dimensions: dimensions(41, 336, null, "source-sized CW-M 320 projection/envelope used by a generic fixture; absolute branch centres remain unverified"),
      symbol: { shape: "box", widthMm: 41, heightMm: 336 },
      ports: [
        port("module", -20.5, 0, -1, 0, stream, role, GENERIC_CW_320),
        ...radialPorts("branch", 20.5, stream, role),
      ],
      note: "Assembly-only generic six-port plate using the official CW-M 320 41 × 336 mm projection/envelope for drawing scale. Branch centres stay synthetic because absolute offsets and installation orientation remain unresolved; it is not a CW-M product or capacity claim.",
    }),
  ];
}

function candidate(id, group, manufacturer, productId, name, locator) {
  return {
    id,
    versionId: `${id}.identifier.v1`,
    group,
    category: "source-backed-candidate",
    manufacturer,
    productId,
    name,
    placeable: false,
    status: "identifier-only-evidence-required",
    source: { ...INTERNAL_IDENTIFIER_SOURCE, locator },
    dimensions: { unit: "mm", body: null, evidenceStatus: "not-provided" },
    symbol: null,
    ports: [],
    commercial: { pricing: PRIVATE_PRICING },
    performance: UNKNOWN_PERFORMANCE,
    note: "Identifier and description are source-backed; geometry, typed ports, performance and exact compatibility remain unverified.",
  };
}

function comfoTubeFlow90Candidate() {
  return {
    id: "comfotube-dn90-50m",
    versionId: "comfotube-dn90-50m.evidence.v2",
    group: "Ducts",
    category: "source-backed-candidate",
    manufacturer: "Zehnder",
    productId: "ZEN-CT90-50M",
    name: "ComfoTube DN90 50 m roll",
    placeable: false,
    status: "source-backed-current-generation-candidate-pressure-graph-not-tabulated",
    source: {
      identifier: { ...INTERNAL_IDENTIFIER_SOURCE, locator: "Price List!A94:C94" },
      manufacturerTechnicalCandidate: COMFOTUBE_FLOW_TECHNICAL_SOURCE,
    },
    manufacturerItemCandidate: COMFOTUBE_FLOW_90_EVIDENCE.manufacturerItem,
    manufacturerArticleCandidate: COMFOTUBE_FLOW_90_EVIDENCE.manufacturerArticle,
    localSkuCrosswalkStatus: "unverified",
    dimensions: {
      unit: "mm",
      body: null,
      outsideDiameterMm: COMFOTUBE_FLOW_90_EVIDENCE.outsideDiameterMm,
      insideDiameterMm: COMFOTUBE_FLOW_90_EVIDENCE.insideDiameterMm,
      rollLengthM: COMFOTUBE_FLOW_90_EVIDENCE.rollLengthM,
      evidenceStatus: "official-current-generation-candidate-local-crosswalk-unverified",
    },
    symbol: null,
    ports: [],
    commercial: { pricing: PRIVATE_PRICING },
    performance: {
      status: "bounded-source-metadata-pressure-calculation-blocked",
      values: null,
      normalVentilationMaximum: COMFOTUBE_FLOW_90_EVIDENCE.recommendedNormalVentilationMaximum,
      pressureLoss: COMFOTUBE_FLOW_90_EVIDENCE.pressureLossEvidence,
    },
    candidateSummary: "Flow 90 candidate · 90/77 mm · 50 m · 45 m³/h recommended normal maximum · pressure graph not digitized",
    note: "The local SKU description aligns with the current Flow 90 50 m manufacturer item, but the regional/local crosswalk is not approved. This record is not placeable and supplies no pressure-loss calculation.",
  };
}

function q600Candidate(id, productId, name, identifierLocator) {
  return {
    id,
    versionId: `${id}.evidence.v1`,
    group: "Units",
    category: "mvhr-unit",
    manufacturer: "Zehnder",
    productId,
    name,
    placeable: false,
    status: "source-backed-candidate-variant-conflict",
    source: {
      identifier: { ...INTERNAL_IDENTIFIER_SOURCE, locator: identifierLocator },
      research: Q600_RESEARCH_SOURCE,
    },
    dimensions: {
      unit: "mm",
      body: null,
      evidenceStatus: "withheld-from-placement-pending-tr-st-resolution",
      note: "Research dimensions describe Q600 ST while the supplied product description says Q600 TR; no drawing geometry is promoted until that variant conflict is resolved.",
    },
    symbol: null,
    ports: [],
    connectionEvidence: {
      connectionCount: 4,
      insideDiameterMm: 180,
      outsideDiameterMm: 200,
      nominalDesignation: "180/200",
      roleMapStatus: "unresolved",
      routable: false,
      note: "Bore and outside diameter are source-backed. Port coordinates, stream roles, mating profile, adapters and CW compatibility remain unverified.",
    },
    variantEvidence: {
      suppliedDescription: "TR",
      manufacturerDocument: "ST",
      status: "unresolved-conflict",
    },
    commercial: { pricing: PRIVATE_PRICING },
    performance: UNKNOWN_PERFORMANCE,
    candidateSummary: "180 mm bore / 200 mm OD · TR/ST variant unresolved · not placeable",
    note: "Approved catalogue candidate only. It has no placement geometry, typed routable ports, mounting policy or inferred ComfoWell compatibility.",
  };
}

function dimensions(width, depth, height, note) {
  return {
    unit: "mm",
    body: { width, depth, height },
    drawingEnvelope: { width, depth },
    evidenceStatus: "generic-test-fixture-only",
    note,
  };
}

function radialPorts(prefix, x, stream, role) {
  return [-120, -72, -24, 24, 72, 120].map((y, index) => (
    port(`${prefix}-${index + 1}`, x, y, 1, 0, stream, role, SEMI_RIGID_90)
  ));
}

function port(key, x, y, directionX, directionY, stream, role, interfaceValue) {
  return {
    key,
    positionMm: { x, y, z: 0 },
    direction: { x: directionX, y: directionY, z: 0 },
    system: "mvhr",
    stream,
    role,
    interface: interfaceValue,
  };
}

function interfaceDefinition(family, nominalSizeMm, verificationStatus, evidence = {}) {
  return {
    family,
    nominalSizeMm,
    boreMm: null,
    outsideDiameterMm: null,
    matingProfile: null,
    verificationStatus,
    ...evidence,
  };
}

function routeFamily(id, name, connectionFamily, nominalSizeMm, note, visible = true, interfaceEvidence = {}) {
  return {
    id,
    name,
    visible,
    status: "generic-route-class-not-engineered",
    connectionInterface: connectionFamily === null
      ? null
      : interfaceDefinition(connectionFamily, nominalSizeMm, "generic-route-class-only", interfaceEvidence),
    commercial: { pricing: PRIVATE_PRICING },
    performance: UNKNOWN_PERFORMANCE,
    note,
  };
}

function mountingPolicy(nominalEppSizeMm, allowedModes, evidence, note) {
  return {
    nominalEppSizeMm,
    allowedModes,
    evidence,
    note,
    typicalAttenuatorCount: 2,
    autoPlace: false,
  };
}

function requireId(value, label) {
  if (typeof value !== "string" || value.trim().length < 1) throw new TypeError(`${label} is required`);
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
