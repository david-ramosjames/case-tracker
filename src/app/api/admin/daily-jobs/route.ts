import { NextResponse } from "next/server";

export const maxDuration = 300;
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { type DailyJobStep, runDailyJob } from "@/lib/cron/daily-jobs";
import { errorMessage } from "@/lib/utils";

const VALID_STEPS: DailyJobStep[] = [
  "sheetSync",
  "settlementSync",
  "quoPhoneSync",
  "treatmentPromotion",
  "dailyPulse",
  "missingFields",
  "fieldReminders",
  "all",
];

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const body = (await request.json()) as {
      step?: string;
      caseNumber?: string;
      force?: boolean;
      skipSheetSync?: boolean;
      dryRun?: boolean;
    };

    const step = body.step as DailyJobStep | undefined;
    if (!step || !VALID_STEPS.includes(step)) {
      return NextResponse.json({ error: "Invalid or missing step." }, { status: 400 });
    }

    const result = await runDailyJob(step, {
      force: body.force ?? true,
      skipSheetSync: body.skipSheetSync ?? false,
      caseNumber: body.caseNumber,
      dryRun: body.dryRun ?? false,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    console.error("Daily job failed", error);
    const message = errorMessage(error) || "Daily job failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
