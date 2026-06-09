import { GoalsView } from "@/components/goals/goals-view";
import { PageHeader } from "@/components/layout/page-header";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const { records, goals, users, viewer } = await loadViewerCaseBundle();

  return (
    <>
      <PageHeader
        eyebrow="Goal Tracking"
        title={viewer.isAttorney ? "Your fee goals and pacing" : "Attorney fee goals and pacing"}
        description={
          viewer.isAttorney
            ? "Current commission year progress, forecasted fees, and quarterly target/plan/actual performance."
            : "Compare annual goals, quarterly target/plan/actual, settled fees, disbursed fees, and forecasted fees with pace indicators."
        }
      />
      <GoalsView records={records} goals={goals} users={users} viewer={viewer} />
    </>
  );
}
