import { PageHeader } from "@/components/layout/page-header";
import { ResultsTable } from "@/components/results/results-table";
import { DISBURSED_STATUS_OPTIONS } from "@/lib/case-options";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";

export const dynamic = "force-dynamic";

function parseDisbursedFilter(value: string | undefined) {
  if (!value?.trim()) return "all";
  return DISBURSED_STATUS_OPTIONS.includes(value.trim() as (typeof DISBURSED_STATUS_OPTIONS)[number])
    ? value.trim()
    : "all";
}

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ disbursed?: string }>;
}) {
  const { disbursed } = await searchParams;
  const { records, users, settings, viewer } = await loadViewerCaseBundle();
  const resultsRecords = records.filter((record) => record.tracker.result.settlementDate);

  return (
    <>
      <PageHeader
        eyebrow="Results"
        title="Settlement and disbursement tracker"
        description="Cases with a settlement date only. Track release, closing, check deposited, disbursed, result quarter, and disbursement timing."
      />
      <ResultsTable
        records={resultsRecords}
        users={users}
        settings={settings}
        viewer={viewer}
        initialDisbursed={parseDisbursedFilter(disbursed)}
      />
    </>
  );
}
