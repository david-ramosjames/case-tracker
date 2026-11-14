import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { canManagePerformanceTargets, canViewPerformance } from "@/lib/performance/access";
import { getPerformanceAssumptions, updatePerformanceAssumptions } from "@/lib/performance/assumptions";
import { errorMessage } from "@/lib/utils";

export async function GET() {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformance(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ assumptions: await getPerformanceAssumptions() });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canManagePerformanceTargets(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await request.json()) as {
      settlementToDisburseLagDays?: number;
      agingTargetDays?: number;
      agingWarnDays?: number;
    };
    const assumptions = await updatePerformanceAssumptions({
      ...body,
      updatedBy: sessionUser.id,
    });
    return NextResponse.json({ assumptions });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
