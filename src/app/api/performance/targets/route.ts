import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { canManagePerformanceTargets, canViewPerformance } from "@/lib/performance/access";
import { listPerformanceTargets, upsertPerformanceTarget } from "@/lib/performance/targets";
import { errorMessage } from "@/lib/utils";

export async function GET() {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformance(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ targets: await listPerformanceTargets() });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canManagePerformanceTargets(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await request.json()) as {
      metricKey: string;
      periodGrain: "week" | "month" | "quarter";
      targetValue: number;
      scope: "firm" | "role" | "user";
      scopeRole?: string | null;
      scopeUserId?: string | null;
      effectiveFrom: string;
      effectiveTo?: string | null;
      notes?: string | null;
    };
    const target = await upsertPerformanceTarget({
      ...body,
      createdBy: sessionUser.id,
      closePrevious: true,
    });
    return NextResponse.json({ target });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
