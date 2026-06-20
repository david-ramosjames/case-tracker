import { getAttorneyCommissionStartMonth } from "@/lib/auth/access";
import {
  getCurrentCommissionYear,
  getRecordDisburseDate,
  isDateInCalendarYear,
  isDateInCommissionYear,
} from "@/lib/commission-year";
import {
  getCaseAttorneyFees,
  getDisbursementAttorneyFees,
  getDisbursementSettlementAmount,
  hasMultipleDisbursements,
} from "@/lib/disbursements";
import { getAttorneyOnlyGoals } from "@/lib/firm-goals";
import { type AttorneyGoal, type CaseDisbursement, type CaseRecord } from "@/lib/types";

export type ResultsPartyPeriodStatus = "disbursed_in_period" | "open_undisbursed" | "prior_period_excluded";

/** Plain-language rules shown on the Results page. */
export const RESULTS_TAB_VISIBILITY_RULES = [
  "Disbursement in the current calendar year or the attorney commission year.",
  "Open settlements waiting to disburse — any settlement date.",
  "Multi-party cases show until every party has disbursed or is open.",
  "Fully disbursed and closed cases stay visible when disbursed in period.",
] as const;

export const RESULTS_TAB_AMOUNT_RULES = [
  "Gross Settlement $ and RJL Fees = disbursed this period plus expected open amounts.",
  "Period = current calendar year or the attorney commission year (either qualifies).",
  "Case total hints show the full case across all parties and years.",
] as const;

export type ResultsPeriodContext = {
  calendarYear: number;
  commissionYear: number;
  startMonth: number;
};

export type OutputPeriodContext = {
  mode: "calendar" | "commission";
  periodYear: number;
  startMonth: number;
};

type PartySlice = {
  party: CaseDisbursement | null;
  legacy: boolean;
};

function listPartySlices(record: CaseRecord): PartySlice[] {
  if (record.tracker.disbursements.length > 0) {
    return record.tracker.disbursements.map((party) => ({ party, legacy: false }));
  }
  return [{ party: null, legacy: true }];
}

function isPartySettled(party: CaseDisbursement): boolean {
  return Boolean(party.settlementDate) || (party.settlementAmount ?? 0) > 0 || party.pendingRemaining;
}

function isPartyDisbursed(party: CaseDisbursement): boolean {
  return Boolean(party.disburseDate?.trim()) && !party.pendingRemaining;
}

function isLegacySettled(record: CaseRecord): boolean {
  const result = record.tracker.result;
  return Boolean(result.settlementDate) || (result.settlementAmount ?? 0) > 0;
}

function isLegacyDisbursed(record: CaseRecord): boolean {
  return Boolean(getRecordDisburseDate(record.tracker.result));
}

export function isDateInResultsPeriod(
  dateValue: string | null | undefined,
  context: ResultsPeriodContext,
): boolean {
  return (
    isDateInCalendarYear(dateValue, context.calendarYear) ||
    isDateInCommissionYear(dateValue, context.commissionYear, context.startMonth)
  );
}

export function isDateInOutputPeriod(dateValue: string | null | undefined, context: OutputPeriodContext): boolean {
  if (context.mode === "calendar") {
    return isDateInCalendarYear(dateValue, context.periodYear);
  }
  return isDateInCommissionYear(dateValue, context.periodYear, context.startMonth);
}

export function resolveResultsPeriodContext(
  record: CaseRecord,
  goals: AttorneyGoal[],
  refDate = new Date(),
): ResultsPeriodContext {
  const attorneyGoals = getAttorneyOnlyGoals(goals);
  const startMonth = getAttorneyCommissionStartMonth(attorneyGoals, record.shared.attorneyId);
  const goal =
    attorneyGoals.find(
      (item) =>
        item.attorneyId === record.shared.attorneyId &&
        item.year === getCurrentCommissionYear(startMonth, refDate),
    ) ?? null;

  return {
    calendarYear: refDate.getFullYear(),
    commissionYear: goal?.year ?? getCurrentCommissionYear(startMonth, refDate),
    startMonth: goal?.commissionYearStartMonth ?? startMonth,
  };
}

export function resolveOutputPeriodContextForRecord(
  record: CaseRecord,
  mode: OutputPeriodContext["mode"],
  periodYear: number,
  goalsByAttorney: Map<string, AttorneyGoal>,
  attorneyGoals: AttorneyGoal[],
): OutputPeriodContext {
  const goal = goalsByAttorney.get(record.shared.attorneyId);
  const startMonth =
    goal?.commissionYearStartMonth ??
    getAttorneyCommissionStartMonth(attorneyGoals, record.shared.attorneyId);

  return { mode, periodYear, startMonth };
}

function getPartyGrossSettlement(party: CaseDisbursement | null, legacy: boolean, record: CaseRecord) {
  if (party) return getDisbursementSettlementAmount(party, record);
  return record.tracker.result.settlementAmount ?? 0;
}

function getPartyRjlFees(party: CaseDisbursement | null, legacy: boolean, record: CaseRecord) {
  if (party) return getDisbursementAttorneyFees(party, record);
  return getCaseAttorneyFees(record);
}

