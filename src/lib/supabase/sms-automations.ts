import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { type CaseStage } from "@/lib/types";

export type ClientPreferredLanguage = "en" | "es";

export type SmsAutomationTriggerType = "stage_change" | "time_in_stage";

export type SmsAutomation = {
  id: string;
  name: string;
  enabled: boolean;
  triggerType: SmsAutomationTriggerType;
  fromStage: CaseStage | "any";
  fromStages: CaseStage[];
  toStage: CaseStage | "any";
  excludedToStages: CaseStage[];
  inStages: CaseStage[];
  caseTypes: string[];
  delayDaysAfterSigning: number | null;
  delayHoursAfterSigning: number | null;
  attorneyContactIds: string[];
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
  quoContactId: string | null;
  quoContactName: string | null;
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
  trigger_type?: string | null;
  from_stage: string;
  to_stage: string;
  from_stages?: string[] | null;
  excluded_to_stages?: string[] | null;
  in_stages?: string[] | null;
  delay_days_after_signing?: number | null;
  delay_hours_after_signing?: number | null;
  attorney_contact_ids?: string[] | null;
  case_types: string[] | null;
  message_en: string;
  message_es: string;
  youtube_url_en: string | null;
  youtube_url_es: string | null;
  created_at: string;
  updated_at: string;
};

function parseStageList(values: string[] | null | undefined): CaseStage[] {
  return (values ?? []).filter((value): value is CaseStage => value !== "any");
}

