// A linear face is one room outlet even when its housing has two duct feeds.
export function isLineaTerminal(component) {
  const symbol = component?.displaySymbol ?? component?.catalogueSnapshot?.symbol;
  return symbol?.shape === "linear-grille" && [400, 600].includes(symbol.lineaSize);
}

export function roomOutletAnchor(component, candidates) {
  if (candidates.length === 1) return candidates[0];
  if (isLineaTerminal(component) && candidates.length === 2 &&
      candidates[0].stream === candidates[1].stream &&
      candidates.every(port => port.interface?.nominalSizeMm === 90)) return candidates[0];
  return null;
}
