import { fetchChannelTopic, listSlackWorkspaceUsers, lookupSlackUserIdByEmail, setChannelTopic } from "@/lib/slack/client";
import { getStageTopicLabel } from "@/lib/slack/enum-replies";
import { updateChannelTopicStage, getSlackChannelForCaseNumber } from "@/lib/slack/channels";
import { normalizeSlackChannelId } from "@/lib/slack/client";
import {
  buildCaseTopic,
  caseStageFromTopicLabel,
  parseCaseTopic,
  slackHandleFromContactName,
  stageLabelFromCaseStage,
} from "@/lib/slack/topic-format";
import { type CaseRecord, type CaseStage } from "@/lib/types";

type SlackUserDirectoryEntry = {
  id: string;
  displayName: string;
  realName: string;
  firstName: string;
};

let userDirectoryCache: { fetchedAt: number; users: SlackUserDirectoryEntry[] } | null = null;
const USER_DIRECTORY_TTL_MS = 5 * 60 * 1000;

/** Topics we just wrote — used to ignore echo channel_topic events from our bot. */
const recentlyWrittenTopics = new Map<string, { topic: string; at: number }>();
const WRITTEN_TOPIC_TTL_MS = 60_000;

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

/** Stage label from structured or legacy channel topics. */
export function extractTopicStage(topic: string | null | undefined) {
  if (!topic?.trim()) return null;
  const parsed = parseCaseTopic(topic);
  if (parsed.stageLabel) return parsed.stageLabel;
  const match = topic.trim().match(/\(([^)]+)\)\s*$/);
  return match?.[1]?.trim() || null;
}

const TRAILING_TOPIC_STAGE_PATTERN = /\s*\([^)]*\)\s*$/;

/** Replace or append the trailing `(Status)` segment; preserves the rest of the topic verbatim. */
export function replaceTopicStage(topic: string, stageLabel: string) {
  const suffix = `(${stageLabel})`;
  if (TRAILING_TOPIC_STAGE_PATTERN.test(topic)) {
    return topic.replace(TRAILING_TOPIC_STAGE_PATTERN, ` ${suffix}`).trimEnd();
  }
  return `${topic.trimEnd()} ${suffix}`;
}

/** Attorney / paralegal segment from topics like `Attorney @Arielle | Paralegal @Adrian (Settled)`. */
export function extractTopicMentionPrefix(topic: string | null | undefined) {
  if (!topic?.trim()) return null;
  const trimmed = topic.trim();
  const withoutStage = trimmed.replace(/\s*\([^)]+\)\s*$/, "").trim();
  if (!withoutStage.includes("@")) return null;
  return withoutStage;
}

export function rememberWrittenTopic(channelId: string, topic: string) {
  recentlyWrittenTopics.set(channelId, { topic: topic.trim(), at: Date.now() });
}

export function wasTopicWrittenByUs(channelId: string, topic: string) {
  const entry = recentlyWrittenTopics.get(channelId);
  if (!entry) return false;
  if (Date.now() - entry.at > WRITTEN_TOPIC_TTL_MS) {
    recentlyWrittenTopics.delete(channelId);
    return false;
  }
  return entry.topic === topic.trim();
}

function topicHandleForUser(user: { name: string; slackDisplayName?: string | null }) {
  return user.slackDisplayName?.trim() || slackHandleFromContactName(user.name);
}

export async function syncSlackChannelTopicSummary(record: CaseRecord) {
  const mapping = await getSlackChannelForCaseNumber(record.shared.caseNumber);
  if (!mapping?.slackChannelId) {
    return { updated: false as const, reason: "no_channel" as const };
  }

  const channelId = normalizeSlackChannelId(mapping.slackChannelId);
  if (!channelId) {
    return { updated: false as const, reason: "invalid_channel" as const };
  }

  const stageLabel = stageLabelFromCaseStage(record.tracker.caseStage);
  const nextTopic = buildCaseTopic({
    usesEve: Boolean(record.shared.usesEve),
    attorneyHandle: topicHandleForUser({
      name: record.attorney.name,
      slackDisplayName: record.attorney.slackDisplayName,
    }),
    paralegalHandle: topicHandleForUser({
      name: record.paralegal.name,
      slackDisplayName: record.paralegal.slackDisplayName,
    }),
    attorneySlackUserId: record.attorney.slackUserId,
    paralegalSlackUserId: record.paralegal.slackUserId,
    stageLabel,
    primaryLanguage: record.shared.preferredLanguage,
    secondaryLanguage: record.shared.secondaryLanguage,
  });

  const currentTopic = await fetchChannelTopic(channelId);
  if (currentTopic?.trim() === nextTopic.trim()) {
    await updateChannelTopicStage(record.shared.caseNumber, stageLabel);
    return {
      updated: false as const,
      reason: "already_current" as const,
      topic: nextTopic,
      previousTopic: currentTopic,
      stageLabel,
      channelId,
    };
  }

  const set = await setChannelTopic(channelId, nextTopic);
  if (!set) {
    return {
      updated: false as const,
      reason: "set_failed" as const,
      topic: nextTopic,
      previousTopic: currentTopic,
      stageLabel,
      channelId,
    };
  }

  rememberWrittenTopic(channelId, nextTopic);
  await updateChannelTopicStage(record.shared.caseNumber, stageLabel);
  return {
    updated: true as const,
    topic: nextTopic,
    previousTopic: currentTopic,
    stageLabel,
    channelId,
  };
}

