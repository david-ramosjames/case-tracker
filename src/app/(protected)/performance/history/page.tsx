import { redirect } from "next/navigation";
import { HistoryView } from "@/components/performance/history-view";
import { requireSessionUser } from "@/lib/auth/session";
import { canViewPerformanceHistory } from "@/lib/performance/access";
import { weekStartMondayCt } from "@/lib/performance/weeks";
import { getUsers } from "@/lib/supabase/services";

export const dynamic = "force-dynamic";

export default async function PerformanceHistoryPage() {
  const sessionUser = await requireSessionUser();
  if (!canViewPerformanceHistory(sessionUser.role)) redirect("/performance/my-work");
  const users = await getUsers();
  return <HistoryView users={users} initialWeekStart={weekStartMondayCt()} />;
}
