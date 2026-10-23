import {
  COMPONENT_CATALOGUE,
  createCatalogueComponent,
  findCatalogueItem,
} from "./component-catalogue.mjs";

export const SYNTHETIC_COMPONENT_CATALOGUE = COMPONENT_CATALOGUE.filter(
  (item) => item.status === "synthetic-not-manufacturer-verified",
);

export function findSyntheticCatalogueItem(id) {
  return findCatalogueItem(id);
}

export function createSyntheticComponent(catalogueItemId, placement) {
  return createCatalogueComponent(catalogueItemId, placement);
}
