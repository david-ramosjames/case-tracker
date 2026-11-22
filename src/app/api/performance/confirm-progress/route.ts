import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { findContactForSession } from "@/lib/auth/access";
import { canViewPerformance } from "@/lib/performance/access";
import { classifyLitDeliverableType } from "@/lib/performance/auto-progress";
import {
  shouldUpdateCaseStageOnProgressConfirm,
  stagePatchForProgressConfirm,
  targetStageForProgressConfirm,
} from "@/lib/performance/confirm-stage";
import {
  completeDeliverable,
  createDeliverable,
  listAllOpenDeliverables,
} from "@/lib/performance/deliverables";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCaseById, getUsers, toDatabaseStage, updateTrackerEntry } from "@/lib/supabase/services";
import { type PerformanceDeliverableType } from "@/lib/performance/types";
import { type CaseStage } from "@/lib/types";
import { errorMessage } from "@/lib/utils";

/**
 * Confirm a suggested weekly-goal completion (lit event, demand, lawsuit, disengagement).
 * Demand / lawsuit / disengagement also advance Case Tracker stage when that is not a
 * backward move (and never when the case is already Settled).
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
      stageSuggestionId?: string | null;
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

    let caseStageUpdated: CaseStage | null = null;
    const targetStage = targetStageForProgressConfirm(body.deliverableType);
    if (targetStage) {
      const record = await getCaseById(body.caseId);
      if (record && shouldUpdateCaseStageOnProgressConfirm(record.tracker.caseStage, targetStage)) {
        const actorName = contact?.name || sessionUser.email || "Performance confirm";
        const patch = stagePatchForProgressConfirm(record, targetStage);
        await updateTrackerEntry(body.caseId, patch, {
          actor: { userName: actorName },
          markReviewed: true,
          changeInput: patch,
        });
        caseStageUpdated = targetStage;
      }
    }

    if (body.stageSuggestionId) {
      const admin = createSupabaseAdminClient();
      if (admin) {
        const update: Record<string, unknown> = {
          confirmed_at: new Date().toISOString(),
        };
        if (caseStageUpdated) {
          update.suggested_stage = toDatabaseStage(caseStageUpdated);
        }
        await admin
          .from("case_tracker_stage_suggestions")
          .update(update)
          .eq("id", body.stageSuggestionId);
      }
    }

    return NextResponse.json({ deliverable, caseStageUpdated });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
