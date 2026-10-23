import assert from "node:assert/strict";
import test from "node:test";

import {
  Q350_SYSTEM_EVIDENCE,
  evaluateQ350Arrangement,
} from "../src/editor/equipment-evidence.mjs";

test("Q350 evidence records official handed port centres and roles as drawing-only facts", () => {
  assert.deepEqual(Q350_SYSTEM_EVIDENCE.verified.unitBodyMm, {
    width: 725,
    depth: 570,
    height: 745,
  });
  assert.equal(Q350_SYSTEM_EVIDENCE.verified.unitConnectionCount, 4);
  assert.equal(Q350_SYSTEM_EVIDENCE.verified.unitConnectionInsideDiameterMm, 160);
  assert.equal(Q350_SYSTEM_EVIDENCE.verified.unitConnectionOutsideDiameterMm, 190);
  assert.equal(Q350_SYSTEM_EVIDENCE.verified.frontToRearRowCentreSpacingMm, 280.5);
  assert.equal(Q350_SYSTEM_EVIDENCE.verified.rearRowCentreOffsetFromBackMm, 123);
  assert.equal(Q350_SYSTEM_EVIDENCE.verified.horizontalPortCentreSpacingMm, 580);
  assert.deepEqual(Q350_SYSTEM_EVIDENCE.verified.localPortCentresMm["left-front"], { x: -290, y: 118.5 });
  assert.equal(Q350_SYSTEM_EVIDENCE.verified.handedRoleMaps.left["left-front"], "Dwelling supply");
  assert.equal(Q350_SYSTEM_EVIDENCE.verified.handedRoleMaps.right["right-front"], "Dwelling extract");
  assert.ok(Q350_SYSTEM_EVIDENCE.unresolvedCommon.some((item) => item.includes("local Q350 product code")));
});

test("direct and remote real Q350 arrangements stay blocked with precise missing evidence", () => {
  const direct = evaluateQ350Arrangement("direct-unit-mounted");
  const remote = evaluateQ350Arrangement("remote-via-epp");

  assert.equal(direct.canCreateRealAssembly, false);
  assert.equal(direct.canCreateDrawingConnectivity, true);
  assert.equal(direct.evidenceStatus, "factory-mounting-set-identified-installation-review-required");
  assert.ok(direct.verifiedEvidence.some((item) => item.includes("990323644")));
  assert.ok(direct.missingEvidence.some((item) => item.includes("local CW-K320 product code")));
  assert.match(direct.note, /drawing topology only/);

  assert.equal(remote.canCreateRealAssembly, false);
  assert.equal(remote.canCreateDrawingConnectivity, false);
  assert.equal(remote.evidenceStatus, "component-setouts-only");
  assert.ok(remote.missingEvidence.some((item) => item.includes("CW-P320 round-port centre")));
  assert.ok(remote.missingEvidence.some((item) => item.includes("CW-M320 absolute branch centres")));
  assert.match(remote.note, /No real remote equipment assembly/);

  assert.throws(() => evaluateQ350Arrangement("imagined-adapter"), /Unsupported Q350 arrangement mode/);
});
