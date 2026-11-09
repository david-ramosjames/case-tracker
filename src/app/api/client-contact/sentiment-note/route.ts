import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { createTrackerComment } from "@/lib/supabase/services";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();

    const body = (await request.json()) as {
      caseId?: string;
      note?: string;
    };
    const caseId = String(body.caseId ?? "").trim();
    const note = String(body.note ?? "").trim();
    if (!caseId || !note) {
      return NextResponse.json({ error: "caseId and note are required." }, { status: 400 });
    }

    const { comment } = await createTrackerComment({
      caseId,
      authorId: sessionUser.id,
      authorName: sessionUser.name,
      type: "general_note",
      body: note,
    });

    return NextResponse.json({ ok: true, commentId: comment.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to post note.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
