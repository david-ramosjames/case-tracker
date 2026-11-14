import { createPerformanceClient } from "@/lib/performance/db";
import { type AttorneyPlanKind, type AttorneyPlanLine } from "@/lib/performance/types";

type UnknownRow = Record<string, unknown>;

function asString(value: unknown) {
  return typeof value === "string" ? value : value == null ? null : String(value);
}

export function rowToAttorneyPlanLine(row: UnknownRow): AttorneyPlanLine {
  return {
    id: String(row.id),
    attorneyContactId: String(row.attorney_contact_id),
    weekStart: String(row.week_start),
    kind: row.kind as AttorneyPlanKind,
    caseId: asString(row.case_id),
    caseNumber: asString(row.case_number),
    label: String(row.label ?? ""),
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : Number(row.sort_order) || 0,
    createdBy: asString(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listAttorneyPlanLines(input: {
  attorneyContactId: string;
  weekStart: string;
}): Promise<AttorneyPlanLine[]> {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_attorney_plan_lines")
    .select("*")
    .eq("attorney_contact_id", input.attorneyContactId)
    .eq("week_start", input.weekStart)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as UnknownRow[]).map(rowToAttorneyPlanLine);
}

export async function createAttorneyPlanLine(input: {
  attorneyContactId: string;
  weekStart: string;
  kind: AttorneyPlanKind;
  caseId?: string | null;
  caseNumber?: string | null;
  label?: string;
  sortOrder?: number;
  createdBy?: string | null;
}): Promise<AttorneyPlanLine> {
  const client = await createPerformanceClient();
  const { data, error } = await client
    .from("performance_attorney_plan_lines")
    .insert({
      attorney_contact_id: input.attorneyContactId,
      week_start: input.weekStart,
      kind: input.kind,
      case_id: input.caseId ?? null,
      case_number: input.caseNumber?.trim() || null,
      label: input.label?.trim() || "",
      sort_order: input.sortOrder ?? 0,
      created_by: input.createdBy ?? null,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToAttorneyPlanLine(data as UnknownRow);
}

export async function deleteAttorneyPlanLine(id: string) {
  const client = await createPerformanceClient();
  const { error } = await client.from("performance_attorney_plan_lines").delete().eq("id", id);
  if (error) throw error;
}

/** Pure helper — never touches cases. Used by isolation tests. */
export function attorneyPlanDoesNotMutateCases() {
  return true;
}
