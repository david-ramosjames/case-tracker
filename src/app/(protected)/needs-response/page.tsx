import { NeedsResponseView } from "@/components/needs-response/needs-response-table";
import { buildViewerContext } from "@/lib/auth/access";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { listOpenNeedsResponse } from "@/lib/needs-response/repository";
import { getQuoClientSmsUrl, getQuoContactUrl } from "@/lib/quo/links";
import { loadSlackChannelMapByCaseNumber } from "@/lib/slack/channels";
import { formatSlackChannelLabel, getSlackChannelArchiveUrl } from "@/lib/slack/links";
import { type CaseRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

function isAssignedToViewer(record: CaseRecord, contactId: string) {
  return (
    record.shared.attorneyId === contactId ||
    record.shared.paralegalId === contactId ||
    record.shared.legalAssistantId === contactId
  );
}

function quoUrlForCase(record: CaseRecord) {
  const candidates = [
    {
      quoConversationId: record.tracker.quoConversationId,
      quoPhoneNumberId: record.tracker.quoPhoneNumberId,
    },
    ...record.tracker.quoContacts.map((contact) => ({
      quoConversationId: contact.quoConversationId,
      quoPhoneNumberId: contact.quoPhoneNumberId,
    })),
  ];
  for (const candidate of candidates) {
    const inboxUrl = getQuoClientSmsUrl(candidate);
    if (inboxUrl) return inboxUrl;
  }
  return (
    getQuoContactUrl(record.tracker.quoContactId) ??
    record.tracker.quoContacts.map((contact) => getQuoContactUrl(contact.quoContactId)).find((url) => url) ??
    null
  );
}

export default async function NeedsResponsePage() {
  const [{ records, sessionUser, users, settings }, slackChannels] = await Promise.all([
    loadViewerCaseBundle(),
    loadSlackChannelMapByCaseNumber(),
  ]);
  const viewer = buildViewerContext(sessionUser, users);
  const open = records.filter((record) => {
    if (!caseRequiresOngoingUpdates(record)) return false;
    if (viewer.canViewAllCases) return true;
    return viewer.contactId ? isAssignedToViewer(record, viewer.contactId) : false;
  });
  const openByCase = new Map(open.map((record) => [cleanCaseNumber(record.shared.caseNumber), record]));
  const caseNumbers = open.map((record) => record.shared.caseNumber);
  const items = await listOpenNeedsResponse(viewer.canViewAllCases ? undefined : caseNumbers);

  const rows = items
    .map((item) => {
      const caseNumber = cleanCaseNumber(item.caseNumber);
      const record = openByCase.get(caseNumber);
      if (!viewer.canViewAllCases && !record) return null;
      const slack = slackChannels.get(caseNumber) ?? null;
      return {
        ...item,
        caseId: record?.shared.id ?? item.caseId,
        attorneyId: record?.attorney.id ?? null,
        attorneyName: item.attorneyName || record?.attorney.name || null,
        paralegalName: item.paralegalName || record?.paralegal.name || null,
        quoUrl: item.evidenceUrl || (record ? quoUrlForCase(record) : null),
        slackUrl: slack ? getSlackChannelArchiveUrl(slack) : null,
        slackLabel: slack ? formatSlackChannelLabel(slack.slackChannelName) || null : null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-950">Needs response</h1>
        <p className="text-sm text-muted-foreground">
          Full open queue of clients still owed a follow-up. Items stay here until an outbound text, a connected return
          call (2-minute rule), or someone marks Resolved. The morning email only lists newly detected items.
        </p>
      </div>
      <NeedsResponseView rows={rows} scoreboardAttorneyIds={settings.contactScoreboardAttorneyIds} />
    </div>
  );
}
