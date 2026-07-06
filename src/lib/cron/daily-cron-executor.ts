import { triggerDailyCronBatch } from "@/lib/cron/daily-cron-chain";
import {
  clearDailyCronRun,
  getBatch,
  getNextDailyCronBatchIndex,
  loadDailyCronRun,
  mergeDailyCronRunToAllResult,
  saveDailyCronGroupResult,
  type DailyCronGroup,
} from "@/lib/cron/daily-cron-run";
import { runDailyCronGroup } from "@/lib/cron/daily-jobs";
import {
  notifyDailyCronBatchProgress,
  notifyDailyCronStarted,
  notifyDailyJobResult,
} from "@/lib/slack/daily-job-notify";
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

/** Run one batch, post progress to Slack, then chain the next batch or finish. */
export async function executeDailyCronBatchStep(
  request: Request,
  batchIndex: number,
  runId: string,
  options: DailyCronRunOptions,
) {
  const outcome = await runDailyCronBatch(batchIndex, runId, options);
  const progressNotify = await notifyDailyCronBatchProgress(runId, batchIndex, outcome);
  console.info("Daily cron batch progress notify", { runId, batchIndex, progressNotify });

  const nextBatch = getNextDailyCronBatchIndex(batchIndex);
  if (nextBatch != null) {
    triggerDailyCronBatch(request, nextBatch, runId);
    return { ...outcome, chained: nextBatch, completed: false as const, progressNotify };
  }

  const { merged, slackNotify } = await finishDailyCronRun(runId);
  console.info("Daily cron completed", { runId, ok: merged.ok, slackNotify });
  return { ...outcome, merged, slackNotify, completed: true as const, ok: merged.ok, progressNotify };
}

export async function failDailyCronRun(runId: string, batchIndex: number, message: string) {
  const batch = getBatch(batchIndex);
  const failedGroup = batch?.[0];
  if (failedGroup) {
    await saveDailyCronGroupResult(runId, failedGroup, { ok: false, group: failedGroup, error: message });
  }

  await notifyDailyCronBatchProgress(runId, batchIndex, {
    ok: false,
    groups: batch ?? [`batch ${batchIndex}`],
  });

  const run = await loadDailyCronRun(runId);
  const partial = mergeDailyCronRunToAllResult(run);
  const slackNotify = await notifyDailyJobResult("all", { ...partial, ok: false }, {
    source: "cron",
    fatalError: message,
  });
  await clearDailyCronRun(runId);
  return { merged: partial, slackNotify };
}

/** First batch only — remaining batches chain via HTTP. */
export async function startDailyCronChain(
  request: Request,
  runId: string,
  options: DailyCronRunOptions,
) {
  console.info("Daily cron chain starting", { runId, options });
  await clearDailyCronRun(runId);

  const startedNotify = await notifyDailyCronStarted(runId);
  console.info("Daily cron start notify", startedNotify);

  try {
    const result = await executeDailyCronBatchStep(request, 0, runId, options);
    return { ...result, runId, startedNotify };
  } catch (error) {
    const message = errorMessage(error) || "Daily cron failed.";
    console.error("Daily cron batch 0 failed", { runId, message }, error);
    const { merged, slackNotify } = await failDailyCronRun(runId, 0, message);
    return {
      ok: false as const,
      runId,
      error: message,
      merged,
      slackNotify,
      startedNotify,
      completed: true as const,
    };
  }
}
