import { redirect } from "next/navigation";
import { OverviewView } from "@/components/performance/overview-view";
import { requireSessionUser } from "@/lib/auth/session";
import {
  canViewFirmOverviewDetailTables,
  canViewPerformanceOverview,
} from "@/lib/performance/access";
import { getPerformanceAssumptions } from "@/lib/performance/assumptions";
import { buildJonFeeProjection, buildSignedPacingForToday } from "@/lib/performance/overview-data";
import { getMonthlySignedCaseGoal, getQuarterlyAttorneyFeesGoal } from "@/lib/performance/targets";
import { chicagoDateParts } from "@/lib/performance/weeks";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";

export const dynamic = "force-dynamic";

export default async function PerformanceOverviewPage() {
  const sessionUser = await requireSessionUser();
  if (!canViewPerformanceOverview(sessionUser.role)) redirect("/performance/identify");

  const { allRecords, records, users } = await loadViewerCaseBundle();
  const assumptions = await getPerformanceAssumptions();
  const parts = chicagoDateParts();
  const monthlyGoal = await getMonthlySignedCaseGoal(parts.year, parts.month);
  const usersById = new Map(users.map((u) => [u.id, u.name]));
  const quarter = Math.floor((parts.month - 1) / 3) + 1;
  const quarterlyFeeGoal = await getQuarterlyAttorneyFeesGoal(parts.year, quarter);

  // Summary charts: always firm-wide (same numbers for every role).
  const signed = buildSignedPacingForToday(allRecords, monthlyGoal || 40);
  const { projection, bounds } = buildJonFeeProjection({
    records: allRecords,
    usersById,
    lagDays: assumptions.settlementToDisburseLagDays,
    quarterlyGoal: quarterlyFeeGoal,
  });

  // Tables below: firm-wide for admins / Ryan / Lyliana; otherwise the viewer's cases.
  const tablesFirmWide = canViewFirmOverviewDetailTables(sessionUser.role);
  const tableRecords = tablesFirmWide ? allRecords : records;
  const { settledUndisbursed, expectedThisQuarter } = buildJonFeeProjection({
    records: tableRecords,
    usersById,
    lagDays: assumptions.settlementToDisburseLagDays,
    quarterlyGoal: quarterlyFeeGoal,
  });

  return (
    <OverviewView
      signed={signed}
      feeProjection={projection}
      settledUndisbursed={settledUndisbursed}
      expectedThisQuarter={expectedThisQuarter}
      tablesFirmWide={tablesFirmWide}
      agingTargetDays={assumptions.agingTargetDays}
      agingWarnDays={assumptions.agingWarnDays}
      quarterLabel={`${bounds.year} Q${bounds.quarter}`}
    />
  );
}
