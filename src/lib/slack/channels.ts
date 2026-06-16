import { cleanCaseNumber } from "@/lib/csv/parse";
import { caseNumberFromPulseChannelRef, normalizePulseChannelRef } from "@/lib/slack/pulse";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { type CaseSlackChannel } from "@/lib/types";
import { daysSince } from "@/lib/utils";

export type PulseChannelMatch = {
  caseId: string;
  caseNumber: string;
  slackChannelId: string | null;
  slackChannelName: string;
};

/** Case channel lookups for pulse parsing/fan-out — DB only, no Slack channel list API. */
export async function loadPulseChannelContext() {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      matchByChannelRef: new Map<string, PulseChannelMatch>(),
      matchByCaseNumber: new Map<string, PulseChannelMatch>(),
      channelIdToName: new Map<string, string>(),
    };
  }

  const { data: channels } = await admin
    .from("case_slack_channels")
    .select("case_number,slack_channel_name,slack_channel_id");

  const caseNumbers = [
    ...new Set(
      (channels ?? [])
        .map((row) => cleanCaseNumber(String(row.case_number ?? "")))
        .filter(Boolean),
    ),
  ];

  const trackerByCaseNumber = new Map<string, { caseId: string; caseNumber: string }>();
  if (caseNumbers.length > 0) {
    const { data: trackers } = await admin
      .from("case_tracker_entries")
      .select("case_id,id,case_number")
      .in("case_number", caseNumbers);

    for (const row of trackers ?? []) {
      const caseNumber = cleanCaseNumber(String(row.case_number));
      const caseId = String(row.case_id ?? row.id);
      trackerByCaseNumber.set(caseNumber, { caseId, caseNumber });
    }
  }

  const matchByChannelRef = new Map<string, PulseChannelMatch>();
  const matchByCaseNumber = new Map<string, PulseChannelMatch>();
  const channelIdToName = new Map<string, string>();

  for (const row of channels ?? []) {
    const channelName = String(row.slack_channel_name ?? "");
    const normalized = normalizePulseChannelRef(channelName);
    if (!normalized) continue;

    const caseNumber = cleanCaseNumber(String(row.case_number));
    const tracker = trackerByCaseNumber.get(caseNumber);
    if (!tracker) continue;

    const slackChannelId = (row.slack_channel_id as string | null) ?? null;
    const match: PulseChannelMatch = {
      caseId: tracker.caseId,
      caseNumber: tracker.caseNumber,
      slackChannelId,
      slackChannelName: channelName,
    };

    matchByChannelRef.set(normalized, match);
    matchByCaseNumber.set(caseNumber, match);

    const caseNumberFromChannel = caseNumberFromPulseChannelRef(channelName);
    if (caseNumberFromChannel) {
      matchByCaseNumber.set(caseNumberFromChannel, match);
    }

    if (slackChannelId) {
      channelIdToName.set(slackChannelId, normalized);
    }
  }

  return { matchByChannelRef, matchByCaseNumber, channelIdToName };
}

function trackerCaseId(row: { case_id: string | null; id?: string | null }) {
  return (row.case_id as string | null) ?? (row.id as string | null) ?? null;
}

type ChannelRow = {
  case_number: string;
  slack_channel_id: string | null;
  slack_channel_name: string;
  topic_stage: string | null;
  synced_at: string;
  updated_at: string;
};

function rowToChannel(row: ChannelRow): CaseSlackChannel {
  return {
    caseNumber: row.case_number,
    slackChannelId: row.slack_channel_id,
    slackChannelName: row.slack_channel_name,
    topicStage: row.topic_stage,
    syncedAt: row.synced_at,
    updatedAt: row.updated_at,
  };
}

export async function getSlackChannelForCaseNumber(caseNumber: string): Promise<CaseSlackChannel | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const key = cleanCaseNumber(caseNumber);
  const { data, error } = await admin.from("case_slack_channels").select("*").eq("case_number", key).maybeSingle();
  if (error || !data) return null;
  return rowToChannel(data as ChannelRow);
}

export async function loadSlackChannelMapByCaseNumber() {
  const admin = createSupabaseAdminClient();
  if (!admin) return new Map<string, CaseSlackChannel>();

  const { data, error } = await admin.from("case_slack_channels").select("*");
  if (error || !data) return new Map<string, CaseSlackChannel>();

  const map = new Map<string, CaseSlackChannel>();
  for (const row of data) {
    map.set(cleanCaseNumber((row as ChannelRow).case_number), rowToChannel(row as ChannelRow));
  }
  return map;
}

