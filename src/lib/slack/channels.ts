import { cleanCaseNumber } from "@/lib/csv/parse";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { type CaseSlackChannel } from "@/lib/types";

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

export async function upsertSlackChannels(rows: Array<Omit<CaseSlackChannel, "syncedAt" | "updatedAt">>) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required to sync Slack channels.");

  const payload = rows.map((row) => ({
    case_number: cleanCaseNumber(row.caseNumber),
    slack_channel_id: row.slackChannelId,
    slack_channel_name: row.slackChannelName,
    topic_stage: row.topicStage,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { error } = await admin.from("case_slack_channels").upsert(payload, { onConflict: "case_number" });
  if (error) throw error;
  return payload.length;
}

export async function findCaseNumberByReminderThread(threadTs: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data, error } = await admin
    .from("case_tracker_entries")
    .select("case_number, case_id")
    .eq("slack_reminder_thread_ts", threadTs)
    .maybeSingle();

  if (error || !data) return null;
  return {
    caseNumber: data.case_number as string | null,
    caseId: data.case_id as string | null,
  };
}

export async function saveReminderThread(caseId: string, threadTs: string | null) {
  const admin = createSupabaseAdminClient();
  if (!admin) return;

  await admin
    .from("case_tracker_entries")
    .update({
      slack_reminder_thread_ts: threadTs,
      last_slack_reminder_at: new Date().toISOString(),
    })
    .eq("case_id", caseId);
}
