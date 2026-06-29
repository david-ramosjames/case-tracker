import { type DailyCronGroup, getNextDailyCronGroup } from "@/lib/cron/daily-cron-run";
import { getCronSecret } from "@/lib/slack/config";

function buildCronStepUrl(request: Request, group: DailyCronGroup, runId: string) {
  const incoming = new URL(request.url);
  const url = new URL(incoming.origin);
  url.pathname = "/api/cron/daily-job-step";
  url.search = "";

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

  void fetch(url.toString(), {
    method: "GET",
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  }).catch((error) => {
    console.error(`Failed to trigger daily cron group ${group}`, error);
  });
}

export function getNextDailyCronGroupAfter(current: DailyCronGroup) {
  return getNextDailyCronGroup(current);
}
