import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { canViewAllNeedsResponse } from "@/lib/auth/access";
import { ensureProvisionedSessionUser } from "@/lib/auth/session";
import { getDashboardNavMetrics, toNavBadges } from "@/lib/dashboard/nav-metrics";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const sessionUser = await ensureProvisionedSessionUser();
  if (!sessionUser) {
    redirect("/login");
  }

  let badges = {};
  try {
    const { records, viewer } = await loadViewerCaseBundle();
    const metrics = await getDashboardNavMetrics(records, {
      needsResponseFirmwide: canViewAllNeedsResponse(viewer),
    });
    badges = toNavBadges(metrics);
  } catch {
    // Keep nav usable if badge metrics fail.
  }

  return (
    <AppShell sessionUser={sessionUser} badges={badges}>
      {children}
    </AppShell>
  );
}
