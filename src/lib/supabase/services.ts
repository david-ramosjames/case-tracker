import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildTrackerActivityDescription, describeTrackerChanges } from "@/lib/tracker-changes";
import { CASE_STAGE_OPTIONS, EXPECTED_LITIGATION_OPTIONS } from "@/lib/case-options";
import {
  type ActivityLogEntry,
  type AppUser,
  type AttorneyGoal,
  type CaseRecord,
  type CaseStage,
  type CaseStatus,
  type CaseTrackerSettings,
  type CaseTrackerSnapshot,
  type CheckStatus,
  type ClosingStatus,
  type CommentType,
  type ConfidenceLevel,
  type DisbursedStatus,
  type ExpectedLitigationStatus,
  type ReleaseStatus,
  type SettlementResult,
  type StageSignalSource,
  type StageSuggestion,
  type TrackerComment,
  type TrackerEntry,
  type TrackerUpdateInput,
} from "@/lib/types";

type DocketFlowCaseRow = {
  id: string;
  case_number: string | null;
  client_name: string | null;
  name?: string | null;
  status: string | null;
  case_type: string | null;
  date_of_incident: string | null;
  assigned_contact_ids: string[] | null;
  created_at: string | number | null;
  updated_at: string | number | null;
};

type ContactRow = {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
};

type DatabaseValue = string | number | boolean | string[] | Record<string, unknown> | null;
type UnknownRow = Record<string, DatabaseValue | undefined>;
type TrackerEntryRow = UnknownRow;
type ResultRow = UnknownRow;
type SuggestionRow = UnknownRow;

const DEFAULT_SETTINGS: CaseTrackerSettings = {
  staleReviewThresholdDays: 30,
  quarterlyReviewThresholdDays: 90,
  requiredFields: ["minimumValue", "estimatedFeeValue", "targetResolutionQuarter", "confidenceLevel", "policyLimits", "policyInfoSource"],
  oneTimeRequiredFields: [
    "clientName",
    "dateSigned",
    "dateOfIncident",
    "caseType",
    "referralFeeArrangement",
    "balanceCtaInfo",
    "policyLimits",
    "policyInfoSource",
    "injuries",
  ],
  quarterlyRequiredFields: ["targetResolutionQuarter", "minimumValue", "caseDescription"],
  stages: [...CASE_STAGE_OPTIONS],
  confidenceLevels: ["Low", "Medium", "High"],
  expectedLitigationStatuses: [...EXPECTED_LITIGATION_OPTIONS],
  paralegalLimitedEditEnabled: false,
};

async function createTrackerClient() {
  return createSupabaseServerClient();
}

async function createSharedDataClient() {
  return createSupabaseAdminClient() ?? createSupabaseServerClient();
}

export async function getCases(): Promise<CaseRecord[]> {
  const [sharedClient, trackerClient] = await Promise.all([createSharedDataClient(), createTrackerClient()]);

  const [{ data: caseRows }, { data: trackerRows }, { data: resultRows }, { data: contactRows }, { data: suggestionRows }] =
    await Promise.all([
      sharedClient.from("cases").select("*").order("created_at", { ascending: false }),
      trackerClient.from("case_tracker_entries").select("*").order("created_at", { ascending: false }),
      trackerClient.from("case_tracker_results").select("*"),
      sharedClient.from("contacts").select("id,name,email,role"),
      trackerClient.from("case_tracker_stage_suggestions").select("*"),
    ]);

  return mapRecords({
    cases: (caseRows ?? []) as DocketFlowCaseRow[],
    trackers: (trackerRows ?? []) as TrackerEntryRow[],
    results: (resultRows ?? []) as ResultRow[],
    contacts: (contactRows ?? []) as ContactRow[],
    suggestions: (suggestionRows ?? []) as SuggestionRow[],
  });
}

export async function getCaseById(caseId: string): Promise<CaseRecord | null> {
  const records = await getCases();
  return (
    records.find((record) => record.shared.id === caseId || record.shared.id === caseId || record.tracker.id === caseId || record.tracker.caseId === caseId) ??
    null
  );
}

