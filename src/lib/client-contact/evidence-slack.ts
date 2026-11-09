import { cleanCaseNumber } from "@/lib/csv/parse";
import { extractSlackMessageText, fetchChannelHistorySince, type SlackHistoryMessage } from "@/lib/slack/client";
import { getSlackWorkspaceUrl } from "@/lib/slack/links";

const ROUTER_MARKERS = [
  "New Text Message",
  "Outbound Text Message",
  "Missed Call",
  "MISSED CALL",
  "Hung Up at Phone Menu",
  "HUNG UP AT PHONE MENU",
  "Sona Call Completed",
  "Call Back Requested",
  "Human Call Completed",
  "Voicemail",
];

export type SentimentEvidenceItem = {
  /** Final href — Slack permalink when the Quo router post is found, else the Quo URL. */
  url: string;
  quoUrl: string;
  kind: "call" | "sms" | "other";
  /** Short calendar date for the link label (e.g. "Oct 30"). */
  dateLabel: string | null;
};

type EvidenceSeed = {
  url: string;
  label: string | null;
};

/** Parse stored evidence — markdown `[label](url)` from newer weekly runs, or plain URLs. */
export function parseEvidenceItems(value: string | null | undefined): EvidenceSeed[] {
  if (!value?.trim()) return [];

  const markdown: EvidenceSeed[] = [];
  const mdRe = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdRe.exec(value)) !== null) {
    markdown.push({
      label: match[1]?.trim() || null,
      url: match[2].replace(/[),.;]+$/g, ""),
    });
  }
  if (markdown.length) {
    const seen = new Set<string>();
    return markdown.filter((item) => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }

  const found = value.match(/https?:\/\/[^\s<>"']+/g) ?? [];
  const seen = new Set<string>();
  const plain: EvidenceSeed[] = [];
  for (const raw of found) {
    const url = raw.replace(/[),.;]+$/g, "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    plain.push({ url, label: null });
  }
  return plain;
}

export function evidenceKind(url: string, label: string | null): SentimentEvidenceItem["kind"] {
  const haystack = `${label ?? ""} ${url}`.toLowerCase();
  if (haystack.includes("sms") || haystack.includes("/message")) return "sms";
  if (haystack.includes("/call") || haystack.includes("/inbox") || haystack.includes("openphone")) return "call";
  return "other";
}

/** Prefer a short month+day from a stored markdown label like "Oct 30, 4:18 PM". */
export function dateLabelFromEvidenceLabel(label: string | null | undefined) {
  if (!label?.trim()) return null;
  const cleaned = label.replace(/^SMS\s+/i, "").trim();
  const match = cleaned.match(
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2})(?:,?\s+\d{4})?/i,
  );
  if (!match?.[1]) return null;
  return match[1].replace(/\./g, "").replace(/\s+/g, " ").trim();
}

function dateLabelFromIso(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
  }).format(new Date(ms));
}

function dateLabelFromSlackTs(ts: string | null | undefined) {
  if (!ts) return null;
  const seconds = Number(ts.split(".")[0]);
  if (!Number.isFinite(seconds)) return null;
  return dateLabelFromIso(new Date(seconds * 1000).toISOString());
}

function slackMessagePermalink(channelId: string, ts: string) {
  const workspace = getSlackWorkspaceUrl();
  if (!workspace || !channelId || !ts) return null;
  return `${workspace}/archives/${channelId}/p${ts.replace(".", "")}`;
}

function isQuoRouterPost(text: string) {
  return ROUTER_MARKERS.some((marker) => text.includes(marker));
}

function quoMatchTokens(url: string) {
  try {
    const parsed = new URL(url);
    const callId = parsed.searchParams.get("at")?.trim() || "";
    const parts = parsed.pathname.split("/").filter(Boolean);
    const conversationId = parts.includes("c") ? parts[parts.indexOf("c") + 1] || "" : "";
    const phoneNumberId = parts.includes("inbox") ? parts[parts.indexOf("inbox") + 1] || "" : "";
    return {
      callId,
      conversationId,
      phoneNumberId,
      bare: `${parsed.origin}${parsed.pathname}`,
    };
  } catch {
    return { callId: "", conversationId: "", phoneNumberId: "", bare: url };
  }
}

function messageMatchesQuoUrl(text: string, url: string) {
  if (!text || !url) return false;
  if (text.includes(url)) return true;
  const tokens = quoMatchTokens(url);
  if (tokens.callId && text.includes(tokens.callId)) return true;
  if (tokens.conversationId && text.includes(tokens.conversationId)) return true;
  if (tokens.bare && text.includes(tokens.bare)) return true;
  return false;
}

