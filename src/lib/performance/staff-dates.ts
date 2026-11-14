import { createPerformanceClient } from "@/lib/performance/db";

export type PerformanceStaffDates = {
  contactId: string;
  employmentStartDate: string | null;
  employmentEndDate: string | null;
  updatedAt: string;
};

type UnknownRow = Record<string, unknown>;

function rowToStaff(row: UnknownRow): PerformanceStaffDates {
  return {
    contactId: String(row.contact_id),
    employmentStartDate: row.employment_start_date == null ? null : String(row.employment_start_date),
    employmentEndDate: row.employment_end_date == null ? null : String(row.employment_end_date),
    updatedAt: String(row.updated_at),
  };
}

/** Performance-only staffing metadata. Never touches contacts or case assignments. */
export async function listPerformanceStaffDates(): Promise<PerformanceStaffDates[]> {
  const client = await createPerformanceClient();
  const { data, error } = await client.from("performance_staff_dates").select("*");
  if (error) throw error;
  return ((data ?? []) as UnknownRow[]).map(rowToStaff);
}

export async function upsertPerformanceStaffDates(input: {
  contactId: string;
  employmentStartDate?: string | null;
  employmentEndDate?: string | null;
}): Promise<PerformanceStaffDates> {
  const client = await createPerformanceClient();
  const payload = {
    contact_id: input.contactId,
    employment_start_date:
      input.employmentStartDate === undefined
        ? undefined
        : input.employmentStartDate?.trim() || null,
    employment_end_date:
      input.employmentEndDate === undefined ? undefined : input.employmentEndDate?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await client
    .from("performance_staff_dates")
    .select("*")
    .eq("contact_id", input.contactId)
    .maybeSingle();

  if (existing) {
    const update: Record<string, unknown> = { updated_at: payload.updated_at };
    if (payload.employment_start_date !== undefined) {
      update.employment_start_date = payload.employment_start_date;
    }
    if (payload.employment_end_date !== undefined) {
      update.employment_end_date = payload.employment_end_date;
    }
    const { data, error } = await client
      .from("performance_staff_dates")
      .update(update)
      .eq("contact_id", input.contactId)
      .select("*")
      .single();
    if (error) throw error;
    return rowToStaff(data as UnknownRow);
  }

  const { data, error } = await client
    .from("performance_staff_dates")
    .insert({
      contact_id: input.contactId,
      employment_start_date: payload.employment_start_date ?? null,
      employment_end_date: payload.employment_end_date ?? null,
      updated_at: payload.updated_at,
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToStaff(data as UnknownRow);
}

export function staffDatesByContactId(rows: PerformanceStaffDates[]) {
  return new Map(rows.map((row) => [row.contactId, row]));
}