/** Admin / manual: push the structured topic for one case number. */
export async function syncSlackChannelTopicSummaryForCaseNumber(caseNumber: string) {
  const { cleanCaseNumber } = await import("@/lib/csv/parse");
  const { getCases } = await import("@/lib/supabase/services");
  const cleaned = cleanCaseNumber(caseNumber);
  if (!cleaned) {
    return { ok: false as const, reason: "no_case" as const, error: "Case number is required." };
  }

  const records = await getCases();
  const record = records.find((item) => cleanCaseNumber(item.shared.caseNumber) === cleaned);

  if (!record) {
    return { ok: false as const, reason: "no_case" as const, error: `No tracker case found for ${cleaned}.` };
  }

  const result = await syncSlackChannelTopicSummary(record);
  if (result.reason === "no_channel" || result.reason === "invalid_channel") {
    return {
      ok: false as const,
      reason: result.reason,
      error: `No Slack channel mapped for case ${record.shared.caseNumber}.`,
    };
  }
  if (result.reason === "set_failed") {
    return {
      ok: false as const,
      reason: result.reason,
      error: "Slack rejected the topic update (check channels:manage / bot membership).",
      previousTopic: result.previousTopic ?? null,
      topic: result.topic,
    };
  }

  return {
    ok: true as const,
    updated: result.updated,
    reason: result.reason,
    topic: result.topic ?? null,
    previousTopic: result.previousTopic ?? null,
    stageLabel: result.stageLabel ?? null,
    channelId: result.channelId ?? null,
    caseNumber: record.shared.caseNumber,
  };
}

/** @deprecated Prefer syncSlackChannelTopicSummary — kept for call sites that only know stage. */
export async function syncSlackChannelTopicForStage(input: {
  channelId: string;
  caseNumber: string;
  stage: CaseStage;
}) {
  const stageLabel = getStageTopicLabel(input.stage);
  const currentTopic = await fetchChannelTopic(input.channelId);

  if (!currentTopic?.trim()) {
    console.warn("Slack topic update skipped: could not read current channel topic", {
      channelId: input.channelId,
      caseNumber: input.caseNumber,
    });
    await updateChannelTopicStage(input.caseNumber, stageLabel);
    return { updated: false as const, reason: "no_current_topic" as const };
  }

  // If already structured, rebuild stage segment via full replace of stage label in pipe format.
  const { parseCaseTopic, buildCaseTopic: build } = await import("@/lib/slack/topic-format");
  const parsed = parseCaseTopic(currentTopic);
  if (
    parsed.format === "structured" &&
    parsed.primaryLanguage &&
    (parsed.attorneySlackUserId || parsed.attorneyHandle) &&
    (parsed.paralegalSlackUserId || parsed.paralegalHandle)
  ) {
    const nextTopic = build({
      usesEve: parsed.usesEve,
      attorneyHandle: parsed.attorneyHandle ?? "Attorney",
      paralegalHandle: parsed.paralegalHandle ?? "Paralegal",
      attorneySlackUserId: parsed.attorneySlackUserId,
      paralegalSlackUserId: parsed.paralegalSlackUserId,
      stageLabel,
      primaryLanguage: parsed.primaryLanguage,
      secondaryLanguage: parsed.secondaryLanguage,
    });
    if (currentTopic.trim() === nextTopic.trim()) {
      await updateChannelTopicStage(input.caseNumber, stageLabel);
      return { updated: false as const, reason: "already_current" as const };
    }
    const set = await setChannelTopic(input.channelId, nextTopic);
    if (!set) return { updated: false as const, reason: "set_failed" as const };
    rememberWrittenTopic(input.channelId, nextTopic);
    await updateChannelTopicStage(input.caseNumber, stageLabel);
    return { updated: true as const, topic: nextTopic };
  }

  const nextTopic = replaceTopicStage(currentTopic, stageLabel);
  const currentStageLabel = extractTopicStage(currentTopic);

  if (currentStageLabel?.toLowerCase() === stageLabel.toLowerCase()) {
    await updateChannelTopicStage(input.caseNumber, stageLabel);
    return { updated: false as const, reason: "already_current" as const };
  }

  const set = await setChannelTopic(input.channelId, nextTopic);
  if (!set) {
    return { updated: false as const, reason: "set_failed" as const };
  }

  rememberWrittenTopic(input.channelId, nextTopic);
  await updateChannelTopicStage(input.caseNumber, stageLabel);
  return { updated: true as const, topic: nextTopic };
}

export async function resolveChannelUserMentions(input: {
  topic: string | null | undefined;
  attorneyEmail?: string | null;
  paralegalEmail?: string | null;
  attorneyName?: string | null;
  paralegalName?: string | null;
  attorneySlackUserId?: string | null;
  paralegalSlackUserId?: string | null;
}) {
  const storedIds = [input.attorneySlackUserId, input.paralegalSlackUserId].filter(
    (id): id is string => Boolean(id?.trim()),
  );
  if (storedIds.length > 0) {
    return [...new Set(storedIds)].map((id) => `<@${id}>`).join(" ");
  }

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

export { caseStageFromTopicLabel };
