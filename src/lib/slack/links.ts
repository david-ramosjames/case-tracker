import { type CaseSlackChannel } from "@/lib/types";

export function getSlackWorkspaceUrl() {
  const value = process.env.NEXT_PUBLIC_SLACK_WORKSPACE_URL?.trim();
  if (!value) return null;
  return value.replace(/\/$/, "");
}

/** Web link to a Slack channel (direct archive link when ID is known, otherwise workspace search). */
export function getSlackChannelArchiveUrl(channel: Pick<CaseSlackChannel, "slackChannelId" | "slackChannelName">) {
  const workspaceUrl = getSlackWorkspaceUrl();
  if (!workspaceUrl) return null;
  if (channel.slackChannelId) {
    return `${workspaceUrl}/archives/${channel.slackChannelId}`;
  }
  const label = formatSlackChannelLabel(channel.slackChannelName);
  if (!label) return null;
  return `${workspaceUrl}/search?q=${encodeURIComponent(label)}`;
}

export function formatSlackChannelLabel(channelName: string) {
  const trimmed = channelName.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}
