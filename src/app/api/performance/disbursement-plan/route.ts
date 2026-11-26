import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { canViewPerformance } from "@/lib/performance/access";
import { getCaseById, updateTrackerEntry } from "@/lib/supabase/services";
import { type DisbursementPlan } from "@/lib/types";
import { errorMessage } from "@/lib/utils";

const PLANS: DisbursementPlan[] = ["This Week", "Next Week", "2+ Weeks"];

/**
 * Move a Results-plan disbursement board row between This Week / Next Week / 2+ Weeks
 * without wiping other result fields.
 */
export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformance(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as { caseId?: string; plan?: string };
    const caseId = body.caseId?.trim();
    const plan = body.plan?.trim() as DisbursementPlan | undefined;
    if (!caseId || !plan || !PLANS.includes(plan)) {
      return NextResponse.json(
        { error: "caseId and plan (This Week | Next Week | 2+ Weeks) are required." },
        { status: 400 },
      );
    }

    const record = await getCaseById(caseId);
    if (!record) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }

    const nextResult = { ...record.tracker.result, disbursementPlan: plan };
    const { tracker } = await updateTrackerEntry(
      caseId,
      { result: nextResult },
      {
        actor: { userId: sessionUser.id, userName: sessionUser.name },
        markReviewed: true,
        changeInput: { result: nextResult },
      },
    );

    return NextResponse.json({ tracker, plan });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
