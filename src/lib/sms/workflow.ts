import { getAppOriginForNotifications } from "@/lib/auth/redirect-url";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { buildQuoContactMatches, groupQuoContactMatchesByCaseNumber, pickBestQuoContactMatch } from "@/lib/quo/contact-sync";
import { lookupQuoInboxForContact, type QuoInboxMatch } from "@/lib/quo/client";
import { isQuoEnabled } from "@/lib/quo/config";
import { sendQuoTextMessage } from "@/lib/quo/client";
import { renderSmsMessage } from "@/lib/sms/message-template";
import { getSlackChannelForCaseNumber } from "@/lib/slack/channels";
import { postSlackMessage } from "@/lib/slack/client";
import { isSlackEnabled, getSmsApprovalSlackChannelId } from "@/lib/slack/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createSmsPendingApproval,
  hasPendingSmsApprovalForCase,
  listSmsAutomations,
  updateSmsPendingApproval,
  type SmsAutomation,
  type SmsPendingApproval,
} from "@/lib/supabase/sms-automations";
import { type CaseRecord, type CaseStage } from "@/lib/types";

function automationMatchesRecord(automation: SmsAutomation, record: CaseRecord, fromStage: CaseStage, toStage: CaseStage) {
  if (!automation.enabled) return false;
  if (automation.toStage !== toStage) return false;
  if (automation.fromStage !== "any" && automation.fromStage !== fromStage) return false;
  if (automation.caseTypes.length > 0 && !automation.caseTypes.includes(record.shared.caseType)) return false;
  return true;
}

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
  return [
    "*Pending client SMS — not sent yet.*",
    `Case *#${input.approval.caseNumber}* · ${input.approval.clientName ?? "Client"}`,
    `Stage: *${input.approval.fromStage}* → *${input.approval.toStage}*`,
    `To: \`${input.approval.phone}\` (${languageLabel})`,
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

export async function queueSmsApprovalsForStageChange(
  before: CaseRecord,
  after: CaseRecord,
  previousStage: CaseStage | undefined,
) {
  if (!isSlackEnabled()) return { queued: 0, skipped: "slack_disabled" as const };
  if (!previousStage || previousStage === after.tracker.caseStage) return { queued: 0, skipped: "no_stage_change" as const };

  const automations = await listSmsAutomations();
  const matches = automations.filter((automation) =>
    automationMatchesRecord(automation, after, previousStage, after.tracker.caseStage),
  );
  if (matches.length === 0) return { queued: 0, skipped: "no_matching_automation" as const };

  const phone = after.tracker.clientPhone?.trim();
  if (!phone) return { queued: 0, skipped: "missing_phone" as const };

  const channelId = await resolveApprovalChannelId(after.shared.caseNumber);
  if (!channelId) return { queued: 0, skipped: "no_slack_channel" as const };

  const appUrl = getAppOriginForNotifications() ?? "";
  let queued = 0;

  for (const automation of matches) {
    const alreadyPending = await hasPendingSmsApprovalForCase(after.shared.id, automation.id);
    if (alreadyPending) continue;

    const messageBody = buildAutomationMessage(automation, after, previousStage, after.tracker.caseStage);
    const approval = await createSmsPendingApproval({
      caseId: after.shared.id,
      trackerEntryId: after.tracker.id,
      automationId: automation.id,
      caseNumber: after.shared.caseNumber,
      clientName: after.shared.clientName,
      phone,
      language: resolveClientLanguage(after),
      messageBody,
      fromStage: previousStage,
      toStage: after.tracker.caseStage,
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
    const match = pickBestQuoContactMatch(groupedMatches.get(caseNumber) ?? [], row.client_name_snapshot);

    const currentPhone = String(row.client_phone ?? "").trim() || null;
    const currentContactId = String(row.quo_contact_id ?? "").trim() || null;
    const currentConversationId = String(row.quo_conversation_id ?? "").trim() || null;
    const currentPhoneNumberId = String(row.quo_phone_number_id ?? "").trim() || null;

    let nextPhone = match?.phone?.trim() || currentPhone || null;
    const nextContactId = match?.quoContactId ?? (currentContactId || null);
    let nextConversationId = currentConversationId;
    let nextPhoneNumberId = currentPhoneNumberId;

    const contactChanged = Boolean(match && nextContactId !== currentContactId);
    const phoneChanged = Boolean(match?.phone?.trim()) && nextPhone !== currentPhone;
    const needsInboxLookup =
      Boolean(match) &&
      (contactChanged || phoneChanged || !currentConversationId || !currentPhoneNumberId || !nextPhone);

    if (match && needsInboxLookup) {
      const inbox = await resolveInboxForMatch({
        quoContactId: match.quoContactId,
        displayName: match.displayName,
        phone: nextPhone,
      });
      if (inbox) {
        nextPhone = inbox.phone;
        nextConversationId = inbox.conversationId;
        nextPhoneNumberId = inbox.phoneNumberId;
      } else if (contactChanged || phoneChanged) {
        nextConversationId = null;
        nextPhoneNumberId = null;
      }
    } else if (contactChanged) {
      nextConversationId = null;
      nextPhoneNumberId = null;
    }

    if (match) matched += 1;
    if (nextConversationId) conversationLinks += 1;

    if (
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
