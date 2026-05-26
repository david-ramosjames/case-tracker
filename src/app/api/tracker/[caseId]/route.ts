import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { deleteTrackerCase, updateSharedCaseFields, updateTrackerEntry } from "@/lib/supabase/services";
import { type CaseStatus, type SettlementResult, type TrackerUpdateInput } from "@/lib/types";

export async function PATCH(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();

    const { caseId } = await params;
    const input = (await request.json()) as {
      shared?: { status?: CaseStatus; caseType?: string; dateOfIncident?: string | null };
      tracker?: TrackerUpdateInput & { result?: SettlementResult };
      markReviewed?: boolean;
    } & TrackerUpdateInput;
    const trackerInput = input.tracker ?? input;

    if (input.shared) {
      await updateSharedCaseFields(caseId, input.shared);
    }

    const { tracker, activity } = await updateTrackerEntry(caseId, trackerInput, {
      actor: { userId: sessionUser.id, userName: sessionUser.name },
      shared: input.shared,
      markReviewed: input.markReviewed,
    });

    return NextResponse.json({ tracker, activity });
  } catch (error) {
    console.error("Unable to update tracker entry", error);
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error && "message" in error && typeof error.message === "string"
          ? error.message
          : "Unable to update tracker entry.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (sessionUser.role !== "admin" && sessionUser.role !== "super_admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const { caseId } = await params;
    const deleteDocketflowCase = new URL(request.url).searchParams.get("deleteDocketflowCase") === "true";
    const result = await deleteTrackerCase(caseId, { deleteDocketflowCase });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Unable to delete tracker case", error);
    const message = error instanceof Error ? error.message : "Unable to delete tracker case.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
