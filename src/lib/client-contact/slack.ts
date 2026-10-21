import { applyContactStamps } from "@/lib/client-contact/repository";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** "@bot Text - client called about the doctor" → type "Text", details "client called about the doctor". */
export function parseSlackContactMention(text: string) {
  const clean = text
    .replace(/<@[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = clean
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    contactType: parts[0] || "",
    details: parts.slice(1).join(" - "),
  };
}

async function caseForSlackChannel(channelId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data } = await admin
    .from("case_slack_channels")
    .select("case_number")
    .eq("slack_channel_id", channelId)
    .limit(1)
    .maybeSingle();
  const caseNumber = cleanCaseNumber(String(data?.case_number ?? ""));
  if (!caseNumber) return null;

  const { data: entry } = await admin
    .from("case_tracker_entries")
    .select("case_id")
    .eq("case_number", caseNumber)
    .limit(1)
    .maybeSingle();
  return { caseNumber, caseId: (entry?.case_id as string | null) ?? null };
}

/** Logs a staff @mention in a case channel, same shape as the Google Sheet contact logger. */
export async function logSlackClientContactMention(input: { channelId: string; text: string; ts: string }) {
  const parsed = parseSlackContactMention(input.text);
  if (!parsed.contactType && !parsed.details) return { logged: false as const, reason: "no_contact" };

  const contactCase = await caseForSlackChannel(input.channelId);
  if (!contactCase) return { logged: false as const, reason: "not_case_channel" };

  const contactedAt = slackTsToIso(input.ts);
  await applyContactStamps([
    {
      caseId: contactCase.caseId,
      caseNumber: contactCase.caseNumber,
      otherAt: contactedAt,
      conversationAt: contactedAt,
    },
  ]);
  return { logged: true as const, caseNumber: contactCase.caseNumber };
}

function slackTsToIso(ts: string) {
  const seconds = Number(ts.split(".")[0]);
  if (!Number.isFinite(seconds)) return new Date().toISOString();
  return new Date(seconds * 1000).toISOString();
}
