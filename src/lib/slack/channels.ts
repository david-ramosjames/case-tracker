import { cleanCaseNumber } from "@/lib/csv/parse";
import { caseNumberFromPulseChannelRef, normalizePulseChannelRef } from "@/lib/slack/pulse";
import { createSupabaseAdminClient, fetchAllSupabaseRows } from "@/lib/supabase/admin";
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

  const channels = await fetchAllSupabaseRows<{
    case_number: string;
    slack_channel_name: string | null;
    slack_channel_id: string | null;
  }>(admin, "case_slack_channels", "case_number,slack_channel_name,slack_channel_id");

  const caseNumbers = [
    ...new Set(channels.map((row) => cleanCaseNumber(String(row.case_number ?? ""))).filter(Boolean)),
  ];

  const trackerByCaseNumber = new Map<string, { caseId: string; caseNumber: string }>();
  const IN_CHUNK = 200;
  for (let i = 0; i < caseNumbers.length; i += IN_CHUNK) {
    const chunk = caseNumbers.slice(i, i + IN_CHUNK);
    const { data: trackers } = await admin
      .from("case_tracker_entries")
      .select("case_id,id,case_number")
      .in("case_number", chunk);

    for (const row of trackers ?? []) {
      const caseNumber = cleanCaseNumber(String(row.case_number));
      const caseId = String(row.case_id ?? row.id);
      trackerByCaseNumber.set(caseNumber, { caseId, caseNumber });
    }
  }

  const matchByChannelRef = new Map<string, PulseChannelMatch>();
  const matchByCaseNumber = new Map<string, PulseChannelMatch>();
  const channelIdToName = new Map<string, string>();
  const channelByCaseNumber = new Map<string, { slackChannelId: string | null; slackChannelName: string }>();

  for (const row of channels) {
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
    channelByCaseNumber.set(caseNumber, { slackChannelId, slackChannelName: channelName });

    const caseNumberFromChannel = caseNumberFromPulseChannelRef(channelName);
    if (caseNumberFromChannel && caseNumberFromChannel !== caseNumber) {
      matchByCaseNumber.set(caseNumberFromChannel, match);
    }

    if (slackChannelId) {
      channelIdToName.set(slackChannelId, normalized);
    }
  }

  const allTrackers = await fetchAllSupabaseRows<{
    case_id: string | null;
    id: string;
    case_number: string | null;
  }>(admin, "case_tracker_entries", "case_id,id,case_number");

  for (const row of allTrackers) {
    if (row.case_number == null) continue;
    const caseNumber = cleanCaseNumber(String(row.case_number ?? ""));
    if (!caseNumber || matchByCaseNumber.has(caseNumber)) continue;

    const caseId = String(row.case_id ?? row.id);
    const channel = channelByCaseNumber.get(caseNumber);
    matchByCaseNumber.set(caseNumber, {
      caseId,
      caseNumber,
      slackChannelId: channel?.slackChannelId ?? null,
      slackChannelName: channel?.slackChannelName ?? "",
    });
  }

  for (const [channelRef, match] of matchByChannelRef) {
    const suffix = caseNumberFromPulseChannelRef(channelRef);
    if (suffix && !matchByCaseNumber.has(suffix)) {
      matchByCaseNumber.set(suffix, match);
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
  topic_synced_at?: string | null;
  topic_last_written?: string | null;
  synced_at: string;
  updated_at: string;
};

function rowToChannel(row: ChannelRow): CaseSlackChannel {
  return {
    caseNumber: row.case_number,
    slackChannelId: row.slack_channel_id,
    slackChannelName: row.slack_channel_name,
    topicStage: row.topic_stage,
    topicSyncedAt: row.topic_synced_at ?? null,
    topicLastWritten: row.topic_last_written ?? null,
    syncedAt: row.synced_at,
    updatedAt: row.updated_at,
  };
}

export async function updateChannelTopicStage(caseNumber: string, topicStage: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;

  const key = cleanCaseNumber(caseNumber);
  const { error } = await admin
    .from("case_slack_channels")
    .update({ topic_stage: topicStage, updated_at: new Date().toISOString() })
    .eq("case_number", key);

  if (error) {
    console.warn("Failed to update topic_stage in database", { caseNumber: key, error: error.message });
    return false;
  }
  return true;
}

/** Mark that Case Tracker confirmed or wrote the structured Slack topic. */
export async function markChannelTopicSynced(
  caseNumber: string,
  topicStage?: string | null,
  topicText?: string | null,
) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;

  const key = cleanCaseNumber(caseNumber);
  const now = new Date().toISOString();
  const payload: Record<string, string> = {
    topic_synced_at: now,
    updated_at: now,
  };
  if (topicStage?.trim()) payload.topic_stage = topicStage.trim();
  if (typeof topicText === "string") payload.topic_last_written = topicText;

  const { error } = await admin.from("case_slack_channels").update(payload).eq("case_number", key);
  if (error) {
    console.warn("Failed to update topic_synced_at", { caseNumber: key, error: error.message });
    return false;
  }
  return true;
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

  try {
    const data = await fetchAllSupabaseRows<ChannelRow>(admin, "case_slack_channels", "*", {
      orderBy: "case_number",
      ascending: true,
    });
    const map = new Map<string, CaseSlackChannel>();
    for (const row of data) {
      map.set(cleanCaseNumber(row.case_number), rowToChannel(row));
    }
    return map;
  } catch {
    return new Map<string, CaseSlackChannel>();
  }
}

export async function upsertSlackChannels(rows: Array<Omit<CaseSlackChannel, "syncedAt" | "updatedAt" | "topicSyncedAt" | "topicLastWritten">>) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required to sync Slack channels.");

  // Sheet rows can repeat the same Case No; Postgres rejects duplicate keys in one upsert batch.
  const byCaseNumber = new Map<string, Omit<CaseSlackChannel, "syncedAt" | "updatedAt" | "topicSyncedAt" | "topicLastWritten">>();
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
  let { data: trackerRow } = await admin
    .from("case_tracker_entries")
    .select("case_number, case_id, id, slack_reminder_thread_ts, last_slack_reminder_at")
    .eq("case_number", caseNumber)
    .order("last_slack_reminder_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!trackerRow) {
    const { data: caseRow } = await admin
      .from("cases")
      .select("id")
      .eq("case_number", caseNumber)
      .maybeSingle();
    if (caseRow?.id) {
      const { data: byCaseId } = await admin
        .from("case_tracker_entries")
        .select("case_number, case_id, id, slack_reminder_thread_ts, last_slack_reminder_at")
        .eq("case_id", caseRow.id)
        .maybeSingle();
      trackerRow = byCaseId;
    }
  }

  if (!trackerRow) return null;

  const storedThread = trackerRow.slack_reminder_thread_ts as string | null;
  // Case channels are 1:1 with a case — accept replies in any thread on that channel.
  // Prefer the stored reminder thread when present; otherwise require a recent reminder window.
  if (storedThread && storedThread !== threadTs) {
    console.warn("Slack thread reply: accepting channel fallback despite ts mismatch", {
      channelId,
      expected: storedThread,
      received: threadTs,
      caseNumber,
    });
  } else if (!storedThread) {
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