export async function getUsers(): Promise<AppUser[]> {
  const client = await createSharedDataClient();
  const { data } = await client.from("contacts").select("id,name,email,role").order("name");
  return ((data ?? []) as ContactRow[])
    .filter((row) => row.role === "attorney" || row.role === "paralegal" || row.role === "manager")
    .map(contactToUser);
}

export async function getTrackerEntryByCaseId(caseId: string): Promise<TrackerEntry | null> {
  const record = await getCaseById(caseId);
  return record?.tracker ?? null;
}

export type TrackerActor = {
  userId?: string;
  userName: string;
};

export type TrackerUpdateOptions = {
  actor?: TrackerActor;
  shared?: { status?: CaseStatus; caseType?: string };
  markReviewed?: boolean;
};

export async function updateTrackerEntry(
  caseId: string,
  input: TrackerUpdateInput & { result?: SettlementResult },
  options: TrackerUpdateOptions = {},
): Promise<{ tracker: TrackerEntry; activity?: ActivityLogEntry }> {
  const client = await createTrackerClient();

  const existingRecord = await getCaseById(caseId);
  const existingTracker = existingRecord?.tracker ?? null;
  const markReviewed = options.markReviewed ?? true;
  const changedFields = existingTracker
    ? describeTrackerChanges(existingTracker, input, {
        before: existingRecord
          ? { status: existingRecord.shared.status, caseType: existingRecord.shared.caseType }
          : undefined,
        after: options.shared,
      })
    : [];

  const payload = trackerUpdateToRow(input, markReviewed);
  const requestedResult = input.result;
  const { data, error } = await client
    .from("case_tracker_entries")
    .update(payload)
    .or(`case_id.eq.${caseId},id.eq.${caseId}`)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (data) {
    const resultRow = requestedResult ? await upsertResultRow(caseId, toString(data.id, ""), requestedResult) : null;
    const tracker = rowToTrackerEntry(data as TrackerEntryRow, resultRow, []);
    const activity = await createActivityEntry(
      caseId,
      "Tracker updated",
      buildTrackerActivityDescription(changedFields, markReviewed),
      options.actor,
      { changedFields },
    );
    return { tracker, activity: activity ?? undefined };
  }

  const { data: inserted, error: insertError } = await client
    .from("case_tracker_entries")
    .insert({
      ...payload,
      case_id: caseId,
    })
    .select("*")
    .single();

  if (insertError) throw insertError;
  const resultRow = requestedResult ? await upsertResultRow(caseId, toString(inserted.id, ""), requestedResult) : null;
  const tracker = rowToTrackerEntry(inserted as TrackerEntryRow, resultRow, []);
  const activity = await createActivityEntry(
    caseId,
    "Tracker created",
    "Tracker row was created from live DocketFlow case data.",
    options.actor,
  );
  return { tracker, activity: activity ?? undefined };
}

export async function updateSharedCaseFields(caseId: string, input: { status?: CaseStatus; caseType?: string }) {
  const client = await createSharedDataClient();

  const payload: { status?: string; case_type?: string } = {};
  if (input.status) payload.status = input.status === "Closed" ? "archived" : "active";
  if (input.caseType) payload.case_type = input.caseType;

  if (Object.keys(payload).length === 0) return;

  const { error } = await client.from("cases").update(payload).eq("id", caseId);
  if (error) throw error;
}

export async function createTrackerComment(
  input: Omit<TrackerComment, "id" | "createdAt">,
): Promise<{ comment: TrackerComment; activity: ActivityLogEntry | null }> {
  const client = await createTrackerClient();

  const authorName = input.authorName?.trim() || "Unknown user";
  const basePayload = {
    case_id: input.caseId,
    author_id: isUuid(input.authorId) ? input.authorId : null,
    comment_type: input.type,
    body: input.body,
  };

  let insertResult = await client
    .from("case_tracker_comments")
    .insert({ ...basePayload, author_name: authorName })
    .select("*")
    .single();

  if (insertResult.error && String(insertResult.error.message).includes("author_name")) {
    insertResult = await client.from("case_tracker_comments").insert(basePayload).select("*").single();
  }

  const { data, error } = insertResult;
  if (error) throw error;
  const commentTypeLabel = input.type.replace(/_/g, " ");
  const activity = await createActivityEntry(
    input.caseId,
    "Comment added",
    `${authorName} added ${commentTypeLabel}.`,
    { userId: input.authorId, userName: authorName },
  );
  return { comment: commentRowToComment(data as UnknownRow), activity };
}

