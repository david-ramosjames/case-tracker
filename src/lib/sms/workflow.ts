import { getAppOriginForNotifications } from "@/lib/auth/redirect-url";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { buildQuoContactMatches } from "@/lib/quo/contact-sync";
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

export async function syncQuoPhonesToTracker() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required.");

  const matches = await buildQuoContactMatches();
  const byCaseNumber = new Map<string, (typeof matches)[number]>();
  for (const match of matches) {
    const key = cleanCaseNumber(match.caseNumber);
    if (!key) continue;
    if (!byCaseNumber.has(key)) byCaseNumber.set(key, match);
  }

  const { data: trackerRows, error } = await admin
    .from("case_tracker_entries")
    .select("id, case_number")
    .not("case_number", "is", null);

  if (error) throw new Error(error.message);

  let updated = 0;
  let matched = 0;

  for (const row of trackerRows ?? []) {
    const caseNumber = cleanCaseNumber(String(row.case_number ?? ""));
    const match = byCaseNumber.get(caseNumber);
    if (!match) continue;
    matched += 1;

    const { error: updateError } = await admin
      .from("case_tracker_entries")
      .update({
        client_phone: match.phone,
        quo_contact_id: match.quoContactId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (!updateError) updated += 1;
  }

  return { totalContacts: matches.length, matched, updated };
}
