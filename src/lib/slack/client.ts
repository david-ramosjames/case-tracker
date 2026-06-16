import { getSlackBotToken, isSlackEnabled } from "@/lib/slack/config";
import { errorMessage } from "@/lib/utils";

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

function isNotInChannelError(error: unknown) {
  return errorMessage(error).includes("not_in_channel");
}

/** Join public channels before posting. Private channels must invite the bot manually. */
async function ensureSlackChannelMembership(channelId: string) {
  try {
    await slackApi<{ ok: boolean }>("conversations.join", { channel: channelId });
  } catch (error) {
    const message = errorMessage(error);
    if (message.includes("already_in_channel")) return;
    // Private channels cannot be joined via API — invite @Case Tracker in Slack.
    if (
      message.includes("method_not_supported_for_channel_type") ||
      message.includes("channel_not_found") ||
      message.includes("missing_scope")
    ) {
      return;
    }
    throw error;
  }
}

type SlackUserListMember = {
  id?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: {
    display_name?: string;
    real_name?: string;
    first_name?: string;
    email?: string;
  };
  name?: string;
};

export async function lookupSlackUserIdByEmail(email: string) {
  if (!isSlackEnabled()) return null;

  try {
    const payload = await slackApi<{ ok: boolean; user?: { id?: string } }>("users.lookupByEmail", {
      email: email.trim(),
    });
    return payload.user?.id ?? null;
  } catch (error) {
    console.warn("Slack users.lookupByEmail failed", { email, error: errorMessage(error) });
    return null;
  }
}

export async function listSlackWorkspaceUsers() {
  if (!isSlackEnabled()) return [];

  const users: Array<{
    id: string;
    displayName: string;
    realName: string;
    firstName: string;
  }> = [];
  let cursor: string | undefined;

  do {
    const payload = await slackApi<{
      ok: boolean;
      members?: SlackUserListMember[];
      response_metadata?: { next_cursor?: string };
    }>("users.list", {
      limit: 200,
      cursor,
    });

    for (const member of payload.members ?? []) {
      if (!member.id || member.deleted || member.is_bot) continue;
      users.push({
        id: member.id,
        displayName: member.profile?.display_name?.trim() || member.name?.trim() || "",
        realName: member.profile?.real_name?.trim() || "",
        firstName: member.profile?.first_name?.trim() || "",
      });
    }

    cursor = payload.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return users;
}

export async function fetchChannelTopic(channelId: string) {
  if (!isSlackEnabled()) return null;

  try {
    const payload = await slackApi<{
      ok: boolean;
      channel?: { topic?: { value?: string } | string };
    }>("conversations.info", {
      channel: resolveSlackChannelParam(channelId),
    });

    const topic = payload.channel?.topic;
    if (typeof topic === "string") return topic.trim() || null;
    return topic?.value?.trim() || null;
  } catch (error) {
    console.warn("Slack channel topic fetch failed", { channelId, error: errorMessage(error) });
    return null;
  }
}

export async function setChannelTopic(channelId: string, topic: string) {
  if (!isSlackEnabled()) return false;

  const channel = resolveSlackChannelParam(channelId);
  const trimmed = topic.trim();
  if (!trimmed) return false;

  async function attemptSet() {
    await slackApi<{ ok: boolean }>("conversations.setTopic", {
      channel,
      topic: trimmed,
    });
    return true;
  }

  try {
    return await attemptSet();
  } catch (error) {
    if (!isNotInChannelError(error)) {
      const message = errorMessage(error);
      if (message.includes("missing_scope")) {
        console.warn("Slack topic update skipped: add channels:manage (and groups:write for private channels)", {
          channelId,
        });
        return false;
      }
      console.warn("Slack channel topic update failed", { channelId, error: message });
      return false;
    }

    await ensureSlackChannelMembership(channel);

    try {
      return await attemptSet();
    } catch (retryError) {
      const message = errorMessage(retryError);
      if (isNotInChannelError(retryError) || message.includes("missing_scope")) {
        console.warn("Slack topic update skipped", { channelId, error: message });
        return false;
      }
      console.warn("Slack channel topic update failed", { channelId, error: message });
      return false;
    }
  }
}

export async function postSlackMessage(input: {
  channel: string;
  text: string;
  threadTs?: string;
  blocks?: Array<Record<string, unknown>>;
}) {
  if (!isSlackEnabled()) return null;

  const channel = resolveSlackChannelParam(input.channel);

  async function attemptPost() {
    const payload = await slackApi<SlackPostMessageResponse>("chat.postMessage", {
      channel,
      text: input.text,
      thread_ts: input.threadTs,
      blocks: input.blocks,
      unfurl_links: false,
    });
    return { channel: payload.channel ?? input.channel, ts: payload.ts ?? null };
  }

  try {
    return await attemptPost();
  } catch (error) {
    if (!isNotInChannelError(error)) throw error;

    await ensureSlackChannelMembership(channel);

    try {
      return await attemptPost();
    } catch (retryError) {
      if (isNotInChannelError(retryError)) {
        console.warn("Slack post skipped: bot is not in channel", { channel });
        return null;
      }
      throw retryError;
    }
  }
}

let channelNameCache: Map<string, string> | null = null;
let channelIdToNameCache: Map<string, string> | null = null;
let channelCacheExpiresAt = 0;

/** Load all workspace channels once (cached 30 min). Used only if resolving by name. */
export async function loadChannelNameMap(forceRefresh = false) {
  if (!forceRefresh && channelNameCache && channelIdToNameCache && Date.now() < channelCacheExpiresAt) {
    return channelNameCache;
  }

  const map = new Map<string, string>();
  const idToName = new Map<string, string>();
  let cursor: string | undefined;
  let page = 0;

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
      idToName.set(channel.id, channel.name);
    }

    cursor = payload.response_metadata?.next_cursor || undefined;
    page += 1;
  } while (cursor);

  channelNameCache = map;
  channelIdToNameCache = idToName;
  channelCacheExpiresAt = Date.now() + 30 * 60 * 1000;
  return map;
}

