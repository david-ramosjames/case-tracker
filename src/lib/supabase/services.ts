import { buildFieldValidationRowPatch } from "@/lib/attorney-score";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { disbursementWeight } from "@/lib/disbursements";
import { parseCaseBackfillCsv, type ParsedCaseBackfillRow } from "@/lib/csv/case-backfill";
import { trackerTouchesSourcesLit } from "@/lib/slack/reminders";
import {
  notifySlackCaseStageUpdated,
  notifySlackCommentPosted,
  notifySlackTrackerSaved,
} from "@/lib/slack/notify";
import { describeSlackThreadAppliedLabels, parseSlackThreadUpdate } from "@/lib/slack/thread-update";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildStagePatchFromConfirmation } from "@/lib/stage-triggers";
import { buildTrackerActivityDescription, describeTrackerChanges } from "@/lib/tracker-changes";
import {
  CASE_STAGE_OPTIONS,
  EXPECTED_LITIGATION_OPTIONS,
  caseTypeFromCasesTable,
  applyDerivedResultFields,
  applyDerivedSettlementResult,
  deriveCaseSizeFromMinimumValue,
  deriveResultQuarterFromDisburseDate,
  normalizeCaseType,
} from "@/lib/case-options";
import { deriveCaseStatusFromTracker } from "@/lib/case-status";
import { pickNextScheduledEvents } from "@/lib/docketflow/case-events";
import {
  type ActivityLogEntry,
  type AppUser,
  type AttorneyGoal,
  type CaseDisbursement,
  type CaseRecord,
  type CaseStage,
  type CaseBackfillImportResult,
  type CaseStatus,
  type CaseTrackerSettings,
  type CaseTrackerSnapshot,
  type DocketFlowScheduledEvent,
  type CheckStatus,
  type ClosingStatus,
  type CommentType,
  type ConfidenceLevel,
  type DisbursedStatus,
  type ExpectedLitigationStatus,
  type ReductionsStatus,
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
type DisbursementRow = UnknownRow;
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
  return createSupabaseAdminClient() ?? (await createSupabaseServerClient());
}

async function createSharedDataClient() {
  return createSupabaseAdminClient() ?? createSupabaseServerClient();
}

export async function getCases(): Promise<CaseRecord[]> {
  const [sharedClient, trackerClient] = await Promise.all([createSharedDataClient(), createTrackerClient()]);

  const [
    { data: caseRows },
    { data: trackerRows },
    { data: resultRows },
    { data: disbursementRows },
    { data: contactRows },
    { data: suggestionRows },
  ] = await Promise.all([
    sharedClient
      .from("cases")
      .select("id,case_number,client_name,name,status,case_type,date_of_incident,assigned_contact_ids,created_at,updated_at")
      .order("created_at", { ascending: false }),
    trackerClient.from("case_tracker_entries").select("*").order("created_at", { ascending: false }),
    trackerClient.from("case_tracker_results").select("*"),
    trackerClient.from("case_tracker_disbursements").select("*").order("created_at", { ascending: true }),
    sharedClient.from("contacts").select("id,name,email,role"),
    trackerClient.from("case_tracker_stage_suggestions").select("*"),
  ]);

  return mapRecords({
    cases: (caseRows ?? []) as DocketFlowCaseRow[],
    trackers: (trackerRows ?? []) as TrackerEntryRow[],
    results: (resultRows ?? []) as ResultRow[],
    disbursements: (disbursementRows ?? []) as DisbursementRow[],
    contacts: (contactRows ?? []) as ContactRow[],
    suggestions: (suggestionRows ?? []) as SuggestionRow[],
  });
}

export async function getCaseById(caseId: string): Promise<CaseRecord | null> {
  const records = await getCases();
  return (
    records.find((record) => record.shared.id === caseId || record.tracker.id === caseId || record.tracker.caseId === caseId) ??
    null
  );
}

export function isOrphanTrackerRecord(record: CaseRecord) {
  return record.shared.id === record.tracker.id;
}

