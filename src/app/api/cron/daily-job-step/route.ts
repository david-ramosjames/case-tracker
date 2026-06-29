import { NextResponse } from "next/server";

export const maxDuration = 300;
import { triggerDailyCronGroup } from "@/lib/cron/daily-cron-chain";
import {
  type DailyCronGroup,
  DAILY_CRON_GROUP_ORDER,
  clearDailyCronRun,
  getDailyCronRunId,
  getNextDailyCronGroup,
  loadDailyCronRun,
  mergeDailyCronRunToAllResult,
  saveDailyCronGroupResult,
} from "@/lib/cron/daily-cron-run";
import { runDailyCronGroup } from "@/lib/cron/daily-jobs";
import { notifyDailyJobResult } from "@/lib/slack/daily-job-notify";
import { getCronSecret } from "@/lib/slack/config";
import { errorMessage } from "@/lib/utils";

function parseDailyCronGroup(value: string | null): DailyCronGroup | null {
  if (!value) return null;
  return DAILY_CRON_GROUP_ORDER.includes(value as DailyCronGroup) ? (value as DailyCronGroup) : null;
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

export async function GET(request: Request) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const group = parseDailyCronGroup(searchParams.get("group"));
  if (!group) {
    return NextResponse.json({ error: "Invalid or missing group." }, { status: 400 });
  }

  const runId = searchParams.get("runId")?.trim() || getDailyCronRunId();
  const force = searchParams.get("force") === "true";
  const skipSheetSync = searchParams.get("syncSheet") === "false";
  const caseNumber = searchParams.get("caseNumber")?.trim();

  try {
    const result = await runDailyCronGroup(group, {
      force,
      skipSheetSync,
      caseNumber,
    });

    await saveDailyCronGroupResult(runId, group, result);

    const next = getNextDailyCronGroup(group);
    if (next) {
      triggerDailyCronGroup(request, next, runId);
      return NextResponse.json({
        ok: result.ok,
        runId,
        group,
        chained: next,
        result,
      });
    }

    const run = await loadDailyCronRun(runId);
    const merged = mergeDailyCronRunToAllResult(run);
    const slackNotify = await notifyDailyJobResult("all", merged, { source: "cron" });
    await clearDailyCronRun(runId);

    return NextResponse.json(
      {
        ...merged,
        completed: true,
        slackNotify,
      },
      { status: merged.ok ? 200 : 500 },
    );
  } catch (error) {
    const message = errorMessage(error) || "Daily cron step failed.";
    console.error(`Daily cron group failed: ${group}`, error);

    try {
      await saveDailyCronGroupResult(runId, group, { ok: false, group, error: message });
      const run = await loadDailyCronRun(runId);
      const merged = mergeDailyCronRunToAllResult(run);
      const slackNotify = await notifyDailyJobResult("all", merged, {
        source: "cron",
        fatalError: `${group}: ${message}`,
      });
      return NextResponse.json(
        { ok: false, runId, group, error: message, slackNotify },
        { status: 500 },
      );
    } catch (notifyError) {
      console.error("Failed to record or notify daily cron failure", notifyError);
      return NextResponse.json({ ok: false, runId, group, error: message }, { status: 500 });
    }
  }
}
