export type TripStatusTransition = {
  from: string;
  to: string;
};

export const TRIP_STATUS_TRANSITIONS: TripStatusTransition[] = [
  { from: "pending_approval", to: "at_sea" },
  { from: "pending_approval", to: "cancelled" },
  { from: "at_sea", to: "returned" },
  { from: "at_sea", to: "sos" },
  { from: "at_sea", to: "overdue" },
  { from: "sos", to: "rescue_in_progress" },
  { from: "sos", to: "at_sea" },
  { from: "rescue_in_progress", to: "rescued" },
  { from: "rescue_in_progress", to: "at_sea" },
  { from: "rescued", to: "returned" },
];

export function canTransitionTripStatus(currentStatus: string, nextStatus: string) {
  return TRIP_STATUS_TRANSITIONS.some((transition) => transition.from === currentStatus && transition.to === nextStatus);
}
