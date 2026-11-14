import { createPerformanceClient } from "@/lib/performance/db";

export const WEEK_PAIR_METRIC_KEYS = [
  "demand_sent",
  "lawsuit_filed",
  "discovery_responses",
  "lit_event_scheduled",
  "deposition",
  "mediation",
  "hearing",
  "disengagement",
  "settlement",
  "disbursement",
] as const;

export type WeekPairMetricKey = (typeof WEEK_PAIR_METRIC_KEYS)[number];

export type PerformanceWeekPair = {
  id: string;
  weekStart: string;
  seatIndex: number;
  paralegalContactId: string | null;
  attorneyContactId: string | null;
  paralegalLabel: string | null;
  attorneyLabel: string | null;
  isVacant: boolean;
};

export type PerformanceWeekPairMetric = {
  id: string;
  weekPairId: string;
  metricKey: string;
  actualValue: number;
  source: "import" | "manual" | "live";
};

type UnknownRow = Record<string, unknown>;

function asString(value: unknown) {
  return typeof value === "string" ? value : value == null ? null : String(value);
}

export function rowToWeekPair(row: UnknownRow): PerformanceWeekPair {
  return {
    id: String(row.id),
    weekStart: String(row.week_start),
    seatIndex: typeof row.seat_index === "number" ? row.seat_index : Number(row.seat_index) || 0,
    paralegalContactId: asString(row.paralegal_contact_id),
    attorneyContactId: asString(row.attorney_contact_id),
    paralegalLabel: asString(row.paralegal_label),
    attorneyLabel: asString(row.attorney_label),
    isVacant: Boolean(row.is_vacant),
  };
}

export function rowToWeekPairMetric(row: UnknownRow): PerformanceWeekPairMetric {
  return {
    id: String(row.id),
    weekPairId: String(row.week_pair_id),
    metricKey: String(row.metric_key),
    actualValue: typeof row.actual_value === "number" ? row.actual_value : Number(row.actual_value) || 0,
    source: (asString(row.source) as PerformanceWeekPairMetric["source"]) ?? "import",
  };
}

export function weekPairDisplayName(
  pair: PerformanceWeekPair,
  nameById: Map<string, string>,
): { paralegal: string; attorney: string; label: string } {
  const paralegal =
    (pair.paralegalContactId && nameById.get(pair.paralegalContactId)) || pair.paralegalLabel || "TBD";
  const attorney =
    (pair.attorneyContactId && nameById.get(pair.attorneyContactId)) || pair.attorneyLabel || "TBD";
  return { paralegal, attorney, label: `${paralegal} + ${attorney}`.toUpperCase() };
}

/** One TBD is still a team; both TBD (or explicit vacant) means no work expected. */
export function computeIsVacant(input: {
  paralegalContactId?: string | null;
  attorneyContactId?: string | null;
  paralegalLabel?: string | null;
  attorneyLabel?: string | null;
}) {
  const para =
    input.paralegalContactId ||
    (input.paralegalLabel && input.paralegalLabel.trim().toUpperCase() !== "TBD"
      ? input.paralegalLabel
      : null);
  const att =
    input.attorneyContactId ||
    (input.attorneyLabel && input.attorneyLabel.trim().toUpperCase() !== "TBD"
      ? input.attorneyLabel
      : null);
  const paraEmpty = !para;
  const attEmpty = !att;
  return paraEmpty && attEmpty;
}

export async function listWeekPairs(weekStart: string): Promise<PerformanceWeekPair[]> {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_week_pairs")
    .select("*")
    .eq("week_start", weekStart)
    .order("seat_index", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as UnknownRow[]).map(rowToWeekPair);
}

/** Most recent week before `weekStart` that already has seats. */
export async function findPriorWeekWithPairs(weekStart: string): Promise<string | null> {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_week_pairs")
    .select("week_start")
    .lt("week_start", weekStart)
    .order("week_start", { ascending: false })
    .limit(1);
  if (error) throw error;
  const prior = data?.[0]?.week_start;
  return prior == null ? null : String(prior);
}

