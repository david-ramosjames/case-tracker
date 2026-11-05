import { NeedsResponseView } from "@/components/needs-response/needs-response-table";
import { buildViewerContext, canViewAllNeedsResponse } from "@/lib/auth/access";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { listOpenNeedsResponse } from "@/lib/needs-response/repository";
import { attachQuoRouterSlackPosts } from "@/lib/needs-response/slack-post";
import { getQuoClientSmsUrl, getQuoContactUrl } from "@/lib/quo/links";
import { loadSlackChannelMapByCaseNumber } from "@/lib/slack/channels";
import { formatSlackChannelLabel, getSlackChannelArchiveUrl } from "@/lib/slack/links";
import { type CaseRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

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
  const [{ records, allRecords, sessionUser, users, settings }, slackChannels] = await Promise.all([
    loadViewerCaseBundle(),
    loadSlackChannelMapByCaseNumber(),
  ]);
  const viewer = buildViewerContext(sessionUser, users);
  const seesEveryone = canViewAllNeedsResponse(viewer);
  // Staff stay on their own assigned cases. Admins, the managing attorney, and the
  // managing paralegal see the full open queue.
  const visibleCases = seesEveryone ? allRecords : records;
  const open = visibleCases.filter((record) => caseRequiresOngoingUpdates(record));
  const openByCase = new Map(open.map((record) => [cleanCaseNumber(record.shared.caseNumber), record]));
  const staffByCase = new Map(records.map((record) => [cleanCaseNumber(record.shared.caseNumber), record]));
  const caseNumbers = open.map((record) => record.shared.caseNumber);
  const items = await listOpenNeedsResponse(seesEveryone ? undefined : caseNumbers);

  const rows = items
    .map((item) => {
      const caseNumber = cleanCaseNumber(item.caseNumber);
      const record = openByCase.get(caseNumber);
      if (!seesEveryone && !record) return null;
      const slack = slackChannels.get(caseNumber) ?? null;
      return {
        ...item,
        caseId: record?.shared.id ?? item.caseId,
        attorneyId: record?.attorney.id ?? null,
        attorneyName: item.attorneyName || record?.attorney.name || null,
        paralegalName: item.paralegalName || record?.paralegal.name || null,
        legalAssistantName:
          staffByCase.get(caseNumber)?.legalAssistant?.name || item.legalAssistantName || null,
        quoUrl: item.evidenceUrl || (record ? quoUrlForCase(record) : null),
        slackMessageUrl: item.slackMessageUrl,
        slackUrl: item.slackMessageUrl || (slack ? getSlackChannelArchiveUrl(slack) : null),
        slackLabel: slack ? formatSlackChannelLabel(slack.slackChannelName) || null : null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const channelIdByCase = new Map<string, string>();
  for (const [caseNumber, channel] of slackChannels) {
    if (channel.slackChannelId) channelIdByCase.set(cleanCaseNumber(caseNumber), channel.slackChannelId);
  }
  const rowsWithPosts = await attachQuoRouterSlackPosts(rows, channelIdByCase);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-950">Needs response</h1>
        <p className="text-sm text-muted-foreground">
          Full open queue of clients still owed a follow-up. Items stay here until an outbound text, a connected return
          call (2-minute rule), or someone marks Resolved. The morning email only lists newly detected items.
        </p>
      </div>
      <NeedsResponseView rows={rowsWithPosts} scoreboardAttorneyIds={settings.contactScoreboardAttorneyIds} />
    </div>
  );
}
