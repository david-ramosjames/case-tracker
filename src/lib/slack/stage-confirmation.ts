import { getAppOriginForNotifications } from "@/lib/auth/redirect-url";
import { resolveChannelUserMentions } from "@/lib/slack/channel-topic";
import { loadPulseChannelContext, type PulseChannelMatch } from "@/lib/slack/channels";
import { caseNumberFromPulseChannelRef } from "@/lib/slack/pulse";
import {
  extractSlackMessageTextForParsing,
  fetchChannelHistory,
  fetchChannelTopic,
  postSlackMessage,
} from "@/lib/slack/client";
import { getDailyPulseChannelId, isSlackEnabled } from "@/lib/slack/config";
import {
  isIgnoredPulseChannelRef,
  isPulseStatusRecapMessage,
  normalizePulseChannelRef,
  normalizeSlackMessageMarkup,
  parseDailyPulseMessage,
  type ParsedPulseItem,
} from "@/lib/slack/pulse";
import {
  isStageConfirmationReaction,
  parseStageConfirmationText,
} from "@/lib/slack/stage-confirmation-parse";
import { buildStagePatchFromConfirmation, shouldSkipPulseSuggestion } from "@/lib/stage-triggers";
import { getCaseById, updateTrackerEntry } from "@/lib/supabase/services";
import { findCaseByStageUpdateThread } from "@/lib/slack/channels";
import { getStageSlackOptions } from "@/lib/slack/enum-replies";
import {
  applyConfirmedStage,
  createStageSuggestion,
  dismissStageSuggestionById,
  findPulseLineSuggestion,
  findStageSuggestionByConfirmationThread,
  getCaseIdForSuggestion,
  getDailyPulseLastTs,
  getOpenStageSuggestionForCase,
  markStageSuggestionPosted,
  setDailyPulseLastTs,
  wasPulseItemHandled,
} from "@/lib/supabase/stage-suggestions";
import { type CaseStage } from "@/lib/types";
import { errorMessage } from "@/lib/utils";

function stageDisplay(stage: CaseStage) {
  const labels: Record<CaseStage, string> = {
    Onboarding: "Onboarding",
    Txt: "Treatment",
    Dmd: "Demand",
    Lit: "Litigation",
    Settled: "Settled",
    Disengaged: "Disengaged",
    Terminated: "Terminated",
    Referred: "Referred",
  };
  return labels[stage] ?? stage;
}

