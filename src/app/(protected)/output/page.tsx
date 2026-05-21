import { PageHeader } from "@/components/layout/page-header";
import { OutputView } from "@/components/output/output-view";
import { dataRepository } from "@/lib/data/repository";

export const dynamic = "force-dynamic";

export default async function OutputPage() {
  const [records, goals, users] = await Promise.all([
    dataRepository.getCases(),
    dataRepository.getAttorneyGoals(),
    dataRepository.getUsers(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Output"
        title="Firm results and pacing"
        description="Roll up case statuses, settled versus disbursed results, completed disbursements, commission threshold, and quarterly target/plan/actual performance. Filter by attorney or paralegal."
      />
      <OutputView records={records} goals={goals} users={users} />
    </>
  );
}
