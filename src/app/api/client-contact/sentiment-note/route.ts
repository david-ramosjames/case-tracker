import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { getAppOriginForNotifications } from "@/lib/auth/redirect-url";
import { saveSentimentNote } from "@/lib/client-contact/repository";
import { createTrackerComment, getCaseById } from "@/lib/supabase/services";

function sentimentSlackText(input: {
  sentiment: string;
  attorneySlackUserId: string | null | undefined;
  attorneyName: string;
  note: string;
  caseId: string;
  caseNumber: string;
}) {
  const mention = input.attorneySlackUserId?.trim()
    ? `<@${input.attorneySlackUserId.trim().toUpperCase()}>`
    : input.attorneyName.trim() || "attorney";
  const appUrl = getAppOriginForNotifications();
  const openCase = appUrl ? `<${appUrl}/cases/${input.caseId}|Open case>` : null;

  // Match team style: "🛑 Negative Sentiment: @Attorney note text…"
  const headline =
    input.sentiment === "Negative"
      ? `🛑 *Negative Sentiment:* ${mention} ${input.note}`
      : input.sentiment === "Neutral"
        ? `⚪ *Neutral Sentiment:* ${mention} ${input.note}`
        : input.sentiment === "Positive"
          ? `🟢 *Positive Sentiment:* ${mention} ${input.note}`
          : `*Sentiment Note:* ${mention} ${input.note}`;
  return openCase ? `${headline}\n${openCase}` : headline;
}

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();

    const body = (await request.json()) as {
      caseId?: string;
      clientName?: string;
      note?: string;
      sentiment?: string | null;
    };
    const caseId = String(body.caseId ?? "").trim();
    const clientName = String(body.clientName ?? "").trim();
    const note = String(body.note ?? "").trim();
    const sentiment = String(body.sentiment ?? "").trim();
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

    const attorneySlackUserId = record.attorney.slackUserId?.trim() || null;
    const slackText = sentimentSlackText({
      sentiment,
      attorneySlackUserId,
      attorneyName: record.attorney.name,
      note,
      caseId: record.shared.id,
      caseNumber: record.shared.caseNumber,
    });

    const { comment } = await createTrackerComment({
      caseId,
      authorId: sessionUser.id,
      authorName: sessionUser.name,
      type: "general_note",
      body: note,
      slackLabel: sentiment === "Negative" ? "Negative Sentiment" : "Sentiment Note",
      slackText,
      mentionSlackUserIds: attorneySlackUserId ? [attorneySlackUserId] : [],
    });

    return NextResponse.json({ ok: true, commentId: comment.id, note });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to post note.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