export async function getCaseComments(caseId: string): Promise<TrackerComment[]> {
  const client = await createTrackerClient();

  const { data } = await client
    .from("case_tracker_comments")
    .select("*")
    .or(`case_id.eq.${caseId},tracker_entry_id.eq.${caseId}`)
    .order("created_at", { ascending: false });

  return ((data ?? []) as UnknownRow[]).map(commentRowToComment);
}

export async function getCaseActivity(caseId: string): Promise<ActivityLogEntry[]> {
  const client = await createTrackerClient();

  const { data } = await client
    .from("case_tracker_activity")
    .select("*")
    .or(`case_id.eq.${caseId},tracker_entry_id.eq.${caseId}`)
    .order("created_at", { ascending: false });

  return ((data ?? []) as UnknownRow[]).map(activityRowToActivity);
}

export async function createSnapshot(quarter: string, capturedBy: string): Promise<CaseTrackerSnapshot> {
  const client = await createTrackerClient();

  const records = await getCases();
  const entries = records.map((record) => record.tracker);
  const { data, error } = await client
    .from("case_tracker_snapshots")
    .insert({
      quarter,
      captured_by: capturedBy || null,
      snapshot: entries,
    })
    .select("*")
    .single();

  if (error) throw error;
  return {
    id: data.id,
    quarter: data.quarter,
    capturedAt: data.captured_at,
    capturedBy,
    entries,
  };
}

export async function getAttorneyGoals(): Promise<AttorneyGoal[]> {
  const client = await createTrackerClient();

  const [{ data: goalRows }, { data: contactRows }] = await Promise.all([
    client.from("attorney_goals").select("*").order("year", { ascending: false }),
    client.from("contacts").select("id,name,email,role"),
  ]);
  const attorneys = ((contactRows ?? []) as ContactRow[]).filter((row) => row.role === "attorney");

  return ((goalRows ?? []) as UnknownRow[]).map((row) => {
    const attorneyName = toStringOrNull(row.attorney_name);
    const matchedContact = attorneys.find((contact) => contact.name && attorneyName && namesMatch(contact.name, attorneyName));
    return {
      id: toStringOrNull(row.id) ?? "unknown-goal",
      attorneyId: matchedContact?.id ?? toStringOrNull(row.attorney_user_id) ?? attorneyName ?? "unknown-attorney",
      year: Number(row.year ?? new Date().getFullYear()),
      annualFeeGoal: Number(row.annual_fee_goal ?? 0),
      q1Goal: Number(row.q1_goal ?? 0),
      q2Goal: Number(row.q2_goal ?? 0),
      q3Goal: Number(row.q3_goal ?? 0),
      q4Goal: Number(row.q4_goal ?? 0),
    };
  });
}

export async function getSettings(): Promise<CaseTrackerSettings> {
  const client = await createTrackerClient();

  const { data } = await client.from("case_tracker_settings").select("key,value");
  const settings = new Map(((data ?? []) as Array<{ key: string; value: unknown }>).map((row) => [row.key, row.value]));
  const thresholds = asObject(settings.get("review_thresholds"));

  return {
    ...DEFAULT_SETTINGS,
    staleReviewThresholdDays: Number(thresholds.stale_review_days ?? DEFAULT_SETTINGS.staleReviewThresholdDays),
    quarterlyReviewThresholdDays: Number(thresholds.quarterly_check_in_days ?? DEFAULT_SETTINGS.quarterlyReviewThresholdDays),
  };
}

