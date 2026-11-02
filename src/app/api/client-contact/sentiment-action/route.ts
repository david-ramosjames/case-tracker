import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { setSentimentActionRequired } from "@/lib/client-contact/repository";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();

    const body = (await request.json()) as {
      caseNumber?: string;
      clientName?: string;
      actionRequired?: boolean;
    };
    const caseNumber = String(body.caseNumber ?? "").trim();
    const clientName = String(body.clientName ?? "").trim();
    if (!caseNumber || !clientName || typeof body.actionRequired !== "boolean") {
      return NextResponse.json({ error: "caseNumber, clientName, and actionRequired are required." }, { status: 400 });
    }

    await setSentimentActionRequired({
      caseNumber,
      clientName,
      actionRequired: body.actionRequired,
      updatedBy: sessionUser.name ?? sessionUser.email ?? null,
    });

    return NextResponse.json({ ok: true, actionRequired: body.actionRequired });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update action required.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