export async function upsertSlackChannels(rows: Array<Omit<CaseSlackChannel, "syncedAt" | "updatedAt">>) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required to sync Slack channels.");

  // Sheet rows can repeat the same Case No; Postgres rejects duplicate keys in one upsert batch.
  const byCaseNumber = new Map<string, Omit<CaseSlackChannel, "syncedAt" | "updatedAt">>();
  for (const row of rows) {
    byCaseNumber.set(cleanCaseNumber(row.caseNumber), row);
  }
  const deduped = [...byCaseNumber.values()];
  const duplicatesRemoved = rows.length - deduped.length;

  const payload = deduped.map((row) => ({
    case_number: cleanCaseNumber(row.caseNumber),
    slack_channel_id: row.slackChannelId,
    slack_channel_name: row.slackChannelName,
    topic_stage: row.topicStage,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { error } = await admin.from("case_slack_channels").upsert(payload, { onConflict: "case_number" });
  if (error) {
    throw new Error(error.message + (error.hint ? ` ${error.hint}` : ""));
  }
  return { synced: payload.length, duplicatesRemoved };
}

export async function findCaseNumberByReminderThread(threadTs: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data, error } = await admin
    .from("case_tracker_entries")
    .select("case_number, case_id, id")
    .eq("slack_reminder_thread_ts", threadTs)
    .maybeSingle();

  if (error || !data) return null;
  const caseId = trackerCaseId(data as { case_id: string | null; id?: string | null });
  if (!caseId) return null;
  return {
    caseNumber: data.case_number as string | null,
    caseId,
  };
}

/** Resolve case from reminder thread_ts, with channel fallback when thread id was not stored. */
export async function findCaseForSlackThread(channelId: string, threadTs: string) {
  const direct = await findCaseNumberByReminderThread(threadTs);
  if (direct?.caseId) return direct;

  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data: channelRow } = await admin
    .from("case_slack_channels")
    .select("case_number")
    .eq("slack_channel_id", channelId)
    .maybeSingle();

  if (!channelRow?.case_number) return null;

  const caseNumber = cleanCaseNumber(channelRow.case_number);
  const { data: trackerRow } = await admin
    .from("case_tracker_entries")
    .select("case_number, case_id, id, slack_reminder_thread_ts, last_slack_reminder_at")
    .eq("case_number", caseNumber)
    .order("last_slack_reminder_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!trackerRow) return null;

  const storedThread = trackerRow.slack_reminder_thread_ts as string | null;
  if (storedThread && storedThread !== threadTs) {
    console.warn("Slack thread reply: ts mismatch on channel fallback", {
      channelId,
      expected: storedThread,
      received: threadTs,
      caseNumber,
    });
    return null;
  }

  if (!storedThread) {
    const remindedAt = trackerRow.last_slack_reminder_at as string | null;
    if (!remindedAt || daysSince(remindedAt) > 14) {
      return null;
    }
    console.warn("Slack thread reply: applying to latest reminded case (thread id was not stored)", {
      channelId,
      caseNumber,
      threadTs,
    });
  }

  const caseId = trackerCaseId(trackerRow as { case_id: string | null; id?: string | null });
  if (!caseId) return null;

  return { caseNumber, caseId };
}

export async function saveReminderThread(caseId: string, caseNumber: string, threadTs: string | null) {
  const admin = createSupabaseAdminClient();
  if (!admin || !threadTs) return false;

  const payload = {
    slack_reminder_thread_ts: threadTs,
    last_slack_reminder_at: new Date().toISOString(),
  };

  const byCaseId = await admin
    .from("case_tracker_entries")
    .update(payload)
    .or(`case_id.eq.${caseId},id.eq.${caseId}`)
    .select("id");

  if (!byCaseId.error && (byCaseId.data?.length ?? 0) > 0) return true;

  const key = cleanCaseNumber(caseNumber);
  if (!key) return false;

  const byCaseNumber = await admin
    .from("case_tracker_entries")
    .update(payload)
    .eq("case_number", key)
    .select("id");

  return !byCaseNumber.error && (byCaseNumber.data?.length ?? 0) > 0;
}

export async function findCaseByStageUpdateThread(threadTs: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data, error } = await admin
    .from("case_tracker_entries")
    .select("case_number, case_id, id")
    .eq("slack_stage_update_thread_ts", threadTs)
    .maybeSingle();

  if (error || !data) return null;
  const caseId = trackerCaseId(data as { case_id: string | null; id?: string | null });
  if (!caseId) return null;

  return {
    caseNumber: data.case_number as string | null,
    caseId,
  };
}

export async function saveStageUpdateThread(caseId: string, caseNumber: string, threadTs: string | null) {
  const admin = createSupabaseAdminClient();
  if (!admin || !threadTs) return false;

  const payload = { slack_stage_update_thread_ts: threadTs };

  const byCaseId = await admin
    .from("case_tracker_entries")
    .update(payload)
    .or(`case_id.eq.${caseId},id.eq.${caseId}`)
    .select("id");

  if (!byCaseId.error && (byCaseId.data?.length ?? 0) > 0) return true;

  const key = cleanCaseNumber(caseNumber);
  if (!key) return false;

  const byCaseNumber = await admin
    .from("case_tracker_entries")
    .update(payload)
    .eq("case_number", key)
    .select("id");

  return !byCaseNumber.error && (byCaseNumber.data?.length ?? 0) > 0;
}