export function buildStageConfirmationMessage(input: {
  suggestedStage: CaseStage;
  confidence: string;
  appUrl: string;
  caseId: string;
  topicMentions?: string;
  markDisbursed?: boolean;
}) {
  const stage = stageDisplay(input.suggestedStage);
  const confidence = input.confidence.toLowerCase();
  const lines: string[] = [];

  if (input.topicMentions) {
    lines.push(input.topicMentions);
  }

  if (input.markDisbursed) {
    lines.push(
      `Bot suggests case status is: *${stage}* and *Disbursed: Yes* (${confidence} confidence)`,
      "",
      "Reply in this thread with ✅ or `confirmed` to set stage to Settled and mark disbursed Yes.",
    );
  } else {
    lines.push(
      `Bot suggests case status is: *${stage}* (${confidence} confidence)`,
      "",
      "Reply in this thread with ✅, `confirmed`, or the correct stage (e.g. `status: Litigation`).",
    );
  }

  lines.push(
    `Valid stages: ${getStageSlackOptions().map((option) => `\`${option}\``).join(" · ")}`,
    `<${input.appUrl}/cases/${input.caseId}|Open in Case Tracker>`,
  );
  return lines.join("\n");
}

export async function postStageConfirmationForSuggestion(
  suggestionId: string,
  caseId: string,
  caseNumber: string,
  clientName: string,
  item: ParsedPulseItem,
  preferredChannelId?: string | null,
) {
  if (!isSlackEnabled()) return { posted: false as const, reason: "slack_disabled" };

  const channelId = preferredChannelId?.trim() || null;
  if (!channelId) return { posted: false as const, reason: "no_channel" };

  const appUrl = getAppOriginForNotifications() ?? "";
  const topic = await fetchChannelTopic(channelId);
  const record = await getCaseById(caseId);
  const topicMentions = await resolveChannelUserMentions({
    topic,
    attorneyEmail: record?.attorney.email,
    paralegalEmail: record?.paralegal.email,
    attorneyName: record?.attorney.name,
    paralegalName: record?.paralegal.name,
  });
  const text = buildStageConfirmationMessage({
    suggestedStage: item.suggestedStage,
    confidence: item.confidence,
    appUrl,
    caseId,
    topicMentions,
    markDisbursed: item.pulseSignal === "disbursed",
  });

  const posted = await postSlackMessage({ channel: channelId, text });
  if (!posted?.ts) return { posted: false as const, reason: "post_failed" };

  await markStageSuggestionPosted(suggestionId, posted.ts);
  return { posted: true as const, threadTs: posted.ts, channelId };
}

const PULSE_LOOKBACK_HOURS = 48;

export type PulseFanOutResult =
  | "posted"
  | "skipped_ignored_channel"
  | "skipped_no_match"
  | "skipped_no_case"
  | "skipped_already_at_stage"
  | "skipped_inactive_tracker"
  | "skipped_handled"
  | "skipped_already_posted"
  | "skipped_post_failed"
  | "skipped_no_channel";

export type PulseItemOutcome = {
  channelRef: string;
  pulseLabel: string;
  suggestedStage: CaseStage;
  pulseSignal: ParsedPulseItem["pulseSignal"];
  applyAs: string;
  caseNumber: string | null;
  trackerStage: CaseStage | null;
  trackerDisbursed: string | null;
  result: PulseFanOutResult;
};

export function formatPulseFanOutResult(result: PulseFanOutResult) {
  return result.replace(/^skipped_/, "").replace(/_/g, " ");
}

export function describePulseItemApply(item: ParsedPulseItem) {
  if (item.pulseSignal === "disbursed") {
    return "Settled + Disbursed Yes";
  }
  return item.suggestedStage;
}

export async function processDailyPulseRecap(options?: { force?: boolean }) {
  if (!isSlackEnabled()) {
    return { processed: 0, posted: 0, skipped: 0, itemOutcomes: [] as PulseItemOutcome[], reason: "slack_disabled" };
  }

  const pulseChannelId = await getDailyPulseChannelId();
  if (!pulseChannelId) {
    return { processed: 0, posted: 0, skipped: 0, itemOutcomes: [] as PulseItemOutcome[], reason: "no_pulse_channel" };
  }

  const lastTs = await getDailyPulseLastTs();
  const lookbackOldest = String(Math.floor(Date.now() / 1000) - PULSE_LOOKBACK_HOURS * 3600);
  const oldest = lookbackOldest;

  const pulseContext = await loadPulseChannelContext();

  let messages: Awaited<ReturnType<typeof fetchChannelHistory>>;
  try {
    messages = await fetchChannelHistory(pulseChannelId, { oldest, limit: 50 });
  } catch (error) {
    const detail = errorMessage(error);
    console.error("Daily pulse history fetch failed", detail);
    return { processed: 0, posted: 0, skipped: 0, itemOutcomes: [] as PulseItemOutcome[], reason: "pulse_history_failed", error: detail };
  }

  let processed = 0;
  let posted = 0;
  let skipped = 0;
  let messagesScanned = 0;
  let pulseMessagesFound = 0;
  let recapHeadersFound = 0;
  let newestTs = lastTs;
  const skipReasons: Partial<Record<PulseFanOutResult, number>> = {};
  const itemOutcomes: PulseItemOutcome[] = [];

  const channelIdToName = pulseContext.channelIdToName;

  for (const message of messages) {
    if (!message.ts) continue;
    messagesScanned += 1;

    const text = extractSlackMessageTextForParsing(message, channelIdToName);
    if (!text) continue;

    const normalizedText = normalizeSlackMessageMarkup(text);
    if (isPulseStatusRecapMessage(normalizedText)) recapHeadersFound += 1;

    const items = parseDailyPulseMessage(text);
    if (items.length === 0) continue;

    pulseMessagesFound += 1;
    if (!newestTs || Number(message.ts) > Number(newestTs)) {
      newestTs = message.ts;
    }
    processed += items.length;

    for (const item of items) {
      const match = resolvePulseChannelMatch(item, pulseContext);
      const record = match ? await getCaseById(match.caseId) : null;
      const result = await fanOutPulseItem(item, message.ts, pulseContext, match, record);
      itemOutcomes.push({
        channelRef: item.channelRef,
        pulseLabel: item.pulseLabel,
        suggestedStage: item.suggestedStage,
        pulseSignal: item.pulseSignal,
        applyAs: describePulseItemApply(item),
        caseNumber: match?.caseNumber ?? caseNumberFromPulseChannelRef(item.channelRef),
        trackerStage: record?.tracker.caseStage ?? null,
        trackerDisbursed: record?.tracker.result.disbursedStatus ?? null,
        result,
      });
      if (result === "posted") posted += 1;
      else {
        skipped += 1;
        skipReasons[result] = (skipReasons[result] ?? 0) + 1;
      }
    }
  }

  if (newestTs && newestTs !== lastTs) {
    await setDailyPulseLastTs(newestTs);
  }

  return {
    processed,
    posted,
    skipped,
    skipReasons,
    itemOutcomes,
    lastTs: newestTs,
    previousLastTs: lastTs,
    messagesScanned,
    pulseMessagesFound,
    recapHeadersFound,
    lookbackHours: PULSE_LOOKBACK_HOURS,
    forced: Boolean(options?.force),
  };
}

function resolvePulseChannelMatch(
  item: ParsedPulseItem,
  pulseContext: Awaited<ReturnType<typeof loadPulseChannelContext>>,
): PulseChannelMatch | null {
  const normalizedRef = normalizePulseChannelRef(item.channelRef);
  const direct = pulseContext.matchByChannelRef.get(normalizedRef);
  if (direct) return direct;

  const caseNumber = caseNumberFromPulseChannelRef(item.channelRef);
  if (caseNumber) {
    const byNumber = pulseContext.matchByCaseNumber.get(caseNumber);
    if (byNumber) return byNumber;

    for (const [channelRef, match] of pulseContext.matchByChannelRef) {
      if (caseNumberFromPulseChannelRef(channelRef) === caseNumber) {
        return match;
      }
    }
  }

  return null;
}

async function fanOutPulseItem(
  item: ParsedPulseItem,
  pulseMessageTs: string,
  pulseContext: Awaited<ReturnType<typeof loadPulseChannelContext>>,
  match: PulseChannelMatch | null = resolvePulseChannelMatch(item, pulseContext),
  record: Awaited<ReturnType<typeof getCaseById>> | null = null,
): Promise<PulseFanOutResult> {
  if (isIgnoredPulseChannelRef(item.channelRef)) return "skipped_ignored_channel";

  if (!match) return "skipped_no_match";

  const resolvedRecord = record ?? (await getCaseById(match.caseId));
  if (!resolvedRecord) return "skipped_no_case";

  const skipReason =
    item.pulseSignal === "disbursed" ? null : shouldSkipPulseSuggestion(resolvedRecord, item.suggestedStage);
  if (skipReason === "inactive_tracker") return "skipped_inactive_tracker";

  const existingLine = await findPulseLineSuggestion(match.caseId, pulseMessageTs, item.channelRef);
  if (existingLine?.confirmationPostedAt) return "skipped_already_posted";
  if (await wasPulseItemHandled(match.caseId, pulseMessageTs, item.suggestedStage)) return "skipped_handled";

  const existing = existingLine ?? (await getOpenStageSuggestionForCase(match.caseId, item.suggestedStage));
  if (existing?.confirmationPostedAt) return "skipped_already_posted";

  const suggestion =
    existing ??
    (await createStageSuggestion({
      caseId: match.caseId,
      trackerEntryId: resolvedRecord.tracker.id,
      source: "pulse",
      suggestedStage: item.suggestedStage,
      confidence: item.confidence,
      excerpt: item.excerpt || item.reason,
      metadata: {
        pulse_message_ts: pulseMessageTs,
        channel_ref: normalizePulseChannelRef(item.channelRef),
        reason: item.reason,
        pulse_label: item.pulseLabel,
        ...(item.pulseSignal === "disbursed" ? { mark_disbursed: true } : {}),
      },
      slackChannelId: match.slackChannelId,
    }));

  const postResult = await postStageConfirmationForSuggestion(
    suggestion.id,
    match.caseId,
    resolvedRecord.shared.caseNumber,
    resolvedRecord.shared.clientName,
    item,
    match.slackChannelId,
  );

  if (!postResult.posted) {
    return postResult.reason === "no_channel" ? "skipped_no_channel" : "skipped_post_failed";
  }

  return "posted";
}

export async function handleStageUpdateNotificationReply(threadTs: string, text: string, actorName = "Slack") {
  const mapping = await findCaseByStageUpdateThread(threadTs);
  if (!mapping?.caseId) return { handled: false as const, reason: "not_stage_update_thread" };

  const record = await getCaseById(mapping.caseId);
  if (!record) return { handled: false as const, reason: "case_not_found" };

  const parsed = parseStageConfirmationText(text, record.tracker.caseStage);
  if (!parsed) return { handled: false as const, reason: "unrecognized_reply" };

  if (parsed.kind === "dismiss") {
    return { handled: true as const, action: "dismissed" as const };
  }

  if (parsed.kind === "invalid_stage") {
    return { handled: true as const, action: "invalid" as const, message: parsed.message };
  }

  const stage = parsed.kind === "explicit_stage" ? parsed.stage : record.tracker.caseStage;
  if (stage === record.tracker.caseStage) {
    return { handled: true as const, action: "unchanged" as const, stage };
  }

  const patch = buildStagePatchFromConfirmation(record, stage);
  await updateTrackerEntry(mapping.caseId, patch, {
    actor: { userName: actorName },
    markReviewed: true,
    changeInput: patch,
  });

  return { handled: true as const, action: "confirmed" as const, stage };
}

export async function handleStageConfirmationReply(threadTs: string, text: string, actorName = "Slack") {
  const suggestion = await findStageSuggestionByConfirmationThread(threadTs);
  if (!suggestion) return { handled: false as const, reason: "no_pending_suggestion" };

  const parsed = parseStageConfirmationText(text, suggestion.suggestedStage);
  if (!parsed) return { handled: false as const, reason: "unrecognized_reply" };

  if (parsed.kind === "dismiss") {
    await dismissStageSuggestionById(suggestion.id, actorName);
    return { handled: true as const, action: "dismissed" as const };
  }

  if (parsed.kind === "invalid_stage") {
    return { handled: true as const, action: "invalid" as const, message: parsed.message };
  }

  const stage = parsed.kind === "explicit_stage" ? parsed.stage : suggestion.suggestedStage;
  const caseId = await getCaseIdForSuggestion(suggestion.id);
  if (!caseId) return { handled: false as const, reason: "case_not_found" };

  const result = await applyConfirmedStage(caseId, stage, suggestion, actorName);
  return { handled: true as const, action: "confirmed" as const, stage: result.stage };
}

export async function handleStageConfirmationReaction(threadTs: string, reaction: string, actorName = "Slack") {
  if (!isStageConfirmationReaction(reaction)) return { handled: false as const, reason: "not_confirm_reaction" };

  const suggestion = await findStageSuggestionByConfirmationThread(threadTs);
  if (!suggestion) return { handled: false as const, reason: "no_pending_suggestion" };

  const caseId = await getCaseIdForSuggestion(suggestion.id);
  if (!caseId) return { handled: false as const, reason: "case_not_found" };

  const result = await applyConfirmedStage(caseId, suggestion.suggestedStage, suggestion, actorName);
  return { handled: true as const, action: "confirmed" as const, stage: result.stage };
}

export async function processManualPulseText(text: string, pulseMessageTs = String(Date.now())) {
  const items = parseDailyPulseMessage(text);
  let posted = 0;
  let skipped = 0;
  for (const item of items) {
    const pulseContext = await loadPulseChannelContext();
    const result = await fanOutPulseItem(item, pulseMessageTs, pulseContext);
    if (result === "posted") posted += 1;
    else skipped += 1;
  }
  return { processed: items.length, posted, skipped };
}
