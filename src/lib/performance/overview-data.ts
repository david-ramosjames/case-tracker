import { isCaseFullyDisbursed } from "@/lib/case-status";
import {
  computeJonQuarterlyFeeProjection,
  computeSignedCasePacing,
  type SettledUndisbursedCase,
} from "@/lib/performance/pacing";
import { rankTopOutstandingByFees, sortOutstandingByAge, withDaysOutstanding } from "@/lib/performance/outstanding";
import { chicagoDateParts, chicagoTodayYmd } from "@/lib/performance/weeks";
import { type AttorneyGoal, type CaseRecord } from "@/lib/types";

function settlementDateOf(record: CaseRecord): string | null {
  return (
    record.tracker.result.settlementDate ??
    record.tracker.disbursements.find((d) => d.settlementDate)?.settlementDate ??
    null
  );
}

function expectedAttorneyFees(record: CaseRecord): number {
  return record.tracker.result.attorneyFees ?? record.tracker.actualFeeValue ?? 0;
}

export function collectSettledUndisbursed(
  records: CaseRecord[],
  usersById: Map<string, string>,
  asOfYmd = chicagoTodayYmd(),
): SettledUndisbursedCase[] {
  const rows: Omit<SettledUndisbursedCase, "daysOutstanding">[] = [];
  for (const record of records) {
    if (record.tracker.caseStage !== "Settled") continue;
    if (isCaseFullyDisbursed(record.tracker.result)) continue;
    const settlementDate = settlementDateOf(record);
    if (!settlementDate) continue;
    rows.push({
      caseId: record.shared.id,
      caseNumber: record.shared.caseNumber,
      clientName: record.shared.clientName,
      attorneyName: usersById.get(record.shared.attorneyId) ?? "—",
      expectedAttorneyFees: expectedAttorneyFees(record),
      settlementDate,
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
  goals: AttorneyGoal[];
  lagDays: number;
}) {
  const bounds = calendarQuarterBounds();
  const settled = collectSettledUndisbursed(input.records, input.usersById);
  const feesDisbursed = feesDisbursedInCalendarQuarter(input.records, bounds.startYmd, bounds.endYmd);
  const feeGoals = input.goals.filter((g) => g.year === bounds.year);
  const quarterlyGoal = feeGoals.reduce((sum, g) => {
    const fees = [g.feeQ1Goal, g.feeQ2Goal, g.feeQ3Goal, g.feeQ4Goal][bounds.quarter - 1] ?? 0;
    return sum + fees;
  }, 0);

  const projection = computeJonQuarterlyFeeProjection({
    feesDisbursedInQuarter: feesDisbursed,
    settledUndisbursed: settled,
    quarterlyGoal,
    quarterEndYmd: bounds.endYmd,
    lagDays: input.lagDays,
  });

  return {
    bounds,
    projection,
    top5: rankTopOutstandingByFees(settled, 5),
    oldest: sortOutstandingByAge(settled),
  };
}
