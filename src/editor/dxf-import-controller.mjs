import {
  createDxfReferenceRecords,
  inspectAsciiDxf,
} from "../import/dxf-reference.mjs";

const UNIT_CHOICES = Object.freeze(["mm", "cm", "m", "in", "ft"]);

export function createDxfImportReviewController(options = {}) {
  const inspect = options.inspect ?? inspectAsciiDxf;
  if (typeof inspect !== "function") throw new TypeError("DXF inspection function is required");
  let generation = 0;
  let state = idleState(generation);

  async function inspectSelection(fileName, loadText) {
    const requestId = ++generation;
    state = freezeState({
      ...idleState(requestId),
      status: "inspecting",
      fileName,
    });
    try {
      const sourceText = requireText(await loadText(), "DXF source text");
      if (requestId !== generation) return { applied: false, stale: true, state };
      const candidate = await inspect(sourceText, { fileName });
      if (requestId !== generation) return { applied: false, stale: true, state };
      state = freezeState({
        ...idleState(requestId),
        status: "review",
        fileName,
        candidate,
      });
      return { applied: true, stale: false, state };
    } catch (error) {
      if (requestId !== generation) return { applied: false, stale: true, state };
      state = freezeState({
        ...idleState(requestId),
        status: "failed",
        fileName,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return { applied: true, stale: false, state };
    }
  }

  return Object.freeze({
    getState: () => state,
    selectSource(source) {
      const fileName = requireText(source?.fileName, "DXF filename");
      const sourceText = requireText(source?.sourceText, "DXF source text");
      return inspectSelection(fileName, async () => sourceText);
    },
    selectFile(source) {
      const fileName = requireText(source?.fileName, "DXF filename");
      if (typeof source?.loadText !== "function") throw new TypeError("DXF text loader is required");
      return inspectSelection(fileName, source.loadText);
    },
    chooseUnits(unit) {
      requireReview(state);
      if (!UNIT_CHOICES.includes(unit)) throw new TypeError(`Unsupported DXF unit choice: ${String(unit)}`);
      if (
        state.candidate.declaredUnits.status === "declared-supported" &&
        unit !== state.candidate.declaredUnits.unit
      ) {
        throw new TypeError(`DXF unit choice conflicts with declared ${state.candidate.declaredUnits.unit} units`);
      }
      state = freezeState({ ...state, unitChoice: unit, unitChoiceConfirmed: true });
      return state;
    },
    chooseLayers(layerNames) {
      requireReview(state);
      if (!Array.isArray(layerNames)) throw new TypeError("DXF layer selection must be an array");
      const available = new Set(state.candidate.layers.map((layer) => layer.name));
      const normalized = [...new Set(layerNames.map((name) => requireText(name, "DXF layer name")))].sort();
      for (const name of normalized) {
        if (!available.has(name)) throw new TypeError(`DXF layer is unavailable: ${name}`);
      }
      state = freezeState({ ...state, includedLayers: normalized, layerSelectionConfirmed: true });
      return state;
    },
    acceptPartialImport(accepted) {
      requireReview(state);
      if (typeof accepted !== "boolean") throw new TypeError("DXF partial acceptance must be boolean");
      state = freezeState({ ...state, partialImportAccepted: accepted });
      return state;
    },
    prepareAcceptance(settings) {
      requireReview(state);
      if (!state.unitChoiceConfirmed) throw new TypeError("DXF source units require explicit confirmation");
      if (!state.layerSelectionConfirmed || state.includedLayers.length === 0) {
        throw new TypeError("At least one DXF layer must be explicitly selected");
      }
      if (!state.candidate.geometry.some((item) => state.includedLayers.includes(item.layer))) {
        throw new TypeError("The selected DXF layers contain no supported reference geometry");
      }
      if (state.candidate.partialAcceptanceRequired && !state.partialImportAccepted) {
        throw new TypeError("DXF omissions require explicit partial-import acceptance");
      }
      const records = createDxfReferenceRecords(state.candidate, {
        ...settings,
        includedLayers: state.includedLayers,
        unitChoice: state.unitChoice,
        acceptPartial: state.partialImportAccepted,
      });
      return Object.freeze({ type: "reference.addCad", ...records });
    },
    complete() {
      generation += 1;
      state = idleState(generation);
      return state;
    },
    cancel() {
      generation += 1;
      state = idleState(generation);
      return state;
    },
  });
}

function idleState(requestId) {
  return freezeState({
    status: "idle",
    requestId,
    fileName: null,
    candidate: null,
    errorMessage: null,
    unitChoice: null,
    unitChoiceConfirmed: false,
    includedLayers: [],
    layerSelectionConfirmed: false,
    partialImportAccepted: false,
  });
}

function requireReview(state) {
  if (state.status !== "review" || !state.candidate) {
    throw new TypeError("A completed DXF inspection is required before review choices");
  }
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  return value;
}

function freezeState(value) {
  Object.freeze(value.includedLayers);
  return Object.freeze(value);
}
