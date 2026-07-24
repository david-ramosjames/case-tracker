import { cleanCaseNumber } from "@/lib/csv/parse";
import { requestDocketFlowCalendarReconcile } from "@/lib/docketflow/calendar-reconcile";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCaseById, isOrphanTrackerRecord } from "@/lib/supabase/services";
import { renameSlackChannel } from "@/lib/slack/client";
import { getSlackChannelForCaseNumber, updateChannelTopicStage } from "@/lib/slack/channels";
import { syncSlackChannelTopicSummary } from "@/lib/slack/channel-topic";
import { buildCaseSlackChannelName } from "@/lib/slack/channel-name";
import { type CaseRecord } from "@/lib/types";

export type CaseAssignmentInput = {
  attorneyContactId: string;
  paralegalContactId: string;
  /** Extra assignees preserved after attorney + paralegal. */
  extraContactIds?: string[];
  usesEve?: boolean;
  /** When true, skip DocketFlow calendar callback (e.g. dry-run). */
  skipCalendarReconcile?: boolean;
  /** When false, do not rename Slack channel even if name would change. Default true. */
  renameSlackChannel?: boolean;
  actorName?: string;
};

type ContactRow = {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  slack_user_id?: string | null;
  slack_display_name?: string | null;
};

function buildAssignedContactIds(
  attorneyId: string,
  paralegalId: string,
  existing: string[] | null | undefined,
  extras?: string[],
) {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of [attorneyId, paralegalId, ...(extras ?? []), ...(existing ?? [])]) {
    if (!id || seen.has(id)) continue;
    // Keep attorney first, paralegal second; extras after.
    if (id === attorneyId || id === paralegalId) {
      if (next.includes(id)) continue;
    }
    seen.add(id);
    next.push(id);
  }
  // Ensure attorney is first and paralegal second even if extras somehow preceded.
  const ordered = [
    attorneyId,
    paralegalId,
    ...next.filter((id) => id !== attorneyId && id !== paralegalId),
  ];
  return [...new Set(ordered)];
}

/**
 * Reassign attorney/paralegal on the shared DocketFlow case + tracker snapshot,
 * optionally rename the Slack channel, rebuild the topic, then ask DocketFlow
 * to reconcile Google Calendar invites.
 */
export async function reassignCaseTeam(caseId: string, input: CaseAssignmentInput) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required to reassign case team.");

  const record = await getCaseById(caseId);
  if (!record) throw new Error("Case not found.");
  if (isOrphanTrackerRecord(record)) {
    throw new Error("Cannot reassign an orphaned tracker row without a DocketFlow case.");
  }

  const contactIds = [input.attorneyContactId, input.paralegalContactId];
  const { data: contacts, error: contactsError } = await admin
    .from("contacts")
    .select("id,name,email,role,slack_user_id,slack_display_name")
    .in("id", contactIds);
  if (contactsError) throw contactsError;

  const byId = new Map(((contacts ?? []) as ContactRow[]).map((row) => [row.id, row]));
  const attorney = byId.get(input.attorneyContactId);
  const paralegal = byId.get(input.paralegalContactId);
  if (!attorney) throw new Error("Attorney contact not found.");
  if (!paralegal) throw new Error("Paralegal contact not found.");

  const { data: caseRow, error: caseReadError } = await admin
    .from("cases")
    .select("id,case_number,client_name,assigned_contact_ids,uses_eve")
    .eq("id", record.shared.id)
    .maybeSingle();
  if (caseReadError) throw caseReadError;
  if (!caseRow) throw new Error("DocketFlow case row not found.");

  const assignedContactIds = buildAssignedContactIds(
    input.attorneyContactId,
    input.paralegalContactId,
    (caseRow.assigned_contact_ids as string[] | null) ?? null,
    input.extraContactIds,
  );

  const usesEve = input.usesEve ?? Boolean(caseRow.uses_eve);

  const { error: caseUpdateError } = await admin
    .from("cases")
    .update({
      responsible_attorney_contact_id: input.attorneyContactId,
      assigned_contact_ids: assignedContactIds,
      uses_eve: usesEve,
      updated_at: new Date().toISOString(),
    })
    .eq("id", record.shared.id);
  if (caseUpdateError) throw caseUpdateError;

  const { error: trackerError } = await admin
    .from("case_tracker_entries")
    .update({
      attorney_contact_id: input.attorneyContactId,
      paralegal_contact_id: input.paralegalContactId,
      attorney_name: attorney.name,
      paralegal_name: paralegal.name,
    })
    .eq("case_id", record.shared.id);
  if (trackerError) throw trackerError;

  let channelRenamed = false;
  let nextChannelName: string | null = null;
  const mapping = await getSlackChannelForCaseNumber(record.shared.caseNumber);
  if (input.renameSlackChannel !== false && mapping?.slackChannelId) {
    const desiredName = buildCaseSlackChannelName({
      clientName: String(caseRow.client_name ?? record.shared.clientName),
      caseNumber: cleanCaseNumber(String(caseRow.case_number ?? record.shared.caseNumber)),
      currentName: mapping.slackChannelName,
    });
    if (desiredName && desiredName !== mapping.slackChannelName.replace(/^#/, "")) {
      const renamed = await renameSlackChannel(mapping.slackChannelId, desiredName);
      if (renamed) {
        channelRenamed = true;
        nextChannelName = desiredName;
        await admin
          .from("case_slack_channels")
          .update({
            slack_channel_name: desiredName,
            updated_at: new Date().toISOString(),
          })
          .eq("case_number", cleanCaseNumber(record.shared.caseNumber));
      }
    }
  }

  const refreshed = (await getCaseById(caseId)) as CaseRecord;
  let topicResult: Awaited<ReturnType<typeof syncSlackChannelTopicSummary>> | null = null;
  const { isSlackTopicAutoSyncEnabled } = await import("@/lib/slack/config");
  if (isSlackTopicAutoSyncEnabled()) {
    topicResult = await syncSlackChannelTopicSummary(refreshed);
    if (topicResult.updated && topicResult.stageLabel) {
      await updateChannelTopicStage(refreshed.shared.caseNumber, topicResult.stageLabel);
    }
  }

  let calendarReconcile: Awaited<ReturnType<typeof requestDocketFlowCalendarReconcile>> | null = null;
  if (!input.skipCalendarReconcile) {
    calendarReconcile = await requestDocketFlowCalendarReconcile(record.shared.id);
  }

  return {
    attorneyId: input.attorneyContactId,
    paralegalId: input.paralegalContactId,
    assignedContactIds,
    usesEve,
    channelRenamed,
    nextChannelName,
    topic: topicResult,
    calendarReconcile,
  };
}