/** Remove a tracker row and related data. Optionally delete the linked DocketFlow `cases` row. */
export async function deleteTrackerCase(
  caseId: string,
  options?: { deleteDocketflowCase?: boolean },
): Promise<{ deletedTrackerId: string; deletedDocketflowCase: boolean; wasOrphan: boolean }> {
  const record = await getCaseById(caseId);
  if (!record) throw new Error("Case not found.");

  const client = createSupabaseAdminClient();
  if (!client) throw new Error("Service role is required to delete tracker cases.");

  const trackerEntryId = record.tracker.id;
  const docketflowCaseId = isOrphanTrackerRecord(record) ? null : record.shared.id;
  const relatedFilter = docketflowCaseId
    ? `tracker_entry_id.eq.${trackerEntryId},case_id.eq.${docketflowCaseId}`
    : `tracker_entry_id.eq.${trackerEntryId}`;

  for (const table of ["case_tracker_activity", "case_tracker_comments", "case_tracker_stage_suggestions"] as const) {
    const { error } = await client.from(table).delete().or(relatedFilter);
    if (error) throw error;
  }

  const { error: resultsError } = await client.from("case_tracker_results").delete().or(relatedFilter);
  if (resultsError) throw resultsError;

  const { error: entryError } = await client.from("case_tracker_entries").delete().eq("id", trackerEntryId);
  if (entryError) throw entryError;

  let deletedDocketflowCase = false;
  if (options?.deleteDocketflowCase && docketflowCaseId) {
    const { error: caseError } = await client.from("cases").delete().eq("id", docketflowCaseId);
    if (caseError) throw caseError;
    deletedDocketflowCase = true;
  }

  return {
    deletedTrackerId: trackerEntryId,
    deletedDocketflowCase,
    wasOrphan: isOrphanTrackerRecord(record),
  };
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

/** Next upcoming DocketFlow calendar rows for a linked case (`case_events`). */
export async function getNextScheduledDocketFlowEvents(
  caseId: string,
  limit = 3,
): Promise<DocketFlowScheduledEvent[]> {
  const client = await createSharedDataClient();
  const { data, error } = await client
    .from("case_events")
    .select(
      "id, case_id, title, date, deadline_end_date, start_date_time, end_date_time, category, event_kind, schedule_kind, included, completed, calendar_origin",
    )
    .eq("case_id", caseId)
    .order("date", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;
  return pickNextScheduledEvents(data ?? [], limit);
}

export type TrackerActor = {
  userId?: string;
  userName: string;
};

export type TrackerUpdateOptions = {
  actor?: TrackerActor;
  shared?: { status?: CaseStatus; caseType?: string; dateOfIncident?: string | null };
  markReviewed?: boolean;
  /** When saving a partial patch, pass the patch here so activity logs only list changed fields. */
  changeInput?: TrackerUpdateInput & { result?: SettlementResult };
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
  const changeInput = options.changeInput ?? input;
  const changedFields = existingTracker
    ? describeTrackerChanges(existingTracker, changeInput, {
        before: existingRecord
          ? {
              status: existingRecord.shared.status,
              caseType: existingRecord.shared.caseType,
              dateOfIncident: existingRecord.shared.dateOfIncident,
            }
          : undefined,
        after: options.shared,
      })
    : [];

  const now = new Date().toISOString();
  const inputWithDerivedCaseSize =
    input.minimumValue !== undefined
      ? { ...input, caseSize: deriveCaseSizeFromMinimumValue(input.minimumValue) }
      : input;
  const inputWithSourcesLit = trackerTouchesSourcesLit(changeInput)
    ? { ...inputWithDerivedCaseSize, lastSourcesLitUpdatedAt: inputWithDerivedCaseSize.lastSourcesLitUpdatedAt ?? now }
    : inputWithDerivedCaseSize;

  const validationPatch = buildFieldValidationRowPatch(
    changeInput as Record<string, unknown>,
    existingTracker,
    inputWithSourcesLit as Record<string, unknown>,
    now,
  );

  const litigationPatch: Record<string, unknown> = {};
  const nextStage = input.caseStage ?? existingTracker?.caseStage;
  if (nextStage === "Lit" || existingTracker?.hasEverBeenLitigation || existingTracker?.caseStage === "Lit") {
    litigationPatch.has_ever_been_litigation = true;
  }
  if (nextStage === "Lit") {
    litigationPatch.expected_litigation = toDatabaseExpectedLitigation("Lit");
    litigationPatch.expected_litigation_validated_at = now;
    if (input.expectedLitigation === undefined && existingTracker?.expectedLitigation !== "Lit") {
      inputWithSourcesLit.expectedLitigation = "Lit";
    }
  }

  const payload = {
    ...trackerUpdateToRow(inputWithSourcesLit, markReviewed),
    ...validationPatch,
    ...litigationPatch,
  };
  const requestedResult = input.result;
  const previousStage = existingTracker?.caseStage;
  const { data, error } = await client
    .from("case_tracker_entries")
    .update(payload)
    .or(`case_id.eq.${caseId},id.eq.${caseId}`)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (data) {
    const resultRow = requestedResult
      ? await upsertResultRow(caseId, toString(data.id, ""), requestedResult, data as TrackerEntryRow)
      : null;
    const tracker = rowToTrackerEntry(data as TrackerEntryRow, resultRow, []);
    const activity = await createActivityEntry(
      caseId,
      "Tracker updated",
      buildTrackerActivityDescription(changedFields, markReviewed),
      options.actor,
      { changedFields },
    );
    if (existingRecord) {
      await syncDerivedSharedCaseStatus(caseId, tracker);
      try {
        await runSlackTrackerSideEffects(existingRecord, tracker, changeInput, previousStage);
      } catch (error) {
        console.error("Slack tracker notification failed", error);
      }
    }
    const refreshed = await getCaseById(caseId);
    return { tracker: refreshed?.tracker ?? tracker, activity: activity ?? undefined };
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
  const resultRow = requestedResult
    ? await upsertResultRow(caseId, toString(inserted.id, ""), requestedResult, inserted as TrackerEntryRow)
    : null;
  const tracker = rowToTrackerEntry(inserted as TrackerEntryRow, resultRow, []);
  await syncDerivedSharedCaseStatus(caseId, tracker);
  const activity = await createActivityEntry(
    caseId,
    "Tracker created",
    "Tracker row was created from live DocketFlow case data.",
    options.actor,
  );
  const refreshed = await getCaseById(caseId);
  return { tracker: refreshed?.tracker ?? tracker, activity: activity ?? undefined };
}

export async function importCaseBackfillCsv(
  csvText: string,
  options: { actor?: TrackerActor; dryRun?: boolean } = {},
): Promise<CaseBackfillImportResult> {
  const parsedRows = parseCaseBackfillCsv(csvText);
  const cases = await getCases();
  const byCaseNumber = new Map(cases.map((record) => [cleanCaseNumber(record.shared.caseNumber), record]));

  const preview: CaseBackfillImportResult["preview"] = [];
  const unmatched: string[] = [];
  let matched = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of parsedRows) {
    const existing = byCaseNumber.get(row.caseNumber);
    const fieldCount = countBackfillFields(row);

    preview.push({ caseNumber: row.caseNumber, matched: Boolean(existing), fieldCount });

    if (!existing) {
      unmatched.push(row.caseNumber);
      continue;
    }

    matched += 1;
    if (fieldCount === 0) {
      skipped += 1;
      continue;
    }

    if (options.dryRun) continue;

    if (Object.keys(row.shared).length > 0) {
      await updateSharedCaseFields(existing.shared.id, row.shared);
    }

    const trackerPatch = row.tracker;
    const resultPatch = row.result;
    const hasTrackerPatch = Object.keys(trackerPatch).length > 0;
    const hasResultPatch = Object.keys(resultPatch).length > 0;

    if (hasTrackerPatch || hasResultPatch) {
      const mergedTracker = mergeTrackerImport(existing.tracker, trackerPatch);
      const mergedResult = hasResultPatch ? { ...existing.tracker.result, ...resultPatch } : undefined;
      await updateTrackerEntry(
        existing.shared.id,
        {
          ...mergedTracker,
          ...(mergedResult ? { result: mergedResult } : {}),
        },
        {
          actor: options.actor,
          shared: Object.keys(row.shared).length > 0 ? row.shared : undefined,
          markReviewed: false,
          changeInput: {
            ...trackerPatch,
            ...(hasResultPatch ? { result: resultPatch as SettlementResult } : {}),
          },
        },
      );
    } else if (Object.keys(row.shared).length > 0) {
      await createActivityEntry(
        existing.shared.id,
        "CSV backfill",
        buildTrackerActivityDescription(
          describeTrackerChanges(existing.tracker, {}, {
            before: {
              status: existing.shared.status,
              caseType: existing.shared.caseType,
              dateOfIncident: existing.shared.dateOfIncident,
            },
            after: row.shared,
          }),
          false,
        ),
        options.actor,
        { source: "csv_backfill" },
      );
    }

    updated += 1;
  }

  return {
    totalRows: parsedRows.length,
    matched,
    updated: options.dryRun ? 0 : updated,
    skipped,
    unmatched,
    preview,
    dryRun: Boolean(options.dryRun),
  };
}

export async function updateSharedCaseFields(
  caseId: string,
  input: { status?: CaseStatus; caseType?: string; dateSigned?: string; dateOfIncident?: string | null },
  options?: { explicitStatus?: CaseStatus },
) {
  const sharedClient = await createSharedDataClient();
  const trackerClient = await createTrackerClient();

  const payload: { status?: string; case_type?: string | null; date_of_incident?: string | null } = {};

  let statusToWrite = options?.explicitStatus;
  if (!statusToWrite) {
    const record = await getCaseById(caseId);
    statusToWrite = record
      ? deriveCaseStatusFromTracker(record.tracker.caseStage, record.tracker.result.disbursedStatus)
      : input.status;
  }
  if (statusToWrite) payload.status = statusToWrite === "Closed" ? "archived" : "active";
  if (input.caseType !== undefined) {
    const trimmed = input.caseType.trim();
    payload.case_type = trimmed ? normalizeCaseType(trimmed) : null;
  }
  if (input.dateOfIncident !== undefined) {
    payload.date_of_incident = input.dateOfIncident ? toDateOnly(input.dateOfIncident) : null;
  }

  if (Object.keys(payload).length > 0) {
    const { error } = await sharedClient.from("cases").update(payload).eq("id", caseId);
    if (error) throw error;
  }

  // Tracker-owned override so we don't mutate DocketFlow created_at.
  if (input.dateSigned) {
    const { error } = await trackerClient
      .from("case_tracker_entries")
      .update({ date_signed_override: input.dateSigned })
      .or(`case_id.eq.${caseId},id.eq.${caseId}`);
    if (error) throw error;
  }
}

/** Apply Date Signed from Client Contact Status column H to matching tracker rows. */
export async function syncDateSignedFromSheet(entries: Array<{ caseNumber: string; dateSigned: string }>) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required to sync date signed from sheet.");

  const byCaseNumber = new Map<string, string>();
  for (const entry of entries) {
    const key = cleanCaseNumber(entry.caseNumber);
    if (key && entry.dateSigned) byCaseNumber.set(key, entry.dateSigned);
  }

  let updated = 0;
  for (const [caseNumber, dateSigned] of byCaseNumber) {
    const { data, error } = await admin
      .from("case_tracker_entries")
      .update({ date_signed_override: dateSigned })
      .eq("case_number", caseNumber)
      .select("id");
    if (error) throw new Error(error.message);
    updated += data?.length ?? 0;
  }

  return { updated };
}

type SettlementSheetCasePayload = {
  caseNumber: string;
  sheetRowCount: number;
  settlementDate: string | null;
  totalSettlementAmount: number | null;
  totalAttorneyFees: number | null;
  latestDisburseDate: string | null;
  allDisbursed: boolean;
  pendingDisbursementCount?: number;
  completedDisbursementCount?: number;
  disbursements: Array<{
    sheetRowKey: string;
    partyLabel: string | null;
    disburseDate: string | null;
    settlementDate: string | null;
    settlementAmount: number | null;
    attorneyFees: number | null;
    pendingRemaining?: boolean;
  }>;
};

type DisbursementRowPayload = {
  tracker_entry_id: string;
  case_id: string | null;
  case_number: string;
  label: string | null;
  disburse_date: string | null;
  settlement_date: string | null;
  settlement_amount: number | null;
  attorney_fees: number | null;
  weight: number;
  pending_remaining: boolean;
  sheet_row_key: string;
  synced_at: string;
};

/** Upsert by sheet_row_key without relying on PostgREST onConflict (partial unique indexes are unsupported). */
async function upsertDisbursementBySheetRowKey(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  payload: DisbursementRowPayload,
) {
  const { data: existing, error: lookupError } = await admin
    .from("case_tracker_disbursements")
    .select("id")
    .eq("sheet_row_key", payload.sheet_row_key)
    .maybeSingle();

  if (lookupError) throw new Error(lookupError.message);

  if (existing?.id) {
    const { error } = await admin.from("case_tracker_disbursements").update(payload).eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await admin.from("case_tracker_disbursements").insert(payload);
  if (error) throw new Error(error.message);
}

/** Apply settlement/disbursement rows from the settlements Google Sheet. */
export async function syncSettlementsFromSheet(cases: SettlementSheetCasePayload[]) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required to sync settlements from sheet.");

  let casesProcessed = 0;
  let disbursementsSynced = 0;
  let settlementsUpdated = 0;
  let stagesAutoSettled = 0;
  let skippedNoTracker = 0;
  const syncedAt = new Date().toISOString();

  for (const item of cases) {
    const caseNumber = cleanCaseNumber(item.caseNumber);
    if (!caseNumber) continue;

    const { data: trackerRows, error: trackerError } = await admin
      .from("case_tracker_entries")
      .select("id,case_id,case_number,expected_disbursement_count,case_stage")
      .eq("case_number", caseNumber);

    if (trackerError) throw new Error(trackerError.message);
    const trackerRow = trackerRows?.[0];
    if (!trackerRow) {
      skippedNoTracker += 1;
      continue;
    }

    const trackerEntryId = toString(trackerRow.id, "");
    const caseId = toStringOrNull(trackerRow.case_id) ?? trackerEntryId;

    const attorneyExpected = Math.max(1, toNumber(trackerRow.expected_disbursement_count) ?? 1);
    const totalSlots = Math.max(attorneyExpected, item.sheetRowCount);
    const weight = disbursementWeight(totalSlots);

    const { error: trackerUpdateError } = await admin
      .from("case_tracker_entries")
      .update({
        expected_disbursement_count: totalSlots,
        multiple_disbursements_enabled: totalSlots > 1,
      })
      .eq("id", trackerEntryId);
    if (trackerUpdateError) throw new Error(trackerUpdateError.message);

    const { error: pruneError } = await admin
      .from("case_tracker_disbursements")
      .delete()
      .eq("case_number", caseNumber)
      .not("sheet_row_key", "is", null);
    if (pruneError) throw new Error(pruneError.message);

    for (const disbursement of item.disbursements) {
      const payload: DisbursementRowPayload = {
        tracker_entry_id: trackerEntryId,
        case_id: isUuid(caseId) ? caseId : null,
        case_number: caseNumber,
        label: disbursement.partyLabel,
        disburse_date: disbursement.disburseDate ? toDateOnly(disbursement.disburseDate) : null,
        settlement_date: disbursement.settlementDate ? toDateOnly(disbursement.settlementDate) : null,
        settlement_amount: disbursement.settlementAmount,
        attorney_fees: disbursement.attorneyFees,
        weight,
        pending_remaining: disbursement.pendingRemaining ?? false,
        sheet_row_key: disbursement.sheetRowKey,
        synced_at: syncedAt,
      };
      await upsertDisbursementBySheetRowKey(admin, payload);
      disbursementsSynced += 1;
    }

    const { data: existingResult } = await admin
      .from("case_tracker_results")
      .select("*")
      .or(`tracker_entry_id.eq.${trackerEntryId},case_id.eq.${caseId}`)
      .maybeSingle();

    const settlementDate = item.settlementDate ? toDateOnly(item.settlementDate) : null;
    const disburseDate = item.latestDisburseDate ? toDateOnly(item.latestDisburseDate) : null;
    const resultPayload = {
      case_id: isUuid(caseId) ? caseId : null,
      tracker_entry_id: trackerEntryId,
      settlement_date: settlementDate ?? existingResult?.settlement_date ?? null,
      settlement_amount: item.totalSettlementAmount ?? existingResult?.settlement_amount ?? null,
      attorney_fees: item.totalAttorneyFees ?? existingResult?.attorney_fees ?? null,
      disburse_date: disburseDate,
      check_disbursed_at: disburseDate ? new Date(disburseDate).toISOString() : existingResult?.check_disbursed_at ?? null,
      disbursed_status: item.allDisbursed ? "Yes" : disburseDate ? existingResult?.disbursed_status ?? "No" : "No",
      result_quarter: disburseDate ? deriveResultQuarterFromDisburseDate(disburseDate) : existingResult?.result_quarter ?? null,
      reductions_status: disburseDate ? "Deposited" : existingResult?.reductions_status ?? "Not Complete",
    };

    if (existingResult) {
      const { error } = await admin.from("case_tracker_results").update(resultPayload).eq("id", existingResult.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from("case_tracker_results").insert(resultPayload);
      if (error) throw new Error(error.message);
    }

    casesProcessed += 1;
    if (settlementDate || disburseDate) settlementsUpdated += 1;

    if (settlementDate) {
      const currentStage = normalizeStage(toStringOrNull(trackerRow.case_stage));
      if (currentStage !== "Settled") {
        const record = await getCaseById(caseId);
        if (record) {
          const patch = buildStagePatchFromConfirmation(record, "Settled");
          await updateTrackerEntry(caseId, patch, {
            actor: { userName: "Disbursing spreadsheet sync" },
            markReviewed: true,
            changeInput: patch,
          });
          stagesAutoSettled += 1;
        }
      }
    }
  }

  return { casesProcessed, disbursementsSynced, settlementsUpdated, stagesAutoSettled, skippedNoTracker };
}

export async function createTrackerComment(
  input: Omit<TrackerComment, "id" | "createdAt">,
): Promise<{ comment: TrackerComment; activity: ActivityLogEntry | null }> {
  const client = (await createSupabaseAdminClient()) ?? (await createTrackerClient());

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
  const commentId = toString(data.id, "comment");
  const activity = await createActivityEntry(
    input.caseId,
    "Comment added",
    `${authorName} added ${commentTypeLabel}.`,
    { userId: input.authorId, userName: authorName },
    { comment_id: commentId, user_name: authorName },
  );

  const record = await getCaseById(input.caseId);
  if (record) {
    try {
      await notifySlackCommentPosted(record, {
        type: input.type,
        body: input.body,
        authorName,
      });
    } catch (error) {
      console.error("Slack comment notification failed", error);
    }
  }

  return {
    comment: commentRowToComment(data as UnknownRow, authorName),
    activity,
  };
}

export async function applySlackThreadUpdate(caseId: string, text: string, actor?: TrackerActor) {
  const parsed = parseSlackThreadUpdate(text);
  if (!parsed) return { applied: false as const, reason: "No recognizable tracker fields in thread reply." };

  const existing = await getCaseById(caseId);
  if (!existing) return { applied: false as const, reason: "Case not found." };

  const merged = mergeTrackerImport(existing.tracker, parsed.tracker);
  await updateTrackerEntry(caseId, merged, {
    actor: actor ?? { userName: "Slack thread" },
    markReviewed: true,
    changeInput: parsed.tracker,
  });

  return { applied: true as const, labels: describeSlackThreadAppliedLabels(parsed.tracker) };
}

export async function getCaseComments(caseId: string): Promise<TrackerComment[]> {
  const client = await createTrackerClient();

  const [{ data: commentRows }, { data: activityRows }] = await Promise.all([
    client
      .from("case_tracker_comments")
      .select("*")
      .or(`case_id.eq.${caseId},tracker_entry_id.eq.${caseId}`)
      .order("created_at", { ascending: false }),
    client.from("case_tracker_activity").select("metadata").eq("case_id", caseId).eq("action", "Comment added"),
  ]);

  const authorByCommentId = new Map<string, string>();
  for (const row of (activityRows ?? []) as UnknownRow[]) {
    const metadata = asObject(row.metadata);
    const commentId = toStringOrNull(metadata.comment_id as string | undefined);
    const userName = toStringOrNull(metadata.user_name as string | undefined);
    if (commentId && userName) authorByCommentId.set(commentId, userName);
  }

  return ((commentRows ?? []) as UnknownRow[]).map((row) => {
    const comment = commentRowToComment(row);
    return {
      ...comment,
      authorName: authorByCommentId.get(comment.id) ?? comment.authorName,
    };
  });
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

export type AttorneyGoalInput = {
  attorneyId: string;
  attorneyName: string;
  year: number;
  annualFeeGoal: number;
  commissionThreshold: number;
  commissionYearStartMonth?: number;
  q1Goal: number;
  q2Goal: number;
  q3Goal: number;
  q4Goal: number;
};

export async function upsertAttorneyGoal(input: AttorneyGoalInput): Promise<AttorneyGoal> {
  const client = await createTrackerClient();
  const annualFeeGoal = input.q1Goal + input.q2Goal + input.q3Goal + input.q4Goal;

  const commissionYearStartMonth = Math.min(12, Math.max(1, Number(input.commissionYearStartMonth ?? 1)));

  const payload = {
    attorney_name: input.attorneyName,
    year: input.year,
    annual_fee_goal: annualFeeGoal,
    commission_threshold: input.commissionThreshold,
    commission_year_start_month: commissionYearStartMonth,
    q1_goal: input.q1Goal,
    q2_goal: input.q2Goal,
    q3_goal: input.q3Goal,
    q4_goal: input.q4Goal,
  };

  const { data, error } = await client
    .from("attorney_goals")
    .upsert(payload, { onConflict: "attorney_name,year" })
    .select("*")
    .single();

  if (error) throw error;

  return {
    id: toString(data.id, "goal"),
    attorneyId: input.attorneyId,
    year: input.year,
    annualFeeGoal,
    commissionThreshold: Number(data.commission_threshold ?? 0),
    commissionYearStartMonth: Number(data.commission_year_start_month ?? 1),
    q1Goal: Number(data.q1_goal ?? 0),
    q2Goal: Number(data.q2_goal ?? 0),
    q3Goal: Number(data.q3_goal ?? 0),
    q4Goal: Number(data.q4_goal ?? 0),
  };
}

export async function getAttorneyGoals(year?: number): Promise<AttorneyGoal[]> {
  const client = await createTrackerClient();

  let goalsQuery = client.from("attorney_goals").select("*").order("year", { ascending: false });
  if (year) goalsQuery = goalsQuery.eq("year", year);

  const sharedClient = await createSharedDataClient();
  const [{ data: goalRows }, { data: contactRows }] = await Promise.all([
    goalsQuery,
    sharedClient.from("contacts").select("id,name,email,role"),
  ]);
  const attorneys = ((contactRows ?? []) as ContactRow[]).filter((row) => row.role === "attorney");

  return ((goalRows ?? []) as UnknownRow[]).map((row) => {
    const attorneyName = toStringOrNull(row.attorney_name);
    const matchedContact = attorneys.find((contact) => contact.name && attorneyName && namesMatch(contact.name, attorneyName));
    const commissionThreshold = Number(row.commission_threshold ?? 0);
    const q1Goal = Number(row.q1_goal ?? 0);
    const q2Goal = Number(row.q2_goal ?? 0);
    const q3Goal = Number(row.q3_goal ?? 0);
    const q4Goal = Number(row.q4_goal ?? 0);

    return {
      id: toStringOrNull(row.id) ?? "unknown-goal",
      attorneyId: matchedContact?.id ?? toStringOrNull(row.attorney_user_id) ?? attorneyName ?? "unknown-attorney",
      year: Number(row.year ?? new Date().getFullYear()),
      annualFeeGoal: q1Goal + q2Goal + q3Goal + q4Goal,
      commissionThreshold,
      commissionYearStartMonth: Number(row.commission_year_start_month ?? 1),
      q1Goal,
      q2Goal,
      q3Goal,
      q4Goal,
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

async function upsertResultRow(
  caseId: string,
  trackerEntryId: string,
  result: SettlementResult,
  trackerRow: TrackerEntryRow,
): Promise<ResultRow | null> {
  const client = await createTrackerClient();
  const normalized = applyDerivedSettlementResult(result, trackerFieldsFromRow(trackerRow));

  const payload = {
    case_id: caseId,
    tracker_entry_id: trackerEntryId || null,
    settlement_date: normalized.settlementDate,
    settlement_amount: normalized.settlementAmount,
    fee_percent: normalized.feePercent,
    attorney_fees: normalized.attorneyFees,
    release_status: result.releaseStatus,
    closing_status: result.closingStatus,
    check_status: result.checkStatus,
    disbursed_status: result.disbursedStatus,
    reductions_status: normalized.reductionsStatus,
    release_signed_at: result.releaseSignedAt,
    closing_signed_at: result.closingSignedAt,
    check_deposited_at: result.checkDepositedAt,
    check_disbursed_at: result.checkDisbursedAt,
    disburse_date: normalized.disburseDate,
    result_quarter: normalized.resultQuarter,
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
  disbursements,
  contacts,
  suggestions,
}: {
  cases: DocketFlowCaseRow[];
  trackers: TrackerEntryRow[];
  results: ResultRow[];
  disbursements: DisbursementRow[];
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
  const disbursementsByTrackerId = groupBy(disbursements, "tracker_entry_id");
  const disbursementsByCaseNumber = groupBy(disbursements, "case_number");

  const recordsFromCases = cases.map((caseRow) => {
    const trackerRow = trackerByCaseId.get(caseRow.id) ?? makeEmptyTrackerRow(caseRow);
    const trackerId = toString(trackerRow.id, "");
    const resultRow = resultsByTrackerId.get(trackerId) ?? resultsByCaseId.get(caseRow.id) ?? null;
    const caseNumber = cleanCaseNumber(caseRow.case_number ?? "");
    return rowToCaseRecord(caseRow, trackerRow, resultRow, contacts, [
      ...(suggestionsByTrackerId.get(trackerId) ?? []),
      ...(suggestionsByCaseId.get(caseRow.id) ?? []),
    ], [
      ...(disbursementsByTrackerId.get(trackerId) ?? []),
      ...(disbursementsByCaseNumber.get(caseNumber) ?? []),
    ]);
  });

  const orphanTrackerRecords = trackers
    .filter((trackerRow) => {
      const caseId = toStringOrNull(trackerRow.case_id);
      return !caseId || !caseById.has(caseId);
    })
    .map((trackerRow) => {
      const trackerId = toString(trackerRow.id, "");
      const caseNumber = cleanCaseNumber(toString(trackerRow.case_number, ""));
      return rowToCaseRecord(
        null,
        trackerRow,
        resultsByTrackerId.get(trackerId) ?? null,
        contacts,
        suggestionsByTrackerId.get(trackerId) ?? [],
        [
          ...(disbursementsByTrackerId.get(trackerId) ?? []),
          ...(disbursementsByCaseNumber.get(caseNumber) ?? []),
        ],
      );
    });

  return [...recordsFromCases, ...orphanTrackerRecords];
}

function rowToCaseRecord(
  caseRow: DocketFlowCaseRow | null,
  trackerRow: TrackerEntryRow,
  resultRow: ResultRow | null,
  contacts: ContactRow[],
  suggestionRows: SuggestionRow[],
  disbursementRows: DisbursementRow[] = [],
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
  const tracker = rowToTrackerEntry(trackerRow, resultRow, suggestionRows, disbursementRows);

  return {
    shared: {
      id: sharedId,
      caseNumber: caseRow?.case_number ?? toString(trackerRow.case_number, "Unlinked case"),
      clientName: caseRow?.client_name ?? caseRow?.name ?? toString(trackerRow.client_name_snapshot, "Unknown client"),
      attorneyId: attorneyContact.id,
      paralegalId: paralegalContact.id,
      status: deriveCaseStatusFromTracker(tracker.caseStage, tracker.result.disbursedStatus),
      caseType: caseTypeFromCasesTable(
        caseRow ? caseRow.case_type : toStringOrNull(trackerRow.case_type),
      ),
      dateSigned: normalizeDate(toStringOrNull(trackerRow.date_signed_override) ?? caseRow?.created_at),
      dateOfIncident: normalizeOptionalDate(caseRow?.date_of_incident),
      createdAt: normalizeDate(caseRow?.created_at),
      updatedAt: normalizeDate(caseRow?.updated_at),
    },
    tracker,
    attorney: contactToUser(attorneyContact),
    paralegal: contactToUser(paralegalContact),
  };
}

function trackerFieldsFromRow(row: TrackerEntryRow) {
  return {
    caseStage: normalizeStage(toStringOrNull(row.case_stage)),
    expectedLitigation: normalizeExpectedLitigation(toStringOrNull(row.expected_litigation)),
    referralFee: toNumber(row.referral_fee),
  };
}

function disbursementRowToDisbursement(row: DisbursementRow): CaseDisbursement {
  return {
    id: toString(row.id, "disbursement"),
    partyLabel: toStringOrNull(row.label),
    disburseDate: toStringOrNull(row.disburse_date),
    settlementDate: toStringOrNull(row.settlement_date),
    settlementAmount: toNumber(row.settlement_amount),
    attorneyFees: toNumber(row.attorney_fees),
    weight: toNumber(row.weight) ?? 1,
    pendingRemaining: toBoolean(row.pending_remaining, false),
    syncedAt: toStringOrNull(row.synced_at),
  };
}

function uniqueDisbursements(rows: DisbursementRow[]) {
  const byId = new Map<string, CaseDisbursement>();
  for (const row of rows) {
    const mapped = disbursementRowToDisbursement(row);
    byId.set(mapped.id, mapped);
  }
  return [...byId.values()];
}

function rowToTrackerEntry(
  row: TrackerEntryRow,
  resultRow: ResultRow | null,
  suggestionRows: SuggestionRow[],
  disbursementRows: DisbursementRow[] = [],
): TrackerEntry {
  const minimumValue = toNumber(row.minimum_value);
  const entry: TrackerEntry = {
    id: toString(row.id, "pending-tracker-entry"),
    caseId: toString(row.case_id, toString(row.id, "pending-tracker-entry")),
    caseStage: normalizeStage(toStringOrNull(row.case_stage)),
    estimatedSettlementValue: minimumValue,
    estimatedFeeValue: toNumber(row.estimated_fee_value),
    targetResolutionQuarter: toStringOrNull(row.target_resolution_quarter),
    confidenceLevel: normalizeConfidence(toStringOrNull(row.confidence_level)),
    sourceOfEstimate: toStringOrNull(row.source_of_estimate),
    liability: toStringOrNull(row.liability),
    caseSize: deriveCaseSizeFromMinimumValue(minimumValue),
    minimumValue,
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
    multipleDisbursementsEnabled: toBoolean(row.multiple_disbursements_enabled, false),
    expectedDisbursementCount: Math.max(1, toNumber(row.expected_disbursement_count) ?? 1),
    disbursements: uniqueDisbursements(disbursementRows),
    lastQuarterlyCheckInAt: toStringOrNull(row.last_quarterly_check_in_at),
    lastSourcesLitUpdatedAt: toStringOrNull(row.last_sources_lit_updated_at),
    lastSlackReminderAt: toStringOrNull(row.last_slack_reminder_at),
    slackReminderThreadTs: toStringOrNull(row.slack_reminder_thread_ts),
    detectedStageSignals: suggestionRows.map(suggestionRowToSuggestion),
    forecastNotes: toString(row.forecast_notes, ""),
    attorneyNotes: toString(row.attorney_notes, ""),
    managerNotes: toString(row.manager_notes, ""),
    lastReviewedAt: toStringOrNull(row.last_reviewed_at),
    liabilityValidatedAt: toStringOrNull(row.liability_validated_at),
    targetResolutionQuarterValidatedAt: toStringOrNull(row.target_resolution_quarter_validated_at),
    minimumValueValidatedAt: toStringOrNull(row.minimum_value_validated_at),
    policyLimitsValidatedAt: toStringOrNull(row.policy_limits_validated_at),
    expectedLitigationValidatedAt: toStringOrNull(row.expected_litigation_validated_at),
    hasEverBeenLitigation: toBoolean(row.has_ever_been_litigation, normalizeStage(toStringOrNull(row.case_stage)) === "Lit"),
    isActive: toBoolean(row.is_active, true),
    settledAmount: toNumber(resultRow?.settlement_amount),
    disbursedAmount: resultRow?.check_disbursed_at ? toNumber(resultRow?.settlement_amount) : null,
    actualFeeValue: toNumber(resultRow?.attorney_fees),
    updatedAt: toString(row.updated_at, new Date().toISOString()),
  };
  return { ...entry, result: applyDerivedSettlementResult(entry.result, entry) };
}

function rowToResult(row: ResultRow | null): SettlementResult {
  return applyDerivedResultFields({
    settlementDate: toStringOrNull(row?.settlement_date),
    settlementAmount: toNumber(row?.settlement_amount),
    feePercent: toNumber(row?.fee_percent),
    attorneyFees: toNumber(row?.attorney_fees) ?? calculateAttorneyFees(toNumber(row?.settlement_amount), toNumber(row?.fee_percent)),
    releaseStatus: normalizeReleaseStatus(toStringOrNull(row?.release_status), toStringOrNull(row?.release_signed_at)),
    closingStatus: normalizeClosingStatus(toStringOrNull(row?.closing_status), toStringOrNull(row?.closing_signed_at)),
    checkStatus: normalizeCheckStatus(toStringOrNull(row?.check_status), toStringOrNull(row?.check_deposited_at)),
    disbursedStatus: normalizeDisbursedStatus(toStringOrNull(row?.disbursed_status), toStringOrNull(row?.check_disbursed_at)),
    reductionsStatus: normalizeReductionsStatus(
      toStringOrNull(row?.reductions_status),
      toStringOrNull(row?.disburse_date),
    ),
    releaseSignedAt: toStringOrNull(row?.release_signed_at),
    closingSignedAt: toStringOrNull(row?.closing_signed_at),
    checkDepositedAt: toStringOrNull(row?.check_deposited_at),
    checkDisbursedAt: toStringOrNull(row?.check_disbursed_at),
    disburseDate: toStringOrNull(row?.disburse_date),
    resultQuarter: toStringOrNull(row?.result_quarter),
  });
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

function countBackfillFields(row: ParsedCaseBackfillRow) {
  return Object.keys(row.shared).length + Object.keys(row.tracker).length + Object.keys(row.result).length;
}

function mergeTrackerImport(existing: TrackerEntry, patch: TrackerUpdateInput): TrackerUpdateInput {
  return {
    caseStage: patch.caseStage ?? existing.caseStage,
    estimatedSettlementValue: patch.estimatedSettlementValue ?? existing.estimatedSettlementValue,
    estimatedFeeValue: patch.estimatedFeeValue ?? existing.estimatedFeeValue,
    targetResolutionQuarter: patch.targetResolutionQuarter ?? existing.targetResolutionQuarter,
    confidenceLevel: patch.confidenceLevel ?? existing.confidenceLevel,
    sourceOfEstimate: patch.sourceOfEstimate ?? existing.sourceOfEstimate,
    liability: patch.liability ?? existing.liability,
    caseSize: patch.caseSize ?? existing.caseSize,
    minimumValue: patch.minimumValue ?? existing.minimumValue,
    referralFee: patch.referralFee ?? existing.referralFee,
    referralFeeArrangement: patch.referralFeeArrangement ?? existing.referralFeeArrangement,
    balanceCtaInfo: patch.balanceCtaInfo ?? existing.balanceCtaInfo,
    policyLimits: patch.policyLimits ?? existing.policyLimits,
    policyInfoSource: patch.policyInfoSource ?? existing.policyInfoSource,
    expectedLitigation: patch.expectedLitigation ?? existing.expectedLitigation,
    sources: patch.sources ?? existing.sources,
    injuries: patch.injuries ?? existing.injuries,
    caseDescription: patch.caseDescription ?? existing.caseDescription,
    statusNotes: patch.statusNotes ?? existing.statusNotes,
    gvNotes: patch.gvNotes ?? existing.gvNotes,
    lrjNotes: patch.lrjNotes ?? existing.lrjNotes,
    lastQuarterlyCheckInAt: patch.lastQuarterlyCheckInAt ?? existing.lastQuarterlyCheckInAt,
    lastSourcesLitUpdatedAt: patch.lastSourcesLitUpdatedAt ?? existing.lastSourcesLitUpdatedAt,
    forecastNotes: patch.forecastNotes ?? existing.forecastNotes,
  };
}

async function runSlackTrackerSideEffects(
  before: CaseRecord,
  afterTracker: TrackerEntry,
  patch: TrackerUpdateInput,
  previousStage: string | undefined,
) {
  const after: CaseRecord = { ...before, tracker: afterTracker };
  await notifySlackCaseStageUpdated(after, previousStage);
  await notifySlackTrackerSaved(after, patch);
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
    injuries: input.injuries,
    case_description: input.caseDescription,
    status_notes: input.statusNotes,
    gv_notes: input.gvNotes,
    lrj_notes: input.lrjNotes,
    last_quarterly_check_in_at: input.lastQuarterlyCheckInAt,
    last_sources_lit_updated_at: input.lastSourcesLitUpdatedAt,
    forecast_notes: input.forecastNotes,
    ...(input.multipleDisbursementsEnabled !== undefined
      ? { multiple_disbursements_enabled: input.multipleDisbursementsEnabled }
      : {}),
    ...(input.expectedDisbursementCount !== undefined
      ? { expected_disbursement_count: Math.max(1, Math.trunc(input.expectedDisbursementCount)) }
      : {}),
    ...(markReviewed ? { last_reviewed_at: new Date().toISOString() } : {}),
  };
}

function isUuid(value: string | null | undefined) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function commentRowToComment(row: UnknownRow, fallbackAuthorName?: string): TrackerComment {
  const storedName = toStringOrNull(row.author_name);
  return {
    id: toString(row.id, "comment"),
    caseId: toString(row.case_id, toString(row.tracker_entry_id, "")),
    authorId: toString(row.author_id, ""),
    authorName: storedName || fallbackAuthorName || "Unknown user",
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
    slackChannelId: toStringOrNull(row.slack_channel_id),
    slackConfirmationThreadTs: toStringOrNull(row.slack_confirmation_thread_ts),
    confirmationPostedAt: toStringOrNull(row.confirmation_posted_at),
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

function normalizeOptionalDate(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toDateOnly(value: string) {
  return value.slice(0, 10);
}

function normalizeCaseStatus(value: string | null | undefined): CaseStatus {
  const normalized = value?.toLowerCase();
  return normalized === "closed" || normalized === "inactive" || normalized === "disengaged" || normalized === "archived" ? "Closed" : "Active";
}

async function syncDerivedSharedCaseStatus(caseId: string, tracker: TrackerEntry) {
  const status = deriveCaseStatusFromTracker(tracker.caseStage, tracker.result.disbursedStatus);
  await updateSharedCaseFields(caseId, {}, { explicitStatus: status });
}

function normalizeStage(value: string | null | undefined): CaseStage {
  const normalized = value?.toLowerCase();
  if (normalized === "lit" || normalized === "litigation" || normalized === "litigated") return "Lit";
  if (normalized === "txt" || normalized === "treatment") return "Txt";
  if (normalized === "dmd" || normalized === "demand") return "Dmd";
  if (normalized === "settled" || normalized === "settlement" || normalized === "set") return "Settled";
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

function normalizeReductionsStatus(
  value: string | null | undefined,
  disburseDate: string | null = null,
): ReductionsStatus {
  if (disburseDate?.trim()) return "Deposited";
  if (value === "Sent" || value === "Approved" || value === "N/A" || value === "Deposited") return value;
  return "Not Complete";
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

function normalizeCommentType(value: string | null | undefined): CommentType {
  if (value === "attorney_update" || value === "manager_note" || value === "risk_flag" || value === "value_change" || value === "general_note") {
    return value;
  }
  return "general_note";
}

function normalizeStageSignalSource(value: string | null | undefined): StageSignalSource {
  if (
    value === "slack" ||
    value === "workflow" ||
    value === "matter_update" ||
    value === "manual" ||
    value === "pulse" ||
    value === "sheet"
  ) {
    return value;
  }
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