function last10(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function closestRouterMatch(
  item: SentimentEvidenceItem,
  messages: SlackHistoryMessage[],
  preferredMs: number | null,
  clientPhones: string[],
) {
  let best: { ts: string; distance: number; rank: number } | null = null;
  const phones = clientPhones.map(last10).filter(Boolean);

  for (const message of messages) {
    if (!message.ts) continue;
    const text = extractSlackMessageText(message);
    const urlHit = messageMatchesQuoUrl(text, item.quoUrl);
    const routerHit = isQuoRouterPost(text) || text.includes("View in Quo");
    if (!urlHit && !routerHit) continue;

    const phoneHit = phones.some((phone) => text.replace(/\D/g, "").includes(phone));
    // Exact Quo deep-link wins; otherwise require a client phone on the router post.
    if (!urlHit && !phoneHit) continue;
    if (item.kind === "sms" && !urlHit && !/Text Message/i.test(text)) continue;
    if (item.kind === "call" && !urlHit && /Text Message/i.test(text)) continue;

    const posted = Number(message.ts) * 1000;
    const distance =
      preferredMs != null && Number.isFinite(posted) ? Math.abs(posted - preferredMs) : 0;
    const rank = urlHit ? 0 : phoneHit ? 1 : 2;
    if (!best || rank < best.rank || (rank === best.rank && distance < best.distance)) {
      best = { ts: message.ts, distance, rank };
    }
  }
  return best?.ts ?? null;
}

function windowBounds(input: {
  sentimentWindowStart?: string | null;
  sentimentWindowEnd?: string | null;
  sentimentScoredAt?: string | null;
}) {
  const startMs = Date.parse(input.sentimentWindowStart ?? "");
  const endMs = Date.parse(input.sentimentWindowEnd ?? "");
  const scoredMs = Date.parse(input.sentimentScoredAt ?? "");
  let oldestMs = Number.isFinite(startMs) ? startMs : Number.isFinite(scoredMs) ? scoredMs - 14 * 86_400_000 : Date.now() - 21 * 86_400_000;
  let latestMs = Number.isFinite(endMs) ? endMs : Number.isFinite(scoredMs) ? scoredMs + 2 * 86_400_000 : Date.now();
  oldestMs -= 6 * 60 * 60 * 1000;
  latestMs += 24 * 60 * 60 * 1000;
  return {
    oldest: String(oldestMs / 1000),
    latest: String(latestMs / 1000),
  };
}

function toEvidenceItem(seed: EvidenceSeed): SentimentEvidenceItem {
  return {
    url: seed.url,
    quoUrl: seed.url,
    kind: evidenceKind(seed.url, seed.label),
    dateLabel: dateLabelFromEvidenceLabel(seed.label),
  };
}

type SlackAttachOptions = {
  /** Hard stop so Contact SSR never hangs on Slack rate limits. */
  budgetMs?: number;
  /** Cap channels touched this request. */
  maxChannels?: number;
};

function isRateLimitedError(error: unknown) {
  return /ratelimited/i.test(error instanceof Error ? error.message : String(error ?? ""));
}

async function loadChannelHistoryForContact(
  channelId: string,
  oldest: string,
  latest: string,
  maxMessages: number,
) {
  // No Slack retries here — Contact must stay fast when rate-limited.
  return fetchChannelHistorySince(channelId, {
    oldest,
    latest,
    maxMessages,
    maxRetries: 0,
  });
}

/**
 * Point sentiment evidence links at the Quo router Slack posts in the case channel
 * (instead of Quo), and fill a short date on each V/SMS label when possible.
 */
export async function attachSentimentEvidenceSlackLinks<
  T extends {
    caseNumber: string;
    sentimentEvidence: SentimentEvidenceItem[];
    sentimentWindowStart?: string | null;
    sentimentWindowEnd?: string | null;
    sentimentScoredAt?: string | null;
    clientPhones?: string[];
  },
>(rows: T[], channelIdByCase: Map<string, string>, options?: SlackAttachOptions): Promise<T[]> {
  const pending = rows.filter(
    (row) => row.sentimentEvidence.length > 0 && channelIdByCase.get(cleanCaseNumber(row.caseNumber)),
  );
  if (!pending.length) return rows;

  const byChannel = new Map<string, T[]>();
  for (const row of pending) {
    const channelId = channelIdByCase.get(cleanCaseNumber(row.caseNumber));
    if (!channelId) continue;
    const group = byChannel.get(channelId) ?? [];
    group.push(row);
    byChannel.set(channelId, group);
  }

  const resolved = new Map<T, SentimentEvidenceItem[]>();
  const budgetMs = options?.budgetMs ?? 2500;
  const maxChannels = options?.maxChannels ?? 20;
  const deadline = Date.now() + budgetMs;
  let channelsDone = 0;

  for (const [channelId, group] of byChannel) {
    if (channelsDone >= maxChannels || Date.now() >= deadline) break;
    channelsDone += 1;

    const starts = group.map((row) => windowBounds(row).oldest).map(Number);
    const ends = group.map((row) => windowBounds(row).latest).map(Number);
    const oldest = String(Math.min(...starts));
    const latest = String(Math.max(...ends));
    let messages: SlackHistoryMessage[] = [];
    try {
      messages = await loadChannelHistoryForContact(channelId, oldest, latest, 100);
    } catch (error) {
      if (isRateLimitedError(error)) {
        console.warn("[client-contact] Slack evidence lookup rate-limited; skipping remaining channels");
        break;
      }
      console.error("[client-contact] Slack evidence lookup failed", channelId, error);
      continue;
    }

    for (const row of group) {
      const preferredMs = Date.parse(row.sentimentScoredAt ?? "");
      const next = row.sentimentEvidence.map((item) => {
        const ts = closestRouterMatch(
          item,
          messages,
          Number.isFinite(preferredMs) ? preferredMs : null,
          row.clientPhones ?? [],
        );
        const slackUrl = ts ? slackMessagePermalink(channelId, ts) : null;
        return {
          ...item,
          url: slackUrl || item.url,
          dateLabel: item.dateLabel || dateLabelFromSlackTs(ts) || null,
        };
      });
      resolved.set(row, next);
    }
  }

  if (!resolved.size) return rows;
  return rows.map((row) => {
    const evidence = resolved.get(row);
    return evidence ? { ...row, sentimentEvidence: evidence } : row;
  });
}

export function evidenceItemsFromStoredUrls(value: string | null | undefined): SentimentEvidenceItem[] {
  return parseEvidenceItems(value).map(toEvidenceItem);
}

/**
 * Point Call 60+sec dates at the Quo router Slack post for that call.
 * Prefers an exact call-id hit; falls back to phone + router call markers near the stamp.
 */
export async function attachQualifyingCallSlackLinks<
  T extends {
    caseNumber: string;
    lastQualifyingCall: string | null;
    lastQualifyingCallId?: string | null;
    lastQualifyingCallSlackUrl?: string | null;
    clientPhones?: string[];
  },
>(rows: T[], channelIdByCase: Map<string, string>, options?: SlackAttachOptions): Promise<T[]> {
  const pending = rows.filter(
    (row) =>
      row.lastQualifyingCall &&
      !row.lastQualifyingCallSlackUrl &&
      channelIdByCase.get(cleanCaseNumber(row.caseNumber)),
  );
  if (!pending.length) return rows;

  const byChannel = new Map<string, T[]>();
  for (const row of pending) {
    const channelId = channelIdByCase.get(cleanCaseNumber(row.caseNumber));
    if (!channelId) continue;
    const group = byChannel.get(channelId) ?? [];
    group.push(row);
    byChannel.set(channelId, group);
  }

  const found = new Map<T, string>();
  const budgetMs = options?.budgetMs ?? 2500;
  const maxChannels = options?.maxChannels ?? 25;
  const deadline = Date.now() + budgetMs;
  let channelsDone = 0;

  for (const [channelId, group] of byChannel) {
    if (channelsDone >= maxChannels || Date.now() >= deadline) break;
    channelsDone += 1;

    const times = group
      .map((row) => Date.parse(row.lastQualifyingCall ?? ""))
      .filter((ms) => Number.isFinite(ms));
    if (!times.length) continue;
    const oldest = String((Math.min(...times) - 12 * 60 * 60 * 1000) / 1000);
    const latest = String((Math.max(...times) + 12 * 60 * 60 * 1000) / 1000);
    let messages: SlackHistoryMessage[] = [];
    try {
      messages = await loadChannelHistoryForContact(channelId, oldest, latest, 80);
    } catch (error) {
      if (isRateLimitedError(error)) {
        console.warn("[client-contact] Slack qualifying-call lookup rate-limited; skipping remaining channels");
        break;
      }
      console.error("[client-contact] Slack qualifying-call lookup failed", channelId, error);
      continue;
    }

    for (const row of group) {
      const preferredMs = Date.parse(row.lastQualifyingCall ?? "");
      const callId = row.lastQualifyingCallId?.trim() || "";
      let best: { ts: string; distance: number; rank: number } | null = null;
      const phones = (row.clientPhones ?? []).map(last10).filter(Boolean);

      for (const message of messages) {
        if (!message.ts) continue;
        const text = extractSlackMessageText(message);
        if (!isQuoRouterPost(text) && !text.includes("View in Quo")) continue;
        if (/Text Message/i.test(text)) continue;

        const idHit = Boolean(callId && text.includes(callId));
        const phoneHit = phones.some((phone) => text.replace(/\D/g, "").includes(phone));
        if (!idHit && !phoneHit) continue;

        const posted = Number(message.ts) * 1000;
        const distance =
          Number.isFinite(preferredMs) && Number.isFinite(posted)
            ? Math.abs(posted - preferredMs)
            : Number.POSITIVE_INFINITY;
        const rank = idHit ? 0 : 1;
        if (!best || rank < best.rank || (rank === best.rank && distance < best.distance)) {
          best = { ts: message.ts, distance, rank };
        }
      }

      const url = best?.ts ? slackMessagePermalink(channelId, best.ts) : null;
      if (url) found.set(row, url);
    }
  }

  if (!found.size) return rows;
  return rows.map((row) => {
    const url = found.get(row);
    return url ? { ...row, lastQualifyingCallSlackUrl: url } : row;
  });
}
