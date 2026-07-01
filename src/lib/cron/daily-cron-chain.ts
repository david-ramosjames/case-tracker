import { after } from "next/server";
import { resolvePublicAppOrigin } from "@/lib/auth/redirect-url";
import {
  DAILY_CRON_BATCHES,
  type DailyCronGroup,
  getFirstGroupOfBatch,
  getNextDailyCronGroup,
} from "@/lib/cron/daily-cron-run";
import { getCronSecret } from "@/lib/slack/config";

function buildCronBatchUrl(request: Request, batchIndex: number, runId: string) {
  const origin = resolvePublicAppOrigin() ?? new URL(request.url).origin;
  const url = new URL("/api/cron/daily-job-step", origin);

  const incoming = new URL(request.url);
  for (const key of ["force", "syncSheet", "caseNumber"] as const) {
    const value = incoming.searchParams.get(key);
    if (value) url.searchParams.set(key, value);
  }

  url.searchParams.set("batch", String(batchIndex));
  url.searchParams.set("runId", runId);
  return url;
}

export function triggerDailyCronBatch(request: Request, batchIndex: number, runId: string) {
  const secret = getCronSecret();
  const url = buildCronBatchUrl(request, batchIndex, runId);

  after(async () => {
    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      });
      if (!response.ok) {
        const body = await response.text();
        console.error(`Daily cron batch failed to start ${batchIndex}`, response.status, body);
        return;
      }
      console.info(`Daily cron batch started`, {
        runId,
        batchIndex,
        firstGroup: getFirstGroupOfBatch(batchIndex),
        status: response.status,
      });
    } catch (error) {
      console.error(`Failed to trigger daily cron batch ${batchIndex}`, error);
    }
  });
}

/** One HTTP hop per batch (not per step) to avoid Vercel INFINITE_LOOP_DETECTED. */
export function triggerDailyCronGroup(request: Request, group: DailyCronGroup, runId: string) {
  const batchIndex = DAILY_CRON_BATCHES.findIndex((batch) => batch.includes(group));
  if (batchIndex < 0) {
    console.error(`No daily cron batch for group ${group}`);
    return;
  }
  triggerDailyCronBatch(request, batchIndex, runId);
}

export function getNextDailyCronGroupAfter(current: DailyCronGroup) {
  return getNextDailyCronGroup(current);
}

export { DAILY_CRON_BATCHES };
