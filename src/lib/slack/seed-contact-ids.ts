import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listSlackWorkspaceUsers, lookupSlackUserIdByEmail } from "@/lib/slack/client";
import { isSlackEnabled } from "@/lib/slack/config";

type ContactRow = {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  slack_user_id: string | null;
  slack_display_name: string | null;
};

function normalizeHandle(value: string) {
  return value.trim().toLowerCase().replace(/[._-]+/g, "");
}

function firstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] ?? "";
}

/**
 * Seed contacts.slack_user_id / slack_display_name from Slack email lookup + directory.
 */
export async function seedContactSlackIds() {
  if (!isSlackEnabled()) {
    throw new Error("Slack is not configured (SLACK_BOT_TOKEN).");
  }

  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required to seed Slack user IDs.");

  const { data, error } = await admin
    .from("contacts")
    .select("id,name,email,role,slack_user_id,slack_display_name")
    .in("role", ["attorney", "paralegal", "legal_assistant", "manager"]);
  if (error) throw error;

  const contacts = (data ?? []) as ContactRow[];
  const directory = await listSlackWorkspaceUsers();

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const contact of contacts) {
    let slackUserId = contact.slack_user_id?.trim() || null;
    let displayName = contact.slack_display_name?.trim() || null;

    if (!slackUserId && contact.email?.includes("@") && !contact.email.endsWith("@ramosjameslaw.local")) {
      slackUserId = await lookupSlackUserIdByEmail(contact.email);
    }

    if (!slackUserId) {
      const target = normalizeHandle(firstName(contact.name) || contact.name || "");
      for (const user of directory) {
        const candidates = [user.displayName, user.realName, user.firstName].map(normalizeHandle);
        if (candidates.some((c) => c && (c === target || c.startsWith(target) || target.startsWith(c)))) {
          slackUserId = user.id;
          displayName = displayName || user.displayName || user.firstName || firstName(contact.name);
          break;
        }
      }
    }

    if (slackUserId && !displayName) {
      const user = directory.find((entry) => entry.id === slackUserId);
      displayName = user?.displayName || user?.firstName || firstName(contact.name) || null;
    }

    if (!slackUserId && !displayName) {
      skipped += 1;
      continue;
    }

    if (slackUserId === contact.slack_user_id && displayName === contact.slack_display_name) {
      skipped += 1;
      continue;
    }

    const { error: updateError } = await admin
      .from("contacts")
      .update({
        slack_user_id: slackUserId,
        slack_display_name: displayName,
      })
      .eq("id", contact.id);

    if (updateError) {
      errors.push(`${contact.name ?? contact.id}: ${updateError.message}`);
      continue;
    }
    updated += 1;
  }

  return { total: contacts.length, updated, skipped, errors };
}
