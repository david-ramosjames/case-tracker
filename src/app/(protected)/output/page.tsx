import { PageHeader } from "@/components/layout/page-header";
import { OutputView } from "@/components/output/output-view";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";

export const dynamic = "force-dynamic";

export default async function OutputPage() {
  const { records, goals, users } = await loadViewerCaseBundle();

  return (
    <>
      <PageHeader
        eyebrow="Output"
        title="Firm results and pacing"
        description="Roll up case statuses, settled versus disbursed results, completed disbursements, and commission threshold. Filter by attorney or paralegal."
      />
      <OutputView records={records} goals={goals} users={users} />
    </>
  );
}
