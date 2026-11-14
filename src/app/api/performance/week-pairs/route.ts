import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { canManagePerformanceTargets, canViewPerformance } from "@/lib/performance/access";
import {
  copyWeekPairs,
  ensureWeekPairs,
  replaceWeekPairs,
} from "@/lib/performance/week-pairs";
import { shiftWeekStart } from "@/lib/performance/team-rollup";
import { weekStartMondayCt } from "@/lib/performance/weeks";
import { errorMessage } from "@/lib/utils";

export async function GET(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformance(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const weekStart = searchParams.get("weekStart") ?? weekStartMondayCt();
    // Auto-carries prior week seats when this week has none yet.
    return NextResponse.json({ pairs: await ensureWeekPairs(weekStart), weekStart });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canManagePerformanceTargets(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await request.json()) as {
      weekStart?: string;
      seats: Array<{
        seatIndex: number;
        paralegalContactId?: string | null;
        attorneyContactId?: string | null;
        paralegalLabel?: string | null;
        attorneyLabel?: string | null;
      }>;
      copyFromPrevious?: boolean;
    };
    const weekStart = body.weekStart ?? weekStartMondayCt();
    if (body.copyFromPrevious) {
      const pairs = await copyWeekPairs(shiftWeekStart(weekStart, -1), weekStart);
      return NextResponse.json({ pairs, weekStart });
    }
    if (!Array.isArray(body.seats)) {
      return NextResponse.json({ error: "seats is required." }, { status: 400 });
    }
    const pairs = await replaceWeekPairs({ weekStart, seats: body.seats });
    return NextResponse.json({ pairs, weekStart });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
