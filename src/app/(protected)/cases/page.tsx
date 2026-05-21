import { CaseTable } from "@/components/cases/case-table";
import { PageHeader } from "@/components/layout/page-header";
import { dataRepository } from "@/lib/data/repository";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const [records, users, settings] = await Promise.all([
    dataRepository.getCases(),
    dataRepository.getUsers(),
    dataRepository.getSettings(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Case List"
        title="Active case pipeline"
        description="Sort and filter shared case records with tracker-specific forecasts, review freshness, missing info flags, and quick access to case detail."
      />
      <CaseTable records={records} users={users} settings={settings} />
    </>
  );
}