async function createActivityEntry(
  caseId: string,
  action: string,
  description: string,
  actor?: TrackerActor,
  metadata?: Record<string, unknown>,
): Promise<ActivityLogEntry | null> {
  const client = await createTrackerClient();

  const { data, error } = await client
    .from("case_tracker_activity")
    .insert({
      case_id: caseId,
      user_id: actor?.userId && isUuid(actor.userId) ? actor.userId : null,
      action,
      description,
      metadata: {
        ...(metadata ?? {}),
        user_name: actor?.userName ?? null,
      },
    })
    .select("*")
    .single();

  if (error) throw error;
  return activityRowToActivity(data as UnknownRow);
}

async function upsertResultRow(caseId: string, trackerEntryId: string, result: SettlementResult): Promise<ResultRow | null> {
  const client = await createTrackerClient();

  const payload = {
    case_id: caseId,
    tracker_entry_id: trackerEntryId || null,
    settlement_date: result.settlementDate,
    settlement_amount: result.settlementAmount,
    fee_percent: result.feePercent,
    attorney_fees: calculateAttorneyFees(result.settlementAmount, result.feePercent),
    release_status: result.releaseStatus,
    closing_status: result.closingStatus,
    check_status: result.checkStatus,
    disbursed_status: result.disbursedStatus,
    release_signed_at: result.releaseSignedAt,
    closing_signed_at: result.closingSignedAt,
    check_deposited_at: result.checkDepositedAt,
    check_disbursed_at: result.checkDisbursedAt,
    disburse_date: result.disburseDate,
    result_quarter: result.resultQuarter,
  };

  const { data: existing, error: updateError } = await client
    .from("case_tracker_results")
    .update(payload)
    .eq("case_id", caseId)
    .select("*")
    .maybeSingle();

  if (updateError) throw updateError;
  if (existing) return existing as ResultRow;

  const { data, error } = await client.from("case_tracker_results").insert(payload).select("*").single();
  if (error) throw error;
  return data as ResultRow;
}

function mapRecords({
  cases,
  trackers,
  results,
  contacts,
  suggestions,
}: {
  cases: DocketFlowCaseRow[];
  trackers: TrackerEntryRow[];
  results: ResultRow[];
  contacts: ContactRow[];
  suggestions: SuggestionRow[];
}): CaseRecord[] {
  const caseById = new Map(cases.map((row) => [row.id, row]));
  const trackerByCaseId = new Map(trackers.map((row) => [toStringOrNull(row.case_id), row]).filter((entry): entry is [string, TrackerEntryRow] => Boolean(entry[0])));
  const resultsByCaseId = new Map(results.map((row) => [toStringOrNull(row.case_id), row]).filter((entry): entry is [string, ResultRow] => Boolean(entry[0])));
  const resultsByTrackerId = new Map(
    results.map((row) => [toStringOrNull(row.tracker_entry_id), row]).filter((entry): entry is [string, ResultRow] => Boolean(entry[0])),
  );
  const suggestionsByTrackerId = groupBy(suggestions, "tracker_entry_id");
  const suggestionsByCaseId = groupBy(suggestions, "case_id");

  const recordsFromCases = cases.map((caseRow) => {
    const trackerRow = trackerByCaseId.get(caseRow.id) ?? makeEmptyTrackerRow(caseRow);
    const trackerId = toString(trackerRow.id, "");
    const resultRow = resultsByTrackerId.get(trackerId) ?? resultsByCaseId.get(caseRow.id) ?? null;
    return rowToCaseRecord(caseRow, trackerRow, resultRow, contacts, [
      ...(suggestionsByTrackerId.get(trackerId) ?? []),
      ...(suggestionsByCaseId.get(caseRow.id) ?? []),
    ]);
  });

  const orphanTrackerRecords = trackers
    .filter((trackerRow) => {
      const caseId = toStringOrNull(trackerRow.case_id);
      return !caseId || !caseById.has(caseId);
    })
    .map((trackerRow) =>
      rowToCaseRecord(
        null,
        trackerRow,
        resultsByTrackerId.get(toString(trackerRow.id, "")) ?? null,
        contacts,
        suggestionsByTrackerId.get(toString(trackerRow.id, "")) ?? [],
      ),
    );

  return [...recordsFromCases, ...orphanTrackerRecords];
}