function rowToAutomation(row: AutomationRow): SmsAutomation {
  const fromStages = parseStageList(row.from_stages);
  const inStages = parseStageList(row.in_stages);
  const triggerType = row.trigger_type === "time_in_stage" ? "time_in_stage" : "stage_change";
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    triggerType,
    fromStage: row.from_stage === "any" ? "any" : (row.from_stage as CaseStage),
    fromStages,
    toStage: row.to_stage === "any" ? "any" : (row.to_stage as CaseStage),
    excludedToStages: parseStageList(row.excluded_to_stages),
    inStages,
    caseTypes: row.case_types ?? [],
    delayDaysAfterSigning: row.delay_days_after_signing ?? null,
    delayHoursAfterSigning: row.delay_hours_after_signing ?? null,
    attorneyContactIds: row.attorney_contact_ids ?? [],
    messageEn: row.message_en,
    messageEs: row.message_es,
    youtubeUrlEn: row.youtube_url_en,
    youtubeUrlEs: row.youtube_url_es,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type ApprovalRow = {
  id: string;
  case_id: string;
  tracker_entry_id: string | null;
  automation_id: string | null;
  case_number: string;
  client_name: string | null;
  phone: string;
  quo_contact_id: string | null;
  quo_contact_name: string | null;
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

function rowToApproval(row: ApprovalRow): SmsPendingApproval {
  return {
    id: row.id,
    caseId: row.case_id,
    trackerEntryId: row.tracker_entry_id,
    automationId: row.automation_id,
    caseNumber: row.case_number,
    clientName: row.client_name,
    phone: row.phone,
    quoContactId: row.quo_contact_id,
    quoContactName: row.quo_contact_name,
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
  triggerType?: SmsAutomationTriggerType;
  fromStage?: CaseStage | "any";
  fromStages?: CaseStage[];
  toStage: CaseStage | "any";
  excludedToStages?: CaseStage[];
  inStages?: CaseStage[];
  caseTypes?: string[];
  delayDaysAfterSigning?: number | null;
  delayHoursAfterSigning?: number | null;
  attorneyContactIds?: string[];
  messageEn: string;
  messageEs: string;
  youtubeUrlEn?: string | null;
  youtubeUrlEs?: string | null;
};

function normalizeAutomationInput(input: SmsAutomationInput) {
  const triggerType = input.triggerType ?? "stage_change";
  const fromStages = input.fromStages ?? [];
  const inStages = input.inStages ?? [];
  const fromStage =
    fromStages.length > 0 ? fromStages[0]! : (input.fromStage === undefined ? "any" : input.fromStage);

  return {
    trigger_type: triggerType,
    from_stage: fromStage,
    from_stages: fromStages,
    to_stage: input.toStage,
    excluded_to_stages: input.excludedToStages ?? [],
    in_stages: inStages,
    delay_days_after_signing: input.delayDaysAfterSigning ?? null,
    delay_hours_after_signing: input.delayHoursAfterSigning ?? null,
    attorney_contact_ids: input.attorneyContactIds ?? [],
  };
}

export async function createSmsAutomation(input: SmsAutomationInput): Promise<SmsAutomation> {
  const admin = requireAdmin();
  const now = new Date().toISOString();
  const stageFields = normalizeAutomationInput(input);
  const { data, error } = await admin
    .from("sms_automations")
    .insert({
      name: input.name.trim(),
      enabled: input.enabled ?? true,
      ...stageFields,
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
  if (input.triggerType !== undefined) patch.trigger_type = input.triggerType;
  if (input.fromStages !== undefined) {
    patch.from_stages = input.fromStages;
    patch.from_stage = input.fromStages.length > 0 ? input.fromStages[0] : (input.fromStage ?? "any");
  } else if (input.fromStage !== undefined) {
    patch.from_stage = input.fromStage;
  }
  if (input.toStage !== undefined) patch.to_stage = input.toStage;
  if (input.excludedToStages !== undefined) patch.excluded_to_stages = input.excludedToStages;
  if (input.inStages !== undefined) patch.in_stages = input.inStages;
  if (input.delayDaysAfterSigning !== undefined) patch.delay_days_after_signing = input.delayDaysAfterSigning;
  if (input.delayHoursAfterSigning !== undefined) patch.delay_hours_after_signing = input.delayHoursAfterSigning;
  if (input.attorneyContactIds !== undefined) patch.attorney_contact_ids = input.attorneyContactIds;
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
      quo_contact_id: input.quoContactId,
      quo_contact_name: input.quoContactName,
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

/**
 * Atomically move a pending approval to approved/rejected.
 * Returns null when another worker already claimed it — prevents double SMS sends.
 */
export async function claimSmsPendingApproval(
  id: string,
  nextStatus: "approved" | "rejected",
): Promise<SmsPendingApproval | null> {
  const admin = requireAdmin();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("sms_pending_approvals")
    .update({ status: nextStatus, updated_at: now })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? rowToApproval(data as ApprovalRow) : null;
}

export async function findSmsPendingApprovalByThread(channelId: string, threadTs: string) {
  const admin = requireAdmin();
  const { data, error } = await admin
    .from("sms_pending_approvals")
    .select("*")
    .eq("slack_channel_id", channelId)
    .eq("slack_thread_ts", threadTs)
    .order("created_at", { ascending: false })
    .limit(1)
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

export async function hasSmsAutomationDeliveryForCase(caseId: string, automationId: string, phone: string) {
  const admin = requireAdmin();
  const { data, error } = await admin
    .from("sms_pending_approvals")
    .select("id")
    .eq("case_id", caseId)
    .eq("automation_id", automationId)
    .eq("phone", phone)
    .in("status", ["pending", "approved", "sent", "rejected"])
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function listStaleSmsPendingApprovals(maxAgeDays: number) {
  const admin = requireAdmin();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);

  const { data, error } = await admin
    .from("sms_pending_approvals")
    .select("*")
    .eq("status", "pending")
    .lt("created_at", cutoff.toISOString());

  if (error) throw new Error(error.message);
  return ((data ?? []) as ApprovalRow[]).map(rowToApproval);
}

export async function hasPendingSmsApprovalForCase(caseId: string, automationId: string, phone: string) {
  const admin = requireAdmin();
  const { data, error } = await admin
    .from("sms_pending_approvals")
    .select("id")
    .eq("case_id", caseId)
    .eq("automation_id", automationId)
    .eq("phone", phone)
    .eq("status", "pending")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean(data);
}
