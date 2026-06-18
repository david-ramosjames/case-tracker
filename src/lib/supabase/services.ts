import { buildFieldValidationRowPatch } from "@/lib/attorney-score";
import { caseNumbersMatch, cleanCaseNumber, compareCaseNumbers } from "@/lib/csv/parse";
import { disbursementWeight, getAggregatedResultFromDisbursements } from "@/lib/disbursements";
import { parseCaseBackfillCsv, type ParsedCaseBackfillRow } from "@/lib/csv/case-backfill";
import {
  parseSettlementFinancialBackfillCsv,
  type ParsedSettlementFinancialBackfillRow,
} from "@/lib/csv/settlement-financial-backfill";
import { trackerTouchesSourcesLit } from "@/lib/slack/reminders";
import {
  notifySlackCaseStageUpdated,
  notifySlackCommentPosted,
  notifySlackTrackerSaved,
} from "@/lib/slack/notify";
import {
  describeSlackThreadAppliedLabels,
  describeSlackThreadSharedLabels,
  parseSlackThreadUpdate,
} from "@/lib/slack/thread-update";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildStagePatchFromConfirmation } from "@/lib/stage-triggers";
import { buildTrackerActivityDescription, describeTrackerChanges } from "@/lib/tracker-changes";
import {
  CASE_STAGE_OPTIONS,
  EXPECTED_LITIGATION_OPTIONS,
  coerceExpectedLitigationForStage,
  caseTypeFromCasesTable,
  applyDerivedResultFields,
  applyDerivedSettlementResult,
  coerceReductionsStatus,
  deriveCaseSizeFromMinimumValue,
  deriveResultQuarterFromDisburseDate,
  normalizeCaseType,
} from "@/lib/case-options";
import {
  FIRM_OUTPERFORM_GOAL_ATTORNEY_ID,
  FIRM_OUTPERFORM_GOAL_ATTORNEY_NAME,
  normalizeGoalScope,
} from "@/lib/firm-goals";
import { deriveFeePercentFromSettlement } from "@/lib/fee-percent";
import { deriveCaseStatusFromTracker, applyOpenSettledTrackerFallback } from "@/lib/case-status";
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
  type GoalScope,
  type ManualDisbursementInput,
  type DisbursementPartyOverrideInput,
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

export function isOrphanTrackerRecord(record: Pick<CaseRecord, "shared" | "tracker">) {
  return record.shared.id === record.tracker.id;
}

/** Activity/comments FK to `cases` only when the tracker row is linked to DocketFlow. */
export function trackerActivityLink(record: Pick<CaseRecord, "shared" | "tracker">) {
  if (isOrphanTrackerRecord(record)) {
    return { caseId: null, trackerEntryId: record.tracker.id };
  }
  return { caseId: record.shared.id, trackerEntryId: record.tracker.id };
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
  shared?: { status?: CaseStatus; caseType?: string; dateSigned?: string; dateOfIncident?: string | null };
  markReviewed?: boolean;
  /** When saving a partial patch, pass the patch here so activity logs only list changed fields. */
  changeInput?: TrackerUpdateInput & {
    result?: SettlementResult;
    manualDisbursements?: ManualDisbursementInput[];
    disbursementOverrides?: DisbursementPartyOverrideInput[];
  };
};

export async function updateTrackerEntry(
  caseId: string,
  input: TrackerUpdateInput & {
    result?: SettlementResult;
    manualDisbursements?: ManualDisbursementInput[];
    disbursementOverrides?: DisbursementPartyOverrideInput[];
  },
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
              dateSigned: existingRecord.shared.dateSigned,
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

  const nextStage = input.caseStage ?? existingTracker?.caseStage ?? "Onboarding";
  const nextExpectedLitigation =
    input.expectedLitigation !== undefined ? input.expectedLitigation : (existingTracker?.expectedLitigation ?? null);
  const coercedExpectedLitigation = coerceExpectedLitigationForStage(nextStage, nextExpectedLitigation);
  const inputWithExpectedLit =
    nextStage === "Lit" || coercedExpectedLitigation !== nextExpectedLitigation
      ? { ...inputWithSourcesLit, expectedLitigation: coercedExpectedLitigation }
      : inputWithSourcesLit;

  const litigationPatch: Record<string, unknown> = {};
  if (nextStage === "Lit" || existingTracker?.hasEverBeenLitigation || existingTracker?.caseStage === "Lit") {
    litigationPatch.has_ever_been_litigation = true;
  }

  const payload = {
    ...trackerUpdateToRow(inputWithExpectedLit, markReviewed),
    ...validationPatch,
    ...litigationPatch,
  };
  const requestedResult = input.result;
  const previousStage = existingTracker?.caseStage;
  let updateQuery = client.from("case_tracker_entries").update(payload);
  if (hasPersistedTrackerEntry(existingTracker)) {
    updateQuery = updateQuery.eq("id", existingTracker!.id);
  } else if (existingRecord && isLinkedDocketFlowCase(existingRecord)) {
    updateQuery = updateQuery.eq("case_id", existingRecord.shared.id);
  } else {
    updateQuery = updateQuery.or(`case_id.eq.${caseId},id.eq.${caseId}`);
  }
  const { data, error } = await updateQuery.select("*").maybeSingle();

  if (error) throw error;
  if (data) {
    const resultRow = requestedResult
      ? await upsertResultRow(caseId, toString(data.id, ""), requestedResult, data as TrackerEntryRow)
      : null;

    if (input.manualDisbursements) {
      const admin = createSupabaseAdminClient();
      if (!admin) throw new Error("Service role required to save manual disbursements.");
      const caseNumber = cleanCaseNumber(
        toStringOrNull((data as TrackerEntryRow).case_number) ??
          cleanCaseNumber(existingRecord?.shared.caseNumber ?? ""),
      );
      if (!caseNumber) throw new Error("Case number is required to save manual disbursements.");
      await syncManualDisbursements(admin, {
        trackerEntryId: toString(data.id, ""),
        caseId: linkedDocketFlowCaseId(data as TrackerEntryRow),
        caseNumber,
        expectedDisbursementCount: Math.max(
          1,
          toNumber((data as TrackerEntryRow).expected_disbursement_count) ??
            existingTracker?.expectedDisbursementCount ??
            1,
        ),
        rows: input.manualDisbursements,
      });
    }

    if (input.disbursementOverrides?.length) {
      const admin = createSupabaseAdminClient();
      if (!admin) throw new Error("Service role required to save disbursement overrides.");
      await syncDisbursementPartyOverrides(admin, input.disbursementOverrides);
    }

    if (input.manualDisbursements || input.disbursementOverrides?.length) {
      const admin = createSupabaseAdminClient();
      if (!admin) throw new Error("Service role required to update results from disbursements.");
      const caseNumber = cleanCaseNumber(
        toStringOrNull((data as TrackerEntryRow).case_number) ??
          cleanCaseNumber(existingRecord?.shared.caseNumber ?? ""),
      );
      if (caseNumber) {
        await recomputeCaseResultFromDisbursements(admin, {
          caseId: linkedDocketFlowCaseId(data as TrackerEntryRow) ?? "",
          trackerEntryId: toString(data.id, ""),
          caseNumber,
        });
      }
    }

    const refreshedRecord = await getCaseById(caseId);
    const tracker = refreshedRecord?.tracker ?? rowToTrackerEntry(data as TrackerEntryRow, resultRow, []);

    const activity = await createActivityEntry(
      caseId,
      "Tracker updated",
      buildTrackerActivityDescription(changedFields, markReviewed),
      options.actor,
      { changedFields },
      existingRecord,
    );
    if (existingRecord) {
      await syncDerivedSharedCaseStatus(caseId, tracker, existingRecord);
      try {
        await runSlackTrackerSideEffects(existingRecord, tracker, changeInput, previousStage);
      } catch (error) {
        console.error("Slack tracker notification failed", error);
      }
    }
    return { tracker, activity: activity ?? undefined };
  }

  if (hasPersistedTrackerEntry(existingTracker)) {
    throw new Error("Tracker entry could not be updated.");
  }

  const linkedInsertCaseId =
    existingRecord && isLinkedDocketFlowCase(existingRecord) && isUuid(existingRecord.shared.id)
      ? existingRecord.shared.id
      : isUuid(caseId)
        ? caseId
        : null;
  const insertRow: Record<string, unknown> = {
    ...payload,
    case_id: linkedInsertCaseId,
  };
  if (existingRecord?.shared.caseNumber) {
    insertRow.case_number = cleanCaseNumber(existingRecord.shared.caseNumber);
  }
  if (existingRecord?.shared.clientName) {
    insertRow.client_name_snapshot = existingRecord.shared.clientName;
  }

  const { data: inserted, error: insertError } = await client
    .from("case_tracker_entries")
    .insert(insertRow)
    .select("*")
    .single();

  if (insertError) throw insertError;
  const resultRow = requestedResult
    ? await upsertResultRow(caseId, toString(inserted.id, ""), requestedResult, inserted as TrackerEntryRow)
    : null;
  const tracker = rowToTrackerEntry(inserted as TrackerEntryRow, resultRow, []);
  const insertedRecord = await getCaseById(caseId);
  await syncDerivedSharedCaseStatus(caseId, tracker, insertedRecord);
  const activity = await createActivityEntry(
    caseId,
    "Tracker created",
    "Tracker row was created from live DocketFlow case data.",
    options.actor,
    undefined,
    insertedRecord,
  );
  const refreshed = await getCaseById(caseId);
  return { tracker: refreshed?.tracker ?? tracker, activity: activity ?? undefined };
}

export async function importCaseBackfillCsv(
  csvText: string,
  options: {
    actor?: TrackerActor;
    dryRun?: boolean;
    onProgress?: (progress: CaseBackfillImportProgress) => void;
  } = {},
): Promise<CaseBackfillImportResult> {
  const parsedRows = parseCaseBackfillCsv(csvText);
  return importCaseBackfillRows(parsedRows, options);
}