function rowToCaseRecord(
  caseRow: DocketFlowCaseRow | null,
  trackerRow: TrackerEntryRow,
  resultRow: ResultRow | null,
  contacts: ContactRow[],
  suggestionRows: SuggestionRow[],
): CaseRecord {
  const assignedContacts = contacts.filter((contact) => caseRow?.assigned_contact_ids?.includes(contact.id));
  const attorneyContact =
    contacts.find((contact) => contact.id === toStringOrNull(trackerRow.attorney_contact_id)) ??
    assignedContacts.find((contact) => contact.role === "attorney") ??
    makeTemporaryContact("unassigned-attorney", toString(trackerRow.attorney_name, "Unassigned Attorney"), "attorney");
  const paralegalContact =
    contacts.find((contact) => contact.id === toStringOrNull(trackerRow.paralegal_contact_id)) ??
    assignedContacts.find((contact) => contact.role === "paralegal") ??
    makeTemporaryContact("unassigned-paralegal", toString(trackerRow.paralegal_name, "Unassigned Paralegal"), "paralegal");
  const sharedId = caseRow?.id ?? toString(trackerRow.id, "unlinked-case");

  return {
    shared: {
      id: sharedId,
      caseNumber: caseRow?.case_number ?? toString(trackerRow.case_number, "Unlinked case"),
      clientName: caseRow?.client_name ?? caseRow?.name ?? toString(trackerRow.client_name_snapshot, "Unknown client"),
      attorneyId: attorneyContact.id,
      paralegalId: paralegalContact.id,
      status: normalizeCaseStatus(caseRow?.status),
      caseType: normalizeCaseType(caseRow?.case_type ?? toStringOrNull(trackerRow.case_type)),
      dateSigned: normalizeDate(caseRow?.created_at),
      dateOfIncident: normalizeDate(caseRow?.date_of_incident),
      createdAt: normalizeDate(caseRow?.created_at),
      updatedAt: normalizeDate(caseRow?.updated_at),
    },
    tracker: rowToTrackerEntry(trackerRow, resultRow, suggestionRows),
    attorney: contactToUser(attorneyContact),
    paralegal: contactToUser(paralegalContact),
  };
}

function rowToTrackerEntry(row: TrackerEntryRow, resultRow: ResultRow | null, suggestionRows: SuggestionRow[]): TrackerEntry {
  return {
    id: toString(row.id, "pending-tracker-entry"),
    caseId: toString(row.case_id, toString(row.id, "pending-tracker-entry")),
    caseStage: normalizeStage(toStringOrNull(row.case_stage)),
    estimatedSettlementValue: toNumber(row.minimum_value),
    estimatedFeeValue: toNumber(row.estimated_fee_value),
    targetResolutionQuarter: toStringOrNull(row.target_resolution_quarter),
    confidenceLevel: normalizeConfidence(toStringOrNull(row.confidence_level)),
    sourceOfEstimate: toStringOrNull(row.source_of_estimate),
    liability: toStringOrNull(row.liability),
    caseSize: toStringOrNull(row.case_size),
    minimumValue: toNumber(row.minimum_value),
    referralFee: toNumber(row.referral_fee),
    referralFeeArrangement: toStringOrNull(row.referral_fee_arrangement),
    balanceCtaInfo: toStringOrNull(row.balance_cta_info),
    policyLimits: toNumber(row.policy_limits),
    policyInfoSource: toStringOrNull(row.policy_info_source),
    expectedLitigation: normalizeExpectedLitigation(toStringOrNull(row.expected_litigation)),
    sources: toString(row.sources, ""),
    litEventsNeeded: toString(row.lit_events_needed, ""),
    litEventsTimeline: toString(row.lit_events_timeline, ""),
    injuries: toString(row.injuries, ""),
    caseDescription: toString(row.case_description, ""),
    statusNotes: toString(row.status_notes, ""),
    gvNotes: toString(row.gv_notes, ""),
    lrjNotes: toString(row.lrj_notes, ""),
    result: rowToResult(resultRow),
    lastQuarterlyCheckInAt: toStringOrNull(row.last_quarterly_check_in_at),
    detectedStageSignals: suggestionRows.map(suggestionRowToSuggestion),
    forecastNotes: toString(row.forecast_notes, ""),
    attorneyNotes: toString(row.attorney_notes, ""),
    managerNotes: toString(row.manager_notes, ""),
    lastReviewedAt: toStringOrNull(row.last_reviewed_at),
    isActive: toBoolean(row.is_active, true),
    settledAmount: toNumber(resultRow?.settlement_amount),
    disbursedAmount: resultRow?.check_disbursed_at ? toNumber(resultRow?.settlement_amount) : null,
    actualFeeValue: toNumber(resultRow?.attorney_fees),
    updatedAt: toString(row.updated_at, new Date().toISOString()),
  };
}

