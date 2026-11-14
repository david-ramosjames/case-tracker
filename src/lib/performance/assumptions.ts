import { createPerformanceClient } from "@/lib/performance/db";
import { type PerformanceAssumptions } from "@/lib/performance/types";

type UnknownRow = Record<string, unknown>;

function rowToAssumptions(row: UnknownRow): PerformanceAssumptions {
  return {
    id: String(row.id),
    settlementToDisburseLagDays: Number(row.settlement_to_disburse_lag_days ?? 42),
    agingTargetDays: Number(row.aging_target_days ?? 30),
    agingWarnDays: Number(row.aging_warn_days ?? 45),
    updatedAt: String(row.updated_at),
  };
}

export async function getPerformanceAssumptions(): Promise<PerformanceAssumptions> {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_assumptions")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return {
      id: "default",
      settlementToDisburseLagDays: 42,
      agingTargetDays: 30,
      agingWarnDays: 45,
      updatedAt: new Date().toISOString(),
    };
  }
  return rowToAssumptions(data as UnknownRow);
}

export async function updatePerformanceAssumptions(input: {
  settlementToDisburseLagDays?: number;
  agingTargetDays?: number;
  agingWarnDays?: number;
  updatedBy?: string | null;
}) {
  const current = await getPerformanceAssumptions();
  const client = await createPerformanceClient();
  const payload = {
    settlement_to_disburse_lag_days:
      input.settlementToDisburseLagDays ?? current.settlementToDisburseLagDays,
    aging_target_days: input.agingTargetDays ?? current.agingTargetDays,
    aging_warn_days: input.agingWarnDays ?? current.agingWarnDays,
    updated_at: new Date().toISOString(),
    updated_by: input.updatedBy ?? null,
  };

  if (current.id === "default") {
    const { data, error } = await client.from("performance_assumptions").insert(payload).select("*").single();
    if (error) throw error;
    return rowToAssumptions(data as UnknownRow);
  }

  const { data, error } = await client
    .from("performance_assumptions")
    .update(payload)
    .eq("id", current.id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToAssumptions(data as UnknownRow);
}
