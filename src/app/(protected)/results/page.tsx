import { PageHeader } from "@/components/layout/page-header";
import { ResultsTable } from "@/components/results/results-table";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const { records, users, settings, viewer } = await loadViewerCaseBundle();
  const resultsRecords = records.filter((record) => record.tracker.result.settlementDate);

  return (
    <>
      <PageHeader
        eyebrow="Results"
        title="Settlement and disbursement tracker"
        description="Cases with a settlement date only. Track release, closing, check deposited, disbursed, result quarter, and disbursement timing."
      />
      <ResultsTable records={resultsRecords} users={users} settings={settings} viewer={viewer} />
    </>
  );
}
