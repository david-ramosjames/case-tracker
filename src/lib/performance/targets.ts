import { createPerformanceClient } from "@/lib/performance/db";
import { resolveTargetValue } from "@/lib/performance/target-resolve";
import { type PerformanceTarget } from "@/lib/performance/types";

export { resolveTargetValue } from "@/lib/performance/target-resolve";

type UnknownRow = Record<string, unknown>;

function rowToTarget(row: UnknownRow): PerformanceTarget {
  return {
    id: String(row.id),
    metricKey: String(row.metric_key),
    periodGrain: row.period_grain as PerformanceTarget["periodGrain"],
    targetValue: Number(row.target_value),
    scope: row.scope as PerformanceTarget["scope"],
    scopeRole: row.scope_role == null ? null : String(row.scope_role),
    scopeUserId: row.scope_user_id == null ? null : String(row.scope_user_id),
    effectiveFrom: String(row.effective_from),
    effectiveTo: row.effective_to == null ? null : String(row.effective_to),
    notes: row.notes == null ? null : String(row.notes),
  };
}

export async function listPerformanceTargets(): Promise<PerformanceTarget[]> {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_targets")
    .select("*")
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as UnknownRow[]).map(rowToTarget);
}

export async function upsertPerformanceTarget(input: {
  metricKey: string;
  periodGrain: PerformanceTarget["periodGrain"];
  targetValue: number;
  scope: PerformanceTarget["scope"];
  scopeRole?: string | null;
  scopeUserId?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  closePrevious?: boolean;
}) {
  const client = await createPerformanceClient();
  if (input.closePrevious) {
    let closeQuery = client
      .from("performance_targets")
      .update({ effective_to: input.effectiveFrom })
      .eq("metric_key", input.metricKey)
      .eq("period_grain", input.periodGrain)
      .eq("scope", input.scope)
      .is("effective_to", null);
    if (input.scopeRole) closeQuery = closeQuery.eq("scope_role", input.scopeRole);
    else closeQuery = closeQuery.is("scope_role", null);
    if (input.scopeUserId) closeQuery = closeQuery.eq("scope_user_id", input.scopeUserId);
    else closeQuery = closeQuery.is("scope_user_id", null);
    await closeQuery;
  }

  const { data, error } = await client
    .from("performance_targets")
    .insert({
      metric_key: input.metricKey,
      period_grain: input.periodGrain,
      target_value: input.targetValue,
      scope: input.scope,
      scope_role: input.scopeRole ?? null,
      scope_user_id: input.scopeUserId ?? null,
      effective_from: input.effectiveFrom,
      effective_to: input.effectiveTo ?? null,
      notes: input.notes ?? null,
      created_by: input.createdBy ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToTarget(data as UnknownRow);
}

export async function getMonthlySignedCaseGoal(year: number, month1to12: number) {
  const onDate = `${year}-${String(month1to12).padStart(2, "0")}-01`;
  const targets = await listPerformanceTargets();
  return resolveTargetValue({
    targets,
    metricKey: "signed_case",
    onDate,
    periodGrain: "month",
  });
}

/** Firm Performance Overview attorney-fees goal for a calendar quarter (not attorney /goals). */
export const ATTORNEY_FEES_QUARTER_METRIC = "attorney_fees_quarter";

export function calendarQuarterStartYmd(year: number, quarter1to4: number) {
  const month = (Math.max(1, Math.min(4, quarter1to4)) - 1) * 3 + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export async function getQuarterlyAttorneyFeesGoal(year: number, quarter1to4: number) {
  const onDate = calendarQuarterStartYmd(year, quarter1to4);
  const targets = await listPerformanceTargets();
  return resolveTargetValue({
    targets,
    metricKey: ATTORNEY_FEES_QUARTER_METRIC,
    onDate,
    periodGrain: "quarter",
  });
}
