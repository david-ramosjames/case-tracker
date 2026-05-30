import { notFound } from "next/navigation";
import { CaseDetailView } from "@/components/cases/case-detail-view";
import { PageHeader } from "@/components/layout/page-header";
import { canViewerAccessCase } from "@/lib/auth/access";
import { dataRepository } from "@/lib/data/repository";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { getSlackChannelForCaseNumber } from "@/lib/slack/channels";

export const dynamic = "force-dynamic";

export default async function CaseDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const { sessionUser, users, goals } = await loadViewerCaseBundle();
  const [record, comments, activity, settings] = await Promise.all([
    dataRepository.getCaseById(caseId),
    dataRepository.getCaseComments(caseId),
    dataRepository.getCaseActivity(caseId),
    dataRepository.getSettings(),
  ]);

  if (!record || !sessionUser || !canViewerAccessCase(record, sessionUser, users, goals)) {
    notFound();
  }

  // DB lookup only — never call Slack here (listing all channels times out on Vercel).
  const slackChannel = await getSlackChannelForCaseNumber(record.shared.caseNumber);

  return (
    <>
      <PageHeader
        eyebrow="Case Detail"
        title={`${record.shared.caseNumber} - ${record.shared.clientName}`}
        description="Case number, attorney, and paralegal stay tied to DocketFlow. Operational fields, forecasts, notes, comments, and activity stay current in the tracker."
      />
      <CaseDetailView
        initialRecord={record}
        initialComments={comments}
        initialActivity={activity}
        settings={settings}
        sessionUser={sessionUser}
        slackChannel={slackChannel}
      />
    </>
  );
}
