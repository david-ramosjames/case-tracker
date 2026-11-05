import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { buildViewerContext, canViewAllNeedsResponse, canViewerAccessCase } from "@/lib/auth/access";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { getNeedsResponseById, resolveNeedsResponse } from "@/lib/needs-response/repository";
import { getAttorneyGoals, getCases, getUsers } from "@/lib/supabase/services";

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();

    const body = (await request.json()) as { id?: string };
    const id = String(body.id ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }

    const item = await getNeedsResponseById(id);
    if (!item || item.status !== "open") {
      return NextResponse.json({ error: "That item is no longer open." }, { status: 404 });
    }

    const [records, users, goals] = await Promise.all([getCases(), getUsers(), getAttorneyGoals()]);
    const viewer = buildViewerContext(sessionUser, users);
    if (!canViewAllNeedsResponse(viewer)) {
      const caseNumber = cleanCaseNumber(item.caseNumber);
      const record = records.find((candidate) => cleanCaseNumber(candidate.shared.caseNumber) === caseNumber);
      if (!record || !canViewerAccessCase(record, sessionUser, users, goals)) {
        return NextResponse.json({ error: "You can only resolve items on your own cases." }, { status: 403 });
      }
    }

    await resolveNeedsResponse(id, sessionUser.name ?? sessionUser.email ?? null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resolve needs-response item.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
