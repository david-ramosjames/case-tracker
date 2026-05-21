import { displayNameFromEmail, isAllowedEmail } from "@/lib/auth/constants";
import { getUserRole, provisionUserRole } from "@/lib/auth/provision-user";
import { type SessionUser } from "@/lib/auth/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !isAllowedEmail(user.email)) return null;

  const role = await getUserRole(user.id, user.email);
  const name = displayNameFromEmail(user.email, user.user_metadata?.full_name as string | undefined);

  return {
    id: user.id,
    email: user.email,
    name,
    role,
    avatarInitials: initials(name),
  };
}

export async function requireSessionUser(): Promise<SessionUser> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) throw new Error("Unauthorized");
  return sessionUser;
}

export async function ensureProvisionedSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !isAllowedEmail(user.email)) return null;

  await provisionUserRole(user.id, user.email);
  return getSessionUser();
}
