import { daysBetweenYmd } from "@/lib/performance/pacing";
import { type SettledUndisbursedCase } from "@/lib/performance/pacing";

export function rankTopOutstandingByFees(
  rows: SettledUndisbursedCase[],
  limit = 5,
): SettledUndisbursedCase[] {
  return [...rows]
    .sort((a, b) => b.expectedAttorneyFees - a.expectedAttorneyFees)
    .slice(0, limit);
}

export function sortOutstandingByAge(rows: SettledUndisbursedCase[]): SettledUndisbursedCase[] {
  return [...rows].sort((a, b) => b.daysOutstanding - a.daysOutstanding);
}

export function withDaysOutstanding(
  rows: Omit<SettledUndisbursedCase, "daysOutstanding">[],
  asOfYmd: string,
): SettledUndisbursedCase[] {
  return rows.map((row) => ({
    ...row,
    daysOutstanding: Math.max(0, daysBetweenYmd(row.settlementDate, asOfYmd)),
  }));
}

export function agingStatus(
  daysOutstanding: number,
  targetDays: number,
  warnDays: number,
): "ok" | "warn" | "over" {
  if (daysOutstanding <= targetDays) return "ok";
  if (daysOutstanding <= warnDays) return "warn";
  return "over";
}
