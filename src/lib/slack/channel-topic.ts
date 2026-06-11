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

  const users = await listSlackWorkspaceUsers();
  userDirectoryCache = { fetchedAt: Date.now(), users };
  return users;
}

export async function resolveChannelUserMentions(input: {
  topic: string | null | undefined;
  attorneyEmail?: string | null;
  paralegalEmail?: string | null;
}) {
  const ids = new Set(extractSlackUserIdsFromTopic(input.topic));

  if (ids.size === 0 && input.topic?.trim()) {
    const handles = extractAtHandlesFromTopic(input.topic);
    if (handles.length > 0) {
      const directory = await loadSlackUserDirectory();
      for (const handle of handles) {
        const userId = matchUserIdByHandle(directory, handle);
        if (userId) ids.add(userId);
      }
    }
  }

  if (ids.size === 0) {
    for (const email of [input.attorneyEmail, input.paralegalEmail]) {
      if (!isResolvableEmail(email)) continue;
      const userId = await lookupSlackUserIdByEmail(email!);
      if (userId) ids.add(userId);
    }
  }

  return [...ids].map((id) => `<@${id}>`).join(" ");
}
