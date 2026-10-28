import { findCatalogueItem } from "./component-catalogue.mjs";

export const VENTILATION_VISIBILITY_GROUPS = Object.freeze([
  ["dn90", "90 mm duct"], ["epp", "EPP"], ["hrv", "HRV"],
  ["distribution", "distribution & attenuators"], ["terminals", "outlets"],
  ["external", "external grilles"], ["other", "other components"],
  ["bend-labels", "bend labels"],
]);

export function routeVisibilityGroup(route) {
  if (route.ductKind === "semi-rigid-radial") return "dn90";
  if (/^epp-rigid-dn/.test(route.ductKind)) return "epp";
  return "other";
}

export function ventilationVisibilityGroup(component) {
  let category = component.category;
  try { category = findCatalogueItem(component.catalogueItemId).category; } catch { /* Imported generic components can lack a catalogue record. */ }
  if (/^mvhr-unit/.test(category)) return "hrv";
  if (/^(attenuator-manifold|standalone-cw|distribution-box|assembly-)/.test(category)) return "distribution";
  if (category === "terminal") return "terminals";
  if (category === "external-grille") return "external";
  return "other";
}
