import { TeamView } from "@/components/performance/team-view";
import { WeekPairsEditor } from "@/components/performance/week-pairs-editor";
import { requireSessionUser } from "@/lib/auth/session";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { canManagePerformanceTargets } from "@/lib/performance/access";
import { createPerformanceClient } from "@/lib/performance/db";
import { rowToDeliverable } from "@/lib/performance/deliverables";
import { buildPairWeekRollup, buildWeekSeatRollup } from "@/lib/performance/pair-rollup";
import { listPerformancePairs } from "@/lib/performance/pairs";
import { filterAttorneys, filterParalegals } from "@/lib/performance/staff-roles";
import { listPerformanceTargets } from "@/lib/performance/targets";
import {
  buildFirmWeekHistory,
  buildFirmWeekRollup,
  listRecentWeekStarts,
  shiftWeekStart,
} from "@/lib/performance/team-rollup";
import {
  ensureWeekPairs,
  listWeekPairMetricsForPairs,
} from "@/lib/performance/week-pairs";
import { weekStartMondayCt } from "@/lib/performance/weeks";

export const dynamic = "force-dynamic";

export default async function PerformanceTeamPage() {
  const sessionUser = await requireSessionUser();
  const weekStart = weekStartMondayCt();
  const weekStarts = listRecentWeekStarts(weekStart, 16);
  const oldestWeek = shiftWeekStart(weekStart, -(weekStarts.length - 1));
  const canEditPairs = canManagePerformanceTargets(sessionUser.role);

  const [{ records, users }, targets, legacyPairs, client] = await Promise.all([
    loadViewerCaseBundle(),
    listPerformanceTargets(),
    listPerformancePairs(),
    createPerformanceClient(),
  ]);
  // Carry prior week seats forward automatically when this week has none yet.
  const weekPairs = await ensureWeekPairs(weekStart);

  const { data } = await client
    .from("performance_deliverables")
    .select("*")
    .eq("workflow_status", "done")
    .gte("completed_at", `${oldestWeek}T00:00:00`)
    .limit(5000);
  const deliverables = ((data ?? []) as Record<string, unknown>[]).map(rowToDeliverable);

  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const metrics = await listWeekPairMetricsForPairs(weekPairs.map((p) => p.id));

  const pairRows =
    weekPairs.length > 0
      ? buildWeekSeatRollup({
          weekStart,
          weekPairs,
          metrics,
          deliverables,
          nameById,
        })
      : buildPairWeekRollup({
          weekStart,
          pairs: legacyPairs,
          deliverables,
          nameById,
        });

  const currentWeek = buildFirmWeekRollup({
    weekStart,
    deliverables,
    records,
    targets,
  });
  const history = buildFirmWeekHistory({
    weekStarts,
    deliverables,
    records,
    targets,
  });

  const attorneys = filterAttorneys(users);
  // Pair seats can include legal assistants historically (e.g. Valeria).
  const pairParalegals = users
    .filter((u) => u.role === "paralegal" || u.role === "legal_assistant")
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <TeamView currentWeek={currentWeek} history={history} pairRows={pairRows} />
      {canEditPairs ? (
        <WeekPairsEditor
          weekStart={weekStart}
          initialPairs={weekPairs}
          paralegals={pairParalegals.length ? pairParalegals : filterParalegals(users)}
          attorneys={attorneys}
        />
      ) : null}
    </div>
  );
}
