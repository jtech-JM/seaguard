export const ALERT_STATUS_TRANSITIONS: Record<string, string[]> = {
  new: ["acknowledged", "closed"],
  acknowledged: ["assigned", "in_progress", "closed"],
  assigned: ["in_progress", "resolved", "closed"],
  in_progress: ["resolved", "closed"],
  resolved: ["closed"],
  closed: [],
};

export function canTransitionAlertStatus(currentStatus: string, nextStatus: string) {
  return (ALERT_STATUS_TRANSITIONS[currentStatus] ?? []).includes(nextStatus);
}
