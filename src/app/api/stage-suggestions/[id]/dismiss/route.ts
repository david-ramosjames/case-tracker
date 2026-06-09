import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { dismissStageSuggestionById } from "@/lib/supabase/stage-suggestions";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();

    const { id } = await params;
    await dismissStageSuggestionById(id, sessionUser.name);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to dismiss stage suggestion.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
