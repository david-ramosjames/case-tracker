import { CaseTable } from "@/components/cases/case-table";
import { PageHeader } from "@/components/layout/page-header";
import { type CasePipelineFilter } from "@/lib/auth/access";
import { parseCaseListQualityFilter } from "@/lib/case-list-filters";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";

export const dynamic = "force-dynamic";

function parsePipelineStatus(
  value: string | undefined,
  qualityFilter: ReturnType<typeof parseCaseListQualityFilter>,
): CasePipelineFilter {
  if (value === "all" || value === "Active" || value === "Closed" || value === "Historical") {
    return value;
  }
  return qualityFilter ? "all" : "Active";
}

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; status?: string }>;
}) {
  const { q, filter, status } = await searchParams;
  const qualityFilter = parseCaseListQualityFilter(filter);
  const { records, users, settings, goals, viewer } = await loadViewerCaseBundle();

  return (
    <>
      <PageHeader
        eyebrow="Case List"
        title={viewer.isAttorney ? "Your case pipeline" : "Active case pipeline"}
        description={
          viewer.isAttorney
            ? "Your assigned cases only. Complete % highlights what still needs updating. Disbursed cases from prior commission years are archived; active cases stay visible until disbursed."
            : "Sort and filter shared case records with tracker-specific forecasts, review freshness, missing info flags, and quick access to case detail."
        }
      />
      <CaseTable
        records={records}
        users={users}
        settings={settings}
        goals={goals}
        viewer={viewer}
        initialSearch={q?.trim() ?? ""}
        initialStatus={parsePipelineStatus(status, qualityFilter)}
        initialQualityFilter={qualityFilter}
      />
    </>
  );
}
