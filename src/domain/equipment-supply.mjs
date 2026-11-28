// Commercial responsibility only; does not affect engineering configuration.
export const OWNER_SUPPLIED_EQUIPMENT = "owner-supplied";

export function canSetEquipmentSupply(component) {
  if (!component || component.decentralisedController) return false;
  if (component.mvhrDesignIntent || component.decentralisedMvhr) return true;
  const category = component.catalogueSnapshot?.category ?? component.catalogueCategory ?? "";
  if (typeof category === "string" && category.startsWith("mvhr-unit")) return true;
  const roles = new Set((component.ports ?? []).filter(port => port.system === "mvhr").map(port => port.role));
  return ["Dwelling supply", "Dwelling extract", "Outdoor intake", "Outdoor exhaust"].every(role => roles.has(role));
}

export function isOwnerSuppliedEquipment(component) {
  return component?.equipmentSupply === OWNER_SUPPLIED_EQUIPMENT;
}

export function setEquipmentSupply(component, value) {
  if (!canSetEquipmentSupply(component)) throw new TypeError("Only an MVHR unit can be marked owner-supplied");
  if (value === "included") delete component.equipmentSupply;
  else if (value === OWNER_SUPPLIED_EQUIPMENT) component.equipmentSupply = value;
  else throw new TypeError("Choose included or owner-supplied unit equipment");
}
