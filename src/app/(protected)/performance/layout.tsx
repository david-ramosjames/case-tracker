import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PerformanceShell } from "@/components/performance/performance-shell";
import { canManagePerformanceTargets, canViewPerformance } from "@/lib/performance/access";
import { requireSessionUser } from "@/lib/auth/session";

export default async function PerformanceLayout({ children }: { children: React.ReactNode }) {
  const sessionUser = await requireSessionUser();
  if (!canViewPerformance(sessionUser.role)) redirect("/cases");

  return (
    <>
      <PageHeader
        eyebrow="Goals & Performance"
        title="Performance"
        description="Weekly work plans, firm pacing, and activity scores — without changing case statuses."
      />
      <PerformanceShell showSettings={canManagePerformanceTargets(sessionUser.role)}>{children}</PerformanceShell>
    </>
  );
}
