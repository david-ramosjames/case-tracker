import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { updateContactScoreboardAttorneys } from "@/lib/supabase/services";

function requireAdmin(sessionUser: Awaited<ReturnType<typeof requireApiSession>>) {
  if (!sessionUser) return unauthorizedResponse();
  if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  return null;
}

export async function PUT(request: Request) {
  const sessionUser = await requireApiSession();
  const denied = requireAdmin(sessionUser);
  if (denied) return denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const attorneyIds = Array.isArray(body.attorneyIds)
      ? body.attorneyIds.filter((id): id is string => typeof id === "string")
      : [];
    const saved = await updateContactScoreboardAttorneys(attorneyIds);
    return NextResponse.json({ attorneyIds: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save the contact scoreboard.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
