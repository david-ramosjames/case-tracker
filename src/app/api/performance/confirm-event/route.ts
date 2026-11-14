import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { findContactForSession } from "@/lib/auth/access";
import { canViewPerformance } from "@/lib/performance/access";
import {
  completeDeliverable,
  createDeliverable,
  listAllOpenDeliverables,
} from "@/lib/performance/deliverables";
import { createPerformanceClient } from "@/lib/performance/db";
import { getUsers } from "@/lib/supabase/services";
import { errorMessage } from "@/lib/utils";

/**
 * Attorney confirms a Docket calendar lit event outcome.
 * Schedule alone never counts as complete — only confirmation does.
 * Does not mutate case stage / lit milestone fields.
 */
export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformance(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (
      sessionUser.role !== "attorney" &&
      sessionUser.role !== "admin" &&
      sessionUser.role !== "super_admin" &&
      sessionUser.role !== "manager"
    ) {
      return NextResponse.json({ error: "Attorney confirmation required." }, { status: 403 });
    }

    const body = (await request.json()) as {
      caseId: string;
      caseNumber: string;
      clientName?: string | null;
      docketEventId: string;
      eventTitle?: string | null;
      deliverableType?: "deposition" | "mediation" | "hearing" | "hearing_trial";
      litPersonName?: string | null;
      hearingType?: string | null;
      outcome: "completed" | "canceled" | "rescheduled";
      attorneyUserId?: string | null;
      assigneeUserId?: string | null;
    };

    if (!body.caseId || !body.docketEventId || !body.outcome) {
      return NextResponse.json({ error: "caseId, docketEventId, and outcome are required." }, { status: 400 });
    }

    const users = await getUsers();
    const contact = findContactForSession(users, sessionUser);
    const type = body.deliverableType ?? "hearing";

    const open = await listAllOpenDeliverables();
    let deliverable = open.find(
      (d) => d.docketEventId === body.docketEventId || d.identityKey === `docket:${body.docketEventId}`,
    );

    if (!deliverable) {
      deliverable = await createDeliverable(
        {
          caseId: body.caseId,
          caseNumber: body.caseNumber,
          clientNameSnapshot: body.clientName,
          deliverableType: type,
          docketEventId: body.docketEventId,
          documentLabel: body.eventTitle ?? undefined,
          litPersonName: body.litPersonName,
          hearingType: body.hearingType,
          attorneyUserId: body.attorneyUserId ?? contact?.id,
          assigneeUserId: body.assigneeUserId,
          identifiedBy: contact?.id,
        },
        contact?.id,
      );
    }

    if (body.outcome === "completed") {
      deliverable = await completeDeliverable({
        deliverableId: deliverable.id,
        completionSource: "confirmed_event",
        actorUserId: contact?.id,
      });
    } else if (body.outcome === "canceled") {
      const client = await createPerformanceClient();
      await client
        .from("performance_deliverables")
        .update({
          workflow_status: "cancelled",
          cancel_reason: "Attorney confirmed canceled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", deliverable.id);
    } else {
      const client = await createPerformanceClient();
      await client.from("performance_deliverable_events").insert({
        deliverable_id: deliverable.id,
        actor_user_id: contact?.id ?? null,
        event_type: "rescheduled_confirmed",
        payload: { docketEventId: body.docketEventId },
      });
    }

    return NextResponse.json({ deliverable, outcome: body.outcome });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
