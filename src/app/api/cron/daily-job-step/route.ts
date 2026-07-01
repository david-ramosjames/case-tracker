import { NextResponse } from "next/server";

export const maxDuration = 300;
import { triggerDailyCronBatch } from "@/lib/cron/daily-cron-chain";
import {
  DAILY_CRON_BATCHES,
  type DailyCronGroup,
  getDailyCronRunId,
  getNextDailyCronBatchIndex,
  saveDailyCronGroupResult,
} from "@/lib/cron/daily-cron-run";
import { finishDailyCronRun, runDailyCronBatch } from "@/lib/cron/daily-cron-executor";
import { runDailyCronGroup } from "@/lib/cron/daily-jobs";
import { notifyDailyJobResult } from "@/lib/slack/daily-job-notify";
import { getCronSecret } from "@/lib/slack/config";
import { errorMessage } from "@/lib/utils";

function parseDailyCronBatch(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= DAILY_CRON_BATCHES.length) return null;
  return index;
}

function authorizeCron(request: Request) {
  const secret = getCronSecret();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

function parseRunOptions(searchParams: URLSearchParams) {
  return {
    force: searchParams.get("force") === "true",
    skipSheetSync: searchParams.get("syncSheet") === "false",
    caseNumber: searchParams.get("caseNumber")?.trim(),
  };
}

export async function GET(request: Request) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const batchIndex = parseDailyCronBatch(searchParams.get("batch"));
  const runId = searchParams.get("runId")?.trim() || getDailyCronRunId();
  const options = parseRunOptions(searchParams);

  if (batchIndex != null) {
    try {
      const outcome = await runDailyCronBatch(batchIndex, runId, options);
      const nextBatch = getNextDailyCronBatchIndex(batchIndex);

      if (nextBatch != null) {
        triggerDailyCronBatch(request, nextBatch, runId);
        return NextResponse.json({
          ok: outcome.ok,
          runId,
          batch: batchIndex,
          groups: outcome.groups,
          chained: nextBatch,
          results: outcome.results,
        });
      }

      const { merged, slackNotify } = await finishDailyCronRun(runId);
      return NextResponse.json(
        {
          ...merged,
          completed: true,
          slackNotify,
        },
        { status: merged.ok ? 200 : 500 },
      );
    } catch (error) {
      const message = errorMessage(error) || "Daily cron batch failed.";
      console.error(`Daily cron batch failed: ${batchIndex}`, error);

      try {
        const batch = DAILY_CRON_BATCHES[batchIndex];
        const failedGroup = batch?.[0];
        if (failedGroup) {
          await saveDailyCronGroupResult(runId, failedGroup, { ok: false, group: failedGroup, error: message });
        }
        const { merged, slackNotify } = await finishDailyCronRun(runId);
        return NextResponse.json(
          {
            ...merged,
            runId,
            batch: batchIndex,
            error: message,
            slackNotify,
          },
          { status: 500 },
        );
      } catch (notifyError) {
        console.error("Failed to record or notify daily cron batch failure", notifyError);
        return NextResponse.json({ ok: false, runId, batch: batchIndex, error: message }, { status: 500 });
      }
    }
  }

  // Legacy single-group entry (manual / older links).
  const group = searchParams.get("group")?.trim() as DailyCronGroup | undefined;
  if (!group || !DAILY_CRON_BATCHES.some((batch) => batch.includes(group))) {
    return NextResponse.json({ error: "Invalid or missing batch." }, { status: 400 });
  }

  try {
    const result = await runDailyCronGroup(group, options);
    await saveDailyCronGroupResult(runId, group, result);

    const batchForGroup = DAILY_CRON_BATCHES.findIndex((batch) => batch.includes(group));
    const nextBatch = getNextDailyCronBatchIndex(batchForGroup);

    if (nextBatch != null) {
      triggerDailyCronBatch(request, nextBatch, runId);
      return NextResponse.json({ ok: result.ok, runId, group, chained: nextBatch, result });
    }

    const { merged, slackNotify } = await finishDailyCronRun(runId);
    return NextResponse.json({ ...merged, completed: true, slackNotify }, { status: merged.ok ? 200 : 500 });
  } catch (error) {
    const message = errorMessage(error) || "Daily cron step failed.";
    console.error(`Daily cron group failed: ${group}`, error);

    try {
      await saveDailyCronGroupResult(runId, group, { ok: false, group, error: message });
      const slackNotify = await notifyDailyJobResult("all", { ok: false, step: "all", error: message }, {
        source: "cron",
        fatalError: `${group}: ${message}`,
      });
      return NextResponse.json({ ok: false, runId, group, error: message, slackNotify }, { status: 500 });
    } catch (notifyError) {
      console.error("Failed to record or notify daily cron failure", notifyError);
      return NextResponse.json({ ok: false, runId, group, error: message }, { status: 500 });
    }
  }
}
