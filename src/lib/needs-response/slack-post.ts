import { cleanCaseNumber } from "@/lib/csv/parse";
import { saveNeedsResponseSlackMessageUrl } from "@/lib/needs-response/repository";
import { type NeedsResponseRow } from "@/lib/needs-response/types";
import { extractSlackMessageText, fetchChannelHistorySince, type SlackHistoryMessage } from "@/lib/slack/client";
import { getSlackWorkspaceUrl } from "@/lib/slack/links";

const ROUTER_MARKERS = [
  "New Text Message",
  "Outbound Text Message",
  "Missed Call",
  "MISSED CALL",
  "Hung Up at Phone Menu",
  "HUNG UP AT PHONE MENU",
  "Sona Call Completed",
  "Call Back Requested",
  "Human Call Completed",
  "Voicemail",
];

function last10(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function slackMessagePermalink(channelId: string, ts: string) {
  const workspace = getSlackWorkspaceUrl();
  if (!workspace || !channelId || !ts) return null;
  return `${workspace}/archives/${channelId}/p${ts.replace(".", "")}`;
}

function messageText(message: SlackHistoryMessage) {
  return extractSlackMessageText(message);
}

function isQuoRouterPost(text: string) {
  return ROUTER_MARKERS.some((marker) => text.includes(marker));
}

function postMatchesItem(item: NeedsResponseRow, text: string) {
  if (!isQuoRouterPost(text)) return false;
  const phone = last10(item.phone);
  if (phone && text.replace(/\D/g, "").includes(phone)) return true;
  const snippet = String(item.details ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (snippet.length >= 16 && text.includes(snippet.slice(0, 24))) return true;
  return false;
}

function closestMatch(item: NeedsResponseRow, messages: SlackHistoryMessage[]) {
  const detected = new Date(item.detectedAt).getTime();
  let best: { ts: string; distance: number } | null = null;
  for (const message of messages) {
    if (!message.ts) continue;
    const text = messageText(message);
    if (!postMatchesItem(item, text)) continue;
    const posted = Number(message.ts) * 1000;
    const distance = Number.isFinite(posted) && Number.isFinite(detected) ? Math.abs(posted - detected) : 0;
    if (!best || distance < best.distance) best = { ts: message.ts, distance };
  }
  return best?.ts ?? null;
}

/**
 * Point each open row at the Quo Router Slack post (not the channel root).
 * Resolved links are saved so later page loads skip the history search.
 */
export async function attachQuoRouterSlackPosts<T extends NeedsResponseRow>(
  rows: T[],
  channelIdByCase: Map<string, string>,
) {
  const pending = rows.filter(
    (row) => !row.slackMessageUrl && channelIdByCase.get(cleanCaseNumber(row.caseNumber)),
  );
  if (!pending.length) return rows;

  const byChannel = new Map<string, T[]>();
  for (const row of pending) {
    const channelId = channelIdByCase.get(cleanCaseNumber(row.caseNumber));
    if (!channelId) continue;
    const group = byChannel.get(channelId) ?? [];
    group.push(row);
    byChannel.set(channelId, group);
  }

  const found = new Map<string, string>();
  await Promise.all(
    [...byChannel.entries()].map(async ([channelId, group]) => {
      const times = group
        .map((row) => new Date(row.detectedAt).getTime())
        .filter((ms) => Number.isFinite(ms));
      if (!times.length) return;
      const oldest = String((Math.min(...times) - 5 * 60_000) / 1000);
      const latest = String((Math.max(...times) + 45 * 60_000) / 1000);
      let messages: SlackHistoryMessage[] = [];
      try {
        messages = await fetchChannelHistorySince(channelId, { oldest, latest, maxMessages: 200 });
      } catch (error) {
        console.error("[needs-response] Slack history lookup failed", channelId, error);
        return;
      }
      for (const row of group) {
        const ts = closestMatch(row, messages);
        const url = ts ? slackMessagePermalink(channelId, ts) : null;
        if (!url) continue;
        found.set(row.id, url);
        void saveNeedsResponseSlackMessageUrl(row.id, url).catch((error) => {
          console.error("[needs-response] could not save Slack post link", row.id, error);
        });
      }
    }),
  );

  if (!found.size) return rows;
  return rows.map((row) => {
    const url = found.get(row.id);
    return url ? { ...row, slackMessageUrl: url, slackUrl: url } : row;
  });
}
