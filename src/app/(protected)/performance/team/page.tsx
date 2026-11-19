import { TeamView } from "@/components/performance/team-view";
import { WeekPairsEditor } from "@/components/performance/week-pairs-editor";
import { requireSessionUser } from "@/lib/auth/session";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { canManagePerformanceTargets } from "@/lib/performance/access";
import { buildPairClosingsFromCases } from "@/lib/performance/closings-from-cases";
import { createPerformanceClient } from "@/lib/performance/db";
import { rowToDeliverable } from "@/lib/performance/deliverables";
import { buildPairWeekRollup, buildWeekSeatRollup } from "@/lib/performance/pair-rollup";
import { listPerformancePairs } from "@/lib/performance/pairs";
import { hasContactRole } from "@/lib/contacts/roles";
import { filterAttorneys, filterParalegals } from "@/lib/performance/staff-roles";
import { listPerformanceTargets } from "@/lib/performance/targets";
import { firmMetricsByWeek, listFirmWeekMetricsInRange } from "@/lib/performance/firm-week-metrics";
import {
  buildFirmWeekRollupFromPairActuals,
  countNewCasesInWeek,
  listRecentWeekStarts,
  shiftWeekStart,
  sumPairRowsToFirmActuals,
  sumStoredPairMetricsByWeek,
} from "@/lib/performance/team-rollup";
import {
  ensureWeekPairs,
  listWeekPairMetricsForPairs,
  listWeekPairs,
  listWeekPairsInRange,
} from "@/lib/performance/week-pairs";
import { formatWeekRangeLabel, weekStartMondayCt } from "@/lib/performance/weeks";

export const dynamic = "force-dynamic";

function isoWeekNumber(weekStartYmd: string): number {
  const [y, m, d] = weekStartYmd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + yearStart.getUTCDay() + 1) / 7);
}

function parseWeekParam(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

export default async function PerformanceTeamPage({
  searchParams,
}: {
  searchParams?: Promise<{ week?: string | string[] }>;
}) {
  const sessionUser = await requireSessionUser();
  const params = searchParams ? await searchParams : {};
  const currentMonday = weekStartMondayCt();
  const requested = parseWeekParam(params.week);
  const selectedWeek = requested && requested <= currentMonday ? requested : currentMonday;

  const weekStarts = listRecentWeekStarts(currentMonday, 16);
  const oldestWeek = shiftWeekStart(currentMonday, -(weekStarts.length - 1));
  const canEditPairs = canManagePerformanceTargets(sessionUser.role);

  const [{ records, users }, targets, legacyPairs, client] = await Promise.all([
    loadViewerCaseBundle(),
    listPerformanceTargets(),
    listPerformancePairs(),
    createPerformanceClient(),
  ]);

  // Carry seats forward when the selected week has none yet.
  let weekPairs = await listWeekPairs(selectedWeek);
  if (weekPairs.length === 0) {
    weekPairs = await ensureWeekPairs(selectedWeek);
  }

  const { data } = await client
    .from("performance_deliverables")
    .select("*")
    .eq("workflow_status", "done")
    .gte("completed_at", `${oldestWeek}T00:00:00`)
    .limit(5000);
  const deliverables = ((data ?? []) as Record<string, unknown>[]).map(rowToDeliverable);

  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const metrics = await listWeekPairMetricsForPairs(weekPairs.map((p) => p.id));

  let pairRows =
    weekPairs.length > 0
      ? buildWeekSeatRollup({
          weekStart: selectedWeek,
          weekPairs,
          metrics,
          deliverables,
          nameById,
        })
      : buildPairWeekRollup({
          weekStart: selectedWeek,
          pairs: legacyPairs,
          deliverables,
          nameById,
        });

  const closings = buildPairClosingsFromCases({
    weekStart: selectedWeek,
    weekPairs,
    records,
  });
  pairRows = pairRows.map((row) => {
    const ct = closings.byPairId[row.pairId];
    if (!ct) return row;
    return {
      ...row,
      counts: {
        ...row.counts,
        settlement: ct.settlement,
        disbursement: ct.disbursement,
      },
    };
  });

  const historyPairs = await listWeekPairsInRange(oldestWeek, currentMonday);
  const [historyMetrics, firmMetricRows] = await Promise.all([
    listWeekPairMetricsForPairs(historyPairs.map((p) => p.id)),
    listFirmWeekMetricsInRange(oldestWeek, currentMonday).catch(() => []),
  ]);
  const firmByWeek = firmMetricsByWeek(firmMetricRows);
  const sumsByWeek = sumStoredPairMetricsByWeek({
    weekPairs: historyPairs,
    metrics: historyMetrics,
  });

  // Prefer Team-sheet firm totals when present; otherwise sum Individual/pair seats.
  const firmWeek = buildFirmWeekRollupFromPairActuals({
    weekStart: selectedWeek,
    pairActuals: sumPairRowsToFirmActuals(pairRows),
    newCaseCount: countNewCasesInWeek(records, selectedWeek),
    targets,
    firmSheetActuals: firmByWeek.get(selectedWeek) ?? null,
  });

  const seatWeekStarts = new Set(historyPairs.map((p) => p.weekStart));
  for (const weekStart of firmByWeek.keys()) seatWeekStarts.add(weekStart);
  seatWeekStarts.add(selectedWeek);
  seatWeekStarts.add(currentMonday);

  const history = weekStarts.map((ws) => {
    if (ws === selectedWeek) return firmWeek;
    return buildFirmWeekRollupFromPairActuals({
      weekStart: ws,
      pairActuals: sumsByWeek.get(ws) ?? {},
      newCaseCount: countNewCasesInWeek(records, ws),
      targets,
      firmSheetActuals: firmByWeek.get(ws) ?? null,
    });
  });

  const attorneys = filterAttorneys(users);
  const pairParalegals = users
    .filter((u) => hasContactRole(u, "paralegal") || hasContactRole(u, "legal_assistant"))
    .sort((a, b) => a.name.localeCompare(b.name));

  const weekLabel = `Week ${isoWeekNumber(selectedWeek)}`;
  const weekRangeLabel = formatWeekRangeLabel(selectedWeek);

  return (
    <div className="space-y-6">
      <TeamView
        weekStart={currentMonday}
        weekRangeLabel={weekRangeLabel}
        weekLabel={weekLabel}
        isCurrentWeek={selectedWeek === currentMonday}
        selectedWeek={selectedWeek}
        firmWeek={firmWeek}
        history={history}
        trackedWeekStarts={[...seatWeekStarts]}
        pairRows={pairRows}
        closingDetails={closings.details}
      />
      {canEditPairs ? (
        <WeekPairsEditor
          key={selectedWeek}
          weekStart={selectedWeek}
          initialPairs={weekPairs}
          paralegals={pairParalegals.length ? pairParalegals : filterParalegals(users)}
          attorneys={attorneys}
        />
      ) : null}
    </div>
  );
}
