/**
 * In-memory dedupe for Slack Events API retries and dual delivery
 * (channel_topic + message subtype channel_topic). Best-effort per instance.
 */

const EVENT_TTL_MS = 5 * 60 * 1000;
const TOPIC_LOCK_TTL_MS = 30 * 1000;

const seenEventIds = new Map<string, number>();
const topicLocks = new Map<string, number>();

function prune(map: Map<string, number>, now: number, ttlMs: number) {
  for (const [key, expiresAt] of map) {
    if (expiresAt <= now) map.delete(key);
  }
}

/** Returns true if this Slack event_id was already handled recently. */
export function claimSlackEventId(eventId: string | undefined | null): boolean {
  if (!eventId?.trim()) return true;
  const now = Date.now();
  prune(seenEventIds, now, EVENT_TTL_MS);
  const key = eventId.trim();
  if (seenEventIds.has(key)) return false;
  seenEventIds.set(key, now + EVENT_TTL_MS);
  return true;
}

/**
 * Claim exclusive handling for a channel topic value briefly.
 * Prevents parallel handlers for the same edit from double-applying / double-posting.
 */
export function claimTopicApplyLock(channelId: string, topic: string): boolean {
  const now = Date.now();
  prune(topicLocks, now, TOPIC_LOCK_TTL_MS);
  const key = `${channelId}:${topic.trim()}`;
  if (topicLocks.has(key)) return false;
  topicLocks.set(key, now + TOPIC_LOCK_TTL_MS);
  return true;
}
