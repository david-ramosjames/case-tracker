import { getAppOriginForNotifications } from "@/lib/auth/redirect-url";
import { getSlackChannelForCaseNumber } from "@/lib/slack/channels";
import {
  extractSlackMessageTextForParsing,
  fetchChannelHistorySince,
  postSlackMessage,
  resolveSlackChannelId,
} from "@/lib/slack/client";
import { getDailyPulseChannelId, isSlackEnabled } from "@/lib/slack/config";
import {
  isIgnoredPulseChannelRef,
  isPulseStatusRecapMessage,
  normalizeSlackMessageMarkup,
  parseDailyPulseMessage,
  type ParsedPulseItem,
} from "@/lib/slack/pulse";
import {
  isStageConfirmationReaction,
  parseStageConfirmationText,
} from "@/lib/slack/stage-confirmation-parse";
import { shouldSkipPulseSuggestion } from "@/lib/stage-triggers";
import { getCaseById } from "@/lib/supabase/services";
import {
  applyConfirmedStage,
  createStageSuggestion,
  dismissStageSuggestionById,
  findCaseBySlackChannelRef,
  findStageSuggestionByConfirmationThread,
  getCaseIdForSuggestion,
  getDailyPulseLastTs,
  getOpenStageSuggestionForCase,
  markStageSuggestionPosted,
  setDailyPulseLastTs,
  wasPulseItemHandled,
} from "@/lib/supabase/stage-suggestions";
import { type CaseStage } from "@/lib/types";

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
  caseNumber: string;
  clientName: string;
  suggestedStage: CaseStage;
  confidence: string;
  excerpt: string;
  reason?: string;
  appUrl: string;
  caseId: string;
}) {
  const lines = [
    `*Case #${input.caseNumber}* (${input.clientName}) — confirm status change?`,
    `Pulse suggests: *${stageDisplay(input.suggestedStage)}* (${input.confidence.toLowerCase()} confidence)`,
  ];
  if (input.reason) lines.push(`_${input.reason}_`);
  if (input.excerpt) lines.push(`> ${input.excerpt}`);
  lines.push("");
  lines.push("Reply in this thread with ✅, `confirmed`, or the correct stage (e.g. `Stage: Demand`).");
  lines.push(`<${input.appUrl}/cases/${input.caseId}|Open in Case Tracker>`);
  return lines.join("\n");
}

export async function postStageConfirmationForSuggestion(
  suggestionId: string,
  caseId: string,
  caseNumber: string,
  clientName: string,
  item: ParsedPulseItem,
) {
  if (!isSlackEnabled()) return { posted: false as const, reason: "slack_disabled" };

  const mapping = await getSlackChannelForCaseNumber(caseNumber);
  const channelId = mapping?.slackChannelId ?? (await resolveSlackChannelId(item.channelRef));
  if (!channelId) return { posted: false as const, reason: "no_channel" };

  const appUrl = getAppOriginForNotifications() ?? "";
  const text = buildStageConfirmationMessage({
    caseNumber,
    clientName,
    suggestedStage: item.suggestedStage,
    confidence: item.confidence,
    excerpt: item.excerpt,
    reason: item.reason,
    appUrl,
    caseId,
  });

  const posted = await postSlackMessage({ channel: channelId, text });
  if (!posted?.ts) return { posted: false as const, reason: "post_failed" };

  await markStageSuggestionPosted(suggestionId, posted.ts);
  return { posted: true as const, threadTs: posted.ts, channelId };
}

const PULSE_LOOKBACK_HOURS = 48;

export async function processDailyPulseRecap(options?: { force?: boolean }) {
  if (!isSlackEnabled()) return { processed: 0, posted: 0, skipped: 0, reason: "slack_disabled" };

  const pulseChannelId = await getDailyPulseChannelId();
  if (!pulseChannelId) return { processed: 0, posted: 0, skipped: 0, reason: "no_pulse_channel" };

  const lastTs = options?.force ? null : await getDailyPulseLastTs();
  const lookbackOldest = String(Math.floor(Date.now() / 1000) - PULSE_LOOKBACK_HOURS * 3600);
  const oldest = lastTs ?? lookbackOldest;

  let messages: Awaited<ReturnType<typeof fetchChannelHistorySince>>;
  try {
    messages = await fetchChannelHistorySince(pulseChannelId, { oldest, maxMessages: 100 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("Daily pulse history fetch failed", detail);
    return { processed: 0, posted: 0, skipped: 0, reason: "pulse_history_failed", error: detail };
  }

  let processed = 0;
  let posted = 0;
  let skipped = 0;
  let messagesScanned = 0;
  let pulseMessagesFound = 0;
  let recapHeadersFound = 0;
  let newestTs = lastTs;

  for (const message of messages) {
    if (!message.ts) continue;
    messagesScanned += 1;
    if (lastTs && Number(message.ts) <= Number(lastTs)) continue;

    const text = await extractSlackMessageTextForParsing(message);
    if (!text) continue;

    const normalizedText = normalizeSlackMessageMarkup(text);
    if (isPulseStatusRecapMessage(normalizedText)) recapHeadersFound += 1;

    const items = parseDailyPulseMessage(text);
    if (items.length === 0) continue;

    pulseMessagesFound += 1;
    newestTs = message.ts;
    processed += items.length;

    for (const item of items) {
      const result = await fanOutPulseItem(item, message.ts);
      if (result === "posted") posted += 1;
      else skipped += 1;
    }
  }

  if (newestTs && newestTs !== lastTs) {
    await setDailyPulseLastTs(newestTs);
  }

  return {
    processed,
    posted,
    skipped,
    lastTs: newestTs,
    messagesScanned,
    pulseMessagesFound,
    recapHeadersFound,
    lookbackHours: PULSE_LOOKBACK_HOURS,
  };
}

async function fanOutPulseItem(item: ParsedPulseItem, pulseMessageTs: string): Promise<"posted" | "skipped"> {
  if (isIgnoredPulseChannelRef(item.channelRef)) return "skipped";

  const match = await findCaseBySlackChannelRef(item.channelRef);
  if (!match) return "skipped";

  const record = await getCaseById(match.caseId);
  if (!record) return "skipped";

  if (shouldSkipPulseSuggestion(record, item.suggestedStage)) return "skipped";
  if (await wasPulseItemHandled(match.caseId, pulseMessageTs, item.suggestedStage)) return "skipped";

  const existing = await getOpenStageSuggestionForCase(match.caseId, item.suggestedStage);
  if (existing?.confirmationPostedAt) return "skipped";

  const suggestion =
    existing ??
    (await createStageSuggestion({
      caseId: match.caseId,
      trackerEntryId: record.tracker.id,
      source: "pulse",
      suggestedStage: item.suggestedStage,
      confidence: item.confidence,
      excerpt: item.excerpt || item.reason,
      metadata: { pulse_message_ts: pulseMessageTs, channel_ref: item.channelRef, reason: item.reason },
      slackChannelId: match.slackChannelId,
    }));

  const postResult = await postStageConfirmationForSuggestion(
    suggestion.id,
    match.caseId,
    record.shared.caseNumber,
    record.shared.clientName,
    item,
  );

  return postResult.posted ? "posted" : "skipped";
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
    const result = await fanOutPulseItem(item, pulseMessageTs);
    if (result === "posted") posted += 1;
    else skipped += 1;
  }
  return { processed: items.length, posted, skipped };
}
