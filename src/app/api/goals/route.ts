import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { FIRM_OUTPERFORM_GOAL_ATTORNEY_ID, FIRM_OUTPERFORM_GOAL_ATTORNEY_NAME } from "@/lib/firm-goals";
import { upsertAttorneyGoal, type AttorneyGoalInput } from "@/lib/supabase/services";
import { errorMessage } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const input = (await request.json()) as AttorneyGoalInput;
    const goalScope = input.goalScope === "firm" ? "firm" : "attorney";
    if (!input.year) {
      return NextResponse.json({ error: "Commission year is required." }, { status: 400 });
    }
    if (goalScope === "attorney" && !input.attorneyName?.trim()) {
      return NextResponse.json({ error: "Attorney and year are required." }, { status: 400 });
    }

    const goal = await upsertAttorneyGoal({
      goalId: input.goalId,
      goalScope,
      attorneyId: goalScope === "firm" ? FIRM_OUTPERFORM_GOAL_ATTORNEY_ID : input.attorneyId,
      attorneyName: goalScope === "firm" ? FIRM_OUTPERFORM_GOAL_ATTORNEY_NAME : input.attorneyName.trim(),
      year: Number(input.year),
      annualGrossGoal: Number(input.annualGrossGoal ?? 0),
      annualRjlFeesGoal: Number(input.annualRjlFeesGoal ?? 0),
      commissionThreshold: Number(input.commissionThreshold ?? 0),
      monthlyGoals: input.monthlyGoals ?? {},
      monthlyFeeGoals: input.monthlyFeeGoals ?? {},
      calendarPlugGoals: input.calendarPlugGoals ?? {},
      calendarPlugFeeGoals: input.calendarPlugFeeGoals ?? {},
      q1Goal: Number(input.q1Goal ?? 0),
      q2Goal: Number(input.q2Goal ?? 0),
      q3Goal: Number(input.q3Goal ?? 0),
      q4Goal: Number(input.q4Goal ?? 0),
      feeQ1Goal: Number(input.feeQ1Goal ?? 0),
      feeQ2Goal: Number(input.feeQ2Goal ?? 0),
      feeQ3Goal: Number(input.feeQ3Goal ?? 0),
      feeQ4Goal: Number(input.feeQ4Goal ?? 0),
      commissionYearStartMonth: Number(input.commissionYearStartMonth ?? 1),
      commissionMonthCount: Number(input.commissionMonthCount ?? 12),
    });

    return NextResponse.json({ goal });
  } catch (error) {
    const message = errorMessage(error);
    return NextResponse.json({ error: message || "Unable to save attorney goal." }, { status: 500 });
  }
}
