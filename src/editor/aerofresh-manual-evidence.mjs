// Reviewed product-dimension drawings. No fan curves or installation compatibility are inferred.
export const AEROFRESH_MANUAL_EVIDENCE = Object.freeze({
  "300": Object.freeze({
    sourceId: "aerofresh-inst-aer-300-v1-february-2026", title: "INST-AER-300 V1", dimensionPage: 45, rolePage: 4, servicePage: 5,
    body: Object.freeze({ width: 660, depth: 443, height: 760 }), spigotProtrusionMm: 63, nominalSpigotDiameterMm: 125,
    service: Object.freeze({ aboveMm: 150, belowMinimumMm: 150, rearToServiceBoundaryMm: 900 }),
    portSetout: Object.freeze({ outerXSpanMm: 502, innerXSpanMm: 197, rearOffsetsMm: Object.freeze([343,210,210,93]), xOriginStatus: "not-explicitly-dimensioned" }),
    mountingPolicy: "remote-only",
  }),
  "450": Object.freeze({
    sourceId: "aerofresh-inst-aer-450-600-v1", title: "INST-AER-450-600 V1", dimensionPage: 43, rolePage: 4, servicePage: 5,
    corroboratingSource: Object.freeze({ sourceId: "aerofresh-hrv-range-brochure-2025", page: 14, supplies: "608 mm body depth and 4 x 200 mm native spigots" }),
    body: Object.freeze({ width: 728, depth: 608, height: 881 }), spigotProtrusionMm: 50, nominalSpigotDiameterMm: 200,
    service: Object.freeze({ aboveMm: 150, belowMinimumMm: 150, rearToServiceBoundaryMm: 1100 }),
    portSetout: Object.freeze({ rearLeft: Object.freeze({ xFromLeftMm:200, yFromRearMm:187 }), rearRight: Object.freeze({ xFromLeftMm:593, yFromRearMm:160 }), frontLeft: Object.freeze({ xFromLeftMm:135, yFromRearMm:448 }), frontRight: Object.freeze({ xFromLeftMm:528, yFromRearMm:421 }), horizontalPitchMm:393, brochureHorizontalPitchMm:394, pitchConflictMm:1 }),
    connectionDecision: "owner-confirms-spigots-suit-160mm-epp-no-reducer-inferred",
    handingDecision: "manufacturer-definitions-owner-approved",
  }),
});
