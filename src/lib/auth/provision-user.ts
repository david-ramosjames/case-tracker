import { getRoleForEmail, isAllowedEmail, normalizeEmail } from "@/lib/auth/constants";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { type UserRole } from "@/lib/types";

function normalizeRole(value: string | null | undefined): UserRole | null {
  if (value === "attorney" || value === "paralegal" || value === "manager" || value === "admin" || value === "super_admin") {
    return value;
  }
  return null;
}

export async function provisionUserRole(userId: string, email: string) {
  if (!isAllowedEmail(email)) {
    throw new Error("Only @ramosjames.com accounts can access this app.");
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to provision user roles.");
  }

  const role = getRoleForEmail(email);
  const { data: existing, error: existingError } = await admin
    .from("case_tracker_user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) throw existingError;

  const existingRole = normalizeRole(existing?.role as string | null | undefined);
  const nextRole =
    role === "admin" ? "admin" : existingRole && existingRole !== "attorney" ? existingRole : role;

  const { error } = await admin.from("case_tracker_user_roles").upsert(
    {
      user_id: userId,
      role: nextRole,
      active: true,
    },
    { onConflict: "user_id" },
  );

  if (error) throw error;
  return nextRole;
}

export async function getUserRole(userId: string, email: string): Promise<UserRole> {
  const admin = createSupabaseAdminClient();
  if (admin) {
    const { data } = await admin.from("case_tracker_user_roles").select("role").eq("user_id", userId).maybeSingle();
    const role = normalizeRole(data?.role as string | null | undefined);
    if (role) return role;
  }

  return getRoleForEmail(normalizeEmail(email));
}
