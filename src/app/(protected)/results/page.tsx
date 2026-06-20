import { PageHeader } from "@/components/layout/page-header";
import { ResultsTabRules } from "@/components/results/results-tab-rules";
import { ResultsTable } from "@/components/results/results-table";
import { DISBURSED_STATUS_OPTIONS } from "@/lib/case-options";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { isResultsTabCase } from "@/lib/results-commission-year";

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
  const { records, goals, users, settings, viewer } = await loadViewerCaseBundle();
  const resultsRecords = records.filter((record) => isResultsTabCase(record, goals));

  return (
    <>
      <PageHeader
        eyebrow="Results"
        title="Settlement and disbursement tracker"
        description="Settlements and disbursements in the current calendar year or each attorney commission year, plus open undisbursed settlements. Track release, closing, check, reductions, and disbursement workflow."
      />
      <ResultsTabRules />
      <ResultsTable
        records={resultsRecords}
        goals={goals}
        users={users}
        settings={settings}
        viewer={viewer}
        initialDisbursed={parseDisbursedFilter(disbursed)}
      />
    </>
  );
}
