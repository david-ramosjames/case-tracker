import { createPerformanceClient } from "@/lib/performance/db";
import { type PerformancePair } from "@/lib/performance/types";

type UnknownRow = Record<string, unknown>;

function asString(value: unknown) {
  return typeof value === "string" ? value : value == null ? null : String(value);
}

export function rowToPair(row: UnknownRow): PerformancePair {
  return {
    id: String(row.id),
    attorneyContactId: asString(row.attorney_contact_id),
    paralegalContactId: asString(row.paralegal_contact_id),
    attorneyLabel: asString(row.attorney_label),
    paralegalLabel: asString(row.paralegal_label),
    effectiveFrom: String(row.effective_from),
    effectiveTo: asString(row.effective_to),
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : Number(row.sort_order) || 0,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function pairDisplayName(
  pair: PerformancePair,
  nameById: Map<string, string>,
): { attorney: string; paralegal: string; label: string } {
  const attorney =
    (pair.attorneyContactId && nameById.get(pair.attorneyContactId)) ||
    pair.attorneyLabel ||
    "TBD";
  const paralegal =
    (pair.paralegalContactId && nameById.get(pair.paralegalContactId)) ||
    pair.paralegalLabel ||
    "TBD";
  return { attorney, paralegal, label: `${paralegal} + ${attorney}`.toUpperCase() };
}

/** Pairs active on a given date (inclusive effective window). */
export function pairsActiveOn(pairs: PerformancePair[], onDate: string): PerformancePair[] {
  return pairs
    .filter((pair) => {
      if (pair.effectiveFrom > onDate) return false;
      if (pair.effectiveTo && pair.effectiveTo < onDate) return false;
      return true;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

export async function listPerformancePairs(): Promise<PerformancePair[]> {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_pairs")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as UnknownRow[]).map(rowToPair);
}

export async function createPerformancePair(input: {
  attorneyContactId?: string | null;
  paralegalContactId?: string | null;
  attorneyLabel?: string | null;
  paralegalLabel?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  sortOrder?: number;
}): Promise<PerformancePair> {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_pairs")
    .insert({
      attorney_contact_id: input.attorneyContactId ?? null,
      paralegal_contact_id: input.paralegalContactId ?? null,
      attorney_label: input.attorneyLabel?.trim() || null,
      paralegal_label: input.paralegalLabel?.trim() || null,
      effective_from: input.effectiveFrom,
      effective_to: input.effectiveTo?.trim() || null,
      sort_order: input.sortOrder ?? 0,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToPair(data as UnknownRow);
}

export async function updatePerformancePair(input: {
  id: string;
  attorneyContactId?: string | null;
  paralegalContactId?: string | null;
  attorneyLabel?: string | null;
  paralegalLabel?: string | null;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  sortOrder?: number;
}): Promise<PerformancePair> {
  const client = await createPerformanceClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.attorneyContactId !== undefined) update.attorney_contact_id = input.attorneyContactId;
  if (input.paralegalContactId !== undefined) update.paralegal_contact_id = input.paralegalContactId;
  if (input.attorneyLabel !== undefined) update.attorney_label = input.attorneyLabel?.trim() || null;
  if (input.paralegalLabel !== undefined) update.paralegal_label = input.paralegalLabel?.trim() || null;
  if (input.effectiveFrom !== undefined) update.effective_from = input.effectiveFrom;
  if (input.effectiveTo !== undefined) update.effective_to = input.effectiveTo?.trim() || null;
  if (input.sortOrder !== undefined) update.sort_order = input.sortOrder;

  const { data, error } = await client
    .from("performance_pairs")
    .update(update)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToPair(data as UnknownRow);
}

export async function deletePerformancePair(id: string) {
  const client = await createPerformanceClient();
  const { error } = await client.from("performance_pairs").delete().eq("id", id);
  if (error) throw error;
}
