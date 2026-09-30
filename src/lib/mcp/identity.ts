import { displayNameFromEmail, isAllowedEmail, normalizeEmail } from "@/lib/auth/constants";
import { getUserRole } from "@/lib/auth/provision-user";
import { type SessionUser } from "@/lib/auth/types";
import { lookupSlackUserEmail } from "@/lib/slack/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type McpCaller = {
  session: SessionUser;
  slackUserId: string;
  /** Supabase auth user id when the person has signed in to the web app (used for activity attribution). */
  authUserId: string | null;
};

const AUTH_USER_CACHE_MS = 5 * 60 * 1000;
let authUserCache: { loadedAt: number; byEmail: Map<string, string> } | null = null;

async function findAuthUserIdByEmail(email: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  if (!authUserCache || Date.now() - authUserCache.loadedAt > AUTH_USER_CACHE_MS) {
    const byEmail = new Map<string, string>();
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) break;
      for (const user of data.users) {
        if (user.email) byEmail.set(normalizeEmail(user.email), user.id);
      }
      if (data.users.length < 200) break;
    }
    authUserCache = { loadedAt: Date.now(), byEmail };
  }

  return authUserCache.byEmail.get(normalizeEmail(email)) ?? null;
}

async function findContactEmailBySlackUserId(slackUserId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data } = await admin
    .from("contacts")
    .select("email,name")
    .ilike("slack_user_id", slackUserId)
    .limit(1)
    .maybeSingle();
  return data?.email ? { email: String(data.email), name: (data.name as string | null) ?? null } : null;
}

/**
 * Resolve the Slack user behind a Slackbot MCP call to the same session the web app would build
 * for them, so case visibility and roles match the site exactly.
 */
export async function resolveMcpCaller(slackUserId: string): Promise<McpCaller | null> {
  const userId = slackUserId.trim().toUpperCase();
  if (!/^[UW][A-Z0-9]+$/.test(userId)) return null;

  const contact = await findContactEmailBySlackUserId(userId);
  const email = (await lookupSlackUserEmail(userId)) ?? contact?.email ?? null;
  if (!email || !isAllowedEmail(email)) return null;

  const authUserId = await findAuthUserIdByEmail(email);
  const role = await getUserRole(authUserId, email);
  const name = contact?.name?.trim() || displayNameFromEmail(email);

  return {
    slackUserId: userId,
    authUserId,
    session: {
      id: authUserId ?? userId,
      email,
      name,
      role,
      avatarInitials: name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join(""),
    },
  };
}
