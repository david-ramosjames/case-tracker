import { getAppOriginForNotifications } from "@/lib/auth/redirect-url";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { buildQuoContactMatches, groupQuoContactMatchesByCaseNumber, listQuoContactMatchesForCase } from "@/lib/quo/contact-sync";
import { lookupQuoInboxForContact, type QuoInboxMatch } from "@/lib/quo/client";
import { isQuoEnabled } from "@/lib/quo/config";
import { sendQuoTextMessage } from "@/lib/quo/client";
import { renderSmsMessage } from "@/lib/sms/message-template";
import { getSlackChannelForCaseNumber } from "@/lib/slack/channels";
import { postSlackMessage } from "@/lib/slack/client";
import { isSlackEnabled, getSmsApprovalSlackChannelId } from "@/lib/slack/config";
import { getSmsRecipients } from "@/lib/sms/recipients";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncTrackerQuoContacts } from "@/lib/supabase/quo-contacts";
import { automationMatchesStageChange, automationMatchesTimeInStage } from "@/lib/sms/automation-match";
import {
  createSmsPendingApproval,
  hasSmsAutomationDeliveryForCase,
  listSmsAutomations,
  updateSmsPendingApproval,
  type SmsAutomation,
  type SmsPendingApproval,
} from "@/lib/supabase/sms-automations";
import { getCases } from "@/lib/supabase/services";
import { type CaseRecord, type CaseStage } from "@/lib/types";

function resolveClientLanguage(record: CaseRecord): "en" | "es" {
  return record.shared.preferredLanguage === "es" ? "es" : "en";
}

function buildAutomationMessage(automation: SmsAutomation, record: CaseRecord, fromStage: CaseStage, toStage: CaseStage) {
  const language = resolveClientLanguage(record);
  const template = language === "es" ? automation.messageEs : automation.messageEn;
  const youtubeUrl = language === "es" ? automation.youtubeUrlEs : automation.youtubeUrlEn;

  return renderSmsMessage(template, {
    clientName: record.shared.clientName,
    caseNumber: record.shared.caseNumber,
    fromStage,
    toStage,
    language,
    youtubeUrl,
  });
}

async function resolveApprovalChannelId(caseNumber: string) {
  const configured = getSmsApprovalSlackChannelId();
  if (configured) return configured;

  const mapping = await getSlackChannelForCaseNumber(caseNumber);
  return mapping?.slackChannelId ?? null;
}

export function buildSmsApprovalSlackMessage(input: {
  approval: SmsPendingApproval;
  appUrl: string;
}) {
  const languageLabel = input.approval.language === "es" ? "Spanish" : "English";
  const recipientLabel = input.approval.quoContactName
    ? `${input.approval.quoContactName} · \`${input.approval.phone}\``
    : `\`${input.approval.phone}\``;
  const stageLine =
    input.approval.fromStage === input.approval.toStage
      ? `While in *${input.approval.toStage}* (signing delay met)`
      : `Stage: *${input.approval.fromStage}* → *${input.approval.toStage}*`;
  return [
    "*Pending client SMS — not sent yet.*",
    `Case *#${input.approval.caseNumber}* · ${input.approval.clientName ?? "Client"}`,
    stageLine,
    `To: ${recipientLabel} (${languageLabel})`,
    "",
    "*Message preview:*",
    "```",
    input.approval.messageBody,
    "```",
    "",
    "Reply in this thread with ✅ or `approve` / `send` to send via Quo.",
    "Reply `no` or `reject` to cancel.",
    `<${input.appUrl}/cases/${input.approval.caseId}|Open case>`,
  ].join("\n");
}

async function queueSmsApprovalsForAutomation(
  record: CaseRecord,
  automation: SmsAutomation,
  stages: { fromStage: CaseStage; toStage: CaseStage },
  options?: { dryRun?: boolean },
) {
  const recipients = getSmsRecipients(record);
  if (recipients.length === 0) return { queued: 0, skipped: "missing_phone" as const };

  const channelId = await resolveApprovalChannelId(record.shared.caseNumber);
  if (!channelId) return { queued: 0, skipped: "no_slack_channel" as const };

  const appUrl = getAppOriginForNotifications() ?? "";
  let queued = 0;

  for (const recipient of recipients) {
    const alreadyHandled = await hasSmsAutomationDeliveryForCase(record.shared.id, automation.id, recipient.phone);
    if (alreadyHandled) continue;

    if (options?.dryRun) {
      queued += 1;
      continue;
    }

    const messageBody = buildAutomationMessage(automation, record, stages.fromStage, stages.toStage);
    const approval = await createSmsPendingApproval({
      caseId: record.shared.id,
      trackerEntryId: record.tracker.id,
      automationId: automation.id,
      caseNumber: record.shared.caseNumber,
      clientName: record.shared.clientName,
      phone: recipient.phone,
      quoContactId: recipient.quoContactId,
      quoContactName: recipient.displayName,
      language: resolveClientLanguage(record),
      messageBody,
      fromStage: stages.fromStage,
      toStage: stages.toStage,
    });

    const slackText = buildSmsApprovalSlackMessage({ approval, appUrl });
    const posted = await postSlackMessage({ channel: channelId, text: slackText });
    if (!posted?.ts) continue;

    await updateSmsPendingApproval(approval.id, {
      slackChannelId: channelId,
      slackThreadTs: posted.ts,
    });
    queued += 1;
  }

  return { queued };
}

