import { getProjectedFeeValue } from "@/lib/calculations";
import { matchesTargetPeriodFilter, toStandardTargetPeriodLabel } from "@/lib/case-options";
import { isCaseFullyDisbursed } from "@/lib/case-status";
import { getDisbursementAttorneyFees } from "@/lib/disbursements";
import {
  computeJonQuarterlyFeeProjection,
  computeSignedCasePacing,
  type ExpectedDisbursementQuarterCase,
  type SettledUndisbursedCase,
} from "@/lib/performance/pacing";
import { rankTopOutstandingByFees, sortOutstandingByAge, withDaysOutstanding } from "@/lib/performance/outstanding";
import { chicagoDateParts, chicagoTodayYmd } from "@/lib/performance/weeks";
import { type CaseDisbursement, type CaseRecord } from "@/lib/types";

function expectedAttorneyFees(record: CaseRecord): number {
  return record.tracker.result.attorneyFees ?? record.tracker.actualFeeValue ?? 0;
}

function currentExpectedDisbursementQuarterLabel(date = new Date()) {
  const parts = chicagoDateParts(date);
  const quarter = Math.floor((parts.month - 1) / 3) + 1;
  return toStandardTargetPeriodLabel(`Q${quarter}-${String(parts.year % 100).padStart(2, "0")}`) ?? `Q${quarter}-${String(parts.year % 100).padStart(2, "0")}`;
}

/**
 * Active cases whose Expected disbursement quarter is the current calendar quarter
 * (Chicago), excluding fully disbursed / closed pipeline cases.
 */
export function collectExpectedDisbursementThisQuarter(
  records: CaseRecord[],
  usersById: Map<string, string>,
  asOf = new Date(),
): ExpectedDisbursementQuarterCase[] {
  const currentQuarter = currentExpectedDisbursementQuarterLabel(asOf);
  const rows: ExpectedDisbursementQuarterCase[] = [];

  for (const record of records) {
    if (!record.tracker.isActive) continue;
    if (isCaseFullyDisbursed(record.tracker.result)) continue;
    if (!matchesTargetPeriodFilter(currentQuarter, record.tracker.targetResolutionQuarter)) continue;

    const attorneyName = usersById.get(record.shared.attorneyId) ?? "—";
    const fees =
      record.tracker.caseStage === "Settled"
        ? expectedAttorneyFees(record) || getProjectedFeeValue(record) || 0
        : getProjectedFeeValue(record) || 0;

    rows.push({
      caseId: record.shared.id,
      caseNumber: record.shared.caseNumber,
      clientName: record.shared.clientName,
      attorneyName,
      caseStage: record.tracker.caseStage,
      expectedAttorneyFees: fees,
      targetResolutionQuarter: record.tracker.targetResolutionQuarter ?? null,
      settlementDate: record.tracker.result.settlementDate,
    });
  }

  return rows.sort((a, b) => b.expectedAttorneyFees - a.expectedAttorneyFees);
}

function isPartyDisbursed(party: CaseDisbursement): boolean {
  return Boolean(party.disburseDate?.trim()) && !party.pendingRemaining;
}

/**
 * Outstanding aging is per individual/party, not case-level.
 * Requires Settled stage (sheet column G = Y / full settlement) — same gate as
 * stage sync. Party settlement dates alone do not qualify (e.g. 782 Treatment).
 * A co-party without their own settlement date does not get days.
 */
