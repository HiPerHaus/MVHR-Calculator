import { createCatalogueComponent, findCatalogueItem } from "./component-catalogue.mjs";

const SERVICE_ZONE = Object.freeze({
  minX: -800,
  minY: -450,
  maxX: 800,
  maxY: 450,
  evidenceStatus: "generic-placeholder-not-manufacturer-verified",
  note: "Visible planning allowance only; confirm manufacturer, access, support and maintenance clearances before technical review.",
});

export const EQUIPMENT_ASSEMBLY_TEMPLATES = deepFreeze([
  assemblyTemplate("supply", "Generic remote supply attenuation set"),
  assemblyTemplate("extract", "Generic remote extract attenuation set"),
]);

export function findEquipmentAssemblyTemplate(templateId) {
  const template = EQUIPMENT_ASSEMBLY_TEMPLATES.find((candidate) => candidate.id === templateId);
  if (!template) throw new TypeError(`Equipment assembly template not found: ${String(templateId)}`);
  return template;
}

export function createEquipmentAssembly(templateId, placement) {
  const template = findEquipmentAssemblyTemplate(templateId);
  requireId(placement?.id, "Equipment assembly ID");
  requireId(placement?.floorId, "Equipment assembly floor ID");
  const xMm = requireFinite(placement?.xMm, "Equipment assembly placement x");
  const yMm = requireFinite(placement?.yMm, "Equipment assembly placement y");
  const endPlateWidthMm = catalogueWidth(template.catalogueItemIds.endPlate);
  const attenuatorWidthMm = catalogueWidth(template.catalogueItemIds.attenuator);
  const radialPlateWidthMm = catalogueWidth(template.catalogueItemIds.radialPlate);
  const rawComponentSpecs = [
    {
      key: "end-plate",
      catalogueItemId: template.catalogueItemIds.endPlate,
      offsetX: -(attenuatorWidthMm + endPlateWidthMm) / 2,
    },
    { key: "attenuator", catalogueItemId: template.catalogueItemIds.attenuator, offsetX: 0 },
    {
      key: "radial-plate",
      catalogueItemId: template.catalogueItemIds.radialPlate,
      offsetX: (attenuatorWidthMm + radialPlateWidthMm) / 2,
    },
  ];
  const meanOffsetX = rawComponentSpecs.reduce((sum, spec) => sum + spec.offsetX, 0) / rawComponentSpecs.length;
  const componentSpecs = rawComponentSpecs.map((spec) => ({
    ...spec,
    offsetX: spec.offsetX - meanOffsetX,
  }));
  const components = componentSpecs.map((spec) => createCatalogueComponent(spec.catalogueItemId, {
    id: `${placement.id}-${spec.key}`,
    floorId: placement.floorId,
    xMm: xMm + spec.offsetX,
    yMm,
    allowAssemblyOnly: true,
  }));
  const [endPlate, attenuator, radialPlate] = components;
  const connections = [
    assemblyConnection(
      `${placement.id}-connection-1`,
      endPlate,
      "module",
      attenuator,
      "in",
    ),
    assemblyConnection(
      `${placement.id}-connection-2`,
      attenuator,
      "out",
      radialPlate,
      "module",
    ),
  ];
  return {
    assembly: {
      id: placement.id,
      floorId: placement.floorId,
      templateId: template.id,
      name: template.name,
      system: "mvhr",
      stream: template.stream,
      installationMode: "remote-via-rigid-epp",
      componentIds: components.map((component) => component.id),
      connectionIds: connections.map((connection) => connection.id),
      serviceZoneMm: { ...SERVICE_ZONE },
      evidenceStatus: "synthetic-not-manufacturer-verified",
    },
    components,
    connections,
  };
}

export function equipmentAssemblyForComponent(project, componentId) {
  return project?.equipmentAssemblies?.find((assembly) => assembly.componentIds.includes(componentId)) ?? null;
}

export function equipmentAssemblyCentre(project, assembly) {
  const components = assembly.componentIds.map((componentId) => (
    project.components.find((component) => component.id === componentId)
  ));
  if (components.some((component) => !component)) {
    throw new TypeError(`Equipment assembly has a missing component: ${assembly.id}`);
  }
  return components.reduce((centre, component) => ({
    x: centre.x + component.positionMm.x / components.length,
    y: centre.y + component.positionMm.y / components.length,
  }), { x: 0, y: 0 });
}

function assemblyTemplate(stream, name) {
  return {
    id: `generic-remote-${stream}-attenuation-set`,
    group: "Attenuation & distribution",
    category: "equipment-assembly",
    name,
    stream,
    placeable: true,
    status: "synthetic-not-manufacturer-verified",
    componentCount: 3,
    connectionCount: 2,
    catalogueItemIds: {
      endPlate: `generic-${stream}-remote-round-end-plate`,
      attenuator: `generic-${stream}-remote-attenuator`,
      radialPlate: `generic-${stream}-remote-radial-plate`,
    },
    serviceZoneMm: SERVICE_ZONE,
    note: "Places one grouped remote assembly with explicit internal connections. It does not select or claim compatibility with a real CW kit.",
  };
}

function assemblyConnection(id, fromComponent, fromPortKey, toComponent, toPortKey) {
  return {
    id,
    kind: "direct",
    from: {
      componentId: fromComponent.id,
      portId: `${fromComponent.id}-port-${fromPortKey}`,
    },
    to: {
      componentId: toComponent.id,
      portId: `${toComponent.id}-port-${toPortKey}`,
    },
    evidence: "generic assembly topology only; product mating compatibility is not verified",
  };
}

function requireId(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function catalogueWidth(catalogueItemId) {
  const widthMm = findCatalogueItem(catalogueItemId).symbol?.widthMm;
  return requireFinite(widthMm, `Catalogue width for ${catalogueItemId}`);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
