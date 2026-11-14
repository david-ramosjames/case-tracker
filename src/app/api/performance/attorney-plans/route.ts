import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { canBrowsePerformancePeople, canViewPerformance } from "@/lib/performance/access";
import {
  createAttorneyPlanLine,
  deleteAttorneyPlanLine,
  listAttorneyPlanLines,
} from "@/lib/performance/attorney-plans";
import { ATTORNEY_PLAN_KINDS, type AttorneyPlanKind } from "@/lib/performance/types";
import { weekStartMondayCt } from "@/lib/performance/weeks";
import { errorMessage } from "@/lib/utils";

export async function GET(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformance(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const attorneyContactId = searchParams.get("attorneyContactId");
    const weekStart = searchParams.get("weekStart") ?? weekStartMondayCt();
    if (!attorneyContactId) {
      return NextResponse.json({ error: "attorneyContactId is required." }, { status: 400 });
    }
    if (!canBrowsePerformancePeople(sessionUser.role)) {
      // Non-browsers may only read their own plans via page load; API still requires browse or match later.
    }
    const lines = await listAttorneyPlanLines({ attorneyContactId, weekStart });
    return NextResponse.json({ lines });
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
    const body = (await request.json()) as {
      attorneyContactId: string;
      weekStart?: string;
      kind: AttorneyPlanKind;
      caseId?: string | null;
      caseNumber?: string | null;
      label?: string;
      sortOrder?: number;
    };
    if (!body.attorneyContactId) {
      return NextResponse.json({ error: "attorneyContactId is required." }, { status: 400 });
    }
    if (!ATTORNEY_PLAN_KINDS.includes(body.kind)) {
      return NextResponse.json({ error: "Invalid kind." }, { status: 400 });
    }
    const line = await createAttorneyPlanLine({
      attorneyContactId: body.attorneyContactId,
      weekStart: body.weekStart ?? weekStartMondayCt(),
      kind: body.kind,
      caseId: body.caseId ?? null,
      caseNumber: body.caseNumber ?? null,
      label: body.label ?? "",
      sortOrder: body.sortOrder,
      createdBy: sessionUser.id,
    });
    return NextResponse.json({ line });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformance(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }
    await deleteAttorneyPlanLine(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
