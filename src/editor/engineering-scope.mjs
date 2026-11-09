import { isDecentralisedMvhrComponent } from "./decentralised-mvhr.mjs";

export function centralVentilationScope(project, floorId) {
  const components = project.components.filter(item => item.floorId === floorId);
  const centralComponents = components.filter(item => !isDecentralisedMvhrComponent(item) && !item.decentralisedController);
  const routes = project.routes.filter(item => item.floorId === floorId);
  return {
    centralComponents,
    decentralisedOnly: components.length > 0 && centralComponents.length === 0 && routes.length === 0,
  };
}
