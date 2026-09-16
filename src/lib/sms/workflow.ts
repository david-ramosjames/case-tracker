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
import { rejectSmsPendingApproval } from "@/lib/sms/approval";
import { getSmsRecipients } from "@/lib/sms/recipients";
import { createSupabaseAdminClient, fetchAllSupabaseRows } from "@/lib/supabase/admin";
import { syncTrackerQuoContacts } from "@/lib/supabase/quo-contacts";
import { MANUAL_SMS_BATCH_SIZE } from "@/lib/sms/manual-send";
import { automationMatchesStageChange, automationMatchesTimeInStage, automationMatchesManualAttorney } from "@/lib/sms/automation-match";
import {
  claimSmsPendingApproval,
  createSmsPendingApproval,
  getSmsAutomationById,
  hasSmsAutomationDeliveryForCase,
  listSmsAutomations,
  listSmsPendingApprovalsForAutomation,
  listStaleSmsPendingApprovals,
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
  triggerType?: SmsAutomation["triggerType"];
  automationName?: string;
}) {
  const languageLabel = input.approval.language === "es" ? "Spanish" : "English";
  const recipientLabel = input.approval.quoContactName
    ? `${input.approval.quoContactName} · \`${input.approval.phone}\``
    : `\`${input.approval.phone}\``;
  const stageLine =
    input.triggerType === "manual"
      ? `Manual send${input.automationName ? ` · *${input.automationName}*` : ""}`
      : input.approval.fromStage === input.approval.toStage
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

    const slackText = buildSmsApprovalSlackMessage({
      approval,
      appUrl,
      triggerType: automation.triggerType,
      automationName: automation.name,
    });
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

export async function processManualAttorneyDepartureSms(options: {
  automationId: string;
  attorneyContactId: string;
  dryRun?: boolean;
  /** How many SMS to send in this call (default 5). */
  batchSize?: number;
}) {
  if (!isQuoEnabled() && !options.dryRun) {
    return {
      sent: 0,
      failed: 0,
      matched: 0,
      skipped: 0,
      cases: 0,
      remaining: 0,
      done: true,
      reason: "quo_disabled" as const,
    };
  }

  const automation = await getSmsAutomationById(options.automationId);
  if (!automation) {
    return {
      sent: 0,
      failed: 0,
      matched: 0,
      skipped: 0,
      cases: 0,
      remaining: 0,
      done: true,
      reason: "automation_not_found" as const,
    };
  }
  if (automation.triggerType !== "manual") {
    return {
      sent: 0,
      failed: 0,
      matched: 0,
      skipped: 0,
      cases: 0,
      remaining: 0,
      done: true,
      reason: "not_manual_automation" as const,
    };
  }
  if (!automation.enabled) {
    return {
      sent: 0,
      failed: 0,
      matched: 0,
      skipped: 0,
      cases: 0,
      remaining: 0,
      done: true,
      reason: "automation_disabled" as const,
    };
  }
  if (!options.attorneyContactId.trim()) {
    return {
      sent: 0,
      failed: 0,
      matched: 0,
      skipped: 0,
      cases: 0,
      remaining: 0,
      done: true,
      reason: "attorney_required" as const,
    };
  }

  const batchSize = Math.max(1, Math.min(options.batchSize ?? MANUAL_SMS_BATCH_SIZE, 20));

  type WorkItem = {
    record: CaseRecord;
    recipient: ReturnType<typeof getSmsRecipients>[number];
    language: "en" | "es";
    messageBody: string;
  };

  const records = await getCases();
  const workItems: WorkItem[] = [];
  const matchedCaseIds = new Set<string>();
  let english = 0;
  let spanish = 0;
  let alreadyHandled = 0;
  let missingPhone = 0;

  for (const record of records) {
    if (!automationMatchesManualAttorney(automation, record, options.attorneyContactId)) continue;
    matchedCaseIds.add(record.shared.id);
    const language = resolveClientLanguage(record);
    if (language === "es") spanish += 1;
    else english += 1;

    const recipients = getSmsRecipients(record);
    if (recipients.length === 0) {
      missingPhone += 1;
      continue;
    }

    for (const recipient of recipients) {
      const handled = await hasSmsAutomationDeliveryForCase(record.shared.id, automation.id, recipient.phone);
      if (handled) {
        alreadyHandled += 1;
        continue;
      }
      workItems.push({
        record,
        recipient,
        language,
        messageBody: buildAutomationMessage(
          automation,
          record,
          record.tracker.caseStage,
          record.tracker.caseStage,
        ),
      });
    }
  }

  const batch = workItems.slice(0, batchSize);
  const remainingAfter = Math.max(0, workItems.length - batch.length);

  if (options.dryRun) {
    return {
      sent: batch.length,
      failed: 0,
      matched: matchedCaseIds.size,
      skipped: alreadyHandled + missingPhone,
      cases: matchedCaseIds.size,
      english,
      spanish,
      alreadyHandled,
      missingPhone,
      remaining: remainingAfter,
      done: remainingAfter === 0,
      totalPending: workItems.length,
      batchSize,
      automationName: automation.name,
      dryRun: true as const,
    };
  }

  let sent = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const item of batch) {
    const approval = await createSmsPendingApproval({
      caseId: item.record.shared.id,
      trackerEntryId: item.record.tracker.id,
      automationId: automation.id,
      caseNumber: item.record.shared.caseNumber,
      clientName: item.record.shared.clientName,
      phone: item.recipient.phone,
      quoContactId: item.recipient.quoContactId,
      quoContactName: item.recipient.displayName,
      language: item.language,
      messageBody: item.messageBody,
      fromStage: item.record.tracker.caseStage,
      toStage: item.record.tracker.caseStage,
    });

    try {
      const quoMessageId = await sendQuoTextMessage({
        to: item.recipient.phone,
        content: item.messageBody,
      });
      await updateSmsPendingApproval(approval.id, {
        status: "sent",
        quoMessageId,
        sentAt: new Date().toISOString(),
        errorMessage: null,
      });
      sent += 1;
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : "SMS send failed.";
      await updateSmsPendingApproval(approval.id, {
        status: "failed",
        errorMessage: message,
      });
      failed += 1;
      failures.push(`#${item.record.shared.caseNumber} ${item.recipient.phone}: ${message}`);
    }
  }

  return {
    sent,
    failed,
    matched: matchedCaseIds.size,
    skipped: alreadyHandled + missingPhone,
    cases: matchedCaseIds.size,
    english,
    spanish,
    alreadyHandled,
    missingPhone,
    remaining: remainingAfter,
    done: remainingAfter === 0,
    totalPending: workItems.length,
    batchSize,
    automationName: automation.name,
    dryRun: false as const,
    failures: failures.slice(0, 10),
  };
}

