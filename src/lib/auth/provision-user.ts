import { contactRoleToUserRole, getAdminRoleForEmail, isAllowedEmail, normalizeEmail } from "@/lib/auth/constants";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { type UserRole } from "@/lib/types";

function normalizeRole(value: string | null | undefined): UserRole | null {
  if (value === "attorney" || value === "paralegal" || value === "manager" || value === "admin" || value === "super_admin") {
    return value;
  }
  return null;
}

async function resolveRoleFromContact(email: string): Promise<UserRole | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const normalized = normalizeEmail(email);
  const { data, error } = await admin.from("contacts").select("role").ilike("email", normalized).maybeSingle();
  if (error) return null;

  return contactRoleToUserRole(data?.role as string | null | undefined);
}

export async function provisionUserRole(userId: string, email: string): Promise<UserRole | null> {
  if (!isAllowedEmail(email)) {
    throw new Error("Only @ramosjames.com accounts can access this app.");
  }

  const adminClient = createSupabaseAdminClient();
  if (!adminClient) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to provision user roles.");
  }

  const adminRole = getAdminRoleForEmail(email);
  const { data: existing, error: existingError } = await adminClient
    .from("case_tracker_user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) throw existingError;

  const existingRole = normalizeRole(existing?.role as string | null | undefined);

  if (adminRole === "admin") {
    const { error } = await adminClient.from("case_tracker_user_roles").upsert(
      { user_id: userId, role: "admin", active: true },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    return "admin";
  }

  if (existingRole) return existingRole;

  const contactRole = await resolveRoleFromContact(email);
  if (!contactRole) return null;

  const { error } = await adminClient.from("case_tracker_user_roles").upsert(
    { user_id: userId, role: contactRole, active: true },
    { onConflict: "user_id" },
  );
  if (error) throw error;
  return contactRole;
}

export async function getUserRole(userId: string, email: string): Promise<UserRole | null> {
  const adminRole = getAdminRoleForEmail(email);
  const adminClient = createSupabaseAdminClient();

  if (adminClient) {
    const { data } = await adminClient.from("case_tracker_user_roles").select("role").eq("user_id", userId).maybeSingle();
    const storedRole = normalizeRole(data?.role as string | null | undefined);
    if (storedRole) return storedRole;
  }

  if (adminRole) return adminRole;

  return resolveRoleFromContact(email);
}
