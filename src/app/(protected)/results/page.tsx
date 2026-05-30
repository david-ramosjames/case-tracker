import { PageHeader } from "@/components/layout/page-header";
import { ResultsTable } from "@/components/results/results-table";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const { records, users, settings, viewer } = await loadViewerCaseBundle();

  return (
    <>
      <PageHeader
        eyebrow="Results"
        title="Settlement and disbursement tracker"
        description="Track release signed, closing signed, check deposited, check disbursed, result quarter, and disbursement timing."
      />
      <ResultsTable records={records} users={users} settings={settings} viewer={viewer} />
    </>
  );
}
