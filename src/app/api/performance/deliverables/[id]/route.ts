import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { findContactForSession } from "@/lib/auth/access";
import { canViewPerformance } from "@/lib/performance/access";
import { updateDeliverable } from "@/lib/performance/deliverables";
import { getUsers } from "@/lib/supabase/services";
import { errorMessage } from "@/lib/utils";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformance(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { notes?: string | null };
    if (!("notes" in body)) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }
    const users = await getUsers();
    const contact = findContactForSession(users, sessionUser);
    const deliverable = await updateDeliverable({
      deliverableId: id,
      notes: body.notes ?? null,
      actorUserId: contact?.id ?? sessionUser.id,
    });
    return NextResponse.json({ deliverable });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