export type ManualSmsProgressItem = {
  caseId: string;
  caseNumber: string;
  clientName: string | null;
  phone: string;
  language: "en" | "es";
  status?: SmsPendingApproval["status"];
  sentAt?: string | null;
  errorMessage?: string | null;
};

const HANDLED_SMS_STATUSES = new Set<SmsPendingApproval["status"]>(["pending", "approved", "sent", "rejected"]);

export async function getManualAttorneyDepartureSmsProgress(options: {
  automationId: string;
  attorneyContactId: string;
}) {
  const automation = await getSmsAutomationById(options.automationId);
  if (!automation) {
    return { reason: "automation_not_found" as const };
  }
  if (automation.triggerType !== "manual") {
    return { reason: "not_manual_automation" as const };
  }
  if (!options.attorneyContactId.trim()) {
    return { reason: "attorney_required" as const };
  }

  const records = await getCases();
  const matched = records.filter((record) =>
    automationMatchesManualAttorney(automation, record, options.attorneyContactId, { requireEnabled: false }),
  );
  const matchedCaseIds = new Set(matched.map((record) => record.shared.id));

  const approvals = (await listSmsPendingApprovalsForAutomation(automation.id)).filter((row) =>
    matchedCaseIds.has(row.caseId),
  );

  // Group all delivery rows per case+phone (query is newest-first).
  const byKey = new Map<string, SmsPendingApproval[]>();
  for (const approval of approvals) {
    const key = `${approval.caseId}::${approval.phone}`;
    const list = byKey.get(key) ?? [];
    list.push(approval);
    byKey.set(key, list);
  }

  const sent: ManualSmsProgressItem[] = [];
  const skipped: ManualSmsProgressItem[] = [];
  const failed: ManualSmsProgressItem[] = [];
  const remaining: ManualSmsProgressItem[] = [];
  const missingPhone: ManualSmsProgressItem[] = [];
  let english = 0;
  let spanish = 0;

  for (const record of matched) {
    const language = resolveClientLanguage(record);
    if (language === "es") spanish += 1;
    else english += 1;

    const recipients = getSmsRecipients(record);
    if (recipients.length === 0) {
      missingPhone.push({
        caseId: record.shared.id,
        caseNumber: record.shared.caseNumber,
        clientName: record.shared.clientName,
        phone: "",
        language,
      });
      continue;
    }

    for (const recipient of recipients) {
      const key = `${record.shared.id}::${recipient.phone}`;
      const rows = byKey.get(key) ?? [];
      const sentRow = rows.find((row) => row.status === "sent");
      const skippedRow = rows.find((row) => HANDLED_SMS_STATUSES.has(row.status) && row.status !== "sent");
      const failedRow = rows.find((row) => row.status === "failed");
      const latest = rows[0];

      const item: ManualSmsProgressItem = {
        caseId: record.shared.id,
        caseNumber: record.shared.caseNumber,
        clientName: record.shared.clientName ?? recipient.displayName,
        phone: recipient.phone,
        language,
        status: sentRow?.status ?? skippedRow?.status ?? failedRow?.status ?? latest?.status,
        sentAt: sentRow?.sentAt ?? null,
        errorMessage: failedRow?.errorMessage ?? null,
      };

      if (sentRow) {
        sent.push(item);
      } else if (skippedRow) {
        skipped.push(item);
      } else if (failedRow) {
        failed.push(item);
        remaining.push(item);
      } else {
        remaining.push(item);
      }
    }
  }

  const sortByCase = (a: ManualSmsProgressItem, b: ManualSmsProgressItem) =>
    a.caseNumber.localeCompare(b.caseNumber, undefined, { numeric: true });

  sent.sort(sortByCase);
  skipped.sort(sortByCase);
  failed.sort(sortByCase);
  remaining.sort(sortByCase);
  missingPhone.sort(sortByCase);

  return {
    automationId: automation.id,
    automationName: automation.name,
    attorneyContactId: options.attorneyContactId,
    cases: matched.length,
    english,
    spanish,
    sentCount: sent.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    remainingCount: remaining.length,
    missingPhoneCount: missingPhone.length,
    done: remaining.length === 0,
    sent,
    skipped,
    failed,
    remaining,
    missingPhone,
  };
}

