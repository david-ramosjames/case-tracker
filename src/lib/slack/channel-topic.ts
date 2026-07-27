import { fetchChannelTopic, fetchChannelTopicResult, listSlackWorkspaceUsers, lookupSlackUserIdByEmail, setChannelTopic } from "@/lib/slack/client";
import { getStageTopicLabel } from "@/lib/slack/enum-replies";
import {
  updateChannelTopicStage,
  getSlackChannelForCaseNumber,
  markChannelTopicSynced,
  loadSlackChannelMapByCaseNumber,
} from "@/lib/slack/channels";
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

export function buildExpectedCaseTopic(record: CaseRecord) {
  return buildCaseTopic({
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
    stageLabel: stageLabelFromCaseStage(record.tracker.caseStage),
    primaryLanguage: record.shared.preferredLanguage,
    secondaryLanguage: record.shared.secondaryLanguage,
  });
}

function topicsEquivalent(current: string | null | undefined, expected: string) {
  if (!current?.trim()) return false;
  if (current.trim() === expected.trim()) return true;

  // Semantic compare — Slack may normalize emoji shortcodes vs unicode.
  const a = parseCaseTopic(current);
  const b = parseCaseTopic(expected);
  if (a.format !== "structured" || b.format !== "structured") return false;

  return (
    a.usesEve === b.usesEve &&
    (a.attorneySlackUserId || a.attorneyHandle)?.toLowerCase() ===
      (b.attorneySlackUserId || b.attorneyHandle)?.toLowerCase() &&
    (a.paralegalSlackUserId || a.paralegalHandle)?.toLowerCase() ===
      (b.paralegalSlackUserId || b.paralegalHandle)?.toLowerCase() &&
    (a.stageLabel ?? "").trim().toLowerCase() === (b.stageLabel ?? "").trim().toLowerCase() &&
    a.primaryLanguage === b.primaryLanguage &&
    a.secondaryLanguage === b.secondaryLanguage
  );
}

