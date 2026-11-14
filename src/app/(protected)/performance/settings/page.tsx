import { redirect } from "next/navigation";
import { PerformanceSettingsView } from "@/components/performance/settings-view";
import { requireSessionUser } from "@/lib/auth/session";
import { canManagePerformanceTargets } from "@/lib/performance/access";
import { getPerformanceAssumptions } from "@/lib/performance/assumptions";
import { listPerformancePairs } from "@/lib/performance/pairs";
import { listPerformanceStaffDates } from "@/lib/performance/staff-dates";
import { listPerformanceTargets } from "@/lib/performance/targets";
import { getUsers } from "@/lib/supabase/services";

export const dynamic = "force-dynamic";

export default async function PerformanceSettingsPage() {
  const sessionUser = await requireSessionUser();
  if (!canManagePerformanceTargets(sessionUser.role)) redirect("/performance/my-work");
  const [assumptions, targets, users, staffDates, pairs] = await Promise.all([
    getPerformanceAssumptions(),
    listPerformanceTargets(),
    getUsers(),
    listPerformanceStaffDates(),
    listPerformancePairs(),
  ]);
  return (
    <PerformanceSettingsView
      initialAssumptions={assumptions}
      initialTargets={targets}
      users={users}
      initialStaffDates={staffDates}
      initialPairs={pairs}
    />
  );
}
