import { getSlackBotToken, isSlackEnabled } from "@/lib/slack/config";
import { sanitizeSlackTopic } from "@/lib/slack/reminders";

type SlackPostMessageResponse = {
  ok: boolean;
  channel?: string;
  ts?: string;
  error?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function slackApi<T>(method: string, body: Record<string, unknown>, attempt = 0): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getSlackBotToken()}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as T & { ok?: boolean; error?: string };
  if (payload.error === "ratelimited" && attempt < 4) {
    const retryAfter = Number(response.headers.get("retry-after") ?? 0);
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1);
    await sleep(waitMs);
    return slackApi<T>(method, body, attempt + 1);
  }

  if (!response.ok || payload.ok === false) {
    const detail = payload.error ?? "unknown";
    throw new Error(`${detail} (Slack ${method})`);
  }
  return payload;
}

function resolveSlackChannelParam(channelId: string) {
  const trimmed = channelId.trim();
  const normalized = normalizeSlackChannelId(trimmed);
  if (!normalized) {
    throw new Error(`invalid_channel_id (Slack channel "${trimmed}")`);
  }
  return normalized;
}

export async function postSlackMessage(input: {
  channel: string;
  text: string;
  threadTs?: string;
  blocks?: Array<Record<string, unknown>>;
}) {
  if (!isSlackEnabled()) return null;

  const payload = await slackApi<SlackPostMessageResponse>("chat.postMessage", {
    channel: resolveSlackChannelParam(input.channel),
    text: input.text,
    thread_ts: input.threadTs,
    blocks: input.blocks,
    unfurl_links: false,
  });

  return { channel: payload.channel ?? input.channel, ts: payload.ts ?? null };
}

export async function setSlackChannelTopic(channelId: string, topic: string) {
  if (!isSlackEnabled()) return false;
  const sanitized = sanitizeSlackTopic(topic);
  if (!sanitized) return false;
  await slackApi("conversations.setTopic", {
    channel: resolveSlackChannelParam(channelId),
    topic: sanitized,
  });
  return true;
}

/** Sets the full channel topic (built from case data — no conversations.info). */
export async function updateSlackChannelTopic(channelId: string, topic: string) {
  const sanitized = sanitizeSlackTopic(topic);
  if (!sanitized) return false;

  try {
    await setSlackChannelTopic(channelId, sanitized);
    return true;
  } catch (error) {
    console.error("Slack topic update skipped", {
      channelId: channelId.trim(),
      error: error instanceof Error ? error.message : error,
    });
    return false;
  }
}

let channelNameCache: Map<string, string> | null = null;
let channelTopicByIdCache: Map<string, string> | null = null;
let channelCacheExpiresAt = 0;

function parseTopicField(topic: string | { value?: string } | undefined) {
  if (typeof topic === "string") return topic.trim();
  return topic?.value?.trim() ?? "";
}

/** Load all workspace channels once (cached 30 min). */
export async function loadChannelNameMap(forceRefresh = false) {
  if (!forceRefresh && channelNameCache && channelTopicByIdCache && Date.now() < channelCacheExpiresAt) {
    return channelNameCache;
  }

  const map = new Map<string, string>();
  const topicsById = new Map<string, string>();
  let cursor: string | undefined;
  let page = 0;

  do {
    if (page > 0) await sleep(1200);
    const payload = await slackApi<{
      ok: boolean;
      channels?: Array<{ id: string; name: string; topic?: string | { value?: string } }>;
      response_metadata?: { next_cursor?: string };
    }>("conversations.list", {
      types: "public_channel,private_channel",
      limit: 200,
      cursor,
    });

    for (const channel of payload.channels ?? []) {
      map.set(channel.name.toLowerCase(), channel.id);
      map.set(`#${channel.name}`.toLowerCase(), channel.id);
      map.set(channel.id, channel.id);
      const topic = parseTopicField(channel.topic);
      if (topic) topicsById.set(channel.id, topic);
    }

    cursor = payload.response_metadata?.next_cursor || undefined;
    page += 1;
  } while (cursor);

  channelNameCache = map;
  channelTopicByIdCache = topicsById;
  channelCacheExpiresAt = Date.now() + 30 * 60 * 1000;
  return map;
}

/** Read topic from conversations.list cache (avoids conversations.info). */
export async function getSlackChannelTopicFromList(
  channelId: string,
  options?: { refresh?: boolean },
) {
  if (!isSlackEnabled()) return null;
  const normalized = normalizeSlackChannelId(channelId);
  if (!normalized) return null;

  await loadChannelNameMap(options?.refresh ?? false);
  return channelTopicByIdCache?.get(normalized) ?? null;
}

export function normalizeSlackChannelId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[CDG][A-Z0-9]+$/i.test(trimmed) ? trimmed : null;
}

export function lookupChannelId(channelNameOrId: string, map: Map<string, string>) {
  const trimmed = channelNameOrId.trim();
  if (!trimmed) return null;
  const asId = normalizeSlackChannelId(trimmed);
  if (asId) return asId;

  const normalized = trimmed.replace(/^#/, "").toLowerCase();
  return map.get(normalized) ?? map.get(`#${normalized}`) ?? null;
}

export async function resolveSlackChannelId(channelNameOrId: string) {
  const map = await loadChannelNameMap();
  return lookupChannelId(channelNameOrId, map);
}
