const TERMINAL_SHAPES = Object.freeze(["round", "rectangular"]);
const TERMINAL_SERVICES = Object.freeze(["supply", "extract"]);

export function activateTerminalPlacementMode({ shape, service }) {
  if (!TERMINAL_SHAPES.includes(shape)) {
    throw new TypeError(`Unsupported terminal shape: ${String(shape)}`);
  }
  if (!TERMINAL_SERVICES.includes(service)) {
    throw new TypeError(`Unsupported terminal service: ${String(service)}`);
  }
  return Object.freeze({ shape, service });
}

export function terminalPlacementRecordId(mode) {
  const value = activateTerminalPlacementMode(mode);
  return value.shape === "round" ? `luna-${value.service}` : `aerofresh-magnetic-wall-grille-${value.service}`;
}

export function terminalPlacementLabel(mode) {
  const value = activateTerminalPlacementMode(mode);
  return `${value.service === "supply" ? "Supply" : "Extract"} · ${value.shape === "round" ? "Round" : "Rectangle"}`;
}
