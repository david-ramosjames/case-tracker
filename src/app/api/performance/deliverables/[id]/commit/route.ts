import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { findContactForSession } from "@/lib/auth/access";
import { canViewPerformance } from "@/lib/performance/access";
import { commitDeliverableToWeek } from "@/lib/performance/deliverables";
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
    const body = (await request.json().catch(() => ({}))) as {
      weekStart?: string;
      plannedDate?: string | null;
    };
    const users = await getUsers();
    const contact = findContactForSession(users, sessionUser);
    const result = await commitDeliverableToWeek({
      deliverableId: id,
      weekStart: body.weekStart,
      plannedDate: body.plannedDate,
      actorUserId: contact?.id ?? sessionUser.id,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
