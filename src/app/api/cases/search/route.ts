import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { filterRecordsForViewer } from "@/lib/auth/access";
import { matchesCaseSearch, sortCaseSearchResults } from "@/lib/case-search";
import { getAttorneyGoals, getCases, getUsers } from "@/lib/supabase/services";

export async function GET(request: Request) {
  const sessionUser = await requireApiSession();
  if (!sessionUser) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(12, Math.max(1, Number(searchParams.get("limit") ?? 8)));

  if (query.length < 1) {
    return NextResponse.json({ results: [] });
  }

  const [records, users, goals] = await Promise.all([getCases(), getUsers(), getAttorneyGoals()]);
  const visible = filterRecordsForViewer(records, sessionUser, users, goals);
  const matches = sortCaseSearchResults(visible.filter((record) => matchesCaseSearch(record, query)), query);
  const results = matches.slice(0, limit).map((record) => ({
    caseId: record.shared.id,
    caseNumber: record.shared.caseNumber,
    clientName: record.shared.clientName,
    attorneyName: record.attorney.name,
    caseStage: record.tracker.caseStage,
  }));

  return NextResponse.json({
    results,
    total: matches.length,
    query,
  });
}
