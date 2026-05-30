import { CaseTable } from "@/components/cases/case-table";
import { PageHeader } from "@/components/layout/page-header";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const { records, users, settings, goals, viewer } = await loadViewerCaseBundle();

  return (
    <>
      <PageHeader
        eyebrow="Case List"
        title={viewer.isAttorney ? "Your case pipeline" : "Active case pipeline"}
        description={
          viewer.isAttorney
            ? "Your assigned cases only. Complete % highlights what still needs updating. Cases older than three months into a new commission year are archived from your view."
            : "Sort and filter shared case records with tracker-specific forecasts, review freshness, missing info flags, and quick access to case detail."
        }
      />
      <CaseTable records={records} users={users} settings={settings} goals={goals} viewer={viewer} />
    </>
  );
}
