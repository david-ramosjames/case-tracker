import { NextResponse } from "next/server";
import { unauthorizedResponse, requireApiSession } from "@/lib/auth/api";
import { canViewPerformanceHistory } from "@/lib/performance/access";
import {
  listCommitmentsForWeek,
  listDeliverablesForAssignee,
  listEventsForDeliverable,
} from "@/lib/performance/deliverables";
import { getLatestMondaySnapshot, listSnapshotsForWeek } from "@/lib/performance/snapshots";
import { weekStartMondayCt } from "@/lib/performance/weeks";
import { errorMessage } from "@/lib/utils";

export async function GET(request: Request) {
  try {
    const sessionUser = await requireApiSession();
    if (!sessionUser) return unauthorizedResponse();
    if (!canViewPerformanceHistory(sessionUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const weekStart = url.searchParams.get("weekStart") ?? weekStartMondayCt();
    const userId = url.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "userId is required." }, { status: 400 });
    }

    const [deliverables, commitments, monday, snapshots] = await Promise.all([
      listDeliverablesForAssignee(userId),
      listCommitmentsForWeek(weekStart),
      getLatestMondaySnapshot(weekStart),
      listSnapshotsForWeek(weekStart),
    ]);

    const deliverableIds = new Set(deliverables.map((d) => d.id));
    const userCommitments = commitments.filter((c) => deliverableIds.has(c.deliverableId));
    const mondayIds = new Set(
      ((monday?.payload.commitmentIds as string[] | undefined) ?? []).map(String),
    );

    const eventsByDeliverable: Record<string, Awaited<ReturnType<typeof listEventsForDeliverable>>> = {};
    for (const d of deliverables.slice(0, 40)) {
      eventsByDeliverable[d.id] = await listEventsForDeliverable(d.id);
    }

    return NextResponse.json({
      weekStart,
      userId,
      monday,
      snapshots,
      deliverables,
      commitments: userCommitments.map((c) => ({
        ...c,
        inMondayPlan: mondayIds.has(c.id),
        addedAfterMonday: !mondayIds.has(c.id),
      })),
      eventsByDeliverable,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
