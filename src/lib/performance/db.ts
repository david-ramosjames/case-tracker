import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function createPerformanceClient() {
  return createSupabaseAdminClient() ?? (await createSupabaseServerClient());
}