function getPartyDisburseDate(party: CaseDisbursement | null, legacy: boolean, record: CaseRecord) {
  if (party) return party.disburseDate;
  return getRecordDisburseDate(record.tracker.result);
}

function getPartySettlementDate(party: CaseDisbursement | null, legacy: boolean, record: CaseRecord) {
  if (party) return party.settlementDate;
  return record.tracker.result.settlementDate;
}

export function getPartyResultsPeriodStatus(
  slice: PartySlice,
  record: CaseRecord,
  context: ResultsPeriodContext,
): ResultsPartyPeriodStatus {
  const { party, legacy } = slice;

  if (legacy) {
    const disburseDate = getRecordDisburseDate(record.tracker.result);
    if (disburseDate) {
      return isDateInResultsPeriod(disburseDate, context)
        ? "disbursed_in_period"
        : "prior_period_excluded";
    }
    return isLegacySettled(record) ? "open_undisbursed" : "prior_period_excluded";
  }

  if (!party) return "prior_period_excluded";

  if (isPartyDisbursed(party)) {
    return isDateInResultsPeriod(party.disburseDate, context)
      ? "disbursed_in_period"
      : "prior_period_excluded";
  }

  return isPartySettled(party) ? "open_undisbursed" : "prior_period_excluded";
}

export function getPartyOutputPeriodStatus(
  slice: PartySlice,
  record: CaseRecord,
  context: OutputPeriodContext,
): ResultsPartyPeriodStatus {
  const { party, legacy } = slice;

  if (legacy) {
    const disburseDate = getRecordDisburseDate(record.tracker.result);
    if (disburseDate) {
      return isDateInOutputPeriod(disburseDate, context)
        ? "disbursed_in_period"
        : "prior_period_excluded";
    }
    return isLegacySettled(record) ? "open_undisbursed" : "prior_period_excluded";
  }

  if (!party) return "prior_period_excluded";

  if (isPartyDisbursed(party)) {
    return isDateInOutputPeriod(party.disburseDate, context)
      ? "disbursed_in_period"
      : "prior_period_excluded";
  }

  return isPartySettled(party) ? "open_undisbursed" : "prior_period_excluded";
}

function sumResultsPartyAmounts(
  record: CaseRecord,
  context: ResultsPeriodContext,
  includeOpen: boolean,
) {
  let settlementAmount = 0;
  let attorneyFees = 0;

  for (const slice of listPartySlices(record)) {
    const status = getPartyResultsPeriodStatus(slice, record, context);
    const counts =
      status === "disbursed_in_period" || (includeOpen && status === "open_undisbursed");
    if (!counts) continue;

    settlementAmount += getPartyGrossSettlement(slice.party, slice.legacy, record);
    attorneyFees += getPartyRjlFees(slice.party, slice.legacy, record);
  }

  return { settlementAmount, attorneyFees };
}

function sumOutputPartyAmounts(
  record: CaseRecord,
  context: OutputPeriodContext,
  includeOpen: boolean,
) {
  let settlementAmount = 0;
  let attorneyFees = 0;

  for (const slice of listPartySlices(record)) {
    const status = getPartyOutputPeriodStatus(slice, record, context);
    const counts =
      status === "disbursed_in_period" || (includeOpen && status === "open_undisbursed");
    if (!counts) continue;

    settlementAmount += getPartyGrossSettlement(slice.party, slice.legacy, record);
    attorneyFees += getPartyRjlFees(slice.party, slice.legacy, record);
  }

  return { settlementAmount, attorneyFees };
}

export function getResultsPeriodAmounts(record: CaseRecord, goals: AttorneyGoal[], refDate = new Date()) {
  const context = resolveResultsPeriodContext(record, goals, refDate);
  const amounts = sumResultsPartyAmounts(record, context, true);
  const feePercent =
    amounts.settlementAmount > 0 ? amounts.attorneyFees / amounts.settlementAmount : null;
  return { ...amounts, feePercent, context };
}

export function getCaseTotalAmounts(record: CaseRecord) {
  let settlementAmount = 0;
  let attorneyFees = 0;

  for (const slice of listPartySlices(record)) {
    settlementAmount += getPartyGrossSettlement(slice.party, slice.legacy, record);
    attorneyFees += getPartyRjlFees(slice.party, slice.legacy, record);
  }

  return { settlementAmount, attorneyFees };
}

function hasResultsSettlementOrDisbursementActivity(record: CaseRecord) {
  const { tracker } = record;
  const result = tracker.result;

  if (tracker.disbursements.length > 0) return true;
  if (result.settlementDate || result.disburseDate) return true;
  if ((result.settlementAmount ?? 0) > 0 || (result.attorneyFees ?? 0) > 0) return true;

  return false;
}

export function recordQualifiesForResultsTab(record: CaseRecord, goals: AttorneyGoal[], refDate = new Date()) {
  if (!hasResultsSettlementOrDisbursementActivity(record)) return false;

  const context = resolveResultsPeriodContext(record, goals, refDate);

  for (const slice of listPartySlices(record)) {
    const status = getPartyResultsPeriodStatus(slice, record, context);
    if (status === "disbursed_in_period" || status === "open_undisbursed") {
      return true;
    }
  }

  return false;
}

