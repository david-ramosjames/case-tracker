import { isActivePipelineCase } from "@/lib/auth/access";
import { isDateInCalendarYear, getRecordDisburseDate } from "@/lib/commission-year";
import {
  getAggregatedResultFromDisbursements,
  getCaseAttorneyFees,
} from "@/lib/disbursements";
import { type AttorneyGoal, type CaseRecord } from "@/lib/types";
import { daysSince, parseCalendarDate } from "@/lib/utils";

export type JumbotronFilters = {
  attorneyIds: string[];
  caseTypes: string[];
  calendarYear: number;
};

export type JumbotronMetric = {
  value: string;
  detail: string;
  sampleSize: number;
};

export type JumbotronMetrics = {
  activeCases: JumbotronMetric;
  averageCaseAgeDays: JumbotronMetric;
  averageSettlement: JumbotronMetric;
  averageRjlFees: JumbotronMetric;
  daysIntakeToSettlement: JumbotronMetric;
  daysSettlementToDisbursement: JumbotronMetric;
};

export type SignedCasesMonthBucket = {
  month: number;
  label: string;
  count: number;
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function mean(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function daysBetween(start: string, end: string) {
  const from = parseCalendarDate(start);
  const to = parseCalendarDate(end);
  if (!from || !to) return null;
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function resolveRecordFinancials(record: CaseRecord) {
  const aggregated = getAggregatedResultFromDisbursements(record.tracker);
  const result = record.tracker.result;

  return {
    settlementDate: aggregated?.settlementDate ?? result.settlementDate,
    settlementAmount: aggregated?.settlementAmount ?? result.settlementAmount,
    attorneyFees: aggregated?.attorneyFees ?? getCaseAttorneyFees(record),
    disburseDate: aggregated?.disburseDate ?? getRecordDisburseDate(result),
  };
}

function matchesJumbotronFilters(record: CaseRecord, filters: JumbotronFilters) {
  if (filters.attorneyIds.length > 0 && !filters.attorneyIds.includes(record.shared.attorneyId)) {
    return false;
  }
  if (filters.caseTypes.length > 0 && !filters.caseTypes.includes(record.shared.caseType)) {
    return false;
  }
  return true;
}

function closedCaseInCalendarYear(record: CaseRecord, calendarYear: number) {
  if (record.shared.status !== "Closed") return false;

  const { settlementDate, disburseDate } = resolveRecordFinancials(record);
  return isDateInCalendarYear(disburseDate, calendarYear) || isDateInCalendarYear(settlementDate, calendarYear);
}

function metricFromNumber(
  value: number | null,
  formatter: (value: number) => string,
  detail: string,
  sampleSize: number,
): JumbotronMetric {
  if (value == null || !Number.isFinite(value)) {
    return { value: "—", detail, sampleSize: 0 };
  }
  return { value: formatter(value), detail, sampleSize };
}

export function computeJumbotronMetrics(
  records: CaseRecord[],
  goals: AttorneyGoal[],
  filters: JumbotronFilters,
): JumbotronMetrics {
  const filtered = records.filter((record) => matchesJumbotronFilters(record, filters));

  const activeCases = filtered.filter((record) => isActivePipelineCase(record, goals));
  const activeAges = activeCases
    .map((record) => daysSince(record.shared.dateSigned))
    .filter((days) => Number.isFinite(days) && days >= 0);

  const closedInYear = filtered.filter((record) => closedCaseInCalendarYear(record, filters.calendarYear));

  const settlementAmounts = closedInYear
    .map((record) => resolveRecordFinancials(record).settlementAmount)
    .filter((amount): amount is number => amount != null && amount > 0);

  const feeAmounts = closedInYear
    .map((record) => resolveRecordFinancials(record).attorneyFees)
    .filter((amount): amount is number => amount != null && amount > 0);

  const intakeToSettlementDays = closedInYear
    .map((record) => {
      const { settlementDate } = resolveRecordFinancials(record);
      if (!record.shared.dateSigned || !settlementDate) return null;
      return daysBetween(record.shared.dateSigned, settlementDate);
    })
    .filter((days): days is number => days != null && days >= 0);

  const settlementToDisbursementDays = closedInYear
    .map((record) => {
      const { settlementDate, disburseDate } = resolveRecordFinancials(record);
      if (!settlementDate || !disburseDate) return null;
      return daysBetween(settlementDate, disburseDate);
    })
    .filter((days): days is number => days != null && days >= 0);

  const yearLabel = String(filters.calendarYear);

  return {
    activeCases: {
      value: String(activeCases.length),
      detail: `${filtered.length} case(s) in scope`,
      sampleSize: activeCases.length,
    },
    averageCaseAgeDays: metricFromNumber(
      mean(activeAges),
      (value) => `${Math.round(value)} days`,
      `${activeAges.length} open case(s) with date signed`,
      activeAges.length,
    ),
    averageSettlement: metricFromNumber(
      mean(settlementAmounts),
      (value) =>
        value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
      `Closed in ${yearLabel} · ${settlementAmounts.length} with settlement amount`,
      settlementAmounts.length,
    ),
    averageRjlFees: metricFromNumber(
      mean(feeAmounts),
      (value) =>
        value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
      `Closed in ${yearLabel} · ${feeAmounts.length} with RJL fees`,
      feeAmounts.length,
    ),
    daysIntakeToSettlement: metricFromNumber(
      mean(intakeToSettlementDays),
      (value) => `${Math.round(value)} days`,
      `Closed in ${yearLabel} · ${intakeToSettlementDays.length} with intake + settlement dates`,
      intakeToSettlementDays.length,
    ),
    daysSettlementToDisbursement: metricFromNumber(
      mean(settlementToDisbursementDays),
      (value) => `${Math.round(value)} days`,
      `Closed in ${yearLabel} · ${settlementToDisbursementDays.length} with settlement + disbursement dates`,
      settlementToDisbursementDays.length,
    ),
  };
}

export function computeSignedCasesByMonth(
  records: CaseRecord[],
  filters: JumbotronFilters,
): SignedCasesMonthBucket[] {
  const counts = Array.from({ length: 12 }, () => 0);

  for (const record of records) {
    if (!matchesJumbotronFilters(record, filters)) continue;

    const dateSigned = record.shared.dateSigned;
    if (!dateSigned || !isDateInCalendarYear(dateSigned, filters.calendarYear)) continue;

    const signed = parseCalendarDate(dateSigned);
    if (!signed || signed.getFullYear() !== filters.calendarYear) continue;

    counts[signed.getMonth()] += 1;
  }

  return counts.map((count, index) => ({
    month: index + 1,
    label: MONTH_LABELS[index] ?? String(index + 1),
    count,
  }));
}
