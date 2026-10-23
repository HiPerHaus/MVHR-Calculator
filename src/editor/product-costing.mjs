import { validateProject } from "../domain/spatial.mjs";
import { createPartsSchedule } from "./parts-schedule.mjs";

/**
 * Read-only costing readiness. No prices are stored in the project or inferred
 * from identifiers because this local shell has no cost-permission boundary.
 */
export function inspectProductCostingReadiness(project, floorId) {
  validateProject(project);
  const schedule = createPartsSchedule(project, { floorId });
  const componentLines = schedule.componentLines.map((line) => ({
    ref: line.ref,
    description: line.description,
    quantity: line.quantity,
    unit: "each",
    productId: line.productId,
    manufacturerArticle: line.manufacturerArticle,
    productMatchStatus: line.matchStatus,
    sourceComponentIds: [...line.componentIds],
    price: null,
    currency: null,
    priceSource: null,
    priceEffectiveDate: null,
    pricingState: line.evidenceClass === "verified-catalogue"
      ? "unpriced-no-authorized-price-record"
      : "blocked-product-match-unresolved",
  }));
  const routeLines = schedule.routeLines.map((line) => ({
    ref: line.ref,
    description: line.description,
    quantity: line.developedQuantityState === "known" ? line.developedQuantityMm / 1000 : null,
    knownQuantity: line.knownMultipliedPlanMm / 1000,
    unit: "m",
    productId: null,
    manufacturerArticle: null,
    productMatchStatus: line.productMatchStatus,
    sourceRouteIds: [...line.routeIds],
    price: null,
    currency: null,
    priceSource: null,
    priceEffectiveDate: null,
    pricingState: "blocked-route-product-and-purchase-basis-unresolved",
  }));
  const lines = [...componentLines, ...routeLines];
  const blockers = [];
  if (lines.length === 0) blockers.push("No model-derived product or route quantities exist on this floor.");
  if (componentLines.some((line) => line.productMatchStatus !== "verified-regional-catalogue-match")) {
    blockers.push("One or more placed components lack a verified regional product match.");
  }
  if (routeLines.length > 0) {
    blockers.push("Drawn route families are not pinned to orderable product variants, pack lengths or waste rules.");
  }
  blockers.push("No authorized, versioned price record with currency, tax basis and effective date is available to this local shell.");
  return deepFreeze({
    floorId,
    floorName: schedule.floorName,
    state: "unpriced-foundation",
    lines,
    summary: {
      lineCount: lines.length,
      pricedLineCount: 0,
      unpricedLineCount: lines.length,
      subtotal: null,
      tax: null,
      total: null,
      currency: null,
    },
    blockers,
    exclusions: [
      "Unmodelled fittings, adapters, sleeves, seals, supports and access provisions",
      "Purchased pack rounding, cutting waste and installation allowances",
      "Labour, electrical work, commissioning and site-specific work",
      "Tax, discounts, markup, validity and supplier availability",
    ],
    evidenceBoundary: "Quantities come from the model schedule, but no supplier cost, sell price, margin or total is inferred. Unknown prices remain null, not zero. This is not a quote, purchase order or cost-permission boundary.",
  });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
