import { applyCommand, validateProject } from "./spatial.mjs";

export const MAX_COMMAND_HISTORY_ENTRIES = 50;
export const MAX_COMMAND_HISTORY_BYTES = 32 * 1024 * 1024;

export function createCommandHistory(project) {
  return {
    past: [],
    present: structuredClone(validateProject(project)),
    future: [],
  };
}

export function executeCommand(history, command) {
  validateHistory(history);
  const next = applyCommand(history.present, command);
  const entry = historyEntry(history.present, command);
  return {
    past: trimPast([...history.past, entry]),
    present: next,
    future: [],
  };
}

export function undoCommand(history) {
  validateHistory(history);
  if (history.past.length === 0) {
    return structuredClone(history);
  }
  const entry = history.past.at(-1);
  return {
    past: structuredClone(history.past.slice(0, -1)),
    present: structuredClone(entry.project),
    future: [
      {
        project: structuredClone(history.present),
        command: structuredClone(entry.command),
        estimatedBytes: estimateProjectBytes(history.present),
      },
      ...structuredClone(history.future),
    ],
  };
}

export function redoCommand(history) {
  validateHistory(history);
  if (history.future.length === 0) {
    return structuredClone(history);
  }
  const entry = history.future[0];
  return {
    past: [
      ...structuredClone(history.past),
      {
        project: structuredClone(history.present),
        command: structuredClone(entry.command),
        estimatedBytes: estimateProjectBytes(history.present),
      },
    ],
    present: structuredClone(entry.project),
    future: structuredClone(history.future.slice(1)),
  };
}

export function canUndo(history) {
  validateHistory(history);
  return history.past.length > 0;
}

export function canRedo(history) {
  validateHistory(history);
  return history.future.length > 0;
}

function validateHistory(history) {
  if (!history || !Array.isArray(history.past) || !Array.isArray(history.future)) {
    throw new TypeError("Command history is invalid");
  }
  validateProject(history.present);
}

function historyEntry(project, command) {
  return {
    project: structuredClone(project),
    // Redo uses the stored project snapshot. Retain only non-authoritative
    // command identity so an import command cannot duplicate embedded assets.
    command: { type: String(command?.type ?? "unknown") },
    estimatedBytes: estimateProjectBytes(project),
  };
}

function trimPast(entries) {
  const retained = [];
  let retainedBytes = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const estimatedBytes = entry.estimatedBytes ?? estimateProjectBytes(entry.project);
    const isNewest = retained.length === 0;
    if (!isNewest && (
      retained.length >= MAX_COMMAND_HISTORY_ENTRIES ||
      retainedBytes + estimatedBytes > MAX_COMMAND_HISTORY_BYTES
    )) break;
    retained.unshift({ ...entry, estimatedBytes });
    retainedBytes += estimatedBytes;
  }
  return retained;
}

function estimateProjectBytes(project) {
  return new TextEncoder().encode(JSON.stringify(project)).byteLength;
}
