import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { type CaseStage } from "@/lib/types";

export type ClientPreferredLanguage = "en" | "es";

export type SmsAutomation = {
  id: string;
  name: string;
  enabled: boolean;
  fromStage: CaseStage | "any";
  toStage: CaseStage;
  caseTypes: string[];
  messageEn: string;
  messageEs: string;
  youtubeUrlEn: string | null;
  youtubeUrlEs: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SmsPendingApproval = {
  id: string;
  caseId: string;
  trackerEntryId: string | null;
  automationId: string | null;
  caseNumber: string;
  clientName: string | null;
  phone: string;
  language: ClientPreferredLanguage;
  messageBody: string;
  fromStage: CaseStage;
  toStage: CaseStage;
  status: "pending" | "approved" | "rejected" | "sent" | "failed" | "cancelled";
  slackChannelId: string | null;
  slackThreadTs: string | null;
  quoMessageId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};

type AutomationRow = {
  id: string;
  name: string;
  enabled: boolean;
  from_stage: string;
  to_stage: string;
  case_types: string[] | null;
  message_en: string;
  message_es: string;
  youtube_url_en: string | null;
  youtube_url_es: string | null;
  created_at: string;
  updated_at: string;
};

type ApprovalRow = {
  id: string;
  case_id: string;
  tracker_entry_id: string | null;
  automation_id: string | null;
  case_number: string;
  client_name: string | null;
  phone: string;
  language: ClientPreferredLanguage;
  message_body: string;
  from_stage: string;
  to_stage: string;
  status: SmsPendingApproval["status"];
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  quo_message_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
};

function rowToAutomation(row: AutomationRow): SmsAutomation {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    fromStage: row.from_stage === "any" ? "any" : (row.from_stage as CaseStage),
    toStage: row.to_stage as CaseStage,
    caseTypes: row.case_types ?? [],
    messageEn: row.message_en,
    messageEs: row.message_es,
    youtubeUrlEn: row.youtube_url_en,
    youtubeUrlEs: row.youtube_url_es,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToApproval(row: ApprovalRow): SmsPendingApproval {
  return {
    id: row.id,
    caseId: row.case_id,
    trackerEntryId: row.tracker_entry_id,
    automationId: row.automation_id,
    caseNumber: row.case_number,
    clientName: row.client_name,
    phone: row.phone,
    language: row.language,
    messageBody: row.message_body,
    fromStage: row.from_stage as CaseStage,
    toStage: row.to_stage as CaseStage,
    status: row.status,
    slackChannelId: row.slack_channel_id,
    slackThreadTs: row.slack_thread_ts,
    quoMessageId: row.quo_message_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
  };
}

function requireAdmin() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required for SMS automations.");
  return admin;
}

export async function listSmsAutomations(): Promise<SmsAutomation[]> {
  const admin = requireAdmin();
  const { data, error } = await admin.from("sms_automations").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as AutomationRow[]).map(rowToAutomation);
}

export type SmsAutomationInput = {
  name: string;
  enabled?: boolean;
  fromStage: CaseStage | "any";
  toStage: CaseStage;
  caseTypes?: string[];
  messageEn: string;
  messageEs: string;
  youtubeUrlEn?: string | null;
  youtubeUrlEs?: string | null;
};

export async function createSmsAutomation(input: SmsAutomationInput): Promise<SmsAutomation> {
  const admin = requireAdmin();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("sms_automations")
    .insert({
      name: input.name.trim(),
      enabled: input.enabled ?? true,
      from_stage: input.fromStage,
      to_stage: input.toStage,
      case_types: input.caseTypes ?? [],
      message_en: input.messageEn.trim(),
      message_es: input.messageEs.trim(),
      youtube_url_en: input.youtubeUrlEn?.trim() || null,
      youtube_url_es: input.youtubeUrlEs?.trim() || null,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return rowToAutomation(data as AutomationRow);
}

export async function updateSmsAutomation(id: string, input: Partial<SmsAutomationInput>): Promise<SmsAutomation> {
  const admin = requireAdmin();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.fromStage !== undefined) patch.from_stage = input.fromStage;
  if (input.toStage !== undefined) patch.to_stage = input.toStage;
  if (input.caseTypes !== undefined) patch.case_types = input.caseTypes;
  if (input.messageEn !== undefined) patch.message_en = input.messageEn.trim();
  if (input.messageEs !== undefined) patch.message_es = input.messageEs.trim();
  if (input.youtubeUrlEn !== undefined) patch.youtube_url_en = input.youtubeUrlEn?.trim() || null;
  if (input.youtubeUrlEs !== undefined) patch.youtube_url_es = input.youtubeUrlEs?.trim() || null;

  const { data, error } = await admin.from("sms_automations").update(patch).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return rowToAutomation(data as AutomationRow);
}

export async function deleteSmsAutomation(id: string) {
  const admin = requireAdmin();
  const { error } = await admin.from("sms_automations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function createSmsPendingApproval(
  input: Omit<SmsPendingApproval, "id" | "status" | "slackChannelId" | "slackThreadTs" | "quoMessageId" | "errorMessage" | "createdAt" | "updatedAt" | "sentAt">,
): Promise<SmsPendingApproval> {
  const admin = requireAdmin();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("sms_pending_approvals")
    .insert({
      case_id: input.caseId,
      tracker_entry_id: input.trackerEntryId,
      automation_id: input.automationId,
      case_number: input.caseNumber,
      client_name: input.clientName,
      phone: input.phone,
      language: input.language,
      message_body: input.messageBody,
      from_stage: input.fromStage,
      to_stage: input.toStage,
      status: "pending",
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return rowToApproval(data as ApprovalRow);
}

export async function updateSmsPendingApproval(
  id: string,
  patch: Partial<{
    status: SmsPendingApproval["status"];
    slackChannelId: string | null;
    slackThreadTs: string | null;
    quoMessageId: string | null;
    errorMessage: string | null;
    sentAt: string | null;
  }>,
) {
  const admin = requireAdmin();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.slackChannelId !== undefined) row.slack_channel_id = patch.slackChannelId;
  if (patch.slackThreadTs !== undefined) row.slack_thread_ts = patch.slackThreadTs;
  if (patch.quoMessageId !== undefined) row.quo_message_id = patch.quoMessageId;
  if (patch.errorMessage !== undefined) row.error_message = patch.errorMessage;
  if (patch.sentAt !== undefined) row.sent_at = patch.sentAt;

  const { data, error } = await admin.from("sms_pending_approvals").update(row).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return rowToApproval(data as ApprovalRow);
}

export async function findSmsPendingApprovalByThread(channelId: string, threadTs: string) {
  const admin = requireAdmin();
  const { data, error } = await admin
    .from("sms_pending_approvals")
    .select("*")
    .eq("slack_channel_id", channelId)
    .eq("slack_thread_ts", threadTs)
    .eq("status", "pending")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? rowToApproval(data as ApprovalRow) : null;
}

export async function listRecentSmsPendingApprovals(limit = 20) {
  const admin = requireAdmin();
  const { data, error } = await admin
    .from("sms_pending_approvals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return ((data ?? []) as ApprovalRow[]).map(rowToApproval);
}

export async function hasPendingSmsApprovalForCase(caseId: string, automationId: string) {
  const admin = requireAdmin();
  const { data, error } = await admin
    .from("sms_pending_approvals")
    .select("id")
    .eq("case_id", caseId)
    .eq("automation_id", automationId)
    .eq("status", "pending")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean(data);
}
