/** A call counts toward the 30-day contact clock only at or above this length. */
export const QUALIFYING_CALL_SECONDS = 60;

/**
 * Contact sync reads Quo ledger activity from this floor forward
 * (July 1, 2026 00:00 America/Chicago).
 */
export const CLIENT_CONTACT_LEDGER_FLOOR_ISO = "2026-07-01T05:00:00.000Z";

export function clientContactLookbackSinceIso(now = Date.now()) {
  const floorMs = Date.parse(CLIENT_CONTACT_LEDGER_FLOOR_ISO);
  if (Number.isFinite(floorMs) && floorMs < now) return new Date(floorMs).toISOString();
  return new Date(now - 120 * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * An inbound text and an outbound text count only when both happen inside this window.
 * The contact time is the later message, when the exchange is complete.
 */
export const TEXT_EXCHANGE_WINDOW_DAYS = 7;
export const TEXT_EXCHANGE_WINDOW_MS = TEXT_EXCHANGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export type TextDirection = "incoming" | "outgoing";

export function textDirection(value: string | null | undefined): TextDirection | null {
  const direction = (value ?? "").toLowerCase();
  if (direction === "incoming" || direction === "inbound") return "incoming";
  if (direction === "outgoing" || direction === "outbound") return "outgoing";
  return null;
}

/** Connected human call long enough to count. Sona and shorter calls do not. */
export function isQualifyingClientCall(input: { aiHandled: boolean; durationSec: number | null | undefined }) {
  if (input.aiHandled) return false;
  const duration = input.durationSec ?? 0;
  return Number.isFinite(duration) && duration >= QUALIFYING_CALL_SECONDS;
}

export function callDurationSeconds(input: {
  durationSec?: number | null;
  answeredAt?: string | null;
  completedAt?: string | null;
}) {
  const raw = input.durationSec;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  const start = input.answeredAt ? Date.parse(input.answeredAt) : NaN;
  const end = input.completedAt ? Date.parse(input.completedAt) : NaN;
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return Math.round((end - start) / 1000);
  }
  return 0;
}

/**
 * Latest time an inbound and an outbound text fell within the exchange window.
 * Uses the most recent opposite-direction message, so a later one-way text does not
 * revive an older exchange that is already outside the window.
 */
export function latestTextExchangeAt(messages: Array<{ at: string; direction: TextDirection }>) {
  const events = messages
    .map((message) => ({ at: message.at, ms: Date.parse(message.at), direction: message.direction }))
    .filter((message) => Number.isFinite(message.ms))
    .sort((left, right) => left.ms - right.ms);

  let lastIncoming = Number.NEGATIVE_INFINITY;
  let lastOutgoing = Number.NEGATIVE_INFINITY;
  let bestMs = Number.NEGATIVE_INFINITY;
  let bestAt: string | null = null;

  for (const event of events) {
    const prior = event.direction === "incoming" ? lastOutgoing : lastIncoming;
    if (prior !== Number.NEGATIVE_INFINITY && event.ms - prior <= TEXT_EXCHANGE_WINDOW_MS && event.ms >= bestMs) {
      bestMs = event.ms;
      bestAt = event.at;
    }
    if (event.direction === "incoming") lastIncoming = event.ms;
    else lastOutgoing = event.ms;
  }

  return bestAt;
}