function rowToResult(row: ResultRow | null): SettlementResult {
  return {
    settlementDate: toStringOrNull(row?.settlement_date),
    settlementAmount: toNumber(row?.settlement_amount),
    feePercent: toNumber(row?.fee_percent),
    attorneyFees: toNumber(row?.attorney_fees) ?? calculateAttorneyFees(toNumber(row?.settlement_amount), toNumber(row?.fee_percent)),
    releaseStatus: normalizeReleaseStatus(toStringOrNull(row?.release_status), toStringOrNull(row?.release_signed_at)),
    closingStatus: normalizeClosingStatus(toStringOrNull(row?.closing_status), toStringOrNull(row?.closing_signed_at)),
    checkStatus: normalizeCheckStatus(toStringOrNull(row?.check_status), toStringOrNull(row?.check_deposited_at)),
    disbursedStatus: normalizeDisbursedStatus(toStringOrNull(row?.disbursed_status), toStringOrNull(row?.check_disbursed_at)),
    releaseSignedAt: toStringOrNull(row?.release_signed_at),
    closingSignedAt: toStringOrNull(row?.closing_signed_at),
    checkDepositedAt: toStringOrNull(row?.check_deposited_at),
    checkDisbursedAt: toStringOrNull(row?.check_disbursed_at),
    disburseDate: toStringOrNull(row?.disburse_date),
    resultQuarter: toStringOrNull(row?.result_quarter),
  };
}

function makeEmptyTrackerRow(caseRow: DocketFlowCaseRow): TrackerEntryRow {
  return {
    id: `pending-${caseRow.id}`,
    case_id: caseRow.id,
    case_stage: "Onboarding",
    expected_litigation: "Pre",
    case_number: caseRow.case_number,
    client_name_snapshot: caseRow.client_name,
    sources: "",
    injuries: "",
    case_description: "",
    status_notes: "",
    gv_notes: "",
    lrj_notes: "",
    lit_events_needed: "",
    lit_events_timeline: "",
    forecast_notes: "",
    attorney_notes: "",
    manager_notes: "",
    is_active: true,
    updated_at: caseRow.updated_at,
  };
}

function trackerUpdateToRow(input: TrackerUpdateInput, markReviewed = true) {
  return {
    case_stage: toDatabaseStage(input.caseStage),
    minimum_value: input.minimumValue ?? input.estimatedSettlementValue,
    estimated_fee_value: input.estimatedFeeValue,
    target_resolution_quarter: input.targetResolutionQuarter,
    confidence_level: input.confidenceLevel,
    source_of_estimate: input.sourceOfEstimate,
    liability: input.liability,
    case_size: input.caseSize,
    referral_fee: input.referralFee,
    referral_fee_arrangement: input.referralFeeArrangement,
    balance_cta_info: input.balanceCtaInfo,
    policy_limits: input.policyLimits,
    policy_info_source: input.policyInfoSource,
    expected_litigation: toDatabaseExpectedLitigation(input.expectedLitigation),
    sources: input.sources,
    lit_events_needed: input.litEventsNeeded,
    lit_events_timeline: input.litEventsTimeline,
    injuries: input.injuries,
    case_description: input.caseDescription,
    status_notes: input.statusNotes,
    gv_notes: input.gvNotes,
    lrj_notes: input.lrjNotes,
    last_quarterly_check_in_at: input.lastQuarterlyCheckInAt,
    forecast_notes: input.forecastNotes,
    ...(markReviewed ? { last_reviewed_at: new Date().toISOString() } : {}),
  };
}

