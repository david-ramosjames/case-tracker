import { getSlackBotToken, isSlackEnabled } from "@/lib/slack/config";

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

let channelNameCache: Map<string, string> | null = null;
let channelCacheExpiresAt = 0;

/** Load all workspace channels once (cached 30 min). Used only if resolving by name. */
export async function loadChannelNameMap(forceRefresh = false) {
  if (!forceRefresh && channelNameCache && Date.now() < channelCacheExpiresAt) {
    return channelNameCache;
  }

  const map = new Map<string, string>();
  let cursor: string | undefined;
  let page = 0;

  do {
    if (page > 0) await sleep(1200);
    const payload = await slackApi<{
      ok: boolean;
      channels?: Array<{ id: string; name: string }>;
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
    }

    cursor = payload.response_metadata?.next_cursor || undefined;
    page += 1;
  } while (cursor);

  channelNameCache = map;
  channelCacheExpiresAt = Date.now() + 30 * 60 * 1000;
  return map;
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

type SlackHistoryMessage = { ts: string; text?: string };

export async function fetchChannelHistory(
  channelId: string,
  options?: { oldest?: string; limit?: number },
): Promise<SlackHistoryMessage[]> {
  if (!isSlackEnabled()) return [];

  const payload = await slackApi<{
    ok: boolean;
    messages?: SlackHistoryMessage[];
  }>("conversations.history", {
    channel: resolveSlackChannelParam(channelId),
    limit: options?.limit ?? 20,
    oldest: options?.oldest,
    inclusive: false,
  });

  const messages = [...(payload.messages ?? [])].sort((a, b) => Number(a.ts) - Number(b.ts));
  return messages;
}
