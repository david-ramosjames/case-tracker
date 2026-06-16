import { cleanCaseNumber } from "@/lib/csv/parse";
import { normalizePulseChannelRef } from "@/lib/slack/pulse";
import {
  buildStagePatchFromConfirmation,
  deriveExpectedLitigationForStage,
} from "@/lib/stage-triggers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getCaseById,
  normalizeExpectedLitigation,
  normalizeStage,
  toDatabaseExpectedLitigation,
  toDatabaseStage,
  trackerActivityLink,
  updateTrackerEntry,
} from "@/lib/supabase/services";
import {
  type CaseStage,
  type ConfidenceLevel,
  type StageSignalSource,
  type StageSuggestion,
} from "@/lib/types";

type SuggestionRow = Record<string, unknown>;

function rowToSuggestion(row: SuggestionRow): StageSuggestion {
  return {
    id: String(row.id ?? "stage-suggestion"),
    source: (row.source as StageSuggestion["source"]) ?? "manual",
    suggestedStage: normalizeStage(String(row.suggested_stage ?? "")),
    suggestedExpectedLitigation: normalizeExpectedLitigation(String(row.suggested_expected_litigation ?? "")) ?? "Pre",
    confidence: (row.confidence as ConfidenceLevel) ?? "Medium",
    excerpt: String(row.excerpt ?? ""),
    detectedAt: String(row.detected_at ?? row.created_at ?? new Date().toISOString()),
    confirmedAt: (row.confirmed_at as string | null) ?? null,
    dismissedAt: (row.dismissed_at as string | null) ?? null,
    slackChannelId: (row.slack_channel_id as string | null) ?? null,
    slackConfirmationThreadTs: (row.slack_confirmation_thread_ts as string | null) ?? null,
    confirmationPostedAt: (row.confirmation_posted_at as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
  };
}

export async function createStageSuggestion(input: {
  caseId: string;
  trackerEntryId: string;
  source: StageSignalSource;
  suggestedStage: CaseStage;
  confidence: ConfidenceLevel;
  excerpt: string;
  metadata?: Record<string, unknown>;
  slackChannelId?: string | null;
  slackConfirmationThreadTs?: string | null;
  confirmationPostedAt?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required for stage suggestions.");

  const { data, error } = await admin
    .from("case_tracker_stage_suggestions")
    .insert({
      case_id: input.caseId,
      tracker_entry_id: input.trackerEntryId,
      source: input.source,
      suggested_stage: toDatabaseStage(input.suggestedStage),
      suggested_expected_litigation: toDatabaseExpectedLitigation(
        deriveExpectedLitigationForStage(input.suggestedStage),
      ),
      confidence: input.confidence,
      excerpt: input.excerpt,
      metadata: input.metadata ?? {},
      slack_channel_id: input.slackChannelId ?? null,
      slack_confirmation_thread_ts: input.slackConfirmationThreadTs ?? null,
      confirmation_posted_at: input.confirmationPostedAt ?? null,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return rowToSuggestion(data as SuggestionRow);
}

export async function getOpenStageSuggestionForCase(caseId: string, suggestedStage?: CaseStage) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  let query = admin
    .from("case_tracker_stage_suggestions")
    .select("*")
    .eq("case_id", caseId)
    .is("confirmed_at", null)
    .is("dismissed_at", null)
    .order("detected_at", { ascending: false })
    .limit(1);

  if (suggestedStage) query = query.eq("suggested_stage", suggestedStage);

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return rowToSuggestion(data as SuggestionRow);
}

export async function findStageSuggestionByConfirmationThread(threadTs: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data, error } = await admin
    .from("case_tracker_stage_suggestions")
    .select("*")
    .eq("slack_confirmation_thread_ts", threadTs)
    .is("confirmed_at", null)
    .is("dismissed_at", null)
    .maybeSingle();

  if (error || !data) return null;
  return rowToSuggestion(data as SuggestionRow);
}

export async function findPulseLineSuggestion(caseId: string, pulseMessageTs: string, channelRef: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const normalizedRef = normalizePulseChannelRef(channelRef);
  const { data, error } = await admin
    .from("case_tracker_stage_suggestions")
    .select("*")
    .eq("case_id", caseId)
    .contains("metadata", { pulse_message_ts: pulseMessageTs, channel_ref: normalizedRef })
    .order("detected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return rowToSuggestion(data as SuggestionRow);
}

export async function wasPulseItemHandled(caseId: string, pulseMessageTs: string, suggestedStage: CaseStage) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;

  const { data } = await admin
    .from("case_tracker_stage_suggestions")
    .select("id,metadata,confirmed_at,dismissed_at,suggested_stage")
    .eq("case_id", caseId)
    .eq("suggested_stage", suggestedStage)
    .contains("metadata", { pulse_message_ts: pulseMessageTs });

  return (data ?? []).some((row) => row.confirmed_at || row.dismissed_at);
}

export async function markStageSuggestionPosted(suggestionId: string, threadTs: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return;

  await admin
    .from("case_tracker_stage_suggestions")
    .update({
      slack_confirmation_thread_ts: threadTs,
      confirmation_posted_at: new Date().toISOString(),
    })
    .eq("id", suggestionId);
}

export async function confirmStageSuggestionById(
  suggestionId: string,
  options?: { stage?: CaseStage; actorName?: string },
) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required.");

  const { data: row, error } = await admin
    .from("case_tracker_stage_suggestions")
    .select("*")
    .eq("id", suggestionId)
    .maybeSingle();

  if (error || !row) throw new Error("Stage suggestion not found.");

  const suggestion = rowToSuggestion(row as SuggestionRow);
  const caseId = String(row.case_id);
  const stage = options?.stage ?? suggestion.suggestedStage;

  return applyConfirmedStage(caseId, stage, suggestion, options?.actorName ?? "Case tracker");
}

export async function dismissStageSuggestionById(suggestionId: string, actorName = "Case tracker") {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required.");

  const now = new Date().toISOString();
  const { data: row, error } = await admin
    .from("case_tracker_stage_suggestions")
    .update({ dismissed_at: now })
    .eq("id", suggestionId)
    .select("case_id, tracker_entry_id")
    .maybeSingle();

  if (error) throw new Error(error.message);

  const caseId = row?.case_id ? String(row.case_id) : null;
  const trackerEntryId = row?.tracker_entry_id ? String(row.tracker_entry_id) : null;
  const lookupId = caseId ?? trackerEntryId;
  if (lookupId) {
    const record = await getCaseById(lookupId);
    const link = record
      ? trackerActivityLink(record)
      : { caseId, trackerEntryId: trackerEntryId ?? lookupId };
    await admin.from("case_tracker_activity").insert({
      case_id: link.caseId,
      tracker_entry_id: link.trackerEntryId,
      action: "Stage suggestion dismissed",
      description: "Slack stage confirmation was dismissed.",
      metadata: { user_name: actorName, suggestion_id: suggestionId },
    });
  }

  return { dismissed: true as const };
}

export async function applyConfirmedStage(
  caseId: string,
  stage: CaseStage,
  suggestion: StageSuggestion,
  actorName: string,
) {
  const record = await getCaseById(caseId);
  if (!record) throw new Error("Case not found.");

  const markDisbursed = suggestion.metadata?.mark_disbursed === true;
  const patch = buildStagePatchFromConfirmation(record, stage, { markDisbursed });
  const { tracker } = await updateTrackerEntry(caseId, patch, {
    actor: { userName: actorName },
    markReviewed: true,
    changeInput: patch,
  });

  const admin = createSupabaseAdminClient();
  if (admin) {
    await admin
      .from("case_tracker_stage_suggestions")
      .update({ confirmed_at: new Date().toISOString(), suggested_stage: toDatabaseStage(stage) })
      .eq("id", suggestion.id);

    const activityLink = trackerActivityLink(record);
    const description = markDisbursed
      ? `Confirmed ${suggestion.source} signal: case stage is now ${stage} and disbursed is Yes.`
      : `Confirmed ${suggestion.source} signal: case stage is now ${stage}.`;
    await admin.from("case_tracker_activity").insert({
      case_id: activityLink.caseId,
      tracker_entry_id: activityLink.trackerEntryId,
      action: "Stage suggestion confirmed",
      description,
      metadata: { user_name: actorName, suggestion_id: suggestion.id, excerpt: suggestion.excerpt },
    });
  }

  return { tracker, stage, suggestionId: suggestion.id };
}

export async function getDailyPulseLastTs(): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data } = await admin.from("case_tracker_settings").select("value").eq("key", "daily_pulse_last_ts").maybeSingle();
  const value = data?.value;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "ts" in value && typeof value.ts === "string") return value.ts;
  return null;
}

