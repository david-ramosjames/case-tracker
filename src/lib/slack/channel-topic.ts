import { listSlackWorkspaceUsers, lookupSlackUserIdByEmail } from "@/lib/slack/client";

type SlackUserDirectoryEntry = {
  id: string;
  displayName: string;
  realName: string;
  firstName: string;
};

let userDirectoryCache: { fetchedAt: number; users: SlackUserDirectoryEntry[] } | null = null;
const USER_DIRECTORY_TTL_MS = 5 * 60 * 1000;

function isResolvableEmail(email: string | null | undefined) {
  const trimmed = email?.trim() ?? "";
  if (!trimmed.includes("@")) return false;
  return !trimmed.endsWith("@ramosjameslaw.local");
}

/** Slack mention tokens already embedded in a channel topic (`<@U…>`). */
export function extractSlackUserIdsFromTopic(topic: string | null | undefined) {
  if (!topic?.trim()) return [];
  const ids = [...topic.matchAll(/<@(U[A-Z0-9]+)(?:\|[^>]+)?>/gi)].map((match) => match[1]);
  return [...new Set(ids)];
}

/** Plain-text @handles from topics like `Attorney @Ryan | Paralegal @Lyliana`. */
export function extractAtHandlesFromTopic(topic: string | null | undefined) {
  if (!topic?.trim()) return [];
  const handles = [...topic.matchAll(/(?:^|[\s|(,])@([A-Za-z][\w.-]*)/g)].map((match) => match[1]);
  return [...new Set(handles)];
}

/** Extract Slack user mention tokens from a channel topic (Attorney <@U…> | Paralegal <@U…>). */
export function formatTopicUserMentions(topic: string | null | undefined) {
  return extractSlackUserIdsFromTopic(topic)
    .map((id) => `<@${id}>`)
    .join(" ");
}

function normalizeHandle(value: string) {
  return value.trim().toLowerCase().replace(/[._-]+/g, "");
}

function matchUserIdByHandle(users: SlackUserDirectoryEntry[], handle: string) {
  const target = normalizeHandle(handle);
  if (!target) return null;

  for (const user of users) {
    const candidates = [user.displayName, user.realName, user.firstName];
    for (const candidate of candidates) {
      const normalized = normalizeHandle(candidate);
      if (!normalized) continue;
      if (normalized === target || normalized.startsWith(target) || target.startsWith(normalized)) {
        return user.id;
      }
    }
  }

  return null;
}

async function loadSlackUserDirectory() {
  if (userDirectoryCache && Date.now() - userDirectoryCache.fetchedAt < USER_DIRECTORY_TTL_MS) {
    return userDirectoryCache.users;
  }

  try {
    const users = await listSlackWorkspaceUsers();
    userDirectoryCache = { fetchedAt: Date.now(), users };
    return users;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("missing_scope")) {
      console.warn("Slack users.list unavailable; using topic mention tokens and email lookup only.");
      userDirectoryCache = { fetchedAt: Date.now(), users: [] };
      return [];
    }
    throw error;
  }
}

/** Attorney / paralegal segment from topics like `Attorney @Arielle | Paralegal @Adrian (Settled)`. */
export function extractTopicMentionPrefix(topic: string | null | undefined) {
  if (!topic?.trim()) return null;
  const trimmed = topic.trim();
  const withoutStage = trimmed.replace(/\s*\([^)]+\)\s*$/, "").trim();
  if (!withoutStage.includes("@")) return null;
  return withoutStage;
}

export async function resolveChannelUserMentions(input: {
  topic: string | null | undefined;
  attorneyEmail?: string | null;
  paralegalEmail?: string | null;
  attorneyName?: string | null;
  paralegalName?: string | null;
}) {
  const topicUserIds = extractSlackUserIdsFromTopic(input.topic);
  if (topicUserIds.length > 0) {
    return topicUserIds.map((id) => `<@${id}>`).join(" ");
  }

  const ids = new Set<string>();
  let directory: SlackUserDirectoryEntry[] | null = null;

  async function getDirectory() {
    directory ??= await loadSlackUserDirectory();
    return directory;
  }

  if (input.topic?.trim()) {
    const handles = extractAtHandlesFromTopic(input.topic);
    if (handles.length > 0) {
      const users = await getDirectory();
      for (const handle of handles) {
        const userId = matchUserIdByHandle(users, handle);
        if (userId) ids.add(userId);
      }
    }
  }

  for (const email of [input.attorneyEmail, input.paralegalEmail]) {
    if (!isResolvableEmail(email)) continue;
    const userId = await lookupSlackUserIdByEmail(email!);
    if (userId) ids.add(userId);
  }

  if (ids.size === 0) {
    const users = await getDirectory();
    for (const name of [input.attorneyName, input.paralegalName]) {
      const trimmed = name?.trim();
      if (!trimmed) continue;
      const firstName = trimmed.split(/\s+/)[0];
      const userId = matchUserIdByHandle(users, firstName) ?? matchUserIdByHandle(users, trimmed);
      if (userId) ids.add(userId);
    }
  }

  if (ids.size > 0) {
    return [...ids].map((id) => `<@${id}>`).join(" ");
  }

  return extractTopicMentionPrefix(input.topic) ?? "";
}
