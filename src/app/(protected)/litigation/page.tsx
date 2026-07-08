import { PageHeader } from "@/components/layout/page-header";
import { LitigationTable } from "@/components/litigation/litigation-table";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { isLitigationTabCase } from "@/lib/litigation-events";

export const dynamic = "force-dynamic";

export default async function LitigationPage() {
  const { records, users, viewer } = await loadViewerCaseBundle();
  const litigationRecords = records.filter(isLitigationTabCase);

  return (
    <>
      <PageHeader
        eyebrow="Litigation"
        title="Litigation events tracker"
        description="All cases in the Lit stage in one view. Track plaintiff and defendant depositions, mediation, and trial with date and status for each event."
      />
      <LitigationTable records={litigationRecords} users={users} viewer={viewer} />
    </>
  );
}
