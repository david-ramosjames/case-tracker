import { resolvePublicAppOrigin } from "@/lib/auth/redirect-url";
import {
  DAILY_CRON_BATCHES,
  type DailyCronGroup,
  getFirstGroupOfBatch,
  getNextDailyCronGroup,
} from "@/lib/cron/daily-cron-run";
import { getCronSecret } from "@/lib/slack/config";

function buildCronBatchUrl(request: Request, batchIndex: number, runId: string) {
  const origin = resolvePublicAppOrigin();
  if (!origin) {
    console.warn(
      "NEXT_PUBLIC_SITE_URL is not set; cron chain will use the invoking host (may be a preview deployment).",
    );
  }
  const url = new URL("/api/cron/daily-job-step", origin ?? new URL(request.url).origin);

  const incoming = new URL(request.url);
  for (const key of ["force", "syncSheet", "caseNumber"] as const) {
    const value = incoming.searchParams.get(key);
    if (value) url.searchParams.set(key, value);
  }

  url.searchParams.set("batch", String(batchIndex));
  url.searchParams.set("runId", runId);
  // Child returns immediately and runs the batch in after(); await only the ack.
  url.searchParams.set("async", "1");
  return url;
}

/**
 * Kick the next batch and wait only for the HTTP accept (milliseconds), not the job itself.
 * Previously we awaited the full child fetch from after(), which could consume the parent's
 * remaining maxDuration and abort before settlement sync finished or chained onward.
 */
export async function kickDailyCronBatch(request: Request, batchIndex: number, runId: string) {
  const secret = getCronSecret();
  const url = buildCronBatchUrl(request, batchIndex, runId);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text();
      console.error(`Daily cron batch failed to start ${batchIndex}`, response.status, body);
      return { ok: false as const, status: response.status, body };
    }
    const body = (await response.json().catch(() => null)) as { accepted?: boolean } | null;
    console.info(`Daily cron batch accepted`, {
      runId,
      batchIndex,
      firstGroup: getFirstGroupOfBatch(batchIndex),
      status: response.status,
      accepted: body?.accepted === true,
    });
    return { ok: true as const, status: response.status, accepted: body?.accepted === true };
  } catch (error) {
    console.error(`Failed to trigger daily cron batch ${batchIndex}`, error);
    return { ok: false as const, error };
  }
}

/** @deprecated Prefer kickDailyCronBatch (awaited). Kept name for call sites. */
export function triggerDailyCronBatch(request: Request, batchIndex: number, runId: string) {
  void kickDailyCronBatch(request, batchIndex, runId);
}

/** One HTTP hop per batch (not per step) to avoid Vercel INFINITE_LOOP_DETECTED. */
export function triggerDailyCronGroup(request: Request, group: DailyCronGroup, runId: string) {
  const batchIndex = DAILY_CRON_BATCHES.findIndex((batch) => batch.includes(group));
  if (batchIndex < 0) {
    console.error(`No daily cron batch for group ${group}`);
    return;
  }
  void kickDailyCronBatch(request, batchIndex, runId);
}

export function getNextDailyCronGroupAfter(current: DailyCronGroup) {
  return getNextDailyCronGroup(current);
}

export { DAILY_CRON_BATCHES };
