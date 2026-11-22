import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { findContactForSession } from "@/lib/auth/access";
import { canViewPerformance } from "@/lib/performance/access";
import { buildAutoProgress, closingSignalDoneKey } from "@/lib/performance/auto-progress";
import {
  completeDeliverable,
  createDeliverable,
  listCommitmentsForWeek,
  listDeliverablesForPerson,
} from "@/lib/performance/deliverables";
import { asYmdPrefix, weekEndFromStart, weekStartMondayCt } from "@/lib/performance/weeks";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { listDocketFlowCaseEvents, getUsers } from "@/lib/supabase/services";
import { errorMessage } from "@/lib/utils";

/**
 * Match planned/in-progress weekly goals to Case Tracker + DocketFlow + stage signals.
 * Auto-completes settlement/disbursement (no verification). Returns needs-confirm candidates.
 */
export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformance(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as {
      personId?: string;
      role?: "attorney" | "paralegal";
      weekStart?: string;
      applyAutoCompletes?: boolean;
    };

    const role = body.role === "attorney" ? "attorney" : "paralegal";
    const weekStart = body.weekStart?.slice(0, 10) || weekStartMondayCt();
    const users = await getUsers();
    const contact = findContactForSession(users, sessionUser);
    const personId = body.personId || contact?.id;
    if (!personId) {
      return NextResponse.json({ error: "personId is required." }, { status: 400 });
    }

    const { records } = await loadViewerCaseBundle();
    const assigned = records.filter((r) =>
      role === "attorney" ? r.shared.attorneyId === personId : r.shared.paralegalId === personId,
    );

    const [deliverables, commitments] = await Promise.all([
      listDeliverablesForPerson({
        contactId: personId,
        asAttorney: role === "attorney",
        completedSince: weekStart,
      }),
      listCommitmentsForWeek(weekStart),
    ]);

    const eventsByCaseId: Record<string, Awaited<ReturnType<typeof listDocketFlowCaseEvents>>> = {};
    const weekEnd = weekEndFromStart(weekStart);
    await Promise.all(
      assigned.slice(0, 40).map(async (record) => {
        try {
          const events = await listDocketFlowCaseEvents(record.shared.id);
          eventsByCaseId[record.shared.id] = events.filter((ev) => {
            const dateDay = asYmdPrefix(ev.date) || asYmdPrefix(ev.startDateTime) || "";
            const createdDay = asYmdPrefix(ev.createdAt) || "";
            return (
              (dateDay >= weekStart && dateDay <= weekEnd) ||
              (createdDay >= weekStart && createdDay <= weekEnd)
            );
          });
        } catch {
          eventsByCaseId[record.shared.id] = [];
        }
      }),
    );

    const { candidates, autoCompletes } = buildAutoProgress({
      role,
      personId,
      weekStart,
      records: assigned,
      deliverables,
      commitments,
      eventsByCaseId,
    });

    const applied: Array<{ deliverableId: string; kind: string; caseNumber: string }> = [];
    if (body.applyAutoCompletes !== false) {
      for (const action of autoCompletes) {
        await completeDeliverable({
          deliverableId: action.deliverableId,
          completionSource: "system",
          actorUserId: contact?.id,
          completedAt: action.completedAt,
        });
        applied.push({
          deliverableId: action.deliverableId,
          kind: action.kind,
          caseNumber: action.caseNumber,
        });
      }
    }

    // Info-only settlement/disbursement candidates without a planned item: create+complete system rows
    // so person scorecards include them without verification. Skip if already recorded for that date.
    if (body.applyAutoCompletes !== false && role === "attorney") {
      const existingClosingKeys = new Set(
        deliverables
          .filter(
            (d) =>
              d.workflowStatus === "done" &&
              (d.deliverableType === "settlement" || d.deliverableType === "disbursement"),
          )
          .map((d) =>
            closingSignalDoneKey(
              d.deliverableType as "settlement" | "disbursement",
              d.caseId,
              asYmdPrefix(d.completedAt) || asYmdPrefix(d.plannedDate),
            ),
          )
          .filter(Boolean) as string[],
      );
      for (const candidate of candidates.filter((c) => !c.requiresVerification && !c.deliverableId)) {
        if (candidate.kind !== "settlement" && candidate.kind !== "disbursement") continue;
        const signalKey = closingSignalDoneKey(candidate.kind, candidate.caseId, candidate.signalDate);
        if (signalKey && existingClosingKeys.has(signalKey)) continue;
        const created = await createDeliverable(
          {
            caseId: candidate.caseId,
            caseNumber: candidate.caseNumber,
            clientNameSnapshot: candidate.clientName,
            deliverableType: candidate.deliverableType,
            attorneyUserId: candidate.attorneyUserId,
            assigneeUserId: candidate.assigneeUserId,
            identifiedBy: contact?.id,
            notes: candidate.reason,
          },
          contact?.id,
        );
        await completeDeliverable({
          deliverableId: created.id,
          completionSource: "system",
          actorUserId: contact?.id,
          completedAt: `${candidate.signalDate}T18:00:00.000Z`,
        });
        if (signalKey) existingClosingKeys.add(signalKey);
        applied.push({
          deliverableId: created.id,
          kind: candidate.kind,
          caseNumber: candidate.caseNumber,
        });
      }
    }

    const needsConfirm = candidates.filter((c) => c.requiresVerification);

    return NextResponse.json({
      weekStart,
      applied,
      autoCompletes,
      needsConfirm,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