export async function queueSmsApprovalsForStageChange(
  before: CaseRecord,
  after: CaseRecord,
  previousStage: CaseStage | undefined,
) {
  if (!isSlackEnabled()) return { queued: 0, skipped: "slack_disabled" as const };
  if (!previousStage || previousStage === after.tracker.caseStage) return { queued: 0, skipped: "no_stage_change" as const };

  const automations = await listSmsAutomations();
  const matches = automations.filter((automation) =>
    automationMatchesStageChange(automation, after, previousStage, after.tracker.caseStage),
  );
  if (matches.length === 0) return { queued: 0, skipped: "no_matching_automation" as const };

  let queued = 0;
  for (const automation of matches) {
    const result = await queueSmsApprovalsForAutomation(after, automation, {
      fromStage: previousStage,
      toStage: after.tracker.caseStage,
    });
    if ("skipped" in result && result.skipped) return { queued: 0, skipped: result.skipped };
    queued += result.queued;
  }

  return { queued };
}

export async function processSmsTimeInStageAutomations(options?: {
  dryRun?: boolean;
  caseNumber?: string;
}) {
  if (!isSlackEnabled()) {
    return { queued: 0, matched: 0, skipped: 0, automations: 0, reason: "slack_disabled" as const };
  }

  const automations = (await listSmsAutomations()).filter(
    (automation) => automation.enabled && automation.triggerType === "time_in_stage",
  );
  if (automations.length === 0) {
    return { queued: 0, matched: 0, skipped: 0, automations: 0, reason: "no_time_automations" as const };
  }

  const caseFilter = options?.caseNumber?.trim();
  const caseKey = caseFilter ? cleanCaseNumber(caseFilter) : null;
  let records = await getCases();
  if (caseKey) {
    records = records.filter((record) => cleanCaseNumber(record.shared.caseNumber) === caseKey);
  }

  let queued = 0;
  let matched = 0;
  let skipped = 0;

  for (const record of records) {
    for (const automation of automations) {
      if (!automationMatchesTimeInStage(automation, record)) continue;
      matched += 1;
      const result = await queueSmsApprovalsForAutomation(
        record,
        automation,
        { fromStage: record.tracker.caseStage, toStage: record.tracker.caseStage },
        { dryRun: options?.dryRun },
      );
      if ("skipped" in result && result.skipped) {
        skipped += 1;
        continue;
      }
      if (result.queued === 0) skipped += 1;
      queued += result.queued;
    }
  }

  return { queued, matched, skipped, automations: automations.length, dryRun: Boolean(options?.dryRun) };
}

export function isSmsApprovalText(text: string) {
  const normalized = text.trim().toLowerCase();
  return (
    normalized === "approve" ||
    normalized === "approved" ||
    normalized === "send" ||
    normalized === "yes" ||
    normalized === "confirm" ||
    normalized === "confirmed"
  );
}

export function isSmsRejectionText(text: string) {
  const normalized = text.trim().toLowerCase();
  return normalized === "no" || normalized === "reject" || normalized === "rejected" || normalized === "cancel" || normalized === "dismiss";
}

export async function approveAndSendSmsPendingApproval(approvalId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required.");

  const { data, error } = await admin.from("sms_pending_approvals").select("*").eq("id", approvalId).single();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "pending") return { sent: false as const, reason: "not_pending" as const };

  if (!isQuoEnabled()) {
    await updateSmsPendingApproval(approvalId, {
      status: "failed",
      errorMessage: "Quo API is not configured (QUO_API_KEY / QUO_FROM_PHONE).",
    });
    return { sent: false as const, reason: "quo_disabled" as const };
  }

  try {
    const quoMessageId = await sendQuoTextMessage({
      to: data.phone,
      content: data.message_body,
    });
    await updateSmsPendingApproval(approvalId, {
      status: "sent",
      quoMessageId,
      sentAt: new Date().toISOString(),
      errorMessage: null,
    });
    return { sent: true as const, quoMessageId };
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : "SMS send failed.";
    await updateSmsPendingApproval(approvalId, {
      status: "failed",
      errorMessage: message,
    });
    return { sent: false as const, reason: "send_failed" as const, message };
  }
}

