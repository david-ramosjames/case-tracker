import { StageSuggestionsPanel } from "@/components/dashboard/stage-suggestions-panel";
import { PageHeader } from "@/components/layout/page-header";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";

export const dynamic = "force-dynamic";

export default async function StageSuggestionsPage() {
  const { records, users, viewer } = await loadViewerCaseBundle();

  return (
    <>
      <PageHeader
        eyebrow="Workflow"
        title="Stage suggestions"
        description={
          viewer.isAttorney
            ? "Confirm or dismiss inferred stage changes on your cases from the daily pulse recap."
            : "Confirm or dismiss inferred stage changes from the daily pulse recap — filter by attorney to focus the queue."
        }
      />
      <StageSuggestionsPanel records={records} users={users} viewer={viewer} showEmpty />
    </>
  );
}
