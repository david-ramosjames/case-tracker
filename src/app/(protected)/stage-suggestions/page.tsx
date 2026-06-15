import { StageSuggestionsPanel } from "@/components/dashboard/stage-suggestions-panel";
import { PageHeader } from "@/components/layout/page-header";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";

export const dynamic = "force-dynamic";

export default async function StageSuggestionsPage() {
  const { records } = await loadViewerCaseBundle();

  return (
    <>
      <PageHeader
        eyebrow="Workflow"
        title="Stage suggestions"
        description="Confirm or dismiss inferred stage changes from the daily pulse recap — no need to hunt through Slack."
      />
      <StageSuggestionsPanel records={records} showEmpty />
    </>
  );
}
