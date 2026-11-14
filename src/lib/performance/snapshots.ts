import { createPerformanceClient } from "@/lib/performance/db";
import { listCommitmentsForWeek, listAllOpenDeliverables } from "@/lib/performance/deliverables";
import { weekEndFromStart, weekStartMondayCt } from "@/lib/performance/weeks";
import { type SnapshotKind } from "@/lib/performance/types";

type UnknownRow = Record<string, unknown>;

export type PerformanceWeekSnapshot = {
  id: string;
  weekStart: string;
  snapshotKind: SnapshotKind;
  scope: "firm" | "user";
  scopeUserId: string | null;
  payload: Record<string, unknown>;
  frozenAt: string;
  frozenBy: string;
};

function rowToSnapshot(row: UnknownRow): PerformanceWeekSnapshot {
  return {
    id: String(row.id),
    weekStart: String(row.week_start),
    snapshotKind: row.snapshot_kind as SnapshotKind,
    scope: row.scope as "firm" | "user",
    scopeUserId: row.scope_user_id == null ? null : String(row.scope_user_id),
    payload: (row.payload as Record<string, unknown>) ?? {},
    frozenAt: String(row.frozen_at),
    frozenBy: String(row.frozen_by ?? "system"),
  };
}

export async function ensurePerformanceWeek(weekStart: string) {
  const client = await createPerformanceClient();
  const weekEnd = weekEndFromStart(weekStart);
  const { data, error } = await client
    .from("performance_weeks")
    .upsert({ week_start: weekStart, week_end: weekEnd, status: "open" }, { onConflict: "week_start" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Monday 9:30 checkpoint — freezes commitments only (not backlog).
 * Does not lock further edits to the live plan.
 */
export async function captureMondayPlanSnapshot(weekStart = weekStartMondayCt()) {
  const client = await createPerformanceClient();
  await ensurePerformanceWeek(weekStart);
  const commitments = await listCommitmentsForWeek(weekStart);
  const promised = commitments.filter((c) => c.outcome === "promised" || c.outcome === "completed");
  const payload = {
    commitmentIds: promised.map((c) => c.id),
    deliverableIds: [...new Set(promised.map((c) => c.deliverableId))],
    commitments: promised,
    capturedAt: new Date().toISOString(),
  };

  const { data, error } = await client
    .from("performance_week_snapshots")
    .insert({
      week_start: weekStart,
      snapshot_kind: "monday_plan",
      scope: "firm",
      payload,
      frozen_by: "system",
    })
    .select("*")
    .single();
  if (error) throw error;

  const snapshot = rowToSnapshot(data as UnknownRow);
  for (const commitment of promised) {
    await client
      .from("performance_commitments")
      .update({ monday_snapshot_id: snapshot.id })
      .eq("id", commitment.id)
      .is("monday_snapshot_id", null);
  }

  await client
    .from("performance_weeks")
    .update({ monday_snapshot_at: new Date().toISOString() })
    .eq("week_start", weekStart);

  return snapshot;
}

export async function captureWeekCloseActualsSnapshot(weekStart: string, scoresPayload: Record<string, unknown> = {}) {
  const client = await createPerformanceClient();
  await ensurePerformanceWeek(weekStart);
  const commitments = await listCommitmentsForWeek(weekStart);
  const open = await listAllOpenDeliverables();
  const payload = {
    commitments,
    outstandingDeliverableIds: open.map((d) => d.id),
    scores: scoresPayload,
    capturedAt: new Date().toISOString(),
  };

  const { data, error } = await client
    .from("performance_week_snapshots")
    .insert({
      week_start: weekStart,
      snapshot_kind: "week_close_actuals",
      scope: "firm",
      payload,
      frozen_by: "system",
    })
    .select("*")
    .single();
  if (error) throw error;

  await client
    .from("performance_weeks")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("week_start", weekStart);

  return rowToSnapshot(data as UnknownRow);
}

export async function getLatestMondaySnapshot(weekStart: string) {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_week_snapshots")
    .select("*")
    .eq("week_start", weekStart)
    .eq("snapshot_kind", "monday_plan")
    .order("frozen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToSnapshot(data as UnknownRow) : null;
}

export async function listSnapshotsForWeek(weekStart: string) {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_week_snapshots")
    .select("*")
    .eq("week_start", weekStart)
    .order("frozen_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as UnknownRow[]).map(rowToSnapshot);
}
