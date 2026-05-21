import { getSlackBotToken, isSlackEnabled } from "@/lib/slack/config";

type SlackPostMessageResponse = {
  ok: boolean;
  channel?: string;
  ts?: string;
  error?: string;
};

async function slackApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getSlackBotToken()}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `Slack API ${method} failed.`);
  }
  return payload;
}

export async function postSlackMessage(input: {
  channel: string;
  text: string;
  threadTs?: string;
  blocks?: Array<Record<string, unknown>>;
}) {
  if (!isSlackEnabled()) return null;

  const payload = await slackApi<SlackPostMessageResponse>("chat.postMessage", {
    channel: input.channel,
    text: input.text,
    thread_ts: input.threadTs,
    blocks: input.blocks,
    unfurl_links: false,
  });

  return { channel: payload.channel ?? input.channel, ts: payload.ts ?? null };
}

export async function setSlackChannelTopic(channelId: string, topic: string) {
  if (!isSlackEnabled()) return false;
  await slackApi("conversations.setTopic", { channel: channelId, topic });
  return true;
}

let channelNameCache: Map<string, string> | null = null;
let channelCacheExpiresAt = 0;

async function loadChannelNameMap() {
  if (channelNameCache && Date.now() < channelCacheExpiresAt) return channelNameCache;

  const map = new Map<string, string>();
  let cursor: string | undefined;

  do {
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
  } while (cursor);

  channelNameCache = map;
  channelCacheExpiresAt = Date.now() + 5 * 60 * 1000;
  return map;
}

export async function resolveSlackChannelId(channelNameOrId: string) {
  const trimmed = channelNameOrId.trim();
  if (!trimmed) return null;
  if (/^[CDG][A-Z0-9]+$/i.test(trimmed)) return trimmed;

  const normalized = trimmed.replace(/^#/, "").toLowerCase();
  const map = await loadChannelNameMap();
  return map.get(normalized) ?? map.get(`#${normalized}`) ?? null;
}