export async function syncQuoPhonesToTrackerIfConfigured() {
  if (!isQuoEnabled()) {
    return {
      configured: false,
      totalContacts: 0,
      matched: 0,
      updated: 0,
      skipped: 0,
      conversationLinks: 0,
      conversationSyncWarning: null as string | null,
    };
  }

  const result = await syncQuoPhonesToTracker();
  return { configured: true, ...result };
}

export async function syncQuoPhonesToTracker() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required.");

  const matches = await buildQuoContactMatches();
  const groupedMatches = groupQuoContactMatchesByCaseNumber(matches);

  const { data: trackerRows, error } = await admin
    .from("case_tracker_entries")
    .select("id, case_number, client_name_snapshot, client_phone, quo_contact_id, quo_conversation_id, quo_phone_number_id")
    .not("case_number", "is", null);

  if (error) throw new Error(error.message);

  const inboxCache = new Map<string, QuoInboxMatch | null>();
  let conversationSyncWarning: string | null = null;

  async function resolveInboxForMatch(input: {
    quoContactId: string;
    displayName: string;
    phone?: string | null;
  }) {
    const cacheKey = `${input.quoContactId}|${input.displayName}|${input.phone ?? ""}`;
    if (inboxCache.has(cacheKey)) return inboxCache.get(cacheKey) ?? null;

    try {
      const inbox = await lookupQuoInboxForContact(input);
      inboxCache.set(cacheKey, inbox ?? null);
      return inbox ?? null;
    } catch (error) {
      if (!conversationSyncWarning) {
        conversationSyncWarning =
          error instanceof Error ? error.message : "Quo inbox lookup failed; phones still synced.";
      }
      console.warn("Quo inbox lookup failed", error);
      inboxCache.set(cacheKey, null);
      return null;
    }
  }

  let updated = 0;
  let matched = 0;
  let skipped = 0;
  let conversationLinks = 0;

  for (const row of trackerRows ?? []) {
    const caseNumber = cleanCaseNumber(String(row.case_number ?? ""));
    const caseMatches = listQuoContactMatchesForCase(groupedMatches.get(caseNumber) ?? [], row.client_name_snapshot);

    const currentPhone = String(row.client_phone ?? "").trim() || null;
    const currentContactId = String(row.quo_contact_id ?? "").trim() || null;
    const currentConversationId = String(row.quo_conversation_id ?? "").trim() || null;
    const currentPhoneNumberId = String(row.quo_phone_number_id ?? "").trim() || null;

    const syncedContacts: Array<{
      quoContactId: string;
      displayName: string;
      phone: string | null;
      quoConversationId: string | null;
      quoPhoneNumberId: string | null;
    }> = [];

    for (const match of caseMatches) {
      let phone = match.phone?.trim() || null;
      let conversationId: string | null = null;
      let phoneNumberId: string | null = null;

      const inbox = await resolveInboxForMatch({
        quoContactId: match.quoContactId,
        displayName: match.displayName,
        phone,
      });
      if (inbox) {
        phone = inbox.phone;
        conversationId = inbox.conversationId;
        phoneNumberId = inbox.phoneNumberId;
      }

      syncedContacts.push({
        quoContactId: match.quoContactId,
        displayName: match.displayName,
        phone,
        quoConversationId: conversationId,
        quoPhoneNumberId: phoneNumberId,
      });
      if (conversationId) conversationLinks += 1;
    }

    if (caseMatches.length > 0) matched += 1;

    await syncTrackerQuoContacts(String(row.id), syncedContacts);

    const primary = syncedContacts[0] ?? null;
    const nextPhone = primary?.phone ?? currentPhone;
    const nextContactId = primary?.quoContactId ?? currentContactId;
    const nextConversationId = primary?.quoConversationId ?? currentConversationId;
    const nextPhoneNumberId = primary?.quoPhoneNumberId ?? currentPhoneNumberId;

    if (
      caseMatches.length === 0 &&
      currentPhone === nextPhone &&
      currentContactId === nextContactId &&
      currentConversationId === nextConversationId &&
      currentPhoneNumberId === nextPhoneNumberId
    ) {
      skipped += 1;
      continue;
    }

    const { error: updateError } = await admin
      .from("case_tracker_entries")
      .update({
        client_phone: nextPhone,
        quo_contact_id: nextContactId,
        quo_conversation_id: nextConversationId,
        quo_phone_number_id: nextPhoneNumberId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (!updateError) updated += 1;
  }

  return { totalContacts: matches.length, matched, updated, skipped, conversationLinks, conversationSyncWarning };
}
