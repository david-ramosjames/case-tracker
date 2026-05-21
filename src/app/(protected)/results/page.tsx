import { PageHeader } from "@/components/layout/page-header";
import { ResultsTable } from "@/components/results/results-table";
import { dataRepository } from "@/lib/data/repository";

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const [records, users] = await Promise.all([dataRepository.getCases(), dataRepository.getUsers()]);

  return (
    <>
      <PageHeader
        eyebrow="Results"
        title="Settlement and disbursement tracker"
        description="Track release signed, closing signed, check deposited, check disbursed, result quarter, and disbursement timing across the firm."
      />
      <ResultsTable records={records} users={users} />
    </>
  );
}
