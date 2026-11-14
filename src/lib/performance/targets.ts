import { createPerformanceClient } from "@/lib/performance/db";
import { DEFAULT_ATTORNEY_TARGETS, DEFAULT_PARALEGAL_TARGETS } from "@/lib/performance/scoring";
import { type PerformanceTarget } from "@/lib/performance/types";

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

function coversDate(target: PerformanceTarget, onDate: string) {
  if (target.effectiveFrom > onDate) return false;
  if (target.effectiveTo && target.effectiveTo <= onDate) return false;
  return true;
}

/** Individual > role > firm. Falls back to workbook defaults for weekly activity. */
export function resolveTargetValue(input: {
  targets: PerformanceTarget[];
  metricKey: string;
  onDate: string;
  userId?: string | null;
  role?: string | null;
  periodGrain?: PerformanceTarget["periodGrain"];
}): number {
  const grain = input.periodGrain ?? "week";
  const matches = input.targets.filter(
    (t) => t.metricKey === input.metricKey && t.periodGrain === grain && coversDate(t, input.onDate),
  );
  const userHit = input.userId
    ? matches.find((t) => t.scope === "user" && t.scopeUserId === input.userId)
    : undefined;
  if (userHit) return userHit.targetValue;
  const roleHit = input.role
    ? matches.find((t) => t.scope === "role" && t.scopeRole === input.role)
    : undefined;
  if (roleHit) return roleHit.targetValue;
  const firmHit = matches.find((t) => t.scope === "firm");
  if (firmHit) return firmHit.targetValue;

  if (grain === "week") {
    if (input.metricKey in DEFAULT_PARALEGAL_TARGETS) {
      return DEFAULT_PARALEGAL_TARGETS[input.metricKey as keyof typeof DEFAULT_PARALEGAL_TARGETS];
    }
    if (input.metricKey in DEFAULT_ATTORNEY_TARGETS) {
      return DEFAULT_ATTORNEY_TARGETS[input.metricKey as keyof typeof DEFAULT_ATTORNEY_TARGETS];
    }
  }
  return 0;
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
    await client
      .from("performance_targets")
      .update({ effective_to: input.effectiveFrom })
      .eq("metric_key", input.metricKey)
      .eq("period_grain", input.periodGrain)
      .eq("scope", input.scope)
      .is("effective_to", null)
      .eq("scope_role", input.scopeRole ?? null)
      .eq("scope_user_id", input.scopeUserId ?? null);
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
