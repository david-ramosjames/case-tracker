import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { findContactForSession } from "@/lib/auth/access";
import { canViewPerformance } from "@/lib/performance/access";
import {
  cancelDeliverable,
  createDeliverable,
  DuplicateDeliverableError,
} from "@/lib/performance/deliverables";
import { dismissStageSuggestionById } from "@/lib/supabase/stage-suggestions";
import { getUsers } from "@/lib/supabase/services";
import { type PerformanceDeliverableType } from "@/lib/performance/types";
import { errorMessage } from "@/lib/utils";

/**
 * Dismiss a weekly-goal confirmation candidate (not completed / won't count).
 * - Stage-signal items: dismiss the underlying stage suggestion.
 * - Docket calendar items: create+cancel a stub tied to that event (does not cancel an
 *   existing planned item if one already owns the docket id).
 */
export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformance(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as {
      candidateId?: string;
      caseId?: string;
      caseNumber?: string;
      clientName?: string | null;
      deliverableType?: PerformanceDeliverableType;
      deliverableId?: string | null;
      docketEventId?: string | null;
      stageSuggestionId?: string | null;
      eventTitle?: string | null;
      attorneyUserId?: string | null;
      assigneeUserId?: string | null;
      reason?: string | null;
    };

    if (!body.candidateId) {
      return NextResponse.json({ error: "candidateId is required." }, { status: 400 });
    }

    const users = await getUsers();
    const contact = findContactForSession(users, sessionUser);
    const actorUserId = contact?.id ?? sessionUser.id;
    const dismissReason = body.reason?.trim() || "Dismissed from weekly goal progress";

    if (body.stageSuggestionId) {
      await dismissStageSuggestionById(body.stageSuggestionId, sessionUser.name);
    }

    if (body.docketEventId && body.caseId && body.caseNumber && body.deliverableType) {
      try {
        const created = await createDeliverable(
          {
            caseId: body.caseId,
            caseNumber: body.caseNumber,
            clientNameSnapshot: body.clientName,
            deliverableType: body.deliverableType,
            docketEventId: body.docketEventId,
            documentLabel: body.eventTitle ?? undefined,
            attorneyUserId: body.attorneyUserId ?? contact?.id,
            assigneeUserId: body.assigneeUserId,
            identifiedBy: contact?.id,
            notes: dismissReason,
          },
          actorUserId,
        );
        await cancelDeliverable({
          deliverableId: created.id,
          reason: dismissReason,
          actorUserId,
        });
      } catch (error) {
        // An open planned item already owns this docket id — leave it; client stores a
        // local dismiss so this week's confirmation card stays hidden.
        if (!(error instanceof DuplicateDeliverableError)) throw error;
      }
    }

    return NextResponse.json({ ok: true, candidateId: body.candidateId });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
