import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { canManagePerformanceTargets, canViewPerformance } from "@/lib/performance/access";
import {
  createPerformancePair,
  deletePerformancePair,
  listPerformancePairs,
  updatePerformancePair,
} from "@/lib/performance/pairs";
import { errorMessage } from "@/lib/utils";

export async function GET() {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformance(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ pairs: await listPerformancePairs() });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canManagePerformanceTargets(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await request.json()) as {
      attorneyContactId?: string | null;
      paralegalContactId?: string | null;
      attorneyLabel?: string | null;
      paralegalLabel?: string | null;
      effectiveFrom?: string;
      effectiveTo?: string | null;
      sortOrder?: number;
    };
    if (!body.effectiveFrom) {
      return NextResponse.json({ error: "effectiveFrom is required." }, { status: 400 });
    }
    if (!body.attorneyContactId && !body.attorneyLabel) {
      return NextResponse.json({ error: "Attorney contact or label is required." }, { status: 400 });
    }
    if (!body.paralegalContactId && !body.paralegalLabel) {
      return NextResponse.json({ error: "Paralegal contact or label is required." }, { status: 400 });
    }
    const pair = await createPerformancePair({
      attorneyContactId: body.attorneyContactId ?? null,
      paralegalContactId: body.paralegalContactId ?? null,
      attorneyLabel: body.attorneyLabel ?? null,
      paralegalLabel: body.paralegalLabel ?? null,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo ?? null,
      sortOrder: body.sortOrder,
    });
    return NextResponse.json({ pair });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canManagePerformanceTargets(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await request.json()) as {
      id: string;
      attorneyContactId?: string | null;
      paralegalContactId?: string | null;
      attorneyLabel?: string | null;
      paralegalLabel?: string | null;
      effectiveFrom?: string;
      effectiveTo?: string | null;
      sortOrder?: number;
    };
    if (!body.id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }
    const pair = await updatePerformancePair(body);
    return NextResponse.json({ pair });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canManagePerformanceTargets(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required." }, { status: 400 });
    }
    await deletePerformancePair(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
