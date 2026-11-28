import { lineaPlacementSize, lineaRecordId } from "./zehnder-linea.mjs";

const TERMINAL_SHAPES = Object.freeze(["round", "rectangular", "linea-400", "linea-600"]);
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
  const size = lineaPlacementSize(value.shape);
  if (size) return lineaRecordId(size, value.service);
  return value.shape === "round" ? `luna-${value.service}` : `aerofresh-magnetic-wall-grille-${value.service}`;
}

export function terminalProductLabel(shape) {
  const size = lineaPlacementSize(shape);
  return size ? `Zehnder Linea ${size}` : shape === "round" ? "Round" : "Rectangle";
}

export function terminalPlacementLabel(mode) {
  const value = activateTerminalPlacementMode(mode);
  return `${value.service === "supply" ? "Supply" : "Extract"} · ${terminalProductLabel(value.shape)}`;
}
