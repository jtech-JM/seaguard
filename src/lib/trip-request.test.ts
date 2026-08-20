import assert from "node:assert/strict";
import { test } from "node:test";
import { getTripRequestBlockedReason } from "./trip-request";

const READY = {
  activeTripExists: false,
  fishermanActive: true,
  isCertifiedCaptain: true,
  hasBoat: true,
  hasDevice: true,
  deviceActive: true,
  expectedReturn: "2030-01-01T00:00:00.000Z",
  destination: "Mombasa",
  fishingArea: "Channel",
};

test("returns null for a valid trip request context", () => {
  assert.equal(getTripRequestBlockedReason(READY), null);
});

// The helper reports one blocker at a time, highest priority first, so each
// missing field is asserted against its own context.
test("reports each missing required field", () => {
  assert.match(getTripRequestBlockedReason({ ...READY, destination: "" }) ?? "", /destination/i);
  assert.match(getTripRequestBlockedReason({ ...READY, fishingArea: "  " }) ?? "", /fishing area/i);
  assert.match(
    getTripRequestBlockedReason({ ...READY, expectedReturn: null }) ?? "",
    /expected return/i,
  );
});

test("reports eligibility blockers ahead of missing fields", () => {
  const noFields = { ...READY, destination: "", fishingArea: "", expectedReturn: "" };

  assert.match(
    getTripRequestBlockedReason({ ...noFields, activeTripExists: true }) ?? "",
    /already have an open trip/i,
  );
  assert.match(
    getTripRequestBlockedReason({ ...noFields, fishermanActive: false }) ?? "",
    /registration is inactive/i,
  );
  assert.match(
    getTripRequestBlockedReason({ ...noFields, isCertifiedCaptain: false }) ?? "",
    /certified captain/i,
  );
  assert.match(getTripRequestBlockedReason({ ...noFields, hasBoat: false }) ?? "", /boat/i);
  assert.match(getTripRequestBlockedReason({ ...noFields, hasDevice: false }) ?? "", /device/i);
  assert.match(
    getTripRequestBlockedReason({ ...noFields, deviceActive: false }) ?? "",
    /disabled/i,
  );
});
