import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { upsertAttorneyGoal, type AttorneyGoalInput } from "@/lib/supabase/services";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const input = (await request.json()) as AttorneyGoalInput;
    if (!input.attorneyName?.trim() || !input.year) {
      return NextResponse.json({ error: "Attorney and year are required." }, { status: 400 });
    }

    const goal = await upsertAttorneyGoal({
      attorneyId: input.attorneyId,
      attorneyName: input.attorneyName.trim(),
      year: Number(input.year),
      annualGrossGoal: Number(input.annualGrossGoal ?? 0),
      commissionThreshold: Number(input.commissionThreshold ?? 0),
      monthlyGoals: input.monthlyGoals ?? {},
      q1Goal: Number(input.q1Goal ?? 0),
      q2Goal: Number(input.q2Goal ?? 0),
      q3Goal: Number(input.q3Goal ?? 0),
      q4Goal: Number(input.q4Goal ?? 0),
      commissionYearStartMonth: Number(input.commissionYearStartMonth ?? 1),
      commissionMonthCount: Number(input.commissionMonthCount ?? 12),
    });

    return NextResponse.json({ goal });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save attorney goal.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