export type CaseBackfillImportProgress = {
  processed: number;
  total: number;
  updated: number;
  failed: number;
  currentCaseNumber?: string;
};

export async function importCaseBackfillRows(
  parsedRows: ParsedCaseBackfillRow[],
  options: {
    actor?: TrackerActor;
    dryRun?: boolean;
    cases?: CaseRecord[];
    onProgress?: (progress: CaseBackfillImportProgress) => void;
  } = {},
): Promise<CaseBackfillImportResult> {
  const cases = options.cases ?? (await getCases());
  const byCaseNumber = buildCaseBackfillLookup(cases);

  const preview: CaseBackfillImportResult["preview"] = [];
  const unmatched: string[] = [];
  const unlinked: string[] = [];
  const failed: CaseBackfillImportResult["failed"] = [];
  let matched = 0;
  let updated = 0;
  let skipped = 0;

  for (let index = 0; index < parsedRows.length; index += 1) {
    const row = parsedRows[index];
    const existing = byCaseNumber.get(row.caseNumber);
    const fieldCount = countBackfillFields(row);
    const importable = Boolean(existing && isLinkedDocketFlowCase(existing));

    preview.push({ caseNumber: row.caseNumber, matched: importable, fieldCount });

    if (!existing) {
      unmatched.push(row.caseNumber);
      options.onProgress?.({
        processed: index + 1,
        total: parsedRows.length,
        updated,
        failed: failed.length,
        currentCaseNumber: row.caseNumber,
      });
      continue;
    }

    if (!importable) {
      unlinked.push(row.caseNumber);
      options.onProgress?.({
        processed: index + 1,
        total: parsedRows.length,
        updated,
        failed: failed.length,
        currentCaseNumber: row.caseNumber,
      });
      continue;
    }

    matched += 1;
    if (fieldCount === 0) {
      skipped += 1;
      options.onProgress?.({
        processed: index + 1,
        total: parsedRows.length,
        updated,
        failed: failed.length,
        currentCaseNumber: row.caseNumber,
      });
      continue;
    }

    if (!options.dryRun) {
      const caseId = existing.shared.id;

      try {
        if (Object.keys(row.shared).length > 0) {
          await updateSharedCaseFields(
            caseId,
            row.shared,
            row.shared.status ? { explicitStatus: row.shared.status } : undefined,
          );
        }

        const trackerPatch = row.tracker;
        const resultPatch = row.result;
        const hasTrackerPatch = Object.keys(trackerPatch).length > 0;
        const hasResultPatch = Object.keys(resultPatch).length > 0;

        if (hasTrackerPatch || hasResultPatch) {
          const mergedResult = hasResultPatch ? { ...existing.tracker.result, ...resultPatch } : undefined;
          const { tracker: savedTracker } = await updateTrackerEntry(
            caseId,
            {
              ...trackerPatch,
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
          byCaseNumber.set(row.caseNumber, {
            ...existing,
            shared: Object.keys(row.shared).length > 0 ? { ...existing.shared, ...row.shared } : existing.shared,
            tracker: savedTracker,
          });
        } else if (Object.keys(row.shared).length > 0) {
          await createActivityEntry(
            caseId,
            "CSV backfill",
            buildTrackerActivityDescription(
              describeTrackerChanges(existing.tracker, {}, {
                before: {
                  status: existing.shared.status,
                  caseType: existing.shared.caseType,
                  dateSigned: existing.shared.dateSigned,
                  dateOfIncident: existing.shared.dateOfIncident,
                },
                after: row.shared,
              }),
              false,
            ),
            options.actor,
            { source: "csv_backfill", trackerEntryId: existing.tracker.id },
            existing,
          );
        }

        updated += 1;
      } catch (error) {
        failed.push({
          caseNumber: row.caseNumber,
          message: error instanceof Error ? error.message : "Import failed for this row.",
        });
      }
    }

    options.onProgress?.({
      processed: index + 1,
      total: parsedRows.length,
      updated,
      failed: failed.length,
      currentCaseNumber: row.caseNumber,
    });
  }

  return {
    totalRows: parsedRows.length,
    matched,
    updated: options.dryRun ? 0 : updated,
    skipped,
    unmatched,
    unlinked,
    failed,
    preview,
    dryRun: Boolean(options.dryRun),
  };
}

export async function importSettlementFinancialBackfillCsv(
  csvText: string,
  options: {
    actor?: TrackerActor;
    dryRun?: boolean;
    onProgress?: (progress: CaseBackfillImportProgress) => void;
  } = {},
): Promise<CaseBackfillImportResult> {
  const parsedRows = parseSettlementFinancialBackfillCsv(csvText);
  return importSettlementFinancialBackfillRows(parsedRows, options);
}

export async function importSettlementFinancialBackfillRows(
  parsedRows: ParsedSettlementFinancialBackfillRow[],
  options: {
    actor?: TrackerActor;
    dryRun?: boolean;
    cases?: CaseRecord[];
    onProgress?: (progress: CaseBackfillImportProgress) => void;
  } = {},
): Promise<CaseBackfillImportResult> {
  const cases = options.cases ?? (await getCases());
  const byCaseNumber = buildCaseBackfillLookup(cases);
  const admin = createSupabaseAdminClient();

  const preview: CaseBackfillImportResult["preview"] = [];
  const unmatched: string[] = [];
  const failed: CaseBackfillImportResult["failed"] = [];
  let matched = 0;
  let updated = 0;
  let skipped = 0;

  for (let index = 0; index < parsedRows.length; index += 1) {
    const row = parsedRows[index];
    const existing = byCaseNumber.get(row.caseNumber);
    const fieldCount =
      row.claimCount + Object.keys(row.tracker).length + Object.keys(row.result).length;

    preview.push({ caseNumber: row.caseNumber, matched: Boolean(existing), fieldCount });

    if (!existing) {
      unmatched.push(row.caseNumber);
      options.onProgress?.({
        processed: index + 1,
        total: parsedRows.length,
        updated,
        failed: failed.length,
        currentCaseNumber: row.caseNumber,
      });
      continue;
    }

    matched += 1;
    if (fieldCount === 0) {
      skipped += 1;
      options.onProgress?.({
        processed: index + 1,
        total: parsedRows.length,
        updated,
        failed: failed.length,
        currentCaseNumber: row.caseNumber,
      });
      continue;
    }

    if (!options.dryRun) {
      const caseId = existing.shared.id;

      try {
        const caseNumber = cleanCaseNumber(existing.shared.caseNumber);
        let trackerPatch = { ...row.tracker };
        if (row.keepCaseActive) {
          trackerPatch = { ...trackerPatch, caseStage: "Settled" };
        }

        if (admin && row.lockFinancialBackfill && caseNumber) {
          const { error: clearError } = await admin
            .from("case_tracker_disbursements")
            .delete()
            .eq("case_number", caseNumber);
          if (clearError) throw new Error(clearError.message);
        }

        const { tracker: savedTracker } = await updateTrackerEntry(
          caseId,
          {
            ...trackerPatch,
            ...(row.lockFinancialBackfill
              ? {
                  manualDisbursements: row.manualDisbursements,
                  result: { ...existing.tracker.result, ...row.result },
                }
              : {}),
          },
          {
            actor: options.actor,
            markReviewed: false,
            changeInput: {
              ...trackerPatch,
              ...(row.lockFinancialBackfill ? { manualDisbursements: row.manualDisbursements } : {}),
            },
          },
        );
        byCaseNumber.set(row.caseNumber, { ...existing, tracker: savedTracker });

        if (admin && row.keepCaseActive) {
          const trackerEntryId = existing.tracker.id;
          const linkedCaseId = isLinkedDocketFlowCase(existing) ? existing.shared.id : null;
          const filter = linkedCaseId
            ? `tracker_entry_id.eq.${trackerEntryId},case_id.eq.${linkedCaseId}`
            : `tracker_entry_id.eq.${trackerEntryId}`;
          const { error: partialResultError } = await admin
            .from("case_tracker_results")
            .update({
              disbursed_status: "No",
              check_status: "No",
              check_disbursed_at: null,
              disburse_date: null,
              settlement_date: null,
              result_quarter: null,
            })
            .or(filter);
          if (partialResultError) throw new Error(partialResultError.message);

          if (savedTracker.caseStage && savedTracker.caseStage !== "Settled") {
            const { error: stageError } = await admin
              .from("case_tracker_entries")
              .update({ case_stage: toDatabaseStage(savedTracker.caseStage) })
              .eq("id", trackerEntryId);
            if (stageError) throw new Error(stageError.message);
          }
        }

        if (row.result.feePercent != null && admin) {
          const trackerEntryId = existing.tracker.id;
          const linkedCaseId = isLinkedDocketFlowCase(existing) ? existing.shared.id : null;
          const filter = linkedCaseId
            ? `tracker_entry_id.eq.${trackerEntryId},case_id.eq.${linkedCaseId}`
            : `tracker_entry_id.eq.${trackerEntryId}`;
          const { error: feeError } = await admin
            .from("case_tracker_results")
            .update({ fee_percent: row.result.feePercent })
            .or(filter);
          if (feeError) throw new Error(feeError.message);
        }

        if (admin) {
          const trackerEntryId = existing.tracker.id;
          const linkedCaseId = isLinkedDocketFlowCase(existing) ? existing.shared.id : null;
          if (row.lockFinancialBackfill) {
            const filter = linkedCaseId
              ? `tracker_entry_id.eq.${trackerEntryId},case_id.eq.${linkedCaseId}`
              : `tracker_entry_id.eq.${trackerEntryId}`;
            const { error: lockError } = await admin
              .from("case_tracker_results")
              .update({ financial_backfill_locked: true })
              .or(filter);
            if (lockError) throw new Error(lockError.message);
          }
          if (row.lockReferralFee) {
            const { error: referralLockError } = await admin
              .from("case_tracker_entries")
              .update({ referral_fee_backfill_locked: true })
              .eq("id", trackerEntryId);
            if (referralLockError) throw new Error(referralLockError.message);
          }
        }

        updated += 1;
      } catch (error) {
        failed.push({
          caseNumber: row.caseNumber,
          message: error instanceof Error ? error.message : "Import failed for this row.",
        });
      }
    }

    options.onProgress?.({
      processed: index + 1,
      total: parsedRows.length,
      updated,
      failed: failed.length,
      currentCaseNumber: row.caseNumber,
    });
  }

  return {
    totalRows: parsedRows.length,
    matched,
    updated: options.dryRun ? 0 : updated,
    skipped,
    unmatched,
    unlinked: [],
    failed,
    preview,
    dryRun: Boolean(options.dryRun),
  };
}

export type SettlementFinancialBackfillResetDetail = {
  caseNumber: string;
  financialCleared: boolean;
  referralCleared: boolean;
  stageRestored: boolean;
  restoredStage: string | null;
  disbursementsRemoved: number;
  detectedBy: string[];
  summary: string;
};

export type SettlementFinancialBackfillResetResult = {
  casesReset: number;
  stagesRestored: number;
  disbursementsRemoved: number;
  details: SettlementFinancialBackfillResetDetail[];
};

/** Undo all settlement financial CSV backfill imports so you can re-import or rely on the Google sheet again. */
export async function resetSettlementFinancialBackfill(): Promise<SettlementFinancialBackfillResetResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required to reset settlement financial backfill.");

  type ResetFlags = { financial: boolean; referral: boolean; reasons: string[] };
  const flagsByTrackerId = new Map<string, ResetFlags>();

  function markTracker(trackerEntryId: string, patch: Partial<Pick<ResetFlags, "financial" | "referral">>, reason: string) {
    const existing = flagsByTrackerId.get(trackerEntryId) ?? { financial: false, referral: false, reasons: [] };
    flagsByTrackerId.set(trackerEntryId, {
      financial: existing.financial || Boolean(patch.financial),
      referral: existing.referral || Boolean(patch.referral),
      reasons: existing.reasons.includes(reason) ? existing.reasons : [...existing.reasons, reason],
    });
  }

  const [
    { data: referralLockedRows, error: referralError },
    { data: financialLockedRows, error: financialError },
    { data: arrangementRows, error: arrangementError },
    { data: manualBackfillRows, error: manualError },
  ] = await Promise.all([
    admin.from("case_tracker_entries").select("id").eq("referral_fee_backfill_locked", true),
    admin.from("case_tracker_results").select("tracker_entry_id").eq("financial_backfill_locked", true),
    admin.from("case_tracker_entries").select("id").ilike("referral_fee_arrangement", "%Financial backfill%"),
    admin
      .from("case_tracker_disbursements")
      .select("tracker_entry_id")
      .is("sheet_row_key", null)
      .is("synced_at", null),
  ]);

  if (referralError) throw new Error(referralError.message);
  if (financialError) throw new Error(financialError.message);
  if (arrangementError) throw new Error(arrangementError.message);
  if (manualError) throw new Error(manualError.message);

  for (const row of referralLockedRows ?? []) {
    markTracker(toString(row.id, ""), { referral: true }, "referral lock flag");
  }
  for (const row of financialLockedRows ?? []) {
    markTracker(toString(row.tracker_entry_id, ""), { financial: true }, "financial lock flag");
  }
  for (const row of arrangementRows ?? []) {
    markTracker(toString(row.id, ""), { referral: true }, "referral arrangement text");
  }
  for (const row of manualBackfillRows ?? []) {
    markTracker(toString(row.tracker_entry_id, ""), { financial: true }, "CSV manual disbursement row");
  }

  if (flagsByTrackerId.size === 0) {
    return { casesReset: 0, stagesRestored: 0, disbursementsRemoved: 0, details: [] };
  }

  const details: SettlementFinancialBackfillResetDetail[] = [];
  let stagesRestored = 0;
  let disbursementsRemoved = 0;

  for (const [trackerEntryId, flags] of flagsByTrackerId) {
    if (!trackerEntryId) continue;
    const { data: entry, error: entryError } = await admin
      .from("case_tracker_entries")
      .select("id, case_id, case_number, case_stage, referral_fee_arrangement")
      .eq("id", trackerEntryId)
      .maybeSingle();
    if (entryError) throw new Error(entryError.message);
    if (!entry) continue;

    const caseNumber = cleanCaseNumber(toStringOrNull(entry.case_number) ?? "");
    const linkedCaseId = linkedDocketFlowCaseId(entry as TrackerEntryRow);
    const currentStage = normalizeStage(toStringOrNull(entry.case_stage));
    let restoredStage: CaseStage | null = null;
    let stageRestored = false;
    let removedForCase = 0;

    if (flags.financial && currentStage === "Settled") {
      restoredStage = await lookupPriorCaseStageBeforeSettlement(admin, trackerEntryId);
      if (restoredStage) {
        const { error: stageError } = await admin
          .from("case_tracker_entries")
          .update({ case_stage: toDatabaseStage(restoredStage) })
          .eq("id", trackerEntryId);
        if (stageError) throw new Error(stageError.message);
        stageRestored = true;
        stagesRestored += 1;
      }
    }

    const trackerUpdate: Record<string, unknown> = {
      referral_fee_backfill_locked: false,
    };
    if (flags.referral) {
      trackerUpdate.referral_fee = null;
      trackerUpdate.referral_fee_arrangement = null;
    }

    if (flags.financial && caseNumber) {
      const { data: deletedRows, error: deleteError } = await admin
        .from("case_tracker_disbursements")
        .delete()
        .eq("case_number", caseNumber)
        .is("sheet_row_key", null)
        .select("id");
      if (deleteError) throw new Error(deleteError.message);
      removedForCase = deletedRows?.length ?? 0;
      disbursementsRemoved += removedForCase;

      const { count: sheetPartyCount, error: sheetCountError } = await admin
        .from("case_tracker_disbursements")
        .select("id", { count: "exact", head: true })
        .eq("case_number", caseNumber)
        .not("sheet_row_key", "is", null);
      if (sheetCountError) throw new Error(sheetCountError.message);
      const expectedCount = Math.max(1, sheetPartyCount ?? 0);
      trackerUpdate.expected_disbursement_count = expectedCount;
      trackerUpdate.multiple_disbursements_enabled = expectedCount > 1;
    }

    const { error: trackerUpdateError } = await admin
      .from("case_tracker_entries")
      .update(trackerUpdate)
      .eq("id", trackerEntryId);
    if (trackerUpdateError) throw new Error(trackerUpdateError.message);

    if (flags.financial) {
      const filter = linkedCaseId
        ? `tracker_entry_id.eq.${trackerEntryId},case_id.eq.${linkedCaseId}`
        : `tracker_entry_id.eq.${trackerEntryId}`;
      const { error: resultError } = await admin
        .from("case_tracker_results")
        .update({
          financial_backfill_locked: false,
          settlement_date: null,
          settlement_amount: null,
          attorney_fees: null,
          fee_percent: null,
          disburse_date: null,
          check_disbursed_at: null,
          disbursed_status: "No",
          check_status: "No",
          result_quarter: null,
          release_status: "No",
          closing_status: "No",
          reductions_status: "Not Complete",
        })
        .or(filter);
      if (resultError) throw new Error(resultError.message);
    }

    if (stageRestored) {
      const caseId = linkedCaseId ?? trackerEntryId;
      const refreshed = await getCaseById(caseId);
      if (refreshed) {
        await syncDerivedSharedCaseStatus(caseId, refreshed.tracker, refreshed);
      }
    }

    const summaryParts: string[] = [];
    if (flags.financial) summaryParts.push("cleared financial import");
    if (flags.referral) summaryParts.push("cleared referral fee import");
    if (removedForCase > 0) summaryParts.push(`removed ${removedForCase} manual disbursement row(s)`);
    if (stageRestored && restoredStage) summaryParts.push(`stage restored to ${restoredStage}`);
    else if (flags.financial && currentStage === "Settled") {
      summaryParts.push("stage still Settled (no version history to restore)");
    }

    details.push({
      caseNumber: caseNumber || trackerEntryId,
      financialCleared: flags.financial,
      referralCleared: flags.referral,
      stageRestored,
      restoredStage,
      disbursementsRemoved: removedForCase,
      detectedBy: flags.reasons,
      summary: summaryParts.length > 0 ? summaryParts.join("; ") : "locks cleared",
    });
  }

  details.sort((left, right) => compareCaseNumbers(left.caseNumber, right.caseNumber));

  return {
    casesReset: details.length,
    stagesRestored,
    disbursementsRemoved,
    details,
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

  const record = await getCaseById(caseId);
  const linkedCaseId = record && isLinkedDocketFlowCase(record) ? record.shared.id : null;
  let statusToWrite = options?.explicitStatus;
  if (!statusToWrite) {
    statusToWrite = record
      ? deriveCaseStatusFromTracker(record.tracker.caseStage, record.tracker.result)
      : input.status;
  }
  if (statusToWrite) payload.status = statusToWrite === "Closed" ? "archived" : "active";
  if (input.caseType !== undefined) {
    const trimmed = input.caseType.trim();
    const normalizedType = trimmed ? normalizeCaseType(trimmed) : null;
    if (linkedCaseId) {
      payload.case_type = normalizedType;
    } else {
      const { error } = await trackerClient
        .from("case_tracker_entries")
        .update({ case_type: normalizedType })
        .or(`case_id.eq.${caseId},id.eq.${caseId}`);
      if (error) throw error;
    }
  }
  if (input.dateOfIncident !== undefined) {
    payload.date_of_incident = input.dateOfIncident ? toDateOnly(input.dateOfIncident) : null;
  }

  if (Object.keys(payload).length > 0 && linkedCaseId) {
    const { error } = await sharedClient.from("cases").update(payload).eq("id", linkedCaseId);
    if (error) throw error;
  }

  // Tracker-owned DOL for orphaned rows without a DocketFlow case.
  if (input.dateOfIncident !== undefined && !linkedCaseId) {
    const { error } = await trackerClient
      .from("case_tracker_entries")
      .update({
        date_of_incident_override: input.dateOfIncident ? toDateOnly(input.dateOfIncident) : null,
      })
      .or(`case_id.eq.${caseId},id.eq.${caseId}`);
    if (error) throw error;
  }

  // Tracker-owned override so we don't mutate DocketFlow created_at.
  if (input.dateSigned) {
    const { error } = await trackerClient
      .from("case_tracker_entries")
      .update({ date_signed_override: toDateOnly(input.dateSigned) })
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

type TrackerEntryLookupRow = {
  id: string;
  case_id: string | null;
  case_number: string | null;
  expected_disbursement_count: number | null;
  case_stage: string | null;
};

export type SettlementSheetCasePayload = {
  caseNumber: string;
  sheetRowCount: number;
  settlementDate: string | null;
  /** Column G on the disbursing sheet — Y means full settlement (stage can move to Settled). */
  fullSettlement: boolean;
  totalSettlementAmount: number | null;
  totalAttorneyFees: number | null;
  latestDisburseDate: string | null;
  allDisbursed: boolean;
  pendingDisbursementCount?: number;
  completedDisbursementCount?: number;
  /** When importing from a case page, pass the known tracker row to skip case-number lookup. */
  trackerEntryId?: string;
  docketflowCaseId?: string;
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

export type SettlementSheetSyncPartyDetail = {
  label: string | null;
  settlementDate: string | null;
  disburseDate: string | null;
  pendingRemaining: boolean;
  settlementAmount: number | null;
  attorneyFees: number | null;
};

export type SettlementSheetSyncCaseDetail = {
  caseNumber: string;
  status: "synced" | "skipped_no_tracker" | "skipped_financial_locked";
  sheetRowCount: number;
  partiesSynced?: number;
  settlementDate?: string | null;
  disburseDate?: string | null;
  settlementAmount?: number | null;
  attorneyFees?: number | null;
  disbursedStatus?: DisbursedStatus;
  resultQuarter?: string | null;
  stageAutoSettled?: boolean;
  pendingPartyCount?: number;
  expectedPartyCount?: number;
  parties?: SettlementSheetSyncPartyDetail[];
  summary: string;
};

export type SettlementSheetSyncResult = {
  casesProcessed: number;
  disbursementsSynced: number;
  settlementsUpdated: number;
  stagesAutoSettled: number;
  skippedNoTracker: number;
  skippedFinancialLocked: number;
  sheetCasesFound: number;
  details: SettlementSheetSyncCaseDetail[];
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
    .select("id, disburse_date, settlement_date, pending_remaining, disburse_date_locked, settlement_date_locked")
    .eq("sheet_row_key", payload.sheet_row_key)
    .maybeSingle();

  if (lookupError) throw new Error(lookupError.message);

  if (existing?.id) {
    const merged = { ...payload };
    if (toBoolean(existing.disburse_date_locked, false)) {
      merged.disburse_date = toStringOrNull(existing.disburse_date);
      if (merged.disburse_date) {
        merged.pending_remaining = false;
      } else {
        merged.pending_remaining = toBoolean(existing.pending_remaining, false);
      }
    }
    if (toBoolean(existing.settlement_date_locked, false)) {
      merged.settlement_date = toStringOrNull(existing.settlement_date);
    }
    const { error } = await admin.from("case_tracker_disbursements").update(merged).eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await admin.from("case_tracker_disbursements").insert(payload);
  if (error) throw new Error(error.message);
}

/** Correct disburse/settlement dates on sheet-linked parties (legacy cases). Locked fields survive sheet import. */
async function syncDisbursementPartyOverrides(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  overrides: DisbursementPartyOverrideInput[],
) {
  for (const override of overrides) {
    if (!override.id || !isUuid(override.id)) continue;

    const { data: existing, error: lookupError } = await admin
      .from("case_tracker_disbursements")
      .select("sheet_row_key")
      .eq("id", override.id)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!existing?.sheet_row_key) continue;

    const update: Record<string, unknown> = {};
    if (override.disburseDate !== undefined) {
      update.disburse_date = override.disburseDate ? toDateOnly(override.disburseDate) : null;
    }
    if (override.settlementDate !== undefined) {
      update.settlement_date = override.settlementDate ? toDateOnly(override.settlementDate) : null;
    }
    if (override.pendingRemaining !== undefined) {
      update.pending_remaining = override.pendingRemaining;
    }
    if (override.disburseDateLocked !== undefined) {
      update.disburse_date_locked = override.disburseDateLocked;
    }
    if (override.settlementDateLocked !== undefined) {
      update.settlement_date_locked = override.settlementDateLocked;
    }
    if (override.disburseDate && override.disburseDateLocked !== false) {
      update.disburse_date_locked = true;
      update.pending_remaining = false;
    }
    if (override.settlementDate && override.settlementDateLocked !== false) {
      update.settlement_date_locked = true;
    }
    if (Object.keys(update).length === 0) continue;

    const { error } = await admin.from("case_tracker_disbursements").update(update).eq("id", override.id);
    if (error) throw new Error(error.message);
  }
}

async function lookupPriorCaseStageBeforeSettlement(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  trackerEntryId: string,
): Promise<CaseStage | null> {
  const { data, error } = await admin
    .from("case_tracker_entry_versions")
    .select("old_values, new_values")
    .eq("tracker_entry_id", trackerEntryId)
    .order("changed_at", { ascending: false })
    .limit(30);

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const oldValues = asObject(row.old_values);
    const newValues = asObject(row.new_values);
    const newStage = toStringOrNull(newValues.case_stage);
    const oldStage = toStringOrNull(oldValues.case_stage);
    if (!newStage || !oldStage) continue;
    const normalizedNew = normalizeStage(newStage);
    const normalizedOld = normalizeStage(oldStage);
    if (normalizedNew === "Settled" && normalizedOld !== "Settled") {
      return normalizedOld;
    }
  }

  return null;
}

async function recomputeCaseResultFromDisbursements(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  input: { caseId: string; trackerEntryId: string; caseNumber: string },
) {
  const [{ data: trackerRow, error: trackerError }, { data: disbursementRows, error: disbursementError }, { data: existingResult, error: resultError }] =
    await Promise.all([
      admin.from("case_tracker_entries").select("*").eq("id", input.trackerEntryId).maybeSingle(),
      admin
        .from("case_tracker_disbursements")
        .select("*")
        .eq("case_number", input.caseNumber)
        .order("created_at", { ascending: true }),
      admin
        .from("case_tracker_results")
        .select("*")
        .or(
          input.caseId
            ? `tracker_entry_id.eq.${input.trackerEntryId},case_id.eq.${input.caseId}`
            : `tracker_entry_id.eq.${input.trackerEntryId}`,
        )
        .maybeSingle(),
    ]);

  if (trackerError) throw new Error(trackerError.message);
  if (disbursementError) throw new Error(disbursementError.message);
  if (resultError) throw new Error(resultError.message);
  if (!trackerRow) return;

  const disbursements = uniqueDisbursements((disbursementRows ?? []) as DisbursementRow[]);
  const partyCount = Math.max(
    1,
    toNumber(trackerRow.expected_disbursement_count) ?? 1,
    disbursements.length,
  );
  const aggregated = getAggregatedResultFromDisbursements({
    multipleDisbursementsEnabled: partyCount > 1 || toBoolean(trackerRow.multiple_disbursements_enabled, false),
    expectedDisbursementCount: partyCount,
    disbursements,
    result: rowToResult(existingResult),
  });
  if (!aggregated) return;

  const referralFee = toNumber(trackerRow.referral_fee);
  const feePercent =
    deriveFeePercentFromSettlement({
      settlementAmount: aggregated.settlementAmount,
      attorneyFees: aggregated.attorneyFees,
      referralFee,
    }) ?? aggregated.feePercent;

  const resultPayload = {
    settlement_date: aggregated.settlementDate ? toDateOnly(aggregated.settlementDate) : null,
    settlement_amount: aggregated.settlementAmount,
    attorney_fees: aggregated.attorneyFees,
    fee_percent: feePercent,
    disburse_date: aggregated.disburseDate ? toDateOnly(aggregated.disburseDate) : null,
    check_disbursed_at: aggregated.checkDisbursedAt,
    disbursed_status: aggregated.disbursedStatus,
    result_quarter: aggregated.resultQuarter,
  };

  if (existingResult?.id) {
    const { error } = await admin.from("case_tracker_results").update(resultPayload).eq("id", existingResult.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from("case_tracker_results").insert({
      case_id: linkedDocketFlowCaseId(trackerRow),
      tracker_entry_id: input.trackerEntryId,
      release_status: "No",
      closing_status: "No",
      check_status: "No",
      ...resultPayload,
    });
    if (error) throw new Error(error.message);
  }
}

/** Manual disbursement rows (sheet_row_key null) are never deleted by sheet sync. */
async function syncManualDisbursements(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  input: {
    trackerEntryId: string;
    caseId: string | null;
    caseNumber: string;
    expectedDisbursementCount: number;
    rows: ManualDisbursementInput[];
  },
) {
  const weight = disbursementWeight(input.expectedDisbursementCount);
  const { data: existing, error: lookupError } = await admin
    .from("case_tracker_disbursements")
    .select("id")
    .eq("case_number", input.caseNumber)
    .is("sheet_row_key", null);

  if (lookupError) throw new Error(lookupError.message);

  const keepIds = new Set(input.rows.map((row) => row.id).filter((id): id is string => Boolean(id && isUuid(id))));

  for (const row of existing ?? []) {
    const id = toString(row.id, "");
    if (id && !keepIds.has(id)) {
      const { error } = await admin.from("case_tracker_disbursements").delete().eq("id", id);
      if (error) throw new Error(error.message);
    }
  }

  for (const row of input.rows) {
    const payload = {
      tracker_entry_id: input.trackerEntryId,
      case_id: input.caseId && isUuid(input.caseId) ? input.caseId : null,
      case_number: input.caseNumber,
      label: row.partyLabel?.trim() || null,
      settlement_date: row.settlementDate ? toDateOnly(row.settlementDate) : null,
      disburse_date: row.disburseDate ? toDateOnly(row.disburseDate) : null,
      settlement_amount: row.settlementAmount,
      attorney_fees: row.attorneyFees,
      weight,
      pending_remaining: row.pendingRemaining ?? false,
      sheet_row_key: null,
      synced_at: null,
    };

    if (row.id && isUuid(row.id)) {
      const { error } = await admin
        .from("case_tracker_disbursements")
        .update(payload)
        .eq("id", row.id)
        .is("sheet_row_key", null);
      if (error) throw new Error(error.message);
      continue;
    }

    const { error } = await admin.from("case_tracker_disbursements").insert(payload);
    if (error) throw new Error(error.message);
  }
}

const TRACKER_ENTRY_LOOKUP_SELECT = "id,case_id,case_number,expected_disbursement_count,case_stage";

async function backfillTrackerCaseNumber(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  trackerRow: TrackerEntryLookupRow,
  caseNumber: string,
) {
  const normalized = cleanCaseNumber(caseNumber);
  if (!normalized || toString(trackerRow.case_number, "").trim()) return trackerRow;

  const { error } = await admin.from("case_tracker_entries").update({ case_number: normalized }).eq("id", trackerRow.id);
  if (error) throw new Error(error.message);
  return { ...trackerRow, case_number: normalized };
}

async function findTrackerEntryByCaseNumber(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  caseNumber: string,
) {
  const target = cleanCaseNumber(caseNumber);
  if (!target) return null;

  const { data: exactRows, error: exactError } = await admin
    .from("case_tracker_entries")
    .select(TRACKER_ENTRY_LOOKUP_SELECT)
    .eq("case_number", target);

  if (exactError) throw new Error(exactError.message);
  if (exactRows?.[0]) return exactRows[0];

  const { data: allRows, error: allError } = await admin
    .from("case_tracker_entries")
    .select(TRACKER_ENTRY_LOOKUP_SELECT)
    .ilike("case_number", `%${target}%`);

  if (allError) throw new Error(allError.message);
  const fuzzyTrackerMatch = allRows?.find((row) => caseNumbersMatch(toString(row.case_number, ""), target));
  if (fuzzyTrackerMatch) return fuzzyTrackerMatch;

  const { data: exactCaseRows, error: exactCaseError } = await admin
    .from("cases")
    .select("id,case_number")
    .eq("case_number", target);

  if (exactCaseError) throw new Error(exactCaseError.message);

  const { data: fuzzyCaseRows, error: fuzzyCaseError } = await admin
    .from("cases")
    .select("id,case_number")
    .ilike("case_number", `%${target}%`);

  if (fuzzyCaseError) throw new Error(fuzzyCaseError.message);

  const matchingCases = [...(exactCaseRows ?? []), ...(fuzzyCaseRows ?? [])].filter(
    (row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index,
  ).filter((row) => caseNumbersMatch(toString(row.case_number, ""), target));

  for (const caseRow of matchingCases) {
    const { data: trackerByCaseId, error: trackerByCaseError } = await admin
      .from("case_tracker_entries")
      .select(TRACKER_ENTRY_LOOKUP_SELECT)
      .eq("case_id", caseRow.id)
      .maybeSingle();

    if (trackerByCaseError) throw new Error(trackerByCaseError.message);
    if (trackerByCaseId) {
      return backfillTrackerCaseNumber(admin, trackerByCaseId, toString(caseRow.case_number, target));
    }
  }

  return null;
}

async function resolveTrackerEntryForSheetSync(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  item: SettlementSheetCasePayload,
  caseNumber: string,
) {
  const trackerEntryId = item.trackerEntryId?.trim();
  if (trackerEntryId && isUuid(trackerEntryId)) {
    const { data, error } = await admin
      .from("case_tracker_entries")
      .select(TRACKER_ENTRY_LOOKUP_SELECT)
      .eq("id", trackerEntryId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return backfillTrackerCaseNumber(admin, data, caseNumber);
  }

  const docketflowCaseId = item.docketflowCaseId?.trim();
  if (docketflowCaseId && isUuid(docketflowCaseId)) {
    const { data, error } = await admin
      .from("case_tracker_entries")
      .select(TRACKER_ENTRY_LOOKUP_SELECT)
      .eq("case_id", docketflowCaseId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return backfillTrackerCaseNumber(admin, data, caseNumber);
  }

  return findTrackerEntryByCaseNumber(admin, caseNumber);
}

function buildSettlementSyncPartyDetails(
  item: SettlementSheetCasePayload,
): SettlementSheetSyncPartyDetail[] {
  return item.disbursements.map((party) => ({
    label: party.partyLabel,
    settlementDate: party.settlementDate ? toDateOnly(party.settlementDate) : null,
    disburseDate: party.disburseDate ? toDateOnly(party.disburseDate) : null,
    pendingRemaining: party.pendingRemaining ?? false,
    settlementAmount: party.settlementAmount,
    attorneyFees: party.attorneyFees,
  }));
}

function buildSettlementSyncCaseSummary(input: {
  partiesSynced: number;
  settlementDate: string | null;
  disburseDate: string | null;
  settlementAmount: number | null;
  attorneyFees: number | null;
  disbursedStatus: DisbursedStatus;
  pendingPartyCount: number;
  stageAutoSettled: boolean;
}) {
  const parts: string[] = [`${input.partiesSynced} sheet row(s) synced`];
  if (input.settlementDate) parts.push(`settlement date ${input.settlementDate}`);
  if (input.settlementAmount != null) parts.push(`gross ${input.settlementAmount}`);
  if (input.attorneyFees != null) parts.push(`fees ${input.attorneyFees}`);
  if (input.disburseDate) parts.push(`disburse date ${input.disburseDate}`);
  parts.push(`disbursed ${input.disbursedStatus}`);
  if (input.pendingPartyCount > 0) {
    parts.push(`${input.pendingPartyCount} part${input.pendingPartyCount === 1 ? "y" : "ies"} still pending`);
  }
  if (input.stageAutoSettled) parts.push("stage set to Settled");
  return parts.join("; ");
}

/** Apply settlement/disbursement rows from the settlements Google Sheet. */
export async function syncSettlementsFromSheet(
  cases: SettlementSheetCasePayload[],
  options?: { dryRun?: boolean },
): Promise<SettlementSheetSyncResult & { dryRun?: boolean }> {
  const dryRun = Boolean(options?.dryRun);
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required to sync settlements from sheet.");

  let casesProcessed = 0;
  let disbursementsSynced = 0;
  let settlementsUpdated = 0;
  let stagesAutoSettled = 0;
  let skippedNoTracker = 0;
  let skippedFinancialLocked = 0;
  const details: SettlementSheetSyncCaseDetail[] = [];
  const syncedAt = new Date().toISOString();

  for (const item of cases) {
    const caseNumber = cleanCaseNumber(item.caseNumber);
    if (!caseNumber) continue;

    const trackerRow = await resolveTrackerEntryForSheetSync(admin, item, caseNumber);
    if (!trackerRow) {
      skippedNoTracker += 1;
      details.push({
        caseNumber,
        status: "skipped_no_tracker",
        sheetRowCount: item.sheetRowCount,
        parties: buildSettlementSyncPartyDetails(item),
        summary: "No matching tracker row — case must exist in the app first.",
      });
      continue;
    }

    const resolvedCaseNumber = cleanCaseNumber(toString(trackerRow.case_number, "") || caseNumber);
    const trackerEntryId = toString(trackerRow.id, "");
    const linkedCaseId = linkedDocketFlowCaseId(trackerRow);

    const { data: existingResultForLock } = await admin
      .from("case_tracker_results")
      .select("financial_backfill_locked")
      .or(
        linkedCaseId
          ? `tracker_entry_id.eq.${trackerEntryId},case_id.eq.${linkedCaseId}`
          : `tracker_entry_id.eq.${trackerEntryId}`,
      )
      .maybeSingle();

    if (existingResultForLock?.financial_backfill_locked) {
      skippedFinancialLocked += 1;
      details.push({
        caseNumber: resolvedCaseNumber,
        status: "skipped_financial_locked",
        sheetRowCount: item.sheetRowCount,
        parties: buildSettlementSyncPartyDetails(item),
        summary: "Skipped — financial CSV backfill is locked for this case.",
      });
      continue;
    }

    const attorneyExpected = Math.max(1, toNumber(trackerRow.expected_disbursement_count) ?? 1);
    const totalSlots = Math.max(attorneyExpected, item.sheetRowCount);
    const weight = disbursementWeight(totalSlots);

    if (!dryRun) {
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
        .eq("case_number", resolvedCaseNumber)
        .not("sheet_row_key", "is", null);
      if (pruneError) throw new Error(pruneError.message);

      for (const disbursement of item.disbursements) {
        const payload: DisbursementRowPayload = {
          tracker_entry_id: trackerEntryId,
          case_id: linkedCaseId,
          case_number: resolvedCaseNumber,
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
    } else {
      disbursementsSynced += item.disbursements.length;
    }

    let mappedDisbursements: CaseDisbursement[];
    if (dryRun) {
      const { data: manualRows, error: manualError } = await admin
        .from("case_tracker_disbursements")
        .select("*")
        .eq("case_number", resolvedCaseNumber)
        .is("sheet_row_key", null);
      if (manualError) throw new Error(manualError.message);
      const manualDisbursements = (manualRows ?? []).map((row) => disbursementRowToDisbursement(row as DisbursementRow));
      const sheetDisbursements = item.disbursements.map((disbursement) =>
        sheetPayloadDisbursementToCaseDisbursement(disbursement, weight),
      );
      mappedDisbursements = [...manualDisbursements, ...sheetDisbursements];
    } else {
      const { data: allDisbursementRows, error: fetchAllError } = await admin
        .from("case_tracker_disbursements")
        .select("*")
        .eq("case_number", resolvedCaseNumber)
        .order("created_at", { ascending: true });
      if (fetchAllError) throw new Error(fetchAllError.message);
      mappedDisbursements = uniqueDisbursements((allDisbursementRows ?? []) as DisbursementRow[]);
    }
    const partyCount = Math.max(totalSlots, mappedDisbursements.length);
    if (!dryRun && partyCount > totalSlots) {
      const { error: countError } = await admin
        .from("case_tracker_entries")
        .update({
          expected_disbursement_count: partyCount,
          multiple_disbursements_enabled: partyCount > 1,
        })
        .eq("id", trackerEntryId);
      if (countError) throw new Error(countError.message);
    }

    const { data: existingResult } = await admin
      .from("case_tracker_results")
      .select("*")
      .or(
        linkedCaseId
          ? `tracker_entry_id.eq.${trackerEntryId},case_id.eq.${linkedCaseId}`
          : `tracker_entry_id.eq.${trackerEntryId}`,
      )
      .maybeSingle();

    const existingResultModel = rowToResult(existingResult);
    const aggregated = getAggregatedResultFromDisbursements({
      multipleDisbursementsEnabled: partyCount > 1,
      expectedDisbursementCount: partyCount,
      disbursements: mappedDisbursements,
      result: existingResultModel,
    });

    const sheetSettlementDate = item.settlementDate ? toDateOnly(item.settlementDate) : null;
    const sheetDisburseDate = item.latestDisburseDate ? toDateOnly(item.latestDisburseDate) : null;
    const allPartiesSettled = aggregated
      ? Boolean(aggregated.settlementDate)
      : item.disbursements.every((row) => Boolean(row.settlementDate));
    const allPartiesDisbursed = aggregated
      ? aggregated.disbursedStatus === "Yes"
      : item.disbursements.length >= totalSlots &&
        item.disbursements.every((row) => Boolean(row.disburseDate) && !row.pendingRemaining);

    const totalSettlementAmount =
      aggregated?.settlementAmount ?? item.totalSettlementAmount ?? toNumber(existingResult?.settlement_amount);
    const totalAttorneyFees =
      aggregated?.attorneyFees ?? item.totalAttorneyFees ?? toNumber(existingResult?.attorney_fees);
    const feePercent =
      totalSettlementAmount != null && totalAttorneyFees != null && totalSettlementAmount > 0
        ? totalAttorneyFees / totalSettlementAmount
        : toNumber(existingResult?.fee_percent);

    const resolvedSettlementDate =
      aggregated?.settlementDate ??
      (item.fullSettlement && sheetSettlementDate
        ? sheetSettlementDate
        : allPartiesSettled && sheetSettlementDate
          ? sheetSettlementDate
          : null);
    const resolvedDisburseDate =
      aggregated?.disburseDate ??
      (allPartiesDisbursed && sheetDisburseDate ? toDateOnly(sheetDisburseDate) : null);
    const resolvedDisbursedStatus = aggregated?.disbursedStatus ?? (allPartiesDisbursed ? "Yes" : "No");
    const resolvedCheckDisbursedAt =
      aggregated?.checkDisbursedAt ??
      (allPartiesDisbursed && resolvedDisburseDate
        ? new Date(`${resolvedDisburseDate}T12:00:00.000Z`).toISOString()
        : null);
    const resolvedResultQuarter =
      aggregated?.resultQuarter ??
      (resolvedDisburseDate ? deriveResultQuarterFromDisburseDate(resolvedDisburseDate) : null);

    const resultPayload = {
      case_id: linkedCaseId,
      tracker_entry_id: trackerEntryId,
      settlement_date: resolvedSettlementDate ? toDateOnly(resolvedSettlementDate) : null,
      settlement_amount: totalSettlementAmount,
      attorney_fees: totalAttorneyFees,
      fee_percent: feePercent,
      disburse_date: resolvedDisburseDate ? toDateOnly(resolvedDisburseDate) : null,
      check_disbursed_at: resolvedCheckDisbursedAt,
      disbursed_status: resolvedDisbursedStatus,
      result_quarter: resolvedResultQuarter,
    };

    if (!dryRun) {
      if (existingResult) {
        const { error } = await admin.from("case_tracker_results").update(resultPayload).eq("id", existingResult.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await admin.from("case_tracker_results").insert(resultPayload);
        if (error) throw new Error(error.message);
      }
    }

    casesProcessed += 1;
    if (resolvedSettlementDate || resolvedDisburseDate) settlementsUpdated += 1;

    let stageAutoSettled = false;
    if (resolvedSettlementDate && item.fullSettlement) {
      const currentStage = normalizeStage(toStringOrNull(trackerRow.case_stage));
      if (currentStage !== "Settled") {
        stageAutoSettled = true;
        if (!dryRun) {
          const record = await getCaseById(linkedCaseId ?? trackerEntryId);
          if (record) {
            const patch = buildStagePatchFromConfirmation(record, "Settled");
            await updateTrackerEntry(linkedCaseId ?? trackerEntryId, patch, {
              actor: { userName: "Disbursing spreadsheet sync" },
              markReviewed: true,
              changeInput: patch,
            });
            stagesAutoSettled += 1;
          }
        } else {
          stagesAutoSettled += 1;
        }
      }
    }

    const pendingPartyCount = item.disbursements.filter((row) => row.pendingRemaining).length;
    details.push({
      caseNumber: resolvedCaseNumber,
      status: "synced",
      sheetRowCount: item.sheetRowCount,
      partiesSynced: item.disbursements.length,
      settlementDate: resultPayload.settlement_date,
      disburseDate: resultPayload.disburse_date,
      settlementAmount: totalSettlementAmount,
      attorneyFees: totalAttorneyFees,
      disbursedStatus: resolvedDisbursedStatus,
      resultQuarter: resolvedResultQuarter,
      stageAutoSettled,
      pendingPartyCount,
      expectedPartyCount: partyCount,
      parties: buildSettlementSyncPartyDetails(item),
      summary: buildSettlementSyncCaseSummary({
        partiesSynced: item.disbursements.length,
        settlementDate: resultPayload.settlement_date,
        disburseDate: resultPayload.disburse_date,
        settlementAmount: totalSettlementAmount,
        attorneyFees: totalAttorneyFees,
        disbursedStatus: resolvedDisbursedStatus,
        pendingPartyCount,
        stageAutoSettled,
      }),
    });
  }

  return {
    casesProcessed,
    disbursementsSynced,
    settlementsUpdated,
    stagesAutoSettled,
    skippedNoTracker,
    skippedFinancialLocked,
    sheetCasesFound: cases.length,
    details,
    dryRun,
  };
}

export async function createTrackerComment(
  input: Omit<TrackerComment, "id" | "createdAt">,
): Promise<{ comment: TrackerComment; activity: ActivityLogEntry | null }> {
  const client = (await createSupabaseAdminClient()) ?? (await createTrackerClient());

  const authorName = input.authorName?.trim() || "Unknown user";
  const record = await getCaseById(input.caseId);
  const link = record ? trackerActivityLink(record) : { caseId: input.caseId, trackerEntryId: input.caseId };
  const basePayload = {
    case_id: link.caseId,
    tracker_entry_id: link.trackerEntryId,
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
    record,
  );

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
  const existing = await getCaseById(caseId);
  if (!existing) return { applied: false as const, reason: "Case not found." };

  const parsed = parseSlackThreadUpdate(text, { currentTargetQuarter: existing.tracker.targetResolutionQuarter });
  if (!parsed) return { applied: false as const, reason: "No recognizable tracker fields in thread reply." };

  if (parsed.validationErrors.length > 0) {
    return { applied: false as const, reason: "validation_failed", validationErrors: parsed.validationErrors };
  }

  if (parsed.shared?.caseType) {
    await updateSharedCaseFields(caseId, { caseType: parsed.shared.caseType });
  }

  const hasTrackerPatch = Object.keys(parsed.tracker).length > 0;
  if (hasTrackerPatch) {
    await updateTrackerEntry(caseId, parsed.tracker, {
      actor: actor ?? { userName: "Slack thread" },
      markReviewed: true,
      changeInput: parsed.tracker,
      shared: parsed.shared?.caseType ? { caseType: parsed.shared.caseType } : undefined,
    });
  } else if (parsed.shared?.caseType) {
    await createActivityEntry(
      caseId,
      "Slack thread update",
      `Updated Case type.`,
      actor ?? { userName: "Slack thread" },
      { source: "slack_thread" },
    );
  }

  const labels = [
    ...describeSlackThreadSharedLabels(parsed.shared),
    ...describeSlackThreadAppliedLabels(parsed.tracker),
  ];

  return { applied: true as const, labels };
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
  goalScope?: GoalScope;
  year: number;
  annualGrossGoal: number;
  annualRjlFeesGoal: number;
  commissionThreshold: number;
  commissionYearStartMonth?: number;
  commissionMonthCount?: number;
  monthlyGoals?: Record<string, number>;
  monthlyFeeGoals?: Record<string, number>;
  q1Goal: number;
  q2Goal: number;
  q3Goal: number;
  q4Goal: number;
  feeQ1Goal: number;
  feeQ2Goal: number;
  feeQ3Goal: number;
  feeQ4Goal: number;
};

function parseMonthlyGoalsRow(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const monthlyGoals: Record<string, number> = {};
  for (const [monthKey, raw] of Object.entries(value as Record<string, unknown>)) {
    const amount = Number(raw);
    if (Number.isFinite(amount)) monthlyGoals[monthKey] = amount;
  }
  return monthlyGoals;
}

export async function upsertAttorneyGoal(input: AttorneyGoalInput): Promise<AttorneyGoal> {
  const client = await createTrackerClient();
  const goalScope = normalizeGoalScope(input.goalScope);
  const isFirmGoal = goalScope === "firm";
  const annualGrossGoal = input.q1Goal + input.q2Goal + input.q3Goal + input.q4Goal;
  const annualRjlFeesGoal = input.feeQ1Goal + input.feeQ2Goal + input.feeQ3Goal + input.feeQ4Goal;
  const monthlyGoals = input.monthlyGoals ?? {};
  const monthlyFeeGoals = input.monthlyFeeGoals ?? {};

  const commissionYearStartMonth = Math.min(12, Math.max(1, Number(input.commissionYearStartMonth ?? 1)));
  const commissionMonthCount = Number(input.commissionMonthCount ?? 12) === 13 ? 13 : 12;

  const payload = {
    attorney_name: isFirmGoal ? FIRM_OUTPERFORM_GOAL_ATTORNEY_NAME : input.attorneyName,
    attorney_user_id: isFirmGoal ? null : input.attorneyId || null,
    goal_scope: goalScope,
    year: input.year,
    annual_fee_goal: annualGrossGoal,
    commission_threshold: isFirmGoal ? 0 : input.commissionThreshold,
    commission_year_start_month: commissionYearStartMonth,
    commission_month_count: commissionMonthCount,
    monthly_goals: monthlyGoals,
    monthly_fee_goals: monthlyFeeGoals,
    q1_goal: input.q1Goal,
    q2_goal: input.q2Goal,
    q3_goal: input.q3Goal,
    q4_goal: input.q4Goal,
    fee_q1_goal: input.feeQ1Goal,
    fee_q2_goal: input.feeQ2Goal,
    fee_q3_goal: input.feeQ3Goal,
    fee_q4_goal: input.feeQ4Goal,
  };

  const { data, error } = await client
    .from("attorney_goals")
    .upsert(payload, { onConflict: "attorney_name,year" })
    .select("*")
    .single();

  if (error) throw error;

  return {
    id: toString(data.id, "goal"),
    attorneyId: isFirmGoal ? FIRM_OUTPERFORM_GOAL_ATTORNEY_ID : input.attorneyId,
    goalScope,
    year: input.year,
    annualGrossGoal,
    annualRjlFeesGoal,
    commissionThreshold: Number(data.commission_threshold ?? 0),
    commissionYearStartMonth: Number(data.commission_year_start_month ?? 1),
    commissionMonthCount: Number(data.commission_month_count ?? 12) === 13 ? 13 : 12,
    monthlyGoals: parseMonthlyGoalsRow(data.monthly_goals),
    monthlyFeeGoals: parseMonthlyGoalsRow(data.monthly_fee_goals),
    q1Goal: Number(data.q1_goal ?? 0),
    q2Goal: Number(data.q2_goal ?? 0),
    q3Goal: Number(data.q3_goal ?? 0),
    q4Goal: Number(data.q4_goal ?? 0),
    feeQ1Goal: Number(data.fee_q1_goal ?? 0),
    feeQ2Goal: Number(data.fee_q2_goal ?? 0),
    feeQ3Goal: Number(data.fee_q3_goal ?? 0),
    feeQ4Goal: Number(data.fee_q4_goal ?? 0),
  };
}

export async function deleteAttorneyGoal(goalId: string): Promise<void> {
  const client = await createTrackerClient();
  const { error } = await client.from("attorney_goals").delete().eq("id", goalId);
  if (error) throw error;
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
    const goalScope = normalizeGoalScope(row.goal_scope);
    const isFirmGoal = goalScope === "firm";
    const attorneyName = toStringOrNull(row.attorney_name);
    const matchedContact =
      isFirmGoal || !attorneyName
        ? null
        : attorneys.find((contact) => contact.name && namesMatch(contact.name, attorneyName));
    const commissionThreshold = Number(row.commission_threshold ?? 0);
    const q1Goal = Number(row.q1_goal ?? 0);
    const q2Goal = Number(row.q2_goal ?? 0);
    const q3Goal = Number(row.q3_goal ?? 0);
    const q4Goal = Number(row.q4_goal ?? 0);
    const feeQ1Goal = Number(row.fee_q1_goal ?? 0);
    const feeQ2Goal = Number(row.fee_q2_goal ?? 0);
    const feeQ3Goal = Number(row.fee_q3_goal ?? 0);
    const feeQ4Goal = Number(row.fee_q4_goal ?? 0);

    const monthlyGoals = parseMonthlyGoalsRow(row.monthly_goals);
    const monthlyFeeGoals = parseMonthlyGoalsRow(row.monthly_fee_goals);

    return {
      id: toStringOrNull(row.id) ?? "unknown-goal",
      attorneyId: isFirmGoal
        ? FIRM_OUTPERFORM_GOAL_ATTORNEY_ID
        : matchedContact?.id ?? toStringOrNull(row.attorney_user_id) ?? attorneyName ?? "unknown-attorney",
      goalScope,
      year: Number(row.year ?? new Date().getFullYear()),
      annualGrossGoal: q1Goal + q2Goal + q3Goal + q4Goal,
      annualRjlFeesGoal: feeQ1Goal + feeQ2Goal + feeQ3Goal + feeQ4Goal,
      commissionThreshold,
      commissionYearStartMonth: Number(row.commission_year_start_month ?? 1),
      commissionMonthCount: Number(row.commission_month_count ?? 12) === 13 ? 13 : 12,
      monthlyGoals,
      monthlyFeeGoals,
      q1Goal,
      q2Goal,
      q3Goal,
      q4Goal,
      feeQ1Goal,
      feeQ2Goal,
      feeQ3Goal,
      feeQ4Goal,
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
  record?: CaseRecord | null,
): Promise<ActivityLogEntry | null> {
  const client = await createTrackerClient();

  const resolvedRecord = record ?? (await getCaseById(caseId));
  const fallbackTrackerEntryId =
    typeof metadata?.trackerEntryId === "string" && isUuid(metadata.trackerEntryId) ? metadata.trackerEntryId : caseId;
  const link = resolvedRecord
    ? trackerActivityLink(resolvedRecord)
    : {
        caseId: fallbackTrackerEntryId === caseId ? null : caseId,
        trackerEntryId: fallbackTrackerEntryId,
      };

  const { data, error } = await client
    .from("case_tracker_activity")
    .insert({
      case_id: link.caseId,
      tracker_entry_id: link.trackerEntryId,
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
  const linkedCaseId = linkedDocketFlowCaseId(trackerRow);
  const normalized = applyDerivedSettlementResult(result, trackerFieldsFromRow(trackerRow), {
    skipDisbursementAggregation: true,
  });

  const payload = {
    case_id: linkedCaseId,
    tracker_entry_id: trackerEntryId || null,
    settlement_date: normalized.settlementDate ? toDateOnly(normalized.settlementDate) : null,
    settlement_amount: normalized.settlementAmount,
    fee_percent: normalized.feePercent,
    attorney_fees: normalized.attorneyFees,
    release_status: normalized.releaseStatus,
    closing_status: normalized.closingStatus,
    check_status: normalized.checkStatus,
    disbursed_status: normalized.disbursedStatus,
    reductions_status: normalized.reductionsStatus,
    release_signed_at: normalized.releaseSignedAt,
    closing_signed_at: normalized.closingSignedAt,
    check_deposited_at: normalized.checkDepositedAt,
    check_disbursed_at: normalized.checkDisbursedAt,
    disburse_date: normalized.disburseDate ? toDateOnly(normalized.disburseDate) : null,
    result_quarter: normalized.resultQuarter,
  };

  const lookupFilter = linkedCaseId
    ? `tracker_entry_id.eq.${trackerEntryId},case_id.eq.${linkedCaseId}`
    : `tracker_entry_id.eq.${trackerEntryId}`;

  const { data: existing, error: lookupError } = await client
    .from("case_tracker_results")
    .select("*")
    .or(lookupFilter)
    .maybeSingle();

  if (lookupError) throw lookupError;

  if (existing) {
    const { data, error } = await client
      .from("case_tracker_results")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as ResultRow;
  }

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
    return rowToCaseRecord(caseRow, trackerRow, resultRow, contacts, uniqueSuggestionRows([
      ...(suggestionsByTrackerId.get(trackerId) ?? []),
      ...(suggestionsByCaseId.get(caseRow.id) ?? []),
    ]), [
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
      status: deriveCaseStatusFromTracker(tracker.caseStage, tracker.result),
      caseType: caseTypeFromCasesTable(
        caseRow ? caseRow.case_type : toStringOrNull(trackerRow.case_type),
      ),
      dateSigned: normalizeDate(toStringOrNull(trackerRow.date_signed_override) ?? caseRow?.created_at),
      dateOfIncident: normalizeOptionalDate(
        caseRow?.date_of_incident ?? toStringOrNull(trackerRow.date_of_incident_override),
      ),
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
    sheetRowKey: toStringOrNull(row.sheet_row_key),
    disburseDateLocked: toBoolean(row.disburse_date_locked, false),
    settlementDateLocked: toBoolean(row.settlement_date_locked, false),
    syncedAt: toStringOrNull(row.synced_at),
  };
}

function sheetPayloadDisbursementToCaseDisbursement(
  disbursement: SettlementSheetCasePayload["disbursements"][number],
  weight: number,
): CaseDisbursement {
  return {
    id: `preview-${disbursement.sheetRowKey}`,
    partyLabel: disbursement.partyLabel ?? "",
    disburseDate: disbursement.disburseDate,
    settlementDate: disbursement.settlementDate,
    settlementAmount: disbursement.settlementAmount,
    attorneyFees: disbursement.attorneyFees,
    weight,
    pendingRemaining: disbursement.pendingRemaining ?? false,
    sheetRowKey: disbursement.sheetRowKey,
    disburseDateLocked: false,
    settlementDateLocked: false,
    syncedAt: null,
  };
}

function uniqueSuggestionRows(rows: SuggestionRow[]) {
  const byId = new Map<string, SuggestionRow>();
  for (const row of rows) {
    const id = toString(row.id, "");
    if (id) byId.set(id, row);
  }
  return [...byId.values()];
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
  const result = applyDerivedSettlementResult(entry.result, entry);
  const withFallback = applyOpenSettledTrackerFallback({ ...entry, result });
  return {
    ...withFallback,
    actualFeeValue: withFallback.result.attorneyFees ?? entry.actualFeeValue,
  };
}

function rowToResult(row: ResultRow | null): SettlementResult {
  const disburseDate = toStringOrNull(row?.disburse_date);
  return applyDerivedResultFields({
    settlementDate: toStringOrNull(row?.settlement_date),
    settlementAmount: toNumber(row?.settlement_amount),
    feePercent: toNumber(row?.fee_percent),
    attorneyFees: toNumber(row?.attorney_fees) ?? calculateAttorneyFees(toNumber(row?.settlement_amount), toNumber(row?.fee_percent)),
    releaseStatus: normalizeReleaseStatus(toStringOrNull(row?.release_status), toStringOrNull(row?.release_signed_at)),
    closingStatus: normalizeClosingStatus(toStringOrNull(row?.closing_status), toStringOrNull(row?.closing_signed_at)),
    checkStatus: normalizeCheckStatus(toStringOrNull(row?.check_status), toStringOrNull(row?.check_deposited_at)),
    disbursedStatus: normalizeDisbursedStatus(toStringOrNull(row?.disbursed_status), toStringOrNull(row?.check_disbursed_at), disburseDate),
    reductionsStatus: coerceReductionsStatus(toStringOrNull(row?.reductions_status)),
    releaseSignedAt: toStringOrNull(row?.release_signed_at),
    closingSignedAt: toStringOrNull(row?.closing_signed_at),
    checkDepositedAt: toStringOrNull(row?.check_deposited_at),
    checkDisbursedAt: toStringOrNull(row?.check_disbursed_at),
    disburseDate,
    resultQuarter: toStringOrNull(row?.result_quarter),
    financialBackfillLocked: toBoolean(row?.financial_backfill_locked, false),
  });
}

function makeEmptyTrackerRow(caseRow: DocketFlowCaseRow): TrackerEntryRow {
  return {
    id: `pending-${caseRow.id}`,
    case_id: caseRow.id,
    case_stage: "Onboarding",
    expected_litigation: null,
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

/** Linked DocketFlow cases use the shared case id; orphan tracker rows reuse the tracker id as shared.id. */
function isLinkedDocketFlowCase(record: CaseRecord) {
  return record.shared.id !== record.tracker.id;
}

/** case_tracker_results.case_id must reference public.cases — only set when the tracker row is linked. */
function linkedDocketFlowCaseId(trackerRow: TrackerEntryRow | UnknownRow): string | null {
  const caseId = toStringOrNull(trackerRow.case_id);
  return caseId && isUuid(caseId) ? caseId : null;
}

function buildCaseBackfillLookup(records: CaseRecord[]) {
  const byCaseNumber = new Map<string, CaseRecord>();

  for (const record of records) {
    const caseNumber = cleanCaseNumber(record.shared.caseNumber);
    if (!caseNumber) continue;

    const existing = byCaseNumber.get(caseNumber);
    if (!existing) {
      byCaseNumber.set(caseNumber, record);
      continue;
    }

    const linked = isLinkedDocketFlowCase(record);
    const existingLinked = isLinkedDocketFlowCase(existing);
    if (linked && !existingLinked) {
      byCaseNumber.set(caseNumber, record);
    }
  }

  return byCaseNumber;
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
  const row: Record<string, unknown> = {};

  if (input.caseStage !== undefined) row.case_stage = toDatabaseStage(input.caseStage);
  if (input.minimumValue !== undefined || input.estimatedSettlementValue !== undefined) {
    row.minimum_value = input.minimumValue ?? input.estimatedSettlementValue;
  }
  if (input.estimatedFeeValue !== undefined) row.estimated_fee_value = input.estimatedFeeValue;
  if (input.targetResolutionQuarter !== undefined) row.target_resolution_quarter = input.targetResolutionQuarter;
  if (input.confidenceLevel !== undefined) row.confidence_level = input.confidenceLevel;
  if (input.sourceOfEstimate !== undefined) row.source_of_estimate = input.sourceOfEstimate;
  if (input.liability !== undefined) row.liability = input.liability;
  if (input.caseSize !== undefined) row.case_size = input.caseSize;
  if (input.referralFee !== undefined) row.referral_fee = input.referralFee;
  if (input.referralFeeArrangement !== undefined) row.referral_fee_arrangement = input.referralFeeArrangement;
  if (input.balanceCtaInfo !== undefined) row.balance_cta_info = input.balanceCtaInfo;
  if (input.policyLimits !== undefined) row.policy_limits = input.policyLimits;
  if (input.policyInfoSource !== undefined) row.policy_info_source = input.policyInfoSource;
  if (input.expectedLitigation !== undefined) row.expected_litigation = toDatabaseExpectedLitigation(input.expectedLitigation);
  if (input.sources !== undefined) row.sources = input.sources;
  if (input.injuries !== undefined) row.injuries = input.injuries;
  if (input.caseDescription !== undefined) row.case_description = input.caseDescription;
  if (input.statusNotes !== undefined) row.status_notes = input.statusNotes;
  if (input.gvNotes !== undefined) row.gv_notes = input.gvNotes;
  if (input.lrjNotes !== undefined) row.lrj_notes = input.lrjNotes;
  if (input.lastQuarterlyCheckInAt !== undefined) row.last_quarterly_check_in_at = input.lastQuarterlyCheckInAt;
  if (input.lastSourcesLitUpdatedAt !== undefined) row.last_sources_lit_updated_at = input.lastSourcesLitUpdatedAt;
  if (input.forecastNotes !== undefined) row.forecast_notes = input.forecastNotes;
  if (input.multipleDisbursementsEnabled !== undefined) {
    row.multiple_disbursements_enabled = input.multipleDisbursementsEnabled;
  }
  if (input.expectedDisbursementCount !== undefined) {
    row.expected_disbursement_count = Math.max(1, Math.trunc(input.expectedDisbursementCount));
  }
  if (markReviewed) row.last_reviewed_at = new Date().toISOString();

  return row;
}

function isUuid(value: string | null | undefined) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hasPersistedTrackerEntry(tracker: TrackerEntry | null | undefined) {
  if (!tracker?.id) return false;
  return isUuid(tracker.id) && !tracker.id.startsWith("pending-");
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
    suggestedExpectedLitigation: normalizeExpectedLitigation(toStringOrNull(row.suggested_expected_litigation)) ?? "Pre",
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
    return Number.isNaN(parsed.getTime()) ? null : toDateOnly(parsed.toISOString());
  }
  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : toDateOnly(parsed.toISOString());
}

function toDateOnly(value: string) {
  return value.slice(0, 10);
}

function normalizeCaseStatus(value: string | null | undefined): CaseStatus {
  const normalized = value?.toLowerCase();
  return normalized === "closed" || normalized === "inactive" || normalized === "disengaged" || normalized === "archived" ? "Closed" : "Active";
}

async function syncDerivedSharedCaseStatus(caseId: string, tracker: TrackerEntry, record?: CaseRecord | null) {
  const resolved = record ?? (await getCaseById(caseId));
  if (!resolved || isOrphanTrackerRecord(resolved)) return;

  const status = deriveCaseStatusFromTracker(tracker.caseStage, tracker.result);
  await updateSharedCaseFields(resolved.shared.id, {}, { explicitStatus: status });
}

export function normalizeStage(value: string | null | undefined): CaseStage {
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

export function normalizeExpectedLitigation(value: string | null | undefined): ExpectedLitigationStatus | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  if (normalized === "lit" || normalized === "litigation") return "Lit";
  if (normalized === "expect" || normalized === "expected litigation" || normalized === "expected") return "Expect";
  if (normalized === "pre" || normalized === "pre-lit" || normalized === "prelit") return "Pre";
  return null;
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

function normalizeDisbursedStatus(
  value: string | null | undefined,
  disbursedAt: string | null,
  disburseDate: string | null,
): DisbursedStatus {
  if (!disburseDate?.trim()) return "No";
  return value === "Yes" || disbursedAt ? "Yes" : "No";
}

function calculateAttorneyFees(settlementAmount: number | null, feePercent: number | null) {
  if (settlementAmount == null || feePercent == null) return null;
  return Math.round(settlementAmount * feePercent);
}

export function toDatabaseStage(value: CaseStage | undefined) {
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

export function toDatabaseExpectedLitigation(value: ExpectedLitigationStatus | null | undefined) {
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
