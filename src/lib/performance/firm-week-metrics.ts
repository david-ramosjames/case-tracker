import { createPerformanceClient } from "@/lib/performance/db";
import { type FirmWeeklyMetricKey } from "@/lib/performance/firm-metrics";
import { type ParsedFirmWeekTotals } from "@/lib/performance/weekly-check-import";

export type FirmWeekMetricRow = {
  weekStart: string;
  metricKey: string;
  actualValue: number;
  source: "import" | "manual" | "live";
};

function asString(value: unknown) {
  return value == null ? "" : String(value);
}

function asNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function listFirmWeekMetricsInRange(
  weekStartFrom: string,
  weekStartTo: string,
): Promise<FirmWeekMetricRow[]> {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_firm_week_metrics")
    .select("week_start, metric_key, actual_value, source")
    .gte("week_start", weekStartFrom)
    .lte("week_start", weekStartTo);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    weekStart: asString(row.week_start).slice(0, 10),
    metricKey: asString(row.metric_key),
    actualValue: asNumber(row.actual_value),
    source: (asString(row.source) as FirmWeekMetricRow["source"]) || "import",
  }));
}

/** Map week_start → firm metric actuals (including new_case when present). */
export function firmMetricsByWeek(
  rows: FirmWeekMetricRow[],
): Map<string, Partial<Record<FirmWeeklyMetricKey, number>>> {
  const byWeek = new Map<string, Partial<Record<FirmWeeklyMetricKey, number>>>();
  for (const row of rows) {
    const bucket = byWeek.get(row.weekStart) ?? {};
    bucket[row.metricKey as FirmWeeklyMetricKey] = row.actualValue;
    byWeek.set(row.weekStart, bucket);
  }
  return byWeek;
}

export async function upsertFirmWeekTotals(rows: ParsedFirmWeekTotals[]) {
  if (rows.length === 0) return { weeks: 0, metrics: 0 };
  const client = await createPerformanceClient();
  const payload = rows.flatMap((row) =>
    Object.entries(row.metrics).map(([metricKey, actualValue]) => ({
      week_start: row.weekStart,
      metric_key: metricKey,
      actual_value: Number(actualValue) || 0,
      source: "import" as const,
      updated_at: new Date().toISOString(),
    })),
  );
  const { error } = await client.from("performance_firm_week_metrics").upsert(payload, {
    onConflict: "week_start,metric_key",
  });
  if (error) throw error;
  return { weeks: rows.length, metrics: payload.length };
}
