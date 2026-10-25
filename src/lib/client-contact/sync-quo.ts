import { loadCaseContactMaps, type ContactCase } from "@/lib/client-contact/case-phones";
import { mergeQuoDirectoryContacts } from "@/lib/client-contact/directory-contacts";
import { applyContactStamps, type ContactStamp } from "@/lib/client-contact/repository";
import { syncClientContactsFromLedger } from "@/lib/client-contact/sync-ledger";
import { latestDate } from "@/lib/client-contact/types";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { isQuoEnabled } from "@/lib/quo/config";
import {
  listQuoCallsForPhone,
  listQuoCallsForPhoneOnLine,
  listQuoMessagesForPhone,
  listQuoPhoneNumberIds,
  listRecentQuoClientActivity,
} from "@/lib/quo/client";
import { getCases } from "@/lib/supabase/services";

const LOOKBACK_MS = 120 * 24 * 60 * 60 * 1000;

/**
 * Refresh contact dates for open cases.
 * Reads the Quo reporting ledger, then asks Quo for calls by client phone.
 * Some completed calls omit the client on the webhook, and some clients have
 * more than one Quo contact whose name contains the case number.
 * Does not post to Slack.
 */
export async function syncQuoClientContacts() {
  const fromLedger = await syncClientContactsFromLedger();
  const fromLines = process.env.QUO_API_KEY?.trim() ? await syncClientCallsAcrossLines() : null;
  if (fromLedger.configured) {
    return { ...fromLedger, linePhones: fromLines?.phones ?? 0, lineCases: fromLines?.cases ?? 0 };
  }

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

/** Calls Quo only returns when the request names the client, on every firm line. */
async function syncClientCallsAcrossLines() {
  const maps = await loadCaseContactMaps();
  const openList: ContactCase[] = (await getCases())
    .filter((record) => caseRequiresOngoingUpdates(record))
    .map((record) => ({
      caseId: record.shared.id,
      caseNumber: cleanCaseNumber(record.shared.caseNumber),
    }))
    .filter((record) => record.caseNumber);
  const openCases = new Set(openList.map((record) => record.caseNumber));
  await mergeQuoDirectoryContacts(maps, openList);

  const lines = await listQuoPhoneNumberIds();
  const phones = [...maps.byPhone.entries()]
    .filter(([, matches]) => matches.some((match) => openCases.has(match.caseNumber)))
    .map(([phone, matches]) => ({
      phone,
      matches: matches.filter((match) => openCases.has(match.caseNumber)),
    }))
    .sort((left, right) => left.phone.localeCompare(right.phone));
  const start = new Date().getUTCHours() % 2 === 0 ? 0 : Math.floor(phones.length / 2);
  const ordered = [...phones.slice(start), ...phones.slice(0, start)];

  const byCase = new Map<string, ContactStamp>();
  function stampFor(match: ContactCase) {
    const current = byCase.get(match.caseNumber) ?? { caseNumber: match.caseNumber, caseId: match.caseId };
    byCase.set(match.caseNumber, current);
    return current;
  }

  let savedCases = 0;
  async function flush() {
    if (byCase.size === 0) return;
    const saved = await applyContactStamps([...byCase.values()]);
    savedCases += saved.cases;
    byCase.clear();
  }

  let processed = 0;
  for (const entry of ordered) {
    for (const lineId of lines) {
      let calls: Awaited<ReturnType<typeof listQuoCallsForPhoneOnLine>> = [];
      try {
        calls = await listQuoCallsForPhoneOnLine(entry.phone, lineId);
      } catch (error) {
        console.error("[client-contact] quo line sync failed", error);
        continue;
      }
      for (const call of calls) {
        for (const match of entry.matches) {
          const stamp = stampFor(match);
          stamp.conversationAt = latestDate([stamp.conversationAt, call.createdAt]);
          if (call.direction === "outgoing") stamp.outboundCallAt = latestDate([stamp.outboundCallAt, call.createdAt]);
          if (call.answered) stamp.humanCallAt = latestDate([stamp.humanCallAt, call.createdAt]);
        }
      }
    }
    processed += 1;
    if (processed % 25 === 0) await flush();
  }
  await flush();
  return { phones: phones.length, lines: lines.length, cases: savedCases };
}
