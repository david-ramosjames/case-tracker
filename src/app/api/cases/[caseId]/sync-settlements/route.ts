import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { syncSettlementsFromGoogleSheetForCaseNumber } from "@/lib/google/settlements-sync";
import { getCaseById, isOrphanTrackerRecord } from "@/lib/supabase/services";

export async function POST(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();

    const { caseId } = await params;
    const record = await getCaseById(caseId);
    if (!record) {
      return NextResponse.json({ error: "Case not found." }, { status: 404 });
    }

    const result = await syncSettlementsFromGoogleSheetForCaseNumber(record.shared.caseNumber, {
      trackerEntryId: record.tracker.id,
      docketflowCaseId: isOrphanTrackerRecord(record) ? undefined : record.shared.id,
    });
    if (result.sheetRowsFound === 0) {
      if (result.clearedSheetData) {
        const refreshed = await getCaseById(caseId);
        return NextResponse.json({
          message: `No rows on the disbursing sheet for case ${result.caseNumber}. Cleared stale sheet settlement data.`,
          ...result,
          tracker: refreshed?.tracker ?? null,
          sharedStatus: refreshed ? refreshed.shared.status : null,
        });
      }
      if (result.financialLocked) {
        return NextResponse.json(
          {
            error: `No rows on the disbursing sheet for case ${result.caseNumber}, but financial backfill is locked — settlement data was not cleared.`,
            ...result,
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        {
          error: `No rows found on the disbursing sheet for case ${result.caseNumber}.`,
          ...result,
        },
        { status: 404 },
      );
    }
    if (result.casesProcessed === 0) {
      if (result.skippedFinancialLocked > 0) {
        return NextResponse.json(
          {
            error:
              "Financial backfill is locked for this case — sheet import cannot update settlement data. Unlock in Settings or change stage/disbursement manually.",
            ...result,
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        {
          error: `Found ${result.sheetRowsFound} sheet row(s) but could not match tracker entry for case ${result.caseNumber}.`,
          ...result,
        },
        { status: 404 },
      );
    }

    const refreshed = await getCaseById(caseId);
    return NextResponse.json({
      ...result,
      tracker: refreshed?.tracker ?? null,
      sharedStatus: refreshed ? refreshed.shared.status : null,
    });
  } catch (error) {
    console.error("Case settlement sheet sync failed", error);
    const message = error instanceof Error ? error.message : "Settlement sheet sync failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
