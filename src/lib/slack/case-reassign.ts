import { cleanCaseNumber } from "@/lib/csv/parse";
import { requestDocketFlowCalendarReconcile } from "@/lib/docketflow/calendar-reconcile";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCaseById, isOrphanTrackerRecord } from "@/lib/supabase/services";
import { inviteCaseTeamToSlackChannel } from "@/lib/slack/channel-members";
import { renameSlackChannel } from "@/lib/slack/client";
import { getSlackChannelForCaseNumber, updateChannelTopicStage } from "@/lib/slack/channels";
import { syncSlackChannelTopicSummary } from "@/lib/slack/channel-topic";
import { buildCaseSlackChannelName } from "@/lib/slack/channel-name";
import { type CaseRecord } from "@/lib/types";

export type CaseAssignmentInput = {
  attorneyContactId: string;
  paralegalContactId: string;
  /** When set, becomes the 3rd assigned contact (legal assistant). */
  legalAssistantContactId?: string | null;
  /** Extra assignees preserved after attorney + paralegal (+ LA). */
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
  legalAssistantId: string | null | undefined,
  existing: string[] | null | undefined,
  extras?: string[],
  previousLegalAssistantId?: string | null,
) {
  const seen = new Set<string>();
  const head = [attorneyId, paralegalId, legalAssistantId].filter((id): id is string => Boolean(id));
  const dropPrevious =
    previousLegalAssistantId && previousLegalAssistantId !== legalAssistantId
      ? previousLegalAssistantId
      : null;
  const next: string[] = [];
  for (const id of [...head, ...(extras ?? []), ...(existing ?? [])]) {
    if (!id || seen.has(id)) continue;
    if (dropPrevious && id === dropPrevious) continue;
    seen.add(id);
    next.push(id);
  }
  const remainder = next.filter((id) => !head.includes(id));
  return [...head, ...remainder];
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
  if (input.legalAssistantContactId) contactIds.push(input.legalAssistantContactId);
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
  if (input.legalAssistantContactId && !byId.get(input.legalAssistantContactId)) {
    throw new Error("Legal assistant contact not found.");
  }

  const { data: caseRow, error: caseReadError } = await admin
    .from("cases")
    .select("id,case_number,client_name,assigned_contact_ids,uses_eve")
    .eq("id", record.shared.id)
    .maybeSingle();
  if (caseReadError) throw caseReadError;
  if (!caseRow) throw new Error("DocketFlow case row not found.");

  const nextLegalAssistantId =
    input.legalAssistantContactId === undefined
      ? record.shared.legalAssistantId
      : input.legalAssistantContactId;
  const assignedContactIds = buildAssignedContactIds(
    input.attorneyContactId,
    input.paralegalContactId,
    nextLegalAssistantId,
    (caseRow.assigned_contact_ids as string[] | null) ?? null,
    input.extraContactIds,
    record.shared.legalAssistantId,
  );

  const usesEve = input.usesEve ?? Boolean(caseRow.uses_eve);

  const { error: caseUpdateError } = await admin
    .from("cases")
    .update({
      responsible_attorney_contact_id: input.attorneyContactId,
      assigned_contact_ids: assignedContactIds,
      uses_eve: usesEve,
      // DocketFlow cases.updated_at is bigint epoch ms — never send an ISO string.
      updated_at: Date.now(),
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
  let channelInvite: Awaited<ReturnType<typeof inviteCaseTeamToSlackChannel>> | null = null;
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
  if (mapping?.slackChannelId) {
    channelInvite = await inviteCaseTeamToSlackChannel({
      channelId: mapping.slackChannelId,
      attorney: refreshed.attorney,
      paralegal: refreshed.paralegal,
      legalAssistant: refreshed.legalAssistant,
    });
  }

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
    legalAssistantId: nextLegalAssistantId,
    assignedContactIds,
    usesEve,
    channelRenamed,
    nextChannelName,
    channelInvite,
    topic: topicResult,
    calendarReconcile,
  };
}
