import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { OutputView } from "@/components/output/output-view";
import { canViewOutputAndGoals } from "@/lib/auth/constants";
import { requireSessionUser } from "@/lib/auth/session";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";

export const dynamic = "force-dynamic";

export default async function OutputPage() {
  const sessionUser = await requireSessionUser();
  if (!canViewOutputAndGoals(sessionUser.role)) redirect("/cases");

  const { records, goals, users, viewer } = await loadViewerCaseBundle();

  return (
    <>
      <PageHeader
        eyebrow="Output"
        title={viewer.isAttorney ? "Your results and pacing" : "Firm results and pacing"}
        description={
          viewer.isAttorney
            ? "Roll up your case statuses, settled versus disbursed results, completed disbursements, and commission threshold."
            : "Roll up case statuses, settled versus disbursed results, completed disbursements, and commission threshold. Filter by attorney or firm total."
        }
      />
      <OutputView records={records} goals={goals} users={users} viewer={viewer} />
    </>
  );
}
