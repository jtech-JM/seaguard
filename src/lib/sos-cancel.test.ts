import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRescueOperationPatch, buildSosCancelPatch, shouldRestoreTripStatus } from "./sos-cancel";

test("buildSosCancelPatch appends a false alarm reason", () => {
  const patch = buildSosCancelPatch("Existing note", "Battery issue");

  assert.equal(patch.status, "closed");
  assert.match(patch.notes ?? "", /Existing note/);
  assert.match(patch.notes ?? "", /False alarm reason: Battery issue/);
  assert.ok(patch.resolved_at);
});

test("buildRescueOperationPatch resolves linked operations", () => {
  const patch = buildRescueOperationPatch("Existing note", "Battery issue");

  assert.equal(patch.status, "resolved");
  assert.match(patch.notes ?? "", /Existing note/);
  assert.match(patch.notes ?? "", /False alarm reason: Battery issue/);
  assert.ok(patch.ended_at);
});

test("shouldRestoreTripStatus only restores active SOS trip states", () => {
  assert.equal(shouldRestoreTripStatus("sos"), true);
  assert.equal(shouldRestoreTripStatus("rescue_in_progress"), true);
  assert.equal(shouldRestoreTripStatus("at_sea"), false);
  assert.equal(shouldRestoreTripStatus("returned"), false);
});