export function collectSettledUndisbursed(
  records: CaseRecord[],
  usersById: Map<string, string>,
  asOfYmd = chicagoTodayYmd(),
): SettledUndisbursedCase[] {
  const rows: Omit<SettledUndisbursedCase, "daysOutstanding">[] = [];
  for (const record of records) {
    // Column G Y → Settled. Without that, party H dates are not outstanding yet.
    if (record.tracker.caseStage !== "Settled") continue;

    const attorneyName = usersById.get(record.shared.attorneyId) ?? "—";

    if (record.tracker.disbursements.length > 0) {
      for (const party of record.tracker.disbursements) {
        if (!party.settlementDate) continue;
        if (isPartyDisbursed(party)) continue;
        rows.push({
          caseId: record.shared.id,
          caseNumber: record.shared.caseNumber,
          clientName: party.partyLabel?.trim() || record.shared.clientName,
          attorneyName,
          expectedAttorneyFees: getDisbursementAttorneyFees(party, record),
          settlementDate: party.settlementDate,
          targetResolutionQuarter: record.tracker.targetResolutionQuarter ?? null,
          disbursementId: party.id,
        });
      }
      continue;
    }

    if (isCaseFullyDisbursed(record.tracker.result)) continue;
    const settlementDate = record.tracker.result.settlementDate;
    if (!settlementDate) continue;
    rows.push({
      caseId: record.shared.id,
      caseNumber: record.shared.caseNumber,
      clientName: record.shared.clientName,
      attorneyName,
      expectedAttorneyFees: expectedAttorneyFees(record),
      settlementDate,
      targetResolutionQuarter: record.tracker.targetResolutionQuarter ?? null,
      disbursementId: null,
    });
  }
  return withDaysOutstanding(rows, asOfYmd);
}

export function countSignedInMonth(records: CaseRecord[], year: number, month1to12: number) {
  let count = 0;
  for (const record of records) {
    const signed = record.shared.dateSigned;
    if (!signed) continue;
    const [y, m] = signed.split("-").map(Number);
    if (y === year && m === month1to12) count += 1;
  }
  return count;
}

export function buildSignedPacingForToday(records: CaseRecord[], monthlyGoal: number) {
  const parts = chicagoDateParts();
  const signedMtd = countSignedInMonth(records, parts.year, parts.month);
  return computeSignedCasePacing({
    signedMtd,
    year: parts.year,
    month1to12: parts.month,
    dayOfMonth: parts.day,
    monthlyGoal,
  });
}

function calendarQuarterBounds(date = new Date()) {
  const parts = chicagoDateParts(date);
  const q = Math.floor((parts.month - 1) / 3) + 1;
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const endDay = new Date(Date.UTC(parts.year, endMonth, 0)).getUTCDate();
  return {
    quarter: q,
    year: parts.year,
    startYmd: `${parts.year}-${String(startMonth).padStart(2, "0")}-01`,
    endYmd: `${parts.year}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`,
  };
}

function feesDisbursedInCalendarQuarter(records: CaseRecord[], startYmd: string, endYmd: string) {
  let total = 0;
  for (const record of records) {
    for (const d of record.tracker.disbursements) {
      if (!d.disburseDate) continue;
      if (d.disburseDate < startYmd || d.disburseDate > endYmd) continue;
      total += d.attorneyFees ?? 0;
    }
    if (record.tracker.disbursements.length === 0 && record.tracker.result.checkDisbursedAt) {
      const disburse = record.tracker.result.disburseDate;
      if (disburse && disburse >= startYmd && disburse <= endYmd) {
        total += record.tracker.result.attorneyFees ?? 0;
      }
    }
  }
  return total;
}

export function buildJonFeeProjection(input: {
  records: CaseRecord[];
  usersById: Map<string, string>;
  lagDays: number;
  /** Firm Performance quarterly attorney-fees goal (from Settings). */
  quarterlyGoal: number;
}) {
  const bounds = calendarQuarterBounds();
  const settled = collectSettledUndisbursed(input.records, input.usersById);
  const expectedThisQuarter = collectExpectedDisbursementThisQuarter(input.records, input.usersById);
  const feesDisbursed = feesDisbursedInCalendarQuarter(input.records, bounds.startYmd, bounds.endYmd);

  const projection = computeJonQuarterlyFeeProjection({
    feesDisbursedInQuarter: feesDisbursed,
    settledUndisbursed: settled,
    quarterlyGoal: input.quarterlyGoal,
    quarterEndYmd: bounds.endYmd,
    lagDays: input.lagDays,
  });

  return {
    bounds,
    projection,
    top5: rankTopOutstandingByFees(settled, 5),
    oldest: sortOutstandingByAge(settled),
    expectedThisQuarter,
  };
}
