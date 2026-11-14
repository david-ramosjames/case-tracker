import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { findContactForSession } from "@/lib/auth/access";
import { canViewPerformance } from "@/lib/performance/access";
import { moveCommitmentToWeek } from "@/lib/performance/deliverables";
import { getUsers } from "@/lib/supabase/services";
import { errorMessage } from "@/lib/utils";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformance(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const body = (await request.json()) as {
      fromCommitmentId: string;
      toWeekStart: string;
      plannedDate?: string | null;
    };
    if (!body.fromCommitmentId || !body.toWeekStart) {
      return NextResponse.json({ error: "fromCommitmentId and toWeekStart are required." }, { status: 400 });
    }
    const users = await getUsers();
    const contact = findContactForSession(users, sessionUser);
    const result = await moveCommitmentToWeek({
      deliverableId: id,
      fromCommitmentId: body.fromCommitmentId,
      toWeekStart: body.toWeekStart,
      plannedDate: body.plannedDate,
      actorUserId: contact?.id ?? sessionUser.id,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