export function getOutputDisbursedAmounts(
  record: CaseRecord,
  context: OutputPeriodContext,
) {
  return sumOutputPartyAmounts(record, context, false);
}

export function getOutputSettledAmounts(
  record: CaseRecord,
  context: OutputPeriodContext,
) {
  return sumOutputPartyAmounts(record, context, true);
}

export function recordHasMultipleDisbursementParties(record: CaseRecord) {
  return hasMultipleDisbursements(record.tracker);
}

export type OutputAuditRow = {
  caseNumber: string;
  clientName: string;
  attorneyName: string;
  periodMode: string;
  periodLabel: string;
  partyLabel: string;
  periodStatus: ResultsPartyPeriodStatus;
  settlementDate: string;
  disburseDate: string;
  grossSettlementInPeriod: number;
  rjlFeesInPeriod: number;
  countsTowardDisbursed: boolean;
  countsTowardSettled: boolean;
  caseTotalGrossSettlement: number;
  caseTotalRjlFees: number;
  multiDisbursement: boolean;
  financialBackfillLocked: boolean;
};

function formatAuditDate(value: string | null) {
  if (!value?.trim()) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

export function buildOutputAuditRows(
  records: CaseRecord[],
  options: {
    mode: OutputPeriodContext["mode"];
    periodYear: number;
    periodLabel: string;
    goalsByAttorney: Map<string, AttorneyGoal>;
    attorneyGoals: AttorneyGoal[];
  },
): OutputAuditRow[] {
  const rows: OutputAuditRow[] = [];
  const caseTotals = new Map<string, ReturnType<typeof getCaseTotalAmounts>>();

  for (const record of records) {
    const context = resolveOutputPeriodContextForRecord(
      record,
      options.mode,
      options.periodYear,
      options.goalsByAttorney,
      options.attorneyGoals,
    );
    const totals = getCaseTotalAmounts(record);
    caseTotals.set(record.shared.id, totals);

    for (const slice of listPartySlices(record)) {
      const status = getPartyOutputPeriodStatus(slice, record, context);
      if (status === "prior_period_excluded") continue;

      const gross = getPartyGrossSettlement(slice.party, slice.legacy, record);
      const fees = getPartyRjlFees(slice.party, slice.legacy, record);
      const partyLabel = slice.party?.partyLabel?.trim() || (slice.legacy ? "Case-level" : "Party");

      rows.push({
        caseNumber: record.shared.caseNumber,
        clientName: record.shared.clientName,
        attorneyName: record.attorney.name,
        periodMode: options.mode,
        periodLabel: options.periodLabel,
        partyLabel,
        periodStatus: status,
        settlementDate: formatAuditDate(getPartySettlementDate(slice.party, slice.legacy, record)),
        disburseDate: formatAuditDate(getPartyDisburseDate(slice.party, slice.legacy, record)),
        grossSettlementInPeriod: gross,
        rjlFeesInPeriod: fees,
        countsTowardDisbursed: status === "disbursed_in_period",
        countsTowardSettled: true,
        caseTotalGrossSettlement: totals.settlementAmount,
        caseTotalRjlFees: totals.attorneyFees,
        multiDisbursement: recordHasMultipleDisbursementParties(record),
        financialBackfillLocked: Boolean(record.tracker.result.financialBackfillLocked),
      });
    }
  }

  return rows.sort((left, right) => {
    const caseCmp = left.caseNumber.localeCompare(right.caseNumber);
    if (caseCmp !== 0) return caseCmp;
    return left.partyLabel.localeCompare(right.partyLabel);
  });
}

function escapeCsvCell(value: string | number | boolean) {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildOutputAuditCsv(rows: OutputAuditRow[]) {
  const headers = [
    "Case Number",
    "Client Name",
    "Attorney",
    "Period Mode",
    "Period",
    "Party",
    "Status",
    "Settlement Date",
    "Disburse Date",
    "Gross Settlement In Period",
    "RJL Fees In Period",
    "Counts Toward Disbursed",
    "Counts Toward Settled",
    "Case Total Gross Settlement",
    "Case Total RJL Fees",
    "Multi Disbursement",
    "Financial Backfill Locked",
  ];

  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.caseNumber,
        row.clientName,
        row.attorneyName,
        row.periodMode,
        row.periodLabel,
        row.partyLabel,
        row.periodStatus,
        row.settlementDate,
        row.disburseDate,
        row.grossSettlementInPeriod,
        row.rjlFeesInPeriod,
        row.countsTowardDisbursed ? "Yes" : "No",
        row.countsTowardSettled ? "Yes" : "No",
        row.caseTotalGrossSettlement,
        row.caseTotalRjlFees,
        row.multiDisbursement ? "Yes" : "No",
        row.financialBackfillLocked ? "Yes" : "No",
      ]
        .map(escapeCsvCell)
        .join(","),
    ),
  ];

  return lines.join("\r\n");
}

export function downloadOutputAuditCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
