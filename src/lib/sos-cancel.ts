export type SosCancelReason = string | null | undefined;

function joinCancelNotes(existingNotes: string | null | undefined, reason: string | null | undefined) {
  const trimmedReason = reason?.trim();
  return [existingNotes?.trim(), trimmedReason ? `False alarm reason: ${trimmedReason}` : null]
    .filter(Boolean)
    .join("\n");
}

export function buildSosCancelPatch(existingNotes: string | null | undefined, reason: string | null | undefined) {
  const combinedNotes = joinCancelNotes(existingNotes, reason);

  return {
    status: "closed" as const,
    resolved_at: new Date().toISOString(),
    notes: combinedNotes || null,
  };
}

export function buildRescueOperationPatch(existingNotes: string | null | undefined, reason: string | null | undefined) {
  const combinedNotes = joinCancelNotes(existingNotes, reason);

  return {
    status: "resolved" as const,
    ended_at: new Date().toISOString(),
    notes: combinedNotes || null,
  };
}

export function shouldRestoreTripStatus(status: string) {
  return status === "sos" || status === "rescue_in_progress";
}
