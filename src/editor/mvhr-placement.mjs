import { enableMountedCwDrawingConnections } from "../domain/mounted-cw-drawing-connections.mjs";
import { createCatalogueComponent } from "./component-catalogue.mjs";

export const MVHR_LAYOUTS = Object.freeze({
  "unit-only": "Unit only",
  "unit-mounted-cw": "CW mounted on unit",
  "remote-attenuators": "Remote attenuators",
});

// Mounting is a planning intention, not a transformation of manufacturer geometry.
export function createConfiguredMvhrComponent(selection, placement) {
  const { mounting, model, handing, layout } = selection;
  if (!["horizontal", "vertical"].includes(mounting)) throw new TypeError("Choose horizontal or vertical mounting");
  if (model?.startsWith("aerofresh-300") && layout === "unit-mounted-cw") throw new TypeError("Aerofresh 300 is remote only");
  if (!["generic", "ca200", "q350-hrv", "q350-erv", "q350-de-hrv", "q350-de-erv", "q450-de-hrv", "q450-de-erv", "aerofresh-450-hrv", "aerofresh-450-erv"].includes(model)) throw new TypeError("Unsupported MVHR model");
  if (!["left", "right"].includes(handing)) throw new TypeError("Choose left or right handing");
  if (!Object.hasOwn(MVHR_LAYOUTS, layout)) throw new TypeError("Choose an MVHR layout");
  if (mounting === "horizontal" && !["generic","ca200"].includes(model)) throw new TypeError("A horizontal manufacturer profile is not available");
  if (model === "ca200" && layout === "unit-mounted-cw") throw new TypeError("CA200 direct CW mounting has no reviewed drawing; choose remote attenuators");
  if (model.includes("-de-") && layout === "unit-mounted-cw") throw new TypeError("The German BIM unit has no reviewed CW mating asset; place the CW separately or choose remote attenuators");
  const aerofresh = model.startsWith("aerofresh-450");
  const germanBim = model.match(/^q(350|450)-de-(hrv|erv)$/u);
  const recordId = model === "generic" ? "synthetic-mvhr-placeholder"
    : model === "ca200" ? `zehnder-ca200-${mounting}-${handing}-drawing-profile`
      : aerofresh ? `${model}-${handing}-drawing-profile`
        : germanBim ? `zehnder-q${germanBim[1]}-de-${germanBim[2]}-${handing}-bim-profile`
          : `zehnder-${model}-${handing}-drawing-profile`;
  const component = createCatalogueComponent(recordId, placement);
  const cwSize = selection.cwSize ?? (aerofresh ? "520" : "320");
  if (layout === "unit-mounted-cw" && !["320", "420", "520", "625"].includes(cwSize)) throw new TypeError("Choose a supported CW size");
  if (layout === "unit-mounted-cw" && model === "generic") throw new TypeError("Mounted CW symbols currently require a handed Q350 profile");
  component.mvhrDesignIntent = {
    version: 1, mounting, model, handing: model === "generic" ? null : handing, layout,
    ...(layout === "unit-mounted-cw" ? { cwSize } : {}),
    assemblyState: layout === "unit-only" ? "unit-only" : layout === "unit-mounted-cw" ? "schematic-mounted-cw" : "layout-pending",
    note: "Planning intention only. Accessories, joints, installed mounting geometry and service clearances are not generated or verified.",
  };
  enableMountedCwDrawingConnections(component);
  if (model === "generic") component.displayName = `Generic ${mounting} MVHR`;
  return component;
}
