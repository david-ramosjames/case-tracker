import { GoalsView } from "@/components/goals/goals-view";
import { PageHeader } from "@/components/layout/page-header";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const { records, goals, users } = await loadViewerCaseBundle();

  return (
    <>
      <PageHeader
        eyebrow="Goal Tracking"
        title="Attorney fee goals and pacing"
        description="Compare annual goals, quarterly targets, settled fees, disbursed fees, and forecasted fees with pace indicators."
      />
      <GoalsView records={records} goals={goals} users={users} />
    </>
  );
}