export async function loadChannelIdToNameMap(forceRefresh = false) {
  await loadChannelNameMap(forceRefresh);
  return channelIdToNameCache ?? new Map<string, string>();
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

export type SlackHistoryMessage = {
  ts: string;
  text?: string;
  blocks?: Array<Record<string, unknown>>;
  attachments?: Array<{
    text?: string;
    fallback?: string;
    blocks?: Array<Record<string, unknown>>;
  }>;
};

function collectRichTextElements(
  element: Record<string, unknown>,
  channelIdToName?: Map<string, string>,
): string[] {
  if (element.type === "text" && typeof element.text === "string") return [element.text];
  if (element.type === "link" && typeof element.url === "string") {
    const label = typeof element.text === "string" ? element.text : element.url;
    return [label];
  }
  if (element.type === "emoji" && typeof element.name === "string") return [`:${element.name}:`];
  if (element.type === "channel" && typeof element.channel_id === "string") {
    const name = channelIdToName?.get(element.channel_id);
    return [name ? `#${name}` : `<#${element.channel_id}>`];
  }
  if (!Array.isArray(element.elements)) return [];
  return element.elements.flatMap((child) =>
    collectRichTextElements(child as Record<string, unknown>, channelIdToName),
  );
}

function richTextSectionToLine(section: Record<string, unknown>, channelIdToName?: Map<string, string>) {
  return collectRichTextElements(section, channelIdToName).join("");
}

function collectBlockText(block: Record<string, unknown>, channelIdToName?: Map<string, string>): string[] {
  const parts: string[] = [];
  const type = block.type;

  if ((type === "section" || type === "header") && block.text && typeof block.text === "object") {
    const text = (block.text as { text?: string }).text;
    if (text) parts.push(text);
    return parts;
  }

  if (type === "rich_text_list" && Array.isArray(block.elements)) {
    for (const element of block.elements) {
      if (!element || typeof element !== "object") continue;
      const line = richTextSectionToLine(element as Record<string, unknown>, channelIdToName);
      if (line) parts.push(`• ${line}`);
    }
    return parts;
  }

  if (
    (type === "rich_text_section" ||
      type === "rich_text_quote" ||
      type === "rich_text_preformatted") &&
    Array.isArray(block.elements)
  ) {
    const line = richTextSectionToLine(block, channelIdToName);
    if (line) parts.push(line);
    return parts;
  }

  if (type === "rich_text" && Array.isArray(block.elements)) {
    for (const element of block.elements) {
      if (element && typeof element === "object") {
        parts.push(...collectBlockText(element as Record<string, unknown>, channelIdToName));
      }
    }
    return parts;
  }

  if (Array.isArray(block.elements)) {
    for (const element of block.elements) {
      if (element && typeof element === "object") {
        parts.push(...collectBlockText(element as Record<string, unknown>, channelIdToName));
      }
    }
  }

  return parts;
}

function collectMessageBodyParts(message: SlackHistoryMessage, channelIdToName?: Map<string, string>) {
  const parts: string[] = [];

  for (const block of message.blocks ?? []) {
    parts.push(...collectBlockText(block, channelIdToName));
  }
  for (const attachment of message.attachments ?? []) {
    if (attachment.text) parts.push(attachment.text);
    if (attachment.fallback) parts.push(attachment.fallback);
    for (const block of attachment.blocks ?? []) {
      parts.push(...collectBlockText(block, channelIdToName));
    }
  }

  return parts;
}

/** Merge plain-text preview and Block Kit body — Pulse puts bullets only in blocks. */
export function extractSlackMessageText(
  message: SlackHistoryMessage,
  channelIdToName?: Map<string, string>,
) {
  const blockParts = collectMessageBodyParts(message, channelIdToName);
  const blockText = blockParts.join("\n").trim();
  const plainText = message.text?.trim() ?? "";

  if (blockText && plainText) {
    if (blockText.includes(plainText)) return blockText;
    return `${plainText}\n${blockText}`;
  }

  return blockText || plainText;
}

export function extractSlackMessageTextForParsing(
  message: SlackHistoryMessage,
  channelIdToName: Map<string, string> = new Map(),
) {
  let text = extractSlackMessageText(message, channelIdToName);
  text = text.replace(/<#([CGD][A-Z0-9]+)>/gi, (_, id: string) => {
    const name = channelIdToName.get(id);
    return name ? `#${name}` : `#${id}`;
  });
  text = text.replace(/#([CGD][A-Z0-9]+)\b/g, (match, id: string) => {
    const name = channelIdToName.get(id);
    return name ? `#${name}` : match;
  });
  return text;
}

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

