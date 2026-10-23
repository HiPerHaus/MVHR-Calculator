export const COMBINED_DN160_PORT_PITCH_MM=280.5;
export function needsCombinedGrilleSpacing(component){
  if(component.catalogueItemId!=="generic-external-grille-combined-dn160")return false;
  const intake=component.ports.find(p=>p.stream==="intake"),exhaust=component.ports.find(p=>p.stream==="exhaust");
  return Boolean(intake && exhaust && Math.abs(Math.abs(intake.positionMm.y-exhaust.positionMm.y)-COMBINED_DN160_PORT_PITCH_MM)>1e-6);
}
export function matchCombinedGrilleSpacing(component){
  if(!needsCombinedGrilleSpacing(component))return false;
  const ports=component.ports.filter(p=>["intake","exhaust"].includes(p.stream));
  const centre=(ports[0].positionMm.y+ports[1].positionMm.y)/2;
  for(const port of ports)port.positionMm.y=centre+(port.positionMm.y<centre?-1:1)*COMBINED_DN160_PORT_PITCH_MM/2;
  component.externalGrillePortSpacingMm=COMBINED_DN160_PORT_PITCH_MM;
  component.externalGrilleDrawingSpacingVersion=1;
  const symbol=component.displaySymbol??component.catalogueSnapshot?.symbol;
  if(symbol)component.displaySymbol={...symbol,heightMm:Math.max(symbol.heightMm,441)};
  return true;
}
