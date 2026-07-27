import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAnonKey, getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/supabase/env";

export function createSupabaseAdminClient() {
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!serviceRoleKey) return null;

  return createClient(getSupabaseUrl(), serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/** @deprecated Use createSupabaseAdminClient for provisioning only. */
export function createLegacyServiceClient() {
  const supabaseUrl = getSupabaseUrl();
  const supabaseKey = getSupabaseServiceRoleKey() || getSupabaseAnonKey();
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

const SUPABASE_PAGE_SIZE = 1000;

/**
 * PostgREST/Supabase caps select() at 1000 rows by default.
 * Page through `.range()` until all rows are loaded.
 */
export async function fetchAllSupabaseRows<T = Record<string, unknown>>(
  client: SupabaseClient,
  table: string,
  columns = "*",
  options?: { orderBy?: string; ascending?: boolean },
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  for (;;) {
    let query = client.from(table).select(columns);
    if (options?.orderBy) {
      query = query.order(options.orderBy, { ascending: options.ascending ?? true });
    }
    const { data, error } = await query.range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return rows;
}