function isUuid(value: string | null | undefined) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function commentRowToComment(row: UnknownRow): TrackerComment {
  return {
    id: toString(row.id, "comment"),
    caseId: toString(row.case_id, toString(row.tracker_entry_id, "")),
    authorId: toString(row.author_id, ""),
    authorName: toString(row.author_name, "Unknown user"),
    type: normalizeCommentType(toStringOrNull(row.comment_type)),
    body: toString(row.body, ""),
    createdAt: toString(row.created_at, new Date().toISOString()),
  };
}

function activityRowToActivity(row: UnknownRow): ActivityLogEntry {
  const metadata = asObject(row.metadata);
  return {
    id: toString(row.id, "activity"),
    caseId: toString(row.case_id, toString(row.tracker_entry_id, "")),
    userId: toString(row.user_id, ""),
    userName: toString(metadata.user_name, "Unknown user"),
    action: toString(row.action, "Activity"),
    description: toString(row.description, ""),
    createdAt: toString(row.created_at, new Date().toISOString()),
  };
}

function suggestionRowToSuggestion(row: SuggestionRow): StageSuggestion {
  return {
    id: toString(row.id, "stage-suggestion"),
    source: normalizeStageSignalSource(toStringOrNull(row.source)),
    suggestedStage: normalizeStage(toStringOrNull(row.suggested_stage)),
    suggestedExpectedLitigation: normalizeExpectedLitigation(toStringOrNull(row.suggested_expected_litigation)),
    confidence: normalizeConfidence(toStringOrNull(row.confidence)) ?? "Medium",
    excerpt: toString(row.excerpt, ""),
    detectedAt: toString(row.detected_at, toString(row.created_at, new Date().toISOString())),
    confirmedAt: toStringOrNull(row.confirmed_at),
    dismissedAt: toStringOrNull(row.dismissed_at),
  };
}

function contactToUser(row: ContactRow): AppUser {
  return {
    id: row.id,
    name: row.name ?? "Unknown",
    email: row.email ?? `${slug(row.name ?? row.id)}@ramosjameslaw.local`,
    role: row.role === "paralegal" ? "paralegal" : row.role === "manager" ? "manager" : "attorney",
    avatarInitials: initials(row.name ?? "Unknown"),
    active: true,
  };
}

function makeTemporaryContact(id: string, name: string, role: string): ContactRow {
  return { id, name, email: null, role };
}

function groupBy(rows: SuggestionRow[], key: string) {
  const grouped = new Map<string, SuggestionRow[]>();
  rows.forEach((row) => {
    const value = toStringOrNull(row[key]);
    if (!value) return;
    grouped.set(value, [...(grouped.get(value) ?? []), row]);
  });
  return grouped;
}

