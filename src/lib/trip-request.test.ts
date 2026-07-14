import assert from "node:assert/strict";
import { test } from "node:test";
import { getTripRequestBlockedReason } from "./trip-request";

test("returns a reason when the trip request is missing required fields", () => {
  const reason = getTripRequestBlockedReason({
    activeTripExists: false,
    fishermanActive: true,
    hasBoat: true,
    hasDevice: true,
    deviceActive: true,
    expectedReturn: "",
    destination: "",
    fishingArea: "",
  });

  assert.match(reason ?? "", /destination/i);
  assert.match(reason ?? "", /fishing area/i);
  assert.match(reason ?? "", /expected return/i);
});

test("returns null for a valid trip request context", () => {
  const reason = getTripRequestBlockedReason({
    activeTripExists: false,
    fishermanActive: true,
    hasBoat: true,
    hasDevice: true,
    deviceActive: true,
    expectedReturn: "2030-01-01T00:00:00.000Z",
    destination: "Mombasa",
    fishingArea: "Channel",
  });

  assert.equal(reason, null);
});
