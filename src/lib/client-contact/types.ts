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
  /** Latest of a human call, conversation activity, a logged note, and the text dates. */
  lastInteraction: string | null;
  /** Latest of last interaction, last outbound call, and last outbound text. */
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
  const lastInteraction = latestDate([
    summary.lastHumanCallAt,
    summary.lastConversationAt,
    summary.lastOtherAt,
    earlierDate(summary.lastInboundTextAt, summary.lastOutboundTextAt),
  ]);
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

export function contactNeedsFollowUp(contactedAt: string | null, now = Date.now()) {
  const days = daysSinceContact(contactedAt, now);
  return days === null || days > CLIENT_CONTACT_WINDOW_DAYS;
}
