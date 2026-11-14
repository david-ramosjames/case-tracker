import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { findContactForSession } from "@/lib/auth/access";
import {
  canViewAllParalegalWorkloads,
  canViewPerformance,
} from "@/lib/performance/access";
import {
  createDeliverable,
  listAllOpenDeliverables,
  listDeliverablesForAssignee,
  listDeliverablesForPerson,
} from "@/lib/performance/deliverables";
import { type CreateDeliverableInput } from "@/lib/performance/types";
import { getCaseById, getUsers } from "@/lib/supabase/services";
import { errorMessage } from "@/lib/utils";

export async function GET(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformance(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const users = await getUsers();
    const contact = findContactForSession(users, sessionUser);
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") ?? "mine";
    const assigneeId = url.searchParams.get("assigneeId");
    const personId = url.searchParams.get("personId");
    const asAttorney = url.searchParams.get("asAttorney") === "1";
    const completedSince = url.searchParams.get("completedSince") ?? undefined;

    if (personId) {
      if (!canViewAllParalegalWorkloads(sessionUser.role) && personId !== contact?.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({
        deliverables: await listDeliverablesForPerson({
          contactId: personId,
          asAttorney,
          completedSince,
        }),
      });
    }

    if (scope === "all" || assigneeId) {
      if (!canViewAllParalegalWorkloads(sessionUser.role) && assigneeId !== contact?.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (assigneeId) {
        return NextResponse.json({ deliverables: await listDeliverablesForAssignee(assigneeId) });
      }
      return NextResponse.json({ deliverables: await listAllOpenDeliverables() });
    }

    if (!contact) return NextResponse.json({ deliverables: [] });
    return NextResponse.json({ deliverables: await listDeliverablesForAssignee(contact.id) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformance(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as CreateDeliverableInput;
    const users = await getUsers();
    const contact = findContactForSession(users, sessionUser);

    let attorneyUserId = body.attorneyUserId ?? null;
    let assigneeUserId = body.assigneeUserId ?? null;
    let clientNameSnapshot = body.clientNameSnapshot ?? null;
    let caseNumber = body.caseNumber;

    if (body.caseId) {
      const record = await getCaseById(body.caseId);
      if (record) {
        attorneyUserId = attorneyUserId ?? record.shared.attorneyId;
        assigneeUserId = assigneeUserId ?? record.shared.paralegalId;
        clientNameSnapshot = clientNameSnapshot ?? record.shared.clientName;
        caseNumber = caseNumber || record.shared.caseNumber;
      }
    }

    const deliverable = await createDeliverable(
      {
        ...body,
        caseNumber,
        clientNameSnapshot,
        attorneyUserId,
        assigneeUserId,
        identifiedBy: contact?.id ?? sessionUser.id,
      },
      contact?.id ?? sessionUser.id,
    );

    return NextResponse.json({ deliverable });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
