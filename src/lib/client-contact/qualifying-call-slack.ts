import { attachQualifyingCallSlackLinks } from "@/lib/client-contact/evidence-slack";
import {
  listClientContactSummaries,
  saveQualifyingCallSlackUrls,
} from "@/lib/client-contact/repository";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { loadSlackChannelMapByCaseNumber } from "@/lib/slack/channels";
import { getCases } from "@/lib/supabase/services";

/**
 * For summaries that already know the exact Quo call id, find that call's
 * Quo-router Slack post and cache the permalink. Safe to run on cron — serial,
 * capped, no retries on rate limit.
 */
export async function resolveAndCacheQualifyingCallSlackLinks(options?: {
  budgetMs?: number;
  maxChannels?: number;
  caseNumbers?: string[];
}) {
  const open = (await getCases()).filter((record) => caseRequiresOngoingUpdates(record));
  const caseNumbers =
    options?.caseNumbers?.map(cleanCaseNumber).filter(Boolean) ??
    open.map((record) => cleanCaseNumber(record.shared.caseNumber)).filter(Boolean);

  const summaries = await listClientContactSummaries(caseNumbers);
  const slackChannels = await loadSlackChannelMapByCaseNumber();
  const channelIdByCase = new Map<string, string>();
  for (const [caseNumber, channel] of slackChannels) {
    if (channel.slackChannelId) channelIdByCase.set(cleanCaseNumber(caseNumber), channel.slackChannelId);
  }

  const rows = [...summaries.values()]
    .filter((summary) => summary.lastQualifyingCallId && summary.lastQualifyingCallAt && !summary.lastQualifyingCallSlackUrl)
    .map((summary) => ({
      caseNumber: summary.caseNumber,
      lastQualifyingCall: summary.lastQualifyingCallAt,
      lastQualifyingCallId: summary.lastQualifyingCallId,
      lastQualifyingCallSlackUrl: summary.lastQualifyingCallSlackUrl,
    }))
    .sort((a, b) => Date.parse(b.lastQualifyingCall ?? "") - Date.parse(a.lastQualifyingCall ?? ""));

  if (!rows.length) {
    return { pending: 0, resolved: 0, saved: 0 };
  }

  const enriched = await attachQualifyingCallSlackLinks(rows, channelIdByCase, {
    budgetMs: options?.budgetMs ?? 45_000,
    maxChannels: options?.maxChannels ?? 200,
  });

  const updates = enriched
    .filter((row) => row.lastQualifyingCallSlackUrl && row.lastQualifyingCallId)
    .map((row) => ({
      caseNumber: row.caseNumber,
      callId: row.lastQualifyingCallId!,
      slackUrl: row.lastQualifyingCallSlackUrl!,
    }));

  const saved = updates.length ? await saveQualifyingCallSlackUrls(updates) : { saved: 0 };
  return { pending: rows.length, resolved: updates.length, saved: saved.saved };
}