export async function syncSlackChannelTopicSummary(
  record: CaseRecord,
  options: { skipRead?: boolean } = {},
) {
  const mapping = await getSlackChannelForCaseNumber(record.shared.caseNumber);
  if (!mapping?.slackChannelId) {
    return { updated: false as const, reason: "no_channel" as const };
  }

  const channelId = normalizeSlackChannelId(mapping.slackChannelId);
  if (!channelId) {
    return { updated: false as const, reason: "invalid_channel" as const };
  }

  const stageLabel = stageLabelFromCaseStage(record.tracker.caseStage);
  const nextTopic = buildExpectedCaseTopic(record);

  // Avoid Slack notifications: if we already wrote this exact topic, do not setTopic again.
  if (mapping.topicLastWritten?.trim() === nextTopic.trim()) {
    await markChannelTopicSynced(record.shared.caseNumber, stageLabel, nextTopic);
    return {
      updated: false as const,
      reason: "already_current" as const,
      topic: nextTopic,
      previousTopic: mapping.topicLastWritten,
      stageLabel,
      channelId,
    };
  }

  let currentTopic: string | null = null;
  if (!options.skipRead) {
    currentTopic = await fetchChannelTopic(channelId);
    if (topicsEquivalent(currentTopic, nextTopic)) {
      await markChannelTopicSynced(record.shared.caseNumber, stageLabel, nextTopic);
      return {
        updated: false as const,
        reason: "already_current" as const,
        topic: nextTopic,
        previousTopic: currentTopic,
        stageLabel,
        channelId,
      };
    }
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
  await markChannelTopicSynced(record.shared.caseNumber, stageLabel, nextTopic);
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

export type SlackTopicBulkSyncLogEntry = {
  caseNumber: string;
  clientName: string | null;
  channelName: string | null;
  channelId: string | null;
  status: "updated" | "already_current" | "failed";
  message?: string;
  topic?: string | null;
  previousTopic?: string | null;
};

export type SlackTopicBulkSyncSkippedChannel = {
  caseNumber: string;
  channelName: string | null;
  channelId: string | null;
};

export type SlackTopicBulkSyncResult = {
  /** Case channels in the sheet mapping that were processed. */
  total: number;
  updated: number;
  alreadyCurrent: number;
  setFailed: number;
  /** Sheet rows with no matching Case Tracker case — Slack topics not touched. */
  skippedNoCase: number;
  skippedNoCaseChannels: SlackTopicBulkSyncSkippedChannel[];
  /** Per-channel outcome for every processed Case Tracker case. */
  log: SlackTopicBulkSyncLogEntry[];
  /** Subset of log where the Slack topic was rewritten. */
  updatedChannels: SlackTopicBulkSyncLogEntry[];
  errors: string[];
  /** True when stopped early to stay within server time limits. */
  truncated: boolean;
  /** Total rows in case_slack_channels (Google Sheet import). */
  mappedChannelCount: number;
};

export type SlackTopicAuditStatus =
  | "current"
  | "legacy"
  | "mismatch"
  | "empty"
  | "fetch_failed"
  | "unstructured";

export type SlackTopicAuditEntry = {
  caseNumber: string;
  clientName: string | null;
  channelName: string | null;
  channelId: string | null;
  status: SlackTopicAuditStatus;
  topicSyncedAt: string | null;
  currentTopic: string | null;
  expectedTopic: string;
  /** Present when status is fetch_failed — Slack API error detail. */
  error?: string | null;
};

export type SlackTopicAuditResult = {
  checked: number;
  current: number;
  outdated: number;
  fetchFailed: number;
  truncated: boolean;
  mappedChannelCount: number;
  skippedNoCase: number;
  /** Outdated first (never synced / oldest), then failures. */
  outdatedChannels: SlackTopicAuditEntry[];
  fetchFailedChannels: SlackTopicAuditEntry[];
};

export type SlackTopicBulkSyncOptions = {
  /** Only rewrite channels whose live Slack topic does not match Case Tracker. */
  outdatedOnly?: boolean;
  /**
   * Skip conversations.info and only call setTopic.
   * Use when Slack is rate-limiting info reads. Prefer neverSyncedOnly with this.
   */
  skipRead?: boolean;
  /** Only channels that have never had topic_synced_at set (the remaining backlog). */
  neverSyncedOnly?: boolean;
};

const BULK_TOPIC_SYNC_DELAY_MS = 350;
/** ~2 Slack API calls per case; stay under Vercel limits for large channel lists. */
const BULK_TOPIC_SYNC_MAX_CASES = 400;
/** conversations.info is easy to rate-limit; keep audit paced. */
const TOPIC_AUDIT_DELAY_MS = 450;
const TOPIC_AUDIT_MAX_CASES = 500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sortByOldestTopicSync<T extends { topicSyncedAt: string | null; caseNumber: string }>(items: T[]) {
  return [...items].sort((a, b) => {
    if (!a.topicSyncedAt && b.topicSyncedAt) return -1;
    if (a.topicSyncedAt && !b.topicSyncedAt) return 1;
    if (a.topicSyncedAt && b.topicSyncedAt && a.topicSyncedAt !== b.topicSyncedAt) {
      return a.topicSyncedAt.localeCompare(b.topicSyncedAt);
    }
    return a.caseNumber.localeCompare(b.caseNumber, undefined, { numeric: true });
  });
}

function classifyTopicDrift(
  fetch: { ok: true; topic: string } | { ok: false; error: string },
  expectedTopic: string,
): SlackTopicAuditStatus {
  if (!fetch.ok) return "fetch_failed";
  if (!fetch.topic.trim()) return "empty";
  if (topicsEquivalent(fetch.topic, expectedTopic)) return "current";
  const parsed = parseCaseTopic(fetch.topic);
  if (parsed.format === "legacy") return "legacy";
  if (parsed.format === "structured") return "mismatch";
  return "unstructured";
}

function shortenSlackError(error: string) {
  const trimmed = error.trim();
  if (trimmed.includes("ratelimited")) return "rate limited by Slack — run audit again";
  if (trimmed.includes("not_in_channel")) return "bot not in channel (private channels need /invite)";
  if (trimmed.includes("channel_not_found")) return "channel not found (stale sheet ID?)";
  if (trimmed.includes("missing_scope")) return "missing Slack API scope";
  if (trimmed.includes("invalid_channel_id")) return "invalid channel ID";
  return trimmed.slice(0, 120);
}

/**
 * Read-only: compare live Slack topics to what Case Tracker would write.
 * Outdated list is sorted never-synced / oldest topic_synced_at first.
 */
export async function auditSlackChannelTopicSummaries(): Promise<SlackTopicAuditResult> {
  const { cleanCaseNumber } = await import("@/lib/csv/parse");
  const { getCases } = await import("@/lib/supabase/services");

  const [cases, channelMap] = await Promise.all([getCases(), loadSlackChannelMapByCaseNumber()]);
  const caseNumbersInTracker = new Set(cases.map((record) => cleanCaseNumber(record.shared.caseNumber)));

  let skippedNoCase = 0;
  for (const caseNumber of channelMap.keys()) {
    if (!caseNumbersInTracker.has(caseNumber)) skippedNoCase++;
  }

  const mappedCases = cases
    .map((record) => {
      const key = cleanCaseNumber(record.shared.caseNumber);
      const mapping = channelMap.get(key);
      if (!key || !mapping?.slackChannelId?.trim()) return null;
      return {
        record,
        mapping,
        topicSyncedAt: mapping.topicSyncedAt ?? null,
        caseNumber: record.shared.caseNumber,
      };
    })
    .filter(Boolean) as Array<{
    record: CaseRecord;
    mapping: NonNullable<ReturnType<typeof channelMap.get>>;
    topicSyncedAt: string | null;
    caseNumber: string;
  }>;

  const ordered = sortByOldestTopicSync(mappedCases);
  const truncated = ordered.length > TOPIC_AUDIT_MAX_CASES;
  const batch = ordered.slice(0, TOPIC_AUDIT_MAX_CASES);

  const outdatedChannels: SlackTopicAuditEntry[] = [];
  const fetchFailedChannels: SlackTopicAuditEntry[] = [];
  let current = 0;

  for (let index = 0; index < batch.length; index++) {
    const item = batch[index]!;
    const channelId = normalizeSlackChannelId(item.mapping.slackChannelId ?? "");
    const expectedTopic = buildExpectedCaseTopic(item.record);
    const fetch = channelId
      ? await fetchChannelTopicResult(channelId)
      : ({ ok: false, error: "invalid_channel_id" } as const);
    const status = classifyTopicDrift(fetch, expectedTopic);

    const entry: SlackTopicAuditEntry = {
      caseNumber: item.record.shared.caseNumber,
      clientName: item.record.shared.clientName?.trim() || null,
      channelName: item.mapping.slackChannelName?.trim() || null,
      channelId: item.mapping.slackChannelId?.trim() || null,
      status,
      topicSyncedAt: item.topicSyncedAt,
      currentTopic: fetch.ok ? fetch.topic.slice(0, 240) : null,
      expectedTopic,
      error: fetch.ok ? null : shortenSlackError(fetch.error),
    };

    if (status === "current") {
      current++;
      // Confirm sync timestamp when we find a match and DB has never recorded one.
      if (!item.topicSyncedAt) {
        await markChannelTopicSynced(
          item.record.shared.caseNumber,
          stageLabelFromCaseStage(item.record.tracker.caseStage),
          expectedTopic,
        );
      }
    } else if (status === "fetch_failed") {
      fetchFailedChannels.push(entry);
    } else {
      outdatedChannels.push(entry);
    }

    if (index < batch.length - 1 && TOPIC_AUDIT_DELAY_MS > 0) {
      await sleep(TOPIC_AUDIT_DELAY_MS);
    }
  }

  return {
    checked: batch.length,
    current,
    outdated: outdatedChannels.length,
    fetchFailed: fetchFailedChannels.length,
    truncated,
    mappedChannelCount: channelMap.size,
    skippedNoCase,
    outdatedChannels,
    fetchFailedChannels,
  };
}

/** Admin / manual: push structured topics for mapped case channels. */
export async function syncAllSlackChannelTopicSummaries(
  options: SlackTopicBulkSyncOptions = {},
): Promise<SlackTopicBulkSyncResult> {
  const { cleanCaseNumber } = await import("@/lib/csv/parse");
  const { getCases } = await import("@/lib/supabase/services");

  const [cases, channelMap] = await Promise.all([getCases(), loadSlackChannelMapByCaseNumber()]);

  const caseNumbersInTracker = new Set(cases.map((record) => cleanCaseNumber(record.shared.caseNumber)));

  const skippedNoCaseChannels: SlackTopicBulkSyncSkippedChannel[] = [];
  for (const [caseNumber, channel] of channelMap) {
    if (caseNumbersInTracker.has(caseNumber)) continue;
    skippedNoCaseChannels.push({
      caseNumber,
      channelName: channel.slackChannelName?.trim() || null,
      channelId: channel.slackChannelId?.trim() || null,
    });
  }
  skippedNoCaseChannels.sort((a, b) => a.caseNumber.localeCompare(b.caseNumber, undefined, { numeric: true }));

  let mappedCases = cases
    .map((record) => {
      const key = cleanCaseNumber(record.shared.caseNumber);
      const mapping = channelMap.get(key);
      if (!key || !mapping?.slackChannelId?.trim()) return null;
      return {
        record,
        mapping,
        topicSyncedAt: mapping.topicSyncedAt ?? null,
        caseNumber: record.shared.caseNumber,
      };
    })
    .filter(Boolean) as Array<{
    record: CaseRecord;
    mapping: NonNullable<ReturnType<typeof channelMap.get>>;
    topicSyncedAt: string | null;
    caseNumber: string;
  }>;

  // Prefer never-synced / oldest confirmed sync first.
  mappedCases = sortByOldestTopicSync(mappedCases);

  if (options.neverSyncedOnly) {
    mappedCases = mappedCases.filter((item) => !item.topicSyncedAt);
  }

  if (options.outdatedOnly && !options.skipRead) {
    const outdated: typeof mappedCases = [];
    for (let index = 0; index < mappedCases.length; index++) {
      const item = mappedCases[index]!;
      const channelId = normalizeSlackChannelId(item.mapping.slackChannelId ?? "");
      if (!channelId) continue;
      const expected = buildExpectedCaseTopic(item.record);
      const current = await fetchChannelTopic(channelId);
      if (!topicsEquivalent(current, expected)) {
        outdated.push(item);
      } else if (!item.topicSyncedAt) {
        await markChannelTopicSynced(
          item.record.shared.caseNumber,
          stageLabelFromCaseStage(item.record.tracker.caseStage),
          expected,
        );
      }
      if (index < mappedCases.length - 1 && TOPIC_AUDIT_DELAY_MS > 0) {
        await sleep(TOPIC_AUDIT_DELAY_MS);
      }
      // Keep scan bounded so we still have time to write.
      if (outdated.length >= BULK_TOPIC_SYNC_MAX_CASES) break;
    }
    mappedCases = outdated;
  }

  const skipRead = Boolean(options.skipRead);
  const writeDelayMs = skipRead ? 500 : BULK_TOPIC_SYNC_DELAY_MS;

  const result: SlackTopicBulkSyncResult = {
    total: 0,
    updated: 0,
    alreadyCurrent: 0,
    setFailed: 0,
    skippedNoCase: skippedNoCaseChannels.length,
    skippedNoCaseChannels,
    log: [],
    updatedChannels: [],
    errors: [],
    truncated: mappedCases.length > BULK_TOPIC_SYNC_MAX_CASES,
    mappedChannelCount: channelMap.size,
  };

  const batch = mappedCases.slice(0, BULK_TOPIC_SYNC_MAX_CASES);

  for (let index = 0; index < batch.length; index++) {
    const item = batch[index]!;
    const record = item.record;
    const mapping = item.mapping;
    result.total++;

    const baseEntry = {
      caseNumber: record.shared.caseNumber,
      clientName: record.shared.clientName?.trim() || null,
      channelName: mapping.slackChannelName?.trim() || null,
      channelId: mapping.slackChannelId?.trim() || null,
    };

    try {
      const syncResult = await syncSlackChannelTopicSummary(record, { skipRead });
      if (syncResult.updated) {
        result.updated++;
        const entry: SlackTopicBulkSyncLogEntry = {
          ...baseEntry,
          status: "updated",
          topic: syncResult.topic ?? null,
          previousTopic: syncResult.previousTopic ?? null,
        };
        result.log.push(entry);
        result.updatedChannels.push(entry);
      } else if (syncResult.reason === "already_current") {
        result.alreadyCurrent++;
        result.log.push({
          ...baseEntry,
          status: "already_current",
          topic: syncResult.topic ?? null,
        });
      } else if (syncResult.reason === "set_failed") {
        result.setFailed++;
        const message = "Slack rejected the topic update";
        result.errors.push(`${record.shared.caseNumber}: ${message}`);
        result.log.push({ ...baseEntry, status: "failed", message });
      } else {
        result.setFailed++;
        const message = syncResult.reason ?? "unknown";
        result.errors.push(`${record.shared.caseNumber}: ${message}`);
        result.log.push({ ...baseEntry, status: "failed", message });
      }
    } catch (error) {
      result.setFailed++;
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${record.shared.caseNumber}: ${message}`);
      result.log.push({ ...baseEntry, status: "failed", message });
    }

    if (index < batch.length - 1 && writeDelayMs > 0) {
      await sleep(writeDelayMs);
    }
  }

  if (result.errors.length > 20) {
    const extra = result.errors.length - 20;
    result.errors = result.errors.slice(0, 20);
    result.errors.push(`…and ${extra} more error(s)`);
  }

  return result;
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
