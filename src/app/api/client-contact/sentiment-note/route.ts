import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { saveSentimentNote } from "@/lib/client-contact/repository";
import { createTrackerComment, getCaseById } from "@/lib/supabase/services";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();

    const body = (await request.json()) as {
      caseId?: string;
      clientName?: string;
      note?: string;
    };
    const caseId = String(body.caseId ?? "").trim();
    const clientName = String(body.clientName ?? "").trim();
    const note = String(body.note ?? "").trim();
    if (!caseId || !note) {
      return NextResponse.json({ error: "caseId and note are required." }, { status: 400 });
    }

    const record = await getCaseById(caseId);
    if (!record) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }

    const contactName = clientName || record.shared.clientName;
    await saveSentimentNote({
      caseNumber: record.shared.caseNumber,
      clientName: contactName,
      note,
      updatedBy: sessionUser.name,
    });

    const { comment } = await createTrackerComment({
      caseId,
      authorId: sessionUser.id,
      authorName: sessionUser.name,
      type: "general_note",
      body: note,
      slackLabel: "Sentiment Note",
    });

    return NextResponse.json({ ok: true, commentId: comment.id, note });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to post note.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
