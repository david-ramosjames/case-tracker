import { FIELD_REMINDER_META } from "@/lib/slack/field-reminders";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCaseById, trackerActivityLink, updateTrackerEntry } from "@/lib/supabase/services";
import { type CaseRecord, type FieldReminderKey, type TrackerUpdateInput } from "@/lib/types";

type FieldReminderRow = {
  id: string;
  case_id: string;
  tracker_entry_id: string;
  field_key: FieldReminderKey;
  slack_thread_ts: string | null;
  posted_at: string | null;
  confirmed_at: string | null;
  dismissed_at: string | null;
};

function rowToReminder(row: FieldReminderRow) {
  return {
    id: String(row.id),
    caseId: String(row.case_id),
    trackerEntryId: String(row.tracker_entry_id),
    fieldKey: row.field_key,
    slackThreadTs: row.slack_thread_ts,
    postedAt: row.posted_at,
    confirmedAt: row.confirmed_at,
    dismissedAt: row.dismissed_at,
  };
}

export async function getOpenFieldReminder(caseId: string, fieldKey: FieldReminderKey) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data } = await admin
    .from("case_tracker_field_reminders")
    .select("*")
    .eq("case_id", caseId)
    .eq("field_key", fieldKey)
    .is("confirmed_at", null)
    .is("dismissed_at", null)
    .maybeSingle();

  return data ? rowToReminder(data as FieldReminderRow) : null;
}

export async function findFieldReminderByThread(threadTs: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data } = await admin
    .from("case_tracker_field_reminders")
    .select("*")
    .eq("slack_thread_ts", threadTs)
    .is("confirmed_at", null)
    .is("dismissed_at", null)
    .maybeSingle();

  return data ? rowToReminder(data as FieldReminderRow) : null;
}

export async function createFieldReminder(input: {
  caseId: string;
  trackerEntryId: string;
  fieldKey: FieldReminderKey;
  slackThreadTs: string;
}) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required for field reminders.");

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("case_tracker_field_reminders")
    .insert({
      case_id: input.caseId,
      tracker_entry_id: input.trackerEntryId,
      field_key: input.fieldKey,
      slack_thread_ts: input.slackThreadTs,
      posted_at: now,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return rowToReminder(data as FieldReminderRow);
}

export async function markFieldReminderPosted(reminderId: string, threadTs: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return;

  await admin
    .from("case_tracker_field_reminders")
    .update({ slack_thread_ts: threadTs, posted_at: new Date().toISOString() })
    .eq("id", reminderId);
}

async function closeFieldReminder(
  reminderId: string,
  caseId: string,
  action: "confirmed" | "dismissed",
  actorName: string,
  fieldKey?: FieldReminderKey,
) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required.");

  const now = new Date().toISOString();
  const column = action === "confirmed" ? "confirmed_at" : "dismissed_at";
  await admin.from("case_tracker_field_reminders").update({ [column]: now }).eq("id", reminderId);

  const record = await getCaseById(caseId);
  const link = record ? trackerActivityLink(record) : { caseId: null, trackerEntryId: caseId };
  const fieldLabel = fieldKey ? FIELD_REMINDER_META[fieldKey].label : "Field";

  await admin.from("case_tracker_activity").insert({
    case_id: link.caseId,
    tracker_entry_id: link.trackerEntryId,
    action: action === "confirmed" ? "Field reminder confirmed" : "Field reminder dismissed",
    description:
      action === "confirmed" ? `${fieldLabel} confirmed via Slack.` : `${fieldLabel} reminder dismissed via Slack.`,
    metadata: { user_name: actorName, reminder_id: reminderId, field_key: fieldKey ?? null },
  });
}

function buildFieldReminderTouchInput(record: CaseRecord, fieldKey: FieldReminderKey): TrackerUpdateInput {
  const { tracker } = record;
  switch (fieldKey) {
    case "liability":
      return { liability: tracker.liability };
    case "targetResolutionQuarter":
      return { targetResolutionQuarter: tracker.targetResolutionQuarter };
    case "minimumValue":
      return { minimumValue: tracker.minimumValue };
    case "policyLimits":
      return { policyLimits: tracker.policyLimits };
    case "expectedLitigation":
      return { expectedLitigation: tracker.expectedLitigation };
    default:
      return {};
  }
}

export async function confirmFieldReminder(
  reminderId: string,
  caseId: string,
  fieldKey: FieldReminderKey,
  actorName: string,
  patch?: TrackerUpdateInput,
) {
  const record = await getCaseById(caseId);
  if (!record) throw new Error("Case not found.");

  if (patch && Object.keys(patch).length > 0) {
    await updateTrackerEntry(caseId, patch, {
      actor: { userName: actorName },
      markReviewed: true,
      changeInput: patch,
    });
  } else {
    const touchInput = buildFieldReminderTouchInput(record, fieldKey);
    await updateTrackerEntry(caseId, touchInput, {
      actor: { userName: actorName },
      markReviewed: true,
      changeInput: touchInput,
    });
  }

  await closeFieldReminder(reminderId, caseId, "confirmed", actorName, fieldKey);
  return { fieldKey, confirmed: true as const };
}

export async function dismissFieldReminder(
  reminderId: string,
  caseId: string,
  actorName: string,
  fieldKey?: FieldReminderKey,
) {
  await closeFieldReminder(reminderId, caseId, "dismissed", actorName, fieldKey);
  return { dismissed: true as const };
}
