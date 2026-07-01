import {
  clearDailyCronRun,
  getBatch,
  loadDailyCronRun,
  mergeDailyCronRunToAllResult,
  saveDailyCronGroupResult,
  type DailyCronGroup,
} from "@/lib/cron/daily-cron-run";
import { runDailyCronGroup } from "@/lib/cron/daily-jobs";
import { notifyDailyJobResult } from "@/lib/slack/daily-job-notify";

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
    const result = await runDailyCronGroup(group, options);
    await saveDailyCronGroupResult(runId, group, result);
    results[group] = result;
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
