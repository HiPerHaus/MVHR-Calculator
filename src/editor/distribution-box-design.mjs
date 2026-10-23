export const DISTRIBUTION_BOX_PROFILE_VERSION = "2026-10-21.1";

export const DISTRIBUTION_BOX_PROFILES = deepFreeze([
  distributionBoxProfile({
    id: "zehnder-uk-comfowell-320-rapidlock-2026-v1",
    family: "ComfoWell 320",
    market: "UK",
    source: {
      sourceId: "zehnder-uk-comfowell-320-technical-specification-2026-v1",
      sourceKind: "official-manufacturer-technical-specification",
      title: "Zehnder ComfoWell 320 technical specification",
      url: "https://www.zehnder.co.uk/download/dc9ffdfb77cb4eb89509fb432168ae42",
      documentCode: "Comfowell320_Technical_Specification_2026_V1",
      revision: "2026 V1",
      verificationStatus: "visually-reviewed-component-envelopes-and-connection-descriptions",
    },
    components: {
      attenuator: component("CW-S 320", "990323501", 506, 336, 232.5),
      manifold: component("CW-D 320", "990323531", 233, 336, 253.8),
      mountingPlate90: mountingPlate("CW-M 320 - 6 x 90", "990323613", 61.3, 336, 230, 6, 2, 3),
      endPlate160: endPlate("CW-P 320 - DN 160", "990323512", 42.3, 336, 230),
      mountingSetQ350: component("CW-K 320 Q350", "990323647", 61.8, 336, 510.5),
    },
  }),
  distributionBoxProfile({
    id: "zehnder-uk-comfowell-420-rapidlock-2026-v1",
    family: "ComfoWell 420",
    market: "UK",
    source: {
      sourceId: "zehnder-uk-comfowell-420-technical-specification-2026-v1",
      sourceKind: "official-manufacturer-technical-specification",
      title: "Zehnder ComfoWell 420 technical specification",
      url: "https://www.zehnder.co.uk/download/59e75fb6f42a46748c43a9d56d22234c",
      documentCode: "Comfowell420_Technical_Specification_2026_V1",
      revision: "2026 V1",
      verificationStatus: "visually-reviewed-component-envelopes-and-connection-descriptions",
    },
    components: {
      attenuator: component("CW-S 420", "990323504", 506, 436, 235),
      manifold: component("CW-D 420", "990323620", 233, 436, 259),
      mountingPlate90: mountingPlate("CW-M 420 - 8 x 90", "990323622", 61.3, 436, 230, 8, 2, 4),
      endPlate160: endPlate("CW-P 420 - DN 160", "990323627", 42.3, 436, 230),
      mountingSetQ350: component("CW-K 420 Q350", "990323648", 61.8, 436, 510.5),
    },
  }),
]);

export function findDistributionBoxProfile(id) {
  const profile = DISTRIBUTION_BOX_PROFILES.find((candidate) => candidate.id === id);
  if (!profile) throw new TypeError(`Distribution-box profile not found: ${String(id)}`);
  return profile;
}

export function inspectDistributionBoxDesign(id) {
  const profile = findDistributionBoxProfile(id);
  return deepFreeze({
    profileId: profile.id,
    profileVersion: DISTRIBUTION_BOX_PROFILE_VERSION,
    family: profile.family,
    source: profile.source,
    connectionSequence: [
      {
        from: "round-main-duct",
        to: "end-plate-dn160",
        interface: "round-duct-gasket-seal",
        nominalDiameterMm: 160,
        routeReady: false,
        blocker: "The exact regional duct/adapter mating profile, seal, support and installed orientation are not verified.",
      },
      {
        from: "end-plate-dn160",
        to: "attenuator-or-manifold",
        interface: "comfowell-clamping-strip",
        routeReady: false,
        blocker: "The module joint is described, but an installed plan transform and approved assembly configuration are not available.",
      },
      {
        from: "attenuator-or-manifold",
        to: "mounting-plate-90",
        interface: "comfowell-clamping-strip",
        routeReady: false,
        blocker: "Top/side mounting orientation and the complete configured envelope are not approved.",
      },
      {
        from: "mounting-plate-90",
        to: "semi-rigid-90",
        interface: "rapidlock-push-fit",
        nominalDiameterMm: 90,
        connectionCount: profile.components.mountingPlate90.branchConnections.count,
        routeReady: false,
        blocker: "The drawing verifies socket count and layout, but not every socket centre in an installed plan coordinate system.",
      },
    ],
    placeable: false,
    routeReady: false,
    installedPlanFootprint: profile.installedPlanFootprint,
    blockers: profile.missingGeometry,
  });
}

function distributionBoxProfile({ id, family, market, source, components }) {
  return {
    id,
    family,
    market,
    source,
    components,
    connectionInterfaces: {
      moduleJoint: "comfowell-clamping-strip",
      branchSocket: "rapidlock-push-fit",
      mainRoundDuct: "round-duct-gasket-seal",
    },
    installedPlanFootprint: {
      state: "unresolved",
      widthMm: null,
      depthMm: null,
      note: "Manufacturer component height/width/depth values are retained separately. They are not summed into a plan footprint because mounting side, orientation, brackets, joints, connector protrusions and service clearance are configuration-dependent.",
    },
    placeable: false,
    routeReady: false,
    missingGeometry: [
      "Installed plan orientation and origin for the configured chain",
      "Absolute local centres and directions for every RapidLock branch socket",
      "Configured component order and selected top/side mounting arrangement",
      "Mating profile, adapter, seal, support and service-clearance evidence",
      "Approved regional article and local product-code crosswalk",
    ],
  };
}

function component(name, manufacturerArticle, height, width, depth) {
  return {
    name,
    manufacturerArticle,
    manufacturerEnvelopeMm: { height, width, depth },
    installedPlanFootprintMm: null,
  };
}

function mountingPlate(name, manufacturerArticle, height, width, depth, count, rows, columns) {
  return {
    ...component(name, manufacturerArticle, height, width, depth),
    branchConnections: {
      count,
      layout: { rows, columns },
      nominalDuctDiameterMm: 90,
      drawingOutsideDiameterMm: 90.9,
      interface: "rapidlock-push-fit",
      localCentresMm: null,
      coordinateStatus: "not-dimensioned-in-reviewed-source",
    },
  };
}

function endPlate(name, manufacturerArticle, height, width, depth) {
  return {
    ...component(name, manufacturerArticle, height, width, depth),
    mainConnection: {
      count: 1,
      nominalDiameterMm: 160,
      drawingOutsideDiameterMm: 159,
      centreDefinition: "plate-centre-explicit",
      localCentreMm: { x: 0, y: 0 },
      installedDirection: null,
      matingProfile: null,
    },
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
