import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { confirmStageSuggestionById } from "@/lib/supabase/stage-suggestions";
import { type CaseStage } from "@/lib/types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();

    const { id } = await params;
    const input = (await request.json().catch(() => ({}))) as { stage?: CaseStage };

    const result = await confirmStageSuggestionById(id, {
      stage: input.stage,
      actorName: sessionUser.name,
    });

    return NextResponse.json({
      ok: true,
      stage: result.stage,
      tracker: result.tracker,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to confirm stage suggestion.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
