import { resolveClientContactSlackCaches } from "@/lib/client-contact/sync-quo";
import { getCentralHour } from "@/lib/cron/daily-cron-run";
import { syncQuoPhonesToTrackerIfConfigured } from "@/lib/sms/workflow";
import { postSlackMessage } from "@/lib/slack/client";
import { getDailyPulseChannelId, isSlackEnabled } from "@/lib/slack/config";
import { errorMessage } from "@/lib/utils";

/** Saturday night Central hours when Quo conversation + evidence Slack caching may run. */
export const SATURDAY_EVIDENCE_ENRICHMENT_HOURS = [21, 22, 23] as const;

export function getCentralWeekdayShort(now = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
  }).format(now);
}

/**
 * Vercel schedules both CDT/CST UTC times; only Saturday evening Central runs proceed.
 * Manual calls can pass force=true to ignore the schedule gate.
 */
export function isSaturdayEvidenceEnrichmentDue(now = new Date()) {
  if (getCentralWeekdayShort(now) !== "Sat") return false;
  return (SATURDAY_EVIDENCE_ENRICHMENT_HOURS as readonly number[]).includes(getCentralHour(now));
}

/**
 * Fill missing Quo conversation / line ids (inbox walk) then cache Sentiment evidence Slack links.
 * Budgeted so Saturday can fire multiple times and resume where prior passes left gaps.
 */
export async function runSaturdayEvidenceEnrichment() {
  const phoneSync = await syncQuoPhonesToTrackerIfConfigured({
    maxMs: 600_000,
    maxInboxLookups: 80,
  });

  const slackCaches = await resolveClientContactSlackCaches({
    budgetMs: 120_000,
    maxChannels: 200,
  });

  return {
    ok: !phoneSync.conversationSyncWarning,
    phoneSync,
    slackLinks: slackCaches.slackLinks,
    evidenceLinks: slackCaches.evidenceLinks,
  };
}

export async function notifySaturdayEvidenceEnrichment(
  result: Awaited<ReturnType<typeof runSaturdayEvidenceEnrichment>>,
) {
  if (!isSlackEnabled()) return { posted: false as const, reason: "slack_disabled" as const };

  const channelId = await getDailyPulseChannelId();
  if (!channelId) return { posted: false as const, reason: "no_pulse_channel" as const };

  const sync = result.phoneSync;
  const evidence = result.evidenceLinks;
  const lines = [
    `:link: *Saturday evidence enrichment*`,
    `• Quo inbox lookups: ${sync.inboxLookups ?? 0}${sync.partial ? " (partial — will resume next hour)" : ""}`,
    `• conversation links touched: ${sync.conversationLinks ?? 0}`,
    `• cases updated: ${sync.updated ?? 0}`,
    evidence
      ? `• sentiment evidence Slack: ${evidence.resolved ?? 0} resolved / ${evidence.pending ?? 0} pending`
      : null,
    sync.conversationSyncWarning ? `• warning: ${sync.conversationSyncWarning}` : null,
  ].filter(Boolean);

  try {
    await postSlackMessage({ channel: channelId, text: lines.join("\n") });
    return { posted: true as const };
  } catch (error) {
    console.error("Saturday evidence enrichment Slack notify failed", errorMessage(error), error);
    return { posted: false as const, reason: "post_failed" as const, error: errorMessage(error) };
  }
}
