import { kickDailyCronBatch } from "@/lib/cron/daily-cron-chain";
import {
  clearDailyCronRun,
  getBatch,
  getNextDailyCronBatchIndex,
  isDailyCronBatchParallel,
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

async function runAndSaveGroup(runId: string, batchIndex: number, group: DailyCronGroup, options: DailyCronRunOptions) {
  console.info("Daily cron group starting", { runId, batchIndex, group });
  try {
    const result = await runDailyCronGroup(group, options);
    await saveDailyCronGroupResult(runId, group, result);
    console.info("Daily cron group finished", { runId, batchIndex, group, ok: result.ok !== false });
    return result;
  } catch (error) {
    const message = errorMessage(error) || `${group} failed.`;
    const result = { ok: false as const, group, error: message };
    await saveDailyCronGroupResult(runId, group, result);
    console.error("Daily cron group crashed", { runId, batchIndex, group, message }, error);
    return result;
  }
}

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

  if (isDailyCronBatchParallel(batchIndex) && batch.length > 1) {
    const settled = await Promise.all(
      batch.map(async (group) => {
        const result = await runAndSaveGroup(runId, batchIndex, group, options);
        return [group, result] as const;
      }),
    );
    for (const [group, result] of settled) {
      results[group] = result;
    }
  } else {
    for (const group of batch) {
      results[group] = await runAndSaveGroup(runId, batchIndex, group, options);
    }
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
  // Always attempt the next batch even when this one reported ok:false — one bad
  // sheet/Quo step must not stop settlements, pulse, reminders, or SMS.
  const outcome = await runDailyCronBatch(batchIndex, runId, options);
  const progressNotify = await notifyDailyCronBatchProgress(runId, batchIndex, outcome);
  console.info("Daily cron batch progress notify", { runId, batchIndex, progressNotify });

  const nextBatch = getNextDailyCronBatchIndex(batchIndex);
  if (nextBatch != null) {
    const kick = await kickDailyCronBatch(request, nextBatch, runId);
    console.info("Daily cron next batch kick", { runId, nextBatch, kick, priorOk: outcome.ok });
    if (kick.ok) {
      return { ...outcome, chained: nextBatch, completed: false as const, progressNotify, kick };
    }

    // Vercel returns 508 INFINITE_LOOP_DETECTED after enough same-deployment
    // self-fetches. Finish the remaining batches here so the morning run does
    // not stop mid-chain (settlement done, treatment/SMS never started).
    console.warn("Daily cron kick failed; continuing remaining batches inline", {
      runId,
      nextBatch,
      kick,
    });
    let index: number | null = nextBatch;
    let lastOutcome = outcome;
    while (index != null) {
      lastOutcome = await runDailyCronBatch(index, runId, options);
      await notifyDailyCronBatchProgress(runId, index, lastOutcome);
      index = getNextDailyCronBatchIndex(index);
    }
    const finished = await finishDailyCronRun(runId);
    console.info("Daily cron completed after inline continuation", {
      runId,
      ok: finished.merged.ok,
      slackNotify: finished.slackNotify,
    });
    return {
      ...lastOutcome,
      merged: finished.merged,
      slackNotify: finished.slackNotify,
      completed: true as const,
      ok: finished.merged.ok,
      progressNotify,
      kick,
      continuedInline: true as const,
    };
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

/**
 * Entry point for /api/cron/slack-reminders.
 * Only clears state, posts "started", and kicks batch 0 asynchronously.
 * Heavy work must not run in this request — that made 4:20 look stuck for 8+ minutes.
 */
export async function startDailyCronChain(
  request: Request,
  runId: string,
  options: DailyCronRunOptions,
) {
  console.info("Daily cron chain starting", { runId, options });
  await clearDailyCronRun(runId);

  const startedNotify = await notifyDailyCronStarted(runId);
  console.info("Daily cron start notify", startedNotify);

  const kick = await kickDailyCronBatch(request, 0, runId);
  console.info("Daily cron batch 0 kick", { runId, kick });

  if (!kick.ok) {
    const message =
      "error" in kick && kick.error
        ? errorMessage(kick.error) || "Failed to start daily cron batch 0."
        : `Failed to start daily cron batch 0 (status ${"status" in kick ? kick.status : "?"}).`;
    console.error("Daily cron batch 0 failed to start", { runId, message, kick });
    const { merged, slackNotify } = await failDailyCronRun(runId, 0, message);
    return {
      ok: false as const,
      runId,
      error: message,
      merged,
      slackNotify,
      startedNotify,
      kick,
      completed: true as const,
      accepted: false as const,
    };
  }

  return {
    ok: true as const,
    runId,
    startedNotify,
    kick,
    accepted: true as const,
    completed: false as const,
    chained: 0,
  };
}
