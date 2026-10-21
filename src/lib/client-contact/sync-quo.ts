import { loadCaseContactMaps } from "@/lib/client-contact/case-phones";
import { applyContactStamps, type ContactStamp } from "@/lib/client-contact/repository";
import { syncClientContactsFromLedger } from "@/lib/client-contact/sync-ledger";
import { latestDate } from "@/lib/client-contact/types";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { isQuoEnabled } from "@/lib/quo/config";
import {
  listQuoCallsForPhone,
  listQuoMessagesForPhone,
  listRecentQuoClientActivity,
} from "@/lib/quo/client";
import { getCases } from "@/lib/supabase/services";

const LOOKBACK_MS = 120 * 24 * 60 * 60 * 1000;

/**
 * Refresh contact dates for open cases.
 * Prefers the existing Quo reporting ledger (webhook already feeding quo-reporting).
 * Falls back to the Quo API only when REPORTING_DATABASE_URL is not set.
 * Does not post to Slack.
 */
export async function syncQuoClientContacts() {
  const fromLedger = await syncClientContactsFromLedger();
  if (fromLedger.configured) return fromLedger;

  if (!isQuoEnabled()) return { configured: false as const, cases: 0, phones: 0, source: "none" as const };

  const { byPhone } = await loadCaseContactMaps();
  const openCases = new Set(
    (await getCases())
      .filter((caseRecord) => caseRequiresOngoingUpdates(caseRecord))
      .map((caseRecord) => cleanCaseNumber(caseRecord.shared.caseNumber))
      .filter(Boolean),
  );
  const openPhones = [...byPhone.entries()].filter(([, matches]) =>
    matches.some((match) => openCases.has(match.caseNumber)),
  );

  const newerThan = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const conversations = await listRecentQuoClientActivity({ maxPages: 40, newerThan });
  const byCase = new Map<string, ContactStamp>();

  function stampsForPhone(phone: string) {
    const stamps: ContactStamp[] = [];
    for (const match of byPhone.get(phone) ?? []) {
      if (!openCases.has(match.caseNumber)) continue;
      const current = byCase.get(match.caseNumber) ?? {
        caseNumber: match.caseNumber,
        caseId: match.caseId,
      };
      byCase.set(match.caseNumber, current);
      stamps.push(current);
    }
    return stamps;
  }

  for (const conversation of conversations) {
    for (const stamp of stampsForPhone(conversation.phone)) {
      stamp.conversationAt = latestDate([stamp.conversationAt, conversation.lastActivityAt]);
    }
  }

  let phonesRead = 0;
  const queue = openPhones.map(([phone]) => phone);
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const phone = queue[cursor];
      cursor += 1;
      phonesRead += 1;
      try {
        const [calls, messages] = await Promise.all([
          listQuoCallsForPhone(phone),
          listQuoMessagesForPhone(phone),
        ]);
        for (const stamp of stampsForPhone(phone)) {
          for (const call of calls) {
            stamp.conversationAt = latestDate([stamp.conversationAt, call.createdAt]);
            if (call.direction === "outgoing") {
              stamp.outboundCallAt = latestDate([stamp.outboundCallAt, call.createdAt]);
            }
            if (call.answered) stamp.humanCallAt = latestDate([stamp.humanCallAt, call.createdAt]);
          }
          for (const message of messages) {
            stamp.conversationAt = latestDate([stamp.conversationAt, message.createdAt]);
            if (message.direction === "incoming") {
              stamp.inboundTextAt = latestDate([stamp.inboundTextAt, message.createdAt]);
            }
            if (message.direction === "outgoing") {
              stamp.outboundTextAt = latestDate([stamp.outboundTextAt, message.createdAt]);
            }
          }
        }
      } catch (error) {
        console.error("[client-contact] quo phone sync failed", error);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, () => worker()));

  const saved = await applyContactStamps([...byCase.values()]);
  return {
    configured: true as const,
    source: "quo_api" as const,
    cases: saved.cases,
    phones: phonesRead,
  };
}
