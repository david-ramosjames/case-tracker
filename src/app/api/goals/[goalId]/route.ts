import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { deleteAttorneyGoal } from "@/lib/supabase/services";

export async function DELETE(_request: Request, { params }: { params: Promise<{ goalId: string }> }) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const { goalId } = await params;
    if (!goalId?.trim()) {
      return NextResponse.json({ error: "Goal id is required." }, { status: 400 });
    }

    await deleteAttorneyGoal(goalId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete attorney goal.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
