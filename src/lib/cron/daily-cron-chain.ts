import { after } from "next/server";
import { resolvePublicAppOrigin } from "@/lib/auth/redirect-url";
import { type DailyCronGroup, getNextDailyCronGroup } from "@/lib/cron/daily-cron-run";
import { getCronSecret } from "@/lib/slack/config";

function buildCronStepUrl(request: Request, group: DailyCronGroup, runId: string) {
  const origin = resolvePublicAppOrigin() ?? new URL(request.url).origin;
  const url = new URL("/api/cron/daily-job-step", origin);

  const incoming = new URL(request.url);
  for (const key of ["force", "syncSheet", "caseNumber"] as const) {
    const value = incoming.searchParams.get(key);
    if (value) url.searchParams.set(key, value);
  }

  url.searchParams.set("group", group);
  url.searchParams.set("runId", runId);
  return url;
}

export function triggerDailyCronGroup(request: Request, group: DailyCronGroup, runId: string) {
  const secret = getCronSecret();
  const url = buildCronStepUrl(request, group, runId);

  after(async () => {
    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      });
      if (!response.ok) {
        const body = await response.text();
        console.error(`Daily cron chain failed to start ${group}`, response.status, body);
        return;
      }
      console.info(`Daily cron chain started ${group}`, { runId, status: response.status });
    } catch (error) {
      console.error(`Failed to trigger daily cron group ${group}`, error);
    }
  });
}

export function getNextDailyCronGroupAfter(current: DailyCronGroup) {
  return getNextDailyCronGroup(current);
}
