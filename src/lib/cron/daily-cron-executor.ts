import {
  clearDailyCronRun,
  DAILY_CRON_BATCHES,
  getBatch,
  loadDailyCronRun,
  mergeDailyCronRunToAllResult,
  saveDailyCronGroupResult,
  type DailyCronGroup,
} from "@/lib/cron/daily-cron-run";
import { runDailyCronGroup } from "@/lib/cron/daily-jobs";
import { notifyDailyCronStarted, notifyDailyJobResult } from "@/lib/slack/daily-job-notify";
import { errorMessage } from "@/lib/utils";

export type DailyCronRunOptions = {
  force?: boolean;
  skipSheetSync?: boolean;
  caseNumber?: string;
};

export async function runDailyCronBatch(
  batchIndex: number,
  runId: string,
  options: DailyCronRunOptions,
) {
  const batch = getBatch(batchIndex);
  if (!batch) {
    throw new Error(`Invalid daily cron batch index: ${batchIndex}`);
  }

  const results: Partial<Record<DailyCronGroup, Record<string, unknown>>> = {};

  for (const group of batch) {
    console.info("Daily cron group starting", { runId, batchIndex, group });
    const result = await runDailyCronGroup(group, options);
    await saveDailyCronGroupResult(runId, group, result);
    results[group] = result;
    console.info("Daily cron group finished", { runId, batchIndex, group, ok: result.ok !== false });
  }

  const ok = Object.values(results).every((result) => result?.ok !== false);

  return { ok, batchIndex, groups: batch, results };
}

export async function finishDailyCronRun(runId: string) {
  const run = await loadDailyCronRun(runId);
  const merged = mergeDailyCronRunToAllResult(run);
  const slackNotify = await notifyDailyJobResult("all", merged, { source: "cron" });
  await clearDailyCronRun(runId);
  return { merged, slackNotify };
}

/**
 * Run every daily cron group in this invocation (no self-fetch chain).
 * Posts to #daily-pulse at start and end so partial/killed runs are visible.
 */
export async function runFullDailyCron(runId: string, options: DailyCronRunOptions) {
  console.info("Daily cron started", { runId, options });
  await clearDailyCronRun(runId);

  const startedNotify = await notifyDailyCronStarted(runId);
  console.info("Daily cron start notify", startedNotify);

  const batchResults: Array<{ batchIndex: number; ok: boolean; groups: DailyCronGroup[] }> = [];

  try {
    for (let batchIndex = 0; batchIndex < DAILY_CRON_BATCHES.length; batchIndex += 1) {
      console.info("Daily cron batch starting", { runId, batchIndex, groups: DAILY_CRON_BATCHES[batchIndex] });
      const outcome = await runDailyCronBatch(batchIndex, runId, options);
      batchResults.push({ batchIndex, ok: outcome.ok, groups: outcome.groups });
    }

    const { merged, slackNotify } = await finishDailyCronRun(runId);
    console.info("Daily cron completed", { runId, ok: merged.ok, slackNotify });
    return { ok: merged.ok, runId, merged, slackNotify, startedNotify, batchResults };
  } catch (error) {
    const message = errorMessage(error) || "Daily cron failed.";
    console.error("Daily cron failed", { runId, message }, error);

    let slackNotify: Awaited<ReturnType<typeof notifyDailyJobResult>>;
    try {
      const run = await loadDailyCronRun(runId);
      const partial = mergeDailyCronRunToAllResult(run);
      slackNotify = await notifyDailyJobResult("all", { ...partial, ok: false }, {
        source: "cron",
        fatalError: message,
      });
      await clearDailyCronRun(runId);
    } catch (notifyError) {
      console.error("Daily cron failure notify failed", notifyError);
      slackNotify = { posted: false as const, reason: "post_failed" as const, error: errorMessage(notifyError) };
    }

    return {
      ok: false as const,
      runId,
      error: message,
      slackNotify,
      startedNotify,
      batchResults,
    };
  }
}