function normalizeDate(value: string | number | null | undefined) {
  if (!value) return new Date().toISOString();
  if (typeof value === "number") {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function normalizeCaseStatus(value: string | null | undefined): CaseStatus {
  const normalized = value?.toLowerCase();
  return normalized === "closed" || normalized === "inactive" || normalized === "disengaged" || normalized === "archived" ? "Closed" : "Active";
}

function normalizeStage(value: string | null | undefined): CaseStage {
  const normalized = value?.toLowerCase();
  if (normalized === "lit" || normalized === "litigation" || normalized === "litigated") return "Lit";
  if (normalized === "txt" || normalized === "treatment") return "Txt";
  if (normalized === "dmd" || normalized === "demand") return "Dmd";
  if (normalized === "settled" || normalized === "settlement" || normalized === "set" || normalized === "disbursement") return "Settled";
  if (normalized === "disengaged" || normalized === "disengaging") return "Disengaged";
  if (normalized === "referred") return "Referred";
  if (normalized === "terminated" || normalized === "closed") return "Terminated";
  return "Onboarding";
}

function normalizeConfidence(value: string | null | undefined): ConfidenceLevel | null {
  if (value === "Low" || value === "Medium" || value === "High") return value;
  return null;
}

function normalizeExpectedLitigation(value: string | null | undefined): ExpectedLitigationStatus {
  const normalized = value?.toLowerCase();
  if (normalized === "lit" || normalized === "litigation") return "Lit";
  if (normalized === "expect" || normalized === "expected litigation" || normalized === "expected") return "Expect";
  return "Pre";
}

function normalizeReleaseStatus(value: string | null | undefined, signedAt: string | null): ReleaseStatus {
  return value === "Signed" || signedAt ? "Signed" : "No";
}

function normalizeClosingStatus(value: string | null | undefined, signedAt: string | null): ClosingStatus {
  if (value === "Drafted" || value === "Approved" || value === "Signed") return value;
  return signedAt ? "Signed" : "No";
}

function normalizeCheckStatus(value: string | null | undefined, depositedAt: string | null): CheckStatus {
  if (value === "Deposited" || value === "Sent") return value;
  return depositedAt ? "Deposited" : "No";
}

function normalizeDisbursedStatus(value: string | null | undefined, disbursedAt: string | null): DisbursedStatus {
  return value === "Yes" || disbursedAt ? "Yes" : "No";
}

function calculateAttorneyFees(settlementAmount: number | null, feePercent: number | null) {
  if (settlementAmount == null || feePercent == null) return null;
  return Math.round(settlementAmount * feePercent);
}

function toDatabaseStage(value: CaseStage | undefined) {
  if (!value) return undefined;
  const map: Record<CaseStage, string> = {
    Onboarding: "Intake",
    Txt: "Treatment",
    Dmd: "Demand",
    Lit: "Litigation",
    Settled: "Settlement",
    Disengaged: "DISENGAGED",
    Referred: "Closed",
    Terminated: "Closed",
  };
  return map[value];
}

function toDatabaseExpectedLitigation(value: ExpectedLitigationStatus | null | undefined) {
  if (!value) return undefined;
  const map: Record<ExpectedLitigationStatus, string> = {
    Pre: "Pre-lit",
    Lit: "Litigation",
    Expect: "Expected litigation",
  };
  return map[value];
}

function normalizeCaseType(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "Other";
  if (normalized === "auto" || normalized === "car" || normalized === "auto accident") return "Car";
  if (normalized.includes("premises")) return "Premises";
  if (normalized.includes("truck")) return "Trucking";
  if (normalized.includes("work")) return "Work Injury";
  if (normalized.includes("wrongful")) return "Wrongful Death";
  if (normalized.includes("dog")) return "Dog Bite";
  if (normalized.includes("motorcycle")) return "Motorcycle";
  if (normalized.includes("bicycle")) return "Bicycle";
  if (normalized.includes("product")) return "Products";
  if (normalized === "assault") return "Assault";
  if (normalized.includes("sexual")) return "Sexual Assault";
  if (normalized.includes("child")) return "Child Abuse";
  if (normalized.includes("med")) return "Medmal";
  if (normalized.includes("gun")) return "Gun Shot";
  return value ?? "Other";
}

function normalizeCommentType(value: string | null | undefined): CommentType {
  if (value === "attorney_update" || value === "manager_note" || value === "risk_flag" || value === "value_change" || value === "general_note") {
    return value;
  }
  return "general_note";
}

function normalizeStageSignalSource(value: string | null | undefined): StageSignalSource {
  if (value === "slack" || value === "workflow" || value === "matter_update" || value === "manual") return value;
  return "manual";
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function namesMatch(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase() || a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());
}