/** Paginated channel history for pulse lookback (newest pages first, returned oldest→newest). */
export async function fetchChannelHistorySince(
  channelId: string,
  options?: { oldest?: string; latest?: string; maxMessages?: number },
): Promise<SlackHistoryMessage[]> {
  if (!isSlackEnabled()) return [];

  const maxMessages = options?.maxMessages ?? 200;
  const collected: SlackHistoryMessage[] = [];
  let cursor: string | undefined;

  while (collected.length < maxMessages) {
    const limit = Math.min(100, maxMessages - collected.length);
    const payload = await slackApi<{
      ok: boolean;
      messages?: SlackHistoryMessage[];
      response_metadata?: { next_cursor?: string };
    }>("conversations.history", {
      channel: resolveSlackChannelParam(channelId),
      limit,
      oldest: options?.oldest,
      latest: options?.latest,
      inclusive: false,
      cursor,
    });

    const batch = payload.messages ?? [];
    if (batch.length === 0) break;
    collected.push(...batch);

    cursor = payload.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }

  const deduped = new Map<string, SlackHistoryMessage>();
  for (const message of collected) {
    if (message.ts) deduped.set(message.ts, message);
  }

  return [...deduped.values()].sort((a, b) => Number(a.ts) - Number(b.ts));
}
