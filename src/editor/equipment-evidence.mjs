export const Q350_SYSTEM_EVIDENCE = deepFreeze({
  unitFamilyId: "zehnder-q350",
  scope: "q350-with-cw320",
  status: "drawing-connectivity-supported-installation-evidence-incomplete",
  verified: {
    unitBodyMm: { width: 725, depth: 570, height: 745 },
    unitOverallHeightWithTopConnectionsMm: 849.7,
    unitConnectionCount: 4,
    unitConnectionInsideDiameterMm: 160,
    unitConnectionOutsideDiameterMm: 190,
    frontToRearRowCentreSpacingMm: 280.5,
    rearRowCentreOffsetFromBackMm: 123,
    horizontalPortCentreSpacingMm: 580,
    coordinateConvention: "plan-body-envelope-centre; +x right; +y front",
    localPortCentresMm: {
      "left-rear": { x: -290, y: -162 },
      "left-front": { x: -290, y: 118.5 },
      "right-rear": { x: 290, y: -162 },
      "right-front": { x: 290, y: 118.5 },
    },
    handedRoleMaps: {
      left: {
        "left-rear": "Dwelling extract",
        "left-front": "Dwelling supply",
        "right-rear": "Outdoor exhaust",
        "right-front": "Outdoor intake",
      },
      right: {
        "left-rear": "Outdoor intake",
        "left-front": "Outdoor exhaust",
        "right-rear": "Dwelling supply",
        "right-front": "Dwelling extract",
      },
    },
    connectorOrientation: "rotating-top-or-side-configuration-dependent",
    cw320AssemblyEnvelopesMm: {
      cw320: { width: 791, depth: 566, height: 1414 },
      cw420: { width: 824, depth: 566, height: 1414 },
      cw520: { width: 924, depth: 566, height: 1414 },
    },
  },
  unresolvedCommon: [
    "Exact local Q350 product code to manufacturer article and variant crosswalk",
    "Q350 connector mating profile and any required adapter or seal",
    "Installation support, access and service-clearance requirements for the selected arrangement",
  ],
  arrangements: {
    "direct-unit-mounted": {
      evidenceStatus: "factory-mounting-set-identified-installation-review-required",
      canCreateDrawingConnectivity: true,
      canCreateRealAssembly: false,
      verified: [
        "The supplied setout depicts a Q350/450 with paired CW320 modules",
        "The depicted Q350/450 plus CW320 envelope is 791 × 566 × 1414 mm",
        "Official article 990323644 is designated as CW-K 320 for ComfoAir Q350/450 TR",
        "CW-K320 mounting-set relative dimensions and two nominal 160 mm connections are recorded",
      ],
      unresolved: [
        "Exact local CW-K320 product code to manufacturer article crosswalk",
        "Explicit authored assembly topology for the two dwelling-side ports and selected handing",
        "Verified field configuration, supports, seals, access and service clearances",
      ],
    },
    "remote-via-epp": {
      evidenceStatus: "component-setouts-only",
      canCreateDrawingConnectivity: false,
      canCreateRealAssembly: false,
      verified: [
        "CW-S320, CW-M320 6 × 90 and CW-P320 DN160 named dimensions are recorded",
        "The current owner policy uses nominal EPP 160 mm for Q350",
      ],
      unresolved: [
        "Exact CW-P320 round-port centre and mating profile",
        "CW-M320 absolute branch centres because edge offsets are not dimensioned",
        "Exact EPP product, fittings and adapters between the Q350 and CW-P320",
        "Verified remote supports, seals, access and service clearances",
      ],
    },
  },
});

export function evaluateQ350Arrangement(mode) {
  const arrangement = Q350_SYSTEM_EVIDENCE.arrangements[mode];
  if (!arrangement) throw new TypeError(`Unsupported Q350 arrangement mode: ${String(mode)}`);
  const missingEvidence = [
    ...Q350_SYSTEM_EVIDENCE.unresolvedCommon,
    ...arrangement.unresolved,
  ];
  return deepFreeze({
    unitFamilyId: Q350_SYSTEM_EVIDENCE.unitFamilyId,
    mode,
    status: Q350_SYSTEM_EVIDENCE.status,
    canCreateRealAssembly: arrangement.canCreateRealAssembly && missingEvidence.length === 0,
    canCreateDrawingConnectivity: arrangement.canCreateDrawingConnectivity === true,
    evidenceStatus: arrangement.evidenceStatus,
    verifiedEvidence: [...arrangement.verified],
    missingEvidence,
    note: arrangement.canCreateDrawingConnectivity
      ? "Handed Q350 ports may be used for drawing topology only. A real installed assembly is not approved by this evidence state."
      : "No real remote equipment assembly or physical compatibility may be claimed until every missing evidence item is resolved.",
  });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
