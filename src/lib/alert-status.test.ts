import assert from "node:assert/strict";
import { test } from "node:test";
import { canTransitionAlertStatus } from "./alert-status";

test("allows valid rescue workflow transitions", () => {
  assert.equal(canTransitionAlertStatus("new", "acknowledged"), true);
  assert.equal(canTransitionAlertStatus("acknowledged", "assigned"), true);
  assert.equal(canTransitionAlertStatus("in_progress", "resolved"), true);
});

test("disallows invalid transitions", () => {
  assert.equal(canTransitionAlertStatus("new", "resolved"), false);
  assert.equal(canTransitionAlertStatus("resolved", "assigned"), false);
});