export async function listWeekPairsInRange(
  oldestWeekStart: string,
  newestWeekStart: string,
): Promise<PerformanceWeekPair[]> {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_week_pairs")
    .select("*")
    .gte("week_start", oldestWeekStart)
    .lte("week_start", newestWeekStart)
    .order("week_start", { ascending: false })
    .order("seat_index", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as UnknownRow[]).map(rowToWeekPair);
}

export async function listWeekPairMetricsForPairs(
  weekPairIds: string[],
): Promise<PerformanceWeekPairMetric[]> {
  if (weekPairIds.length === 0) return [];
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_week_pair_metrics")
    .select("*")
    .in("week_pair_id", weekPairIds);
  if (error) throw error;
  return ((data ?? []) as UnknownRow[]).map(rowToWeekPairMetric);
}

export async function replaceWeekPairs(input: {
  weekStart: string;
  seats: Array<{
    seatIndex: number;
    paralegalContactId?: string | null;
    attorneyContactId?: string | null;
    paralegalLabel?: string | null;
    attorneyLabel?: string | null;
  }>;
}): Promise<PerformanceWeekPair[]> {
  const client = await createPerformanceClient();
  await client.from("performance_week_pairs").delete().eq("week_start", input.weekStart);

  const rows = input.seats.map((seat) => {
    const paralegalLabel = seat.paralegalContactId ? null : seat.paralegalLabel?.trim() || "TBD";
    const attorneyLabel = seat.attorneyContactId ? null : seat.attorneyLabel?.trim() || "TBD";
    return {
      week_start: input.weekStart,
      seat_index: seat.seatIndex,
      paralegal_contact_id: seat.paralegalContactId ?? null,
      attorney_contact_id: seat.attorneyContactId ?? null,
      paralegal_label: paralegalLabel,
      attorney_label: attorneyLabel,
      is_vacant: computeIsVacant({
        paralegalContactId: seat.paralegalContactId,
        attorneyContactId: seat.attorneyContactId,
        paralegalLabel,
        attorneyLabel,
      }),
      updated_at: new Date().toISOString(),
    };
  });

  if (rows.length === 0) return [];
  const { data, error } = await client.from("performance_week_pairs").insert(rows).select("*");
  if (error) throw error;
  return ((data ?? []) as UnknownRow[]).map(rowToWeekPair);
}

export async function upsertWeekPairMetrics(input: {
  weekPairId: string;
  metrics: Array<{ metricKey: string; actualValue: number; source?: "import" | "manual" | "live" }>;
}) {
  const client = await createPerformanceClient();
  const rows = input.metrics.map((m) => ({
    week_pair_id: input.weekPairId,
    metric_key: m.metricKey,
    actual_value: m.actualValue,
    source: m.source ?? "manual",
    updated_at: new Date().toISOString(),
  }));
  const { error } = await client.from("performance_week_pair_metrics").upsert(rows, {
    onConflict: "week_pair_id,metric_key",
  });
  if (error) throw error;
}

/** Copy seats from one week to another (no metrics). */
export async function copyWeekPairs(fromWeekStart: string, toWeekStart: string) {
  const source = await listWeekPairs(fromWeekStart);
  return replaceWeekPairs({
    weekStart: toWeekStart,
    seats: source.map((seat) => ({
      seatIndex: seat.seatIndex,
      paralegalContactId: seat.paralegalContactId,
      attorneyContactId: seat.attorneyContactId,
      paralegalLabel: seat.paralegalLabel,
      attorneyLabel: seat.attorneyLabel,
    })),
  });
}

/**
 * Return seats for this week. If none are saved yet, copy the prior week forward
 * so admins do not recreate matches every Monday — they only edit when teams change.
 */
export async function ensureWeekPairs(weekStart: string): Promise<PerformanceWeekPair[]> {
  const existing = await listWeekPairs(weekStart);
  if (existing.length > 0) return existing;

  const prior = await findPriorWeekWithPairs(weekStart);
  if (!prior) return [];
  return copyWeekPairs(prior, weekStart);
}
