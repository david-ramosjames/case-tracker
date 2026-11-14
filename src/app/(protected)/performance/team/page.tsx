import { TeamView } from "@/components/performance/team-view";
import { requireSessionUser } from "@/lib/auth/session";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { createPerformanceClient } from "@/lib/performance/db";
import { rowToDeliverable } from "@/lib/performance/deliverables";
import { buildPairWeekRollup } from "@/lib/performance/pair-rollup";
import { listPerformancePairs } from "@/lib/performance/pairs";
import { listPerformanceTargets } from "@/lib/performance/targets";
import {
  buildFirmWeekHistory,
  buildFirmWeekRollup,
  listRecentWeekStarts,
  shiftWeekStart,
} from "@/lib/performance/team-rollup";
import { weekStartMondayCt } from "@/lib/performance/weeks";

export const dynamic = "force-dynamic";

export default async function PerformanceTeamPage() {
  await requireSessionUser();
  const weekStart = weekStartMondayCt();
  const weekStarts = listRecentWeekStarts(weekStart, 16);
  const oldestWeek = shiftWeekStart(weekStart, -(weekStarts.length - 1));

  const [{ records, users }, targets, pairs, client] = await Promise.all([
    loadViewerCaseBundle(),
    listPerformanceTargets(),
    listPerformancePairs(),
    createPerformanceClient(),
  ]);

  const { data } = await client
    .from("performance_deliverables")
    .select("*")
    .eq("workflow_status", "done")
    .gte("completed_at", `${oldestWeek}T00:00:00`)
    .limit(5000);
  const deliverables = ((data ?? []) as Record<string, unknown>[]).map(rowToDeliverable);

  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const pairRows = buildPairWeekRollup({
    weekStart,
    pairs,
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

  return <TeamView currentWeek={currentWeek} history={history} pairRows={pairRows} />;
}
