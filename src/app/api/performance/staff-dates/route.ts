import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { canManagePerformanceTargets, canViewPerformance } from "@/lib/performance/access";
import { listPerformanceStaffDates, upsertPerformanceStaffDates } from "@/lib/performance/staff-dates";
import { errorMessage } from "@/lib/utils";

export async function GET() {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformance(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ staffDates: await listPerformanceStaffDates() });
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
      contactId: string;
      employmentStartDate?: string | null;
      employmentEndDate?: string | null;
    };
    if (!body.contactId) {
      return NextResponse.json({ error: "contactId is required." }, { status: 400 });
    }
    const row = await upsertPerformanceStaffDates(body);
    return NextResponse.json({ staffDates: row });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