export async function setDailyPulseLastTs(ts: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return;

  await admin
    .from("case_tracker_settings")
    .upsert({ key: "daily_pulse_last_ts", value: ts, description: "Last processed #daily-pulse message ts." }, { onConflict: "key" });
}

export async function getCaseIdForSuggestion(suggestionId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data } = await admin.from("case_tracker_stage_suggestions").select("case_id").eq("id", suggestionId).maybeSingle();
  return data?.case_id ? String(data.case_id) : null;
}

export async function findCaseBySlackChannelRef(channelRef: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const normalized = normalizePulseChannelRef(channelRef);
  const { data: channels } = await admin.from("case_slack_channels").select("case_number,slack_channel_name,slack_channel_id");

  const match = (channels ?? []).find((row) => normalizePulseChannelRef(String(row.slack_channel_name ?? "")) === normalized);

  if (!match?.case_number) return null;

  const caseNumber = cleanCaseNumber(String(match.case_number));
  const { data: tracker } = await admin
    .from("case_tracker_entries")
    .select("case_id,id,case_number")
    .eq("case_number", caseNumber)
    .maybeSingle();

  if (!tracker) return null;

  return {
    caseId: String(tracker.case_id ?? tracker.id),
    caseNumber,
    slackChannelId: (match.slack_channel_id as string | null) ?? null,
    slackChannelName: String(match.slack_channel_name ?? ""),
  };
}
