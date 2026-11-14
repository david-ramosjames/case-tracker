import { TeamView } from "@/components/performance/team-view";
import { requireSessionUser } from "@/lib/auth/session";
import { listAllOpenDeliverables } from "@/lib/performance/deliverables";
import { createPerformanceClient } from "@/lib/performance/db";
import { rowToDeliverable } from "@/lib/performance/deliverables";
import { listPerformanceStaffDates, staffDatesByContactId } from "@/lib/performance/staff-dates";
import { weekStartMondayCt } from "@/lib/performance/weeks";
import { getUsers } from "@/lib/supabase/services";

export const dynamic = "force-dynamic";

export default async function PerformanceTeamPage() {
  await requireSessionUser();
  const [users, staffRows] = await Promise.all([getUsers(), listPerformanceStaffDates()]);
  const weekStart = weekStartMondayCt();
  const open = await listAllOpenDeliverables();

  // Also load recently completed for scoring actuals this week.
  const client = await createPerformanceClient();
  const { data } = await client
    .from("performance_deliverables")
    .select("*")
    .eq("workflow_status", "done")
    .gte("completed_at", `${weekStart}T00:00:00`)
    .limit(500);
  const completed = ((data ?? []) as Record<string, unknown>[]).map(rowToDeliverable);
  const byId = new Map<string, (typeof open)[number]>();
  for (const d of [...open, ...completed]) byId.set(d.id, d);

  return (
    <TeamView
      users={users}
      deliverables={[...byId.values()]}
      weekStart={weekStart}
      staffByContactId={staffDatesByContactId(staffRows)}
    />
  );
}
