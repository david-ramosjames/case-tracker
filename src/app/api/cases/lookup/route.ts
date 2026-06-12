import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { filterRecordsForViewer } from "@/lib/auth/access";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { getAttorneyGoals, getCases, getUsers } from "@/lib/supabase/services";

export async function GET(request: Request) {
  const sessionUser = await requireApiSession();
  if (!sessionUser) return unauthorizedResponse();

  const caseNumber = cleanCaseNumber(new URL(request.url).searchParams.get("caseNumber") ?? "");
  if (!caseNumber) {
    return NextResponse.json({ error: "Case number is required." }, { status: 400 });
  }

  const [records, users, goals] = await Promise.all([getCases(), getUsers(), getAttorneyGoals()]);
  const visible = filterRecordsForViewer(records, sessionUser, users, goals);
  const match = visible.find((record) => cleanCaseNumber(record.shared.caseNumber) === caseNumber);

  if (!match) {
    return NextResponse.json({ error: "Case not found." }, { status: 404 });
  }

  return NextResponse.json({
    caseId: match.shared.id,
    caseNumber: match.shared.caseNumber,
    clientName: match.shared.clientName,
  });
}