/** Default batch size for manual attorney-departure SMS (spread callbacks). */
export { MANUAL_SMS_BATCH_SIZE } from "@/lib/sms/manual-send";

export const SMS_APPROVAL_AUTO_REJECT_DAYS = 7;

export async function autoRejectStaleSmsPendingApprovals(options?: {
  dryRun?: boolean;
  maxAgeDays?: number;
}) {
  if (!isSlackEnabled()) {
    return { rejected: 0, stale: 0, reason: "slack_disabled" as const };
  }

  const maxAgeDays = options?.maxAgeDays ?? SMS_APPROVAL_AUTO_REJECT_DAYS;
  const stale = await listStaleSmsPendingApprovals(maxAgeDays);

  if (options?.dryRun) {
    return { rejected: stale.length, stale: stale.length, dryRun: true as const, maxAgeDays };
  }

  let rejected = 0;
  const slackMessage = `Client SMS auto-cancelled — no approval received within ${maxAgeDays} days. No message was sent.`;

  for (const approval of stale) {
    const result = await rejectSmsPendingApproval(approval, { slackMessage });
    if (result.rejected) rejected += 1;
  }

  return { rejected, stale: stale.length, maxAgeDays };
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
  // Claim first so concurrent Slack retries / reactions cannot both send.
  const claimed = await claimSmsPendingApproval(approvalId, "approved");
  if (!claimed) return { sent: false as const, reason: "not_pending" as const };

  if (!isQuoEnabled()) {
    await updateSmsPendingApproval(approvalId, {
      status: "failed",
      errorMessage: "Quo API is not configured (QUO_API_KEY / QUO_FROM_PHONE).",
    });
    return { sent: false as const, reason: "quo_disabled" as const };
  }

  try {
    const quoMessageId = await sendQuoTextMessage({
      to: claimed.phone,
      content: claimed.messageBody,
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

type QuoSyncTrackerRow = {
  id: string;
  case_number: string | null;
  case_id: string | null;
  client_name_snapshot: string | null;
  client_phone: string | null;
  quo_contact_id: string | null;
  quo_conversation_id: string | null;
  quo_phone_number_id: string | null;
};

/** Load tracker rows for Quo sync, resolving via cases.case_number when tracker.case_number is blank. */
async function loadTrackerRowsForQuoSync(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  filterSet: Set<string> | null,
): Promise<{ rows: QuoSyncTrackerRow[]; missingCaseNumbers: string[]; backfilled: number }> {
  const selectCols =
    "id, case_number, case_id, client_name_snapshot, client_phone, quo_contact_id, quo_conversation_id, quo_phone_number_id";

  const allTrackers = await fetchAllSupabaseRows<QuoSyncTrackerRow>(admin, "case_tracker_entries", selectCols);
  const caseRows = await fetchAllSupabaseRows<{ id: string; case_number: string | null; client_name: string | null }>(
    admin,
    "cases",
    "id, case_number, client_name",
  );

  const caseNumberById = new Map<string, string>();
  const caseIdByNumber = new Map<string, string>();
  const clientNameByCaseId = new Map<string, string>();
  for (const row of caseRows) {
    const num = cleanCaseNumber(String(row.case_number ?? ""));
    if (!num || !row.id) continue;
    caseNumberById.set(String(row.id), num);
    caseIdByNumber.set(num, String(row.id));
    if (row.client_name) clientNameByCaseId.set(String(row.id), String(row.client_name));
  }

  const byId = new Map<string, QuoSyncTrackerRow>();
  let backfilled = 0;

  for (const raw of allTrackers) {
    let caseNumber = cleanCaseNumber(String(raw.case_number ?? ""));
    const caseId = raw.case_id ? String(raw.case_id) : null;

    if (!caseNumber && caseId) {
      caseNumber = caseNumberById.get(caseId) ?? "";
      if (caseNumber) {
        await admin.from("case_tracker_entries").update({ case_number: caseNumber }).eq("id", raw.id);
        backfilled += 1;
      }
    }

    if (!caseNumber) continue;
    if (filterSet && !filterSet.has(caseNumber)) continue;

    byId.set(String(raw.id), {
      ...raw,
      case_number: caseNumber,
      client_name_snapshot: raw.client_name_snapshot ?? (caseId ? clientNameByCaseId.get(caseId) ?? null : null),
    });
  }

  // For filtered sync: also find trackers linked only via cases.case_id when case_number was blank.
  if (filterSet) {
    for (const caseNumber of filterSet) {
      const already = [...byId.values()].some((row) => cleanCaseNumber(String(row.case_number ?? "")) === caseNumber);
      if (already) continue;

      const caseId = caseIdByNumber.get(caseNumber);
      if (!caseId) continue;

      const linked = ((allTrackers ?? []) as QuoSyncTrackerRow[]).find((row) => String(row.case_id ?? "") === caseId);
      if (!linked) continue;

      await admin.from("case_tracker_entries").update({ case_number: caseNumber }).eq("id", linked.id);
      backfilled += 1;
      byId.set(String(linked.id), {
        ...linked,
        case_number: caseNumber,
        client_name_snapshot: linked.client_name_snapshot ?? clientNameByCaseId.get(caseId) ?? null,
      });
    }
  }

  const rows = [...byId.values()];
  const foundNumbers = new Set(rows.map((row) => cleanCaseNumber(String(row.case_number ?? ""))).filter(Boolean));
  const missingCaseNumbers = filterSet ? [...filterSet].filter((n) => !foundNumbers.has(n)) : [];

  return { rows, missingCaseNumbers, backfilled };
}

export async function syncQuoPhonesToTracker(filterCaseNumbers?: string[]) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required.");

  const filterSet = filterCaseNumbers?.length
    ? new Set(filterCaseNumbers.map((n) => cleanCaseNumber(n)).filter(Boolean))
    : null;

  const { matches, totalDirectoryContacts, noCaseNumber } = await buildQuoContactMatches();
  const groupedMatches = groupQuoContactMatchesByCaseNumber(matches);

  const { rows: trackerRows, missingCaseNumbers, backfilled } = await loadTrackerRowsForQuoSync(admin, filterSet);

  const trackerCaseNumbers = new Set(
    trackerRows.map((row) => cleanCaseNumber(String(row.case_number ?? ""))).filter(Boolean),
  );

  const unmatchedContacts: Array<{ displayName: string; caseNumber: string }> = [];
  const seenUnmatchedIds = new Set<string>();
  for (const match of matches) {
    const key = cleanCaseNumber(match.caseNumber);
    if (filterSet && !filterSet.has(key)) continue;
    if (key && !trackerCaseNumbers.has(key) && !seenUnmatchedIds.has(match.quoContactId)) {
      seenUnmatchedIds.add(match.quoContactId);
      unmatchedContacts.push({ displayName: match.displayName, caseNumber: match.caseNumber });
    }
  }

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

  for (const row of trackerRows) {
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

  return {
    totalContacts: matches.length,
    totalDirectoryContacts,
    matched,
    updated,
    skipped,
    conversationLinks,
    conversationSyncWarning,
    noCaseNumber,
    unmatchedContacts,
    missingCaseNumbers,
    backfilled,
  };
}
