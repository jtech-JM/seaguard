import assert from "node:assert/strict";
import { test } from "node:test";
import { canTransitionTripStatus } from "./trip-status";

test("allows the core BMU approval transition", () => {
  assert.equal(canTransitionTripStatus("pending_approval", "at_sea"), true);
  assert.equal(canTransitionTripStatus("pending_approval", "cancelled"), true);
});

test("disallows invalid transitions", () => {
  assert.equal(canTransitionTripStatus("at_sea", "pending_approval"), false);
  assert.equal(canTransitionTripStatus("returned", "at_sea"), false);
});
