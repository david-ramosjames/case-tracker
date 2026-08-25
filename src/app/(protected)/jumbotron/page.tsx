import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { JumbotronView } from "@/components/jumbotron/jumbotron-view";
import { canViewOutputAndGoals } from "@/lib/auth/constants";
import { requireSessionUser } from "@/lib/auth/session";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";

export const dynamic = "force-dynamic";

export default async function JumbotronPage() {
  const sessionUser = await requireSessionUser();
  if (!canViewOutputAndGoals(sessionUser.role)) redirect("/cases");

  const { records, goals, users, viewer } = await loadViewerCaseBundle();

  return (
    <>
      <PageHeader
        eyebrow="Insights"
        title="Jumbotron"
        description={
          viewer.isAttorney
            ? "Your case insights by case type and calendar year. Open metrics reflect your active pipeline; closed metrics use the selected calendar year."
            : "Firm-wide case insights with attorney and case-type filters. Open metrics reflect the active pipeline; closed metrics use the selected calendar year."
        }
      />
      <JumbotronView records={records} goals={goals} users={users} viewer={viewer} />
    </>
  );
}
