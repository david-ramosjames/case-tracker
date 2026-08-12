import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { createTrackerComment } from "@/lib/supabase/services";
import { type CommentType } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();

    const input = (await request.json()) as {
      caseId: string;
      type: CommentType;
      body: string;
      notifyContactIds?: string[];
    };

    const { comment, activity } = await createTrackerComment({
      caseId: input.caseId,
      authorId: sessionUser.id,
      authorName: sessionUser.name,
      type: input.type,
      body: input.body,
      notifyContactIds: Array.isArray(input.notifyContactIds) ? input.notifyContactIds : [],
    });

    return NextResponse.json({ comment, activity });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create tracker comment.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
