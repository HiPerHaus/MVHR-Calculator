import { worldPortTransform } from "../domain/spatial.mjs";

export function deriveRiserTakeoff(project) {
  const ends = new Map(project.components.filter(component => component.riserId)
    .map(component => [component.id, component]));
  return (project.connections ?? []).flatMap(connection => {
    const from = ends.get(connection.from.componentId);
    const to = ends.get(connection.to.componentId);
    if (from?.riserId !== connection.id || to?.riserId !== connection.id || from.floorId === to.floorId) return [];

    const port = from.ports.find(port => port.id === connection.from.portId);
    const start = worldPortTransform(project, from.id, connection.from.portId).positionMm;
    const end = worldPortTransform(project, to.id, connection.to.portId).positionMm;
    const riseMm = start && end ? Math.abs(end.z - start.z) : 0;
    // Allow sub-millimetre drawing differences when matching vertically aligned ends.
    const aligned = start && end && Math.hypot(end.x - start.x, end.y - start.y) <= 1;
    return [{
      id: connection.id,
      nominalSizeMm: port.interface?.nominalSizeMm,
      lengthMm: aligned && riseMm > 0 ? riseMm : null,
    }];
  });
}
