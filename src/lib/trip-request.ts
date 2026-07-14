export interface TripRequestValidationContext {
  activeTripExists: boolean;
  fishermanActive: boolean | null | undefined;
  hasBoat: boolean;
  hasDevice: boolean;
  deviceActive: boolean | null | undefined;
  expectedReturn: string | null | undefined;
  destination: string | null | undefined;
  fishingArea: string | null | undefined;
}

export function getTripRequestBlockedReason(context: TripRequestValidationContext) {
  if (context.activeTripExists) {
    return "You already have an open trip. Check in or resolve the current trip before requesting another.";
  }

  if (context.fishermanActive === false) {
    return "Your fisherman registration is inactive. Contact your BMU officer.";
  }

  if (!context.hasBoat) {
    return "No boat assigned. A boat is required before requesting a trip.";
  }

  if (!context.hasDevice) {
    return "No SOS device assigned. Assign a device before requesting a trip.";
  }

  if (context.deviceActive === false) {
    return "Your assigned SOS device is disabled. Contact your BMU officer.";
  }

  if (!context.destination?.trim()) {
    return "Please provide a destination before submitting the trip request.";
  }

  if (!context.fishingArea?.trim()) {
    return "Please provide the fishing area before submitting the trip request.";
  }

  if (!context.expectedReturn?.trim()) {
    return "Please provide an expected return time before submitting the trip request.";
  }

  return null;
}
