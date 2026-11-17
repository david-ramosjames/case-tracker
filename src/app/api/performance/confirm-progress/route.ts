import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { findContactForSession } from "@/lib/auth/access";
import { canViewPerformance } from "@/lib/performance/access";
import { classifyLitDeliverableType } from "@/lib/performance/auto-progress";
import {
  completeDeliverable,
  createDeliverable,
  listAllOpenDeliverables,
} from "@/lib/performance/deliverables";
import { getUsers } from "@/lib/supabase/services";
import { type PerformanceDeliverableType } from "@/lib/performance/types";
import { errorMessage } from "@/lib/utils";

/**
 * Confirm a suggested weekly-goal completion (lit event, demand, lawsuit, disengagement).
 * Does not mutate case stage.
 */
export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformance(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as {
      caseId: string;
      caseNumber: string;
      clientName?: string | null;
      deliverableType: PerformanceDeliverableType;
      deliverableId?: string | null;
      docketEventId?: string | null;
      eventTitle?: string | null;
      attorneyUserId?: string | null;
      assigneeUserId?: string | null;
      completedAt?: string | null;
      notes?: string | null;
    };

    if (!body.caseId || !body.caseNumber || !body.deliverableType) {
      return NextResponse.json(
        { error: "caseId, caseNumber, and deliverableType are required." },
        { status: 400 },
      );
    }

    const users = await getUsers();
    const contact = findContactForSession(users, sessionUser);
    const open = await listAllOpenDeliverables();

    let deliverable =
      (body.deliverableId ? open.find((d) => d.id === body.deliverableId) : null) ??
      (body.docketEventId
        ? open.find(
            (d) =>
              d.docketEventId === body.docketEventId ||
              d.identityKey === `docket:${body.docketEventId}`,
          )
        : null);

    if (!deliverable) {
      const type =
        body.deliverableType === "hearing" ||
        body.deliverableType === "deposition" ||
        body.deliverableType === "mediation" ||
        body.deliverableType === "hearing_trial"
          ? classifyLitDeliverableType(body.eventTitle) || body.deliverableType
          : body.deliverableType;

      deliverable = await createDeliverable(
        {
          caseId: body.caseId,
          caseNumber: body.caseNumber,
          clientNameSnapshot: body.clientName,
          deliverableType: type,
          docketEventId: body.docketEventId ?? undefined,
          documentLabel: body.eventTitle ?? undefined,
          attorneyUserId: body.attorneyUserId ?? contact?.id,
          assigneeUserId: body.assigneeUserId,
          identifiedBy: contact?.id,
          notes: body.notes ?? undefined,
        },
        contact?.id,
      );
    }

    deliverable = await completeDeliverable({
      deliverableId: deliverable.id,
      completionSource: "confirmed_event",
      actorUserId: contact?.id,
      completedAt: body.completedAt,
    });

    return NextResponse.json({ deliverable });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
