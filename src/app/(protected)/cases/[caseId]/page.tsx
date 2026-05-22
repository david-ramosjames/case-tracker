import { notFound } from "next/navigation";
import { CaseDetailView } from "@/components/cases/case-detail-view";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionUser } from "@/lib/auth/session";
import { dataRepository } from "@/lib/data/repository";
import { resolveSlackChannelId } from "@/lib/slack/client";
import { isSlackEnabled } from "@/lib/slack/config";
import { getSlackChannelForCaseNumber } from "@/lib/slack/channels";

export const dynamic = "force-dynamic";

export default async function CaseDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const [record, comments, activity, settings, sessionUser] = await Promise.all([
    dataRepository.getCaseById(caseId),
    dataRepository.getCaseComments(caseId),
    dataRepository.getCaseActivity(caseId),
    dataRepository.getSettings(),
    getSessionUser(),
  ]);

  if (!record || !sessionUser) {
    notFound();
  }

  const slackMapping = await getSlackChannelForCaseNumber(record.shared.caseNumber);
  let slackChannel = slackMapping;
  if (slackMapping && !slackMapping.slackChannelId && isSlackEnabled()) {
    const channelId = await resolveSlackChannelId(slackMapping.slackChannelName);
    if (channelId) {
      slackChannel = { ...slackMapping, slackChannelId: channelId };
    }
  }

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
