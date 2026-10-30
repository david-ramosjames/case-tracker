export const CLIENT_CONTACT_WINDOW_DAYS = 30;
export const CLIENT_CONTACT_LONG_GAP_DAYS = 45;

/** Stored dates. Each column is one kind of contact, same as the Contact Summary sheet. */
export type ClientContactSummary = {
  caseNumber: string;
  caseId: string | null;
  lastOutboundCallAt: string | null;
  lastHumanCallAt: string | null;
  lastInboundTextAt: string | null;
  lastOutboundTextAt: string | null;
  lastConversationAt: string | null;
  lastOtherAt: string | null;
  lastOtherType: string | null;
  lastOtherDetails: string | null;
};

export type ClientContactDates = {
  /**
   * Contact Summary column F — we actually connected.
   * MAX(J Last Human Call, L Conversation Activity, N Other, MIN(K Inbound Text, M Outbound Text)).
   * Sheet MIN ignores blanks, so one text date still counts.
   */
  lastInteraction: string | null;
  /**
   * Contact Summary column H — we tried.
   * MAX(F Last Interaction, I Last Outbound Call, M Last Outbound Text).
   */
  lastAttempt: string | null;
};

/** Sheet MIN ignores a blank cell, so one text date still counts. Both dates use the earlier one. */
function earlierDate(left: string | null, right: string | null) {
  const leftMs = left ? Date.parse(left) : NaN;
  const rightMs = right ? Date.parse(right) : NaN;
  if (!Number.isFinite(leftMs)) return Number.isFinite(rightMs) ? right : null;
  if (!Number.isFinite(rightMs)) return left;
  return leftMs <= rightMs ? left : right;
}

export function latestDate(values: Array<string | null | undefined>) {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && ms > bestMs) {
      best = value;
      bestMs = ms;
    }
  }
  return best;
}

export function clientContactDates(summary: ClientContactSummary | null): ClientContactDates {
  if (!summary) return { lastInteraction: null, lastAttempt: null };
  // Same as Contact Summary F: MAX(J, L, N, MIN(K, M)).
  const lastInteraction = latestDate([
    summary.lastHumanCallAt,
    summary.lastConversationAt,
    summary.lastOtherAt,
    earlierDate(summary.lastInboundTextAt, summary.lastOutboundTextAt),
  ]);
  // Same as Contact Summary H: MAX(F, I, M).
  return {
    lastInteraction,
    lastAttempt: latestDate([lastInteraction, summary.lastOutboundCallAt, summary.lastOutboundTextAt]),
  };
}

export function daysSinceContact(contactedAt: string | null, now = Date.now()) {
  if (!contactedAt) return null;
  const ms = Date.parse(contactedAt);
  if (!Number.isFinite(ms)) return null;
  return Math.floor((now - ms) / (1000 * 60 * 60 * 24));
}

/** Sheet column G (Days Since Contact) uses Last Interaction (F), not Last Attempt. */
export function contactNeedsFollowUp(lastInteractionAt: string | null, now = Date.now()) {
  const days = daysSinceContact(lastInteractionAt, now);
  return days === null || days > CLIENT_CONTACT_WINDOW_DAYS;
}

export type ClientSentimentLabel = "Positive" | "Neutral" | "Negative" | "Unknown" | "—";

/** Sheet only shows sentiment when Days Since Contact (from Last Interaction) is under 30. */
export function contactSentimentLabel(
  lastInteractionAt: string | null,
  sentiment: string | null,
  now = Date.now(),
): ClientSentimentLabel {
  const days = daysSinceContact(lastInteractionAt, now);
  if (days === null || days > CLIENT_CONTACT_WINDOW_DAYS) return "Unknown";
  if (sentiment === "Positive" || sentiment === "Neutral" || sentiment === "Negative") return sentiment;
  return "—";
}
