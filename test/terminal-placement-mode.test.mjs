import assert from "node:assert/strict";
import test from "node:test";

import {
  activateTerminalPlacementMode,
  terminalPlacementLabel,
  terminalPlacementRecordId,
} from "../src/editor/terminal-placement-mode.mjs";

test("terminal placement mode changes future service without mutating the prior selection", () => {
  const supply = activateTerminalPlacementMode({ shape: "round", service: "supply" });
  const extract = activateTerminalPlacementMode({ ...supply, service: "extract" });

  assert.deepEqual(supply, { shape: "round", service: "supply" });
  assert.deepEqual(extract, { shape: "round", service: "extract" });
  assert.equal(terminalPlacementRecordId(supply), "luna-supply");
  assert.equal(terminalPlacementRecordId(extract), "luna-extract");
  assert.equal(terminalPlacementLabel(extract), "Extract · Round");
});

test("terminal placement mode preserves the chosen service when the outlet shape changes", () => {
  const round = activateTerminalPlacementMode({ shape: "round", service: "extract" });
  const rectangular = activateTerminalPlacementMode({ ...round, shape: "rectangular" });

  assert.equal(terminalPlacementRecordId(round), "luna-extract");
  assert.equal(terminalPlacementRecordId(rectangular), "aerofresh-magnetic-wall-grille-extract");
  assert.equal(terminalPlacementLabel(rectangular), "Extract · Rectangle");
});

test("terminal placement mode rejects unknown services and shapes", () => {
  assert.throws(
    () => activateTerminalPlacementMode({ shape: "round", service: "intake" }),
    /Unsupported terminal service/,
  );
  assert.throws(
    () => activateTerminalPlacementMode({ shape: "ceiling", service: "supply" }),
    /Unsupported terminal shape/,
  );
});
