import { type CaseSlackChannel } from "@/lib/types";

export function getSlackWorkspaceUrl() {
  const value = process.env.NEXT_PUBLIC_SLACK_WORKSPACE_URL?.trim();
  if (!value) return null;
  return value.replace(/\/$/, "");
}

/** Web link to open a Slack channel (requires channel ID for a direct jump). */
export function getSlackChannelArchiveUrl(channel: Pick<CaseSlackChannel, "slackChannelId" | "slackChannelName">) {
  const workspaceUrl = getSlackWorkspaceUrl();
  if (!workspaceUrl) return null;
  if (channel.slackChannelId) {
    return `${workspaceUrl}/archives/${channel.slackChannelId}`;
  }
  return null;
}

export function formatSlackChannelLabel(channelName: string) {
  const trimmed = channelName.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}
