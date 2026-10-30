import { loadCaseContactMaps, type ContactCase } from "@/lib/client-contact/case-phones";
import { mergeQuoDirectoryContacts } from "@/lib/client-contact/directory-contacts";
import {
  applyContactStamps,
  listClientContactSummaries,
  type ContactStamp,
} from "@/lib/client-contact/repository";
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
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCases } from "@/lib/supabase/services";

const LOOKBACK_MS = 120 * 24 * 60 * 60 * 1000;
const BACKFILL_SETTINGS_KEY = "client_contact_line_backfill";
/** Two daily runs at this size cover a few hundred open phones before morning review. */
const DEFAULT_BACKFILL_PHONES = 220;
const DEFAULT_BACKFILL_MS = 700_000;

type BackfillCursor = {
  nextPhone?: string | null;
  updatedAt?: string;
};

/**
 * Refresh contact dates for open cases from the Railway Quo ledger.
 * Slow Quo-by-phone orphan recovery runs on /api/cron/client-contact-backfill.
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

async function loadBackfillCursor(): Promise<BackfillCursor> {
  const admin = createSupabaseAdminClient();
  if (!admin) return {};
  const { data } = await admin.from("case_tracker_settings").select("value").eq("key", BACKFILL_SETTINGS_KEY).maybeSingle();
  const value = data?.value;
  if (!value || typeof value !== "object") return {};
  return value as BackfillCursor;
}

async function saveBackfillCursor(cursor: BackfillCursor) {
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  const { error } = await admin.from("case_tracker_settings").upsert(
    {
      key: BACKFILL_SETTINGS_KEY,
      value: { ...cursor, updatedAt: new Date().toISOString() },
      description: "Cursor for Quo line-by-phone client-contact orphan backfill.",
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
}

/**
 * Asks Quo for calls by client phone on every firm line.
 * Persists a phone cursor so orphans are recovered across runs without
 * timing out the ledger cron.
 */
export async function syncClientContactLineBackfill(options?: {
  maxPhones?: number;
  maxMs?: number;
}) {
  if (!process.env.QUO_API_KEY?.trim()) {
    return { configured: false as const, phones: 0, lines: 0, cases: 0, processed: 0 };
  }

  const maxPhones = options?.maxPhones ?? DEFAULT_BACKFILL_PHONES;
  const maxMs = options?.maxMs ?? DEFAULT_BACKFILL_MS;
  const started = Date.now();

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
  const phoneEntries = [...maps.byPhone.entries()]
    .filter(([, matches]) => matches.some((match) => openCases.has(match.caseNumber)))
    .map(([phone, matches]) => ({
      phone,
      matches: matches.filter((match) => openCases.has(match.caseNumber)),
    }));

  const summaries = await listClientContactSummaries(
    phoneEntries.flatMap((entry) => entry.matches.map((match) => match.caseNumber)),
  );
  phoneEntries.sort((left, right) => {
    const leftAt = Math.min(
      ...left.matches.map((match) => Date.parse(summaries.get(match.caseNumber)?.lastOutboundCallAt ?? "") || 0),
    );
    const rightAt = Math.min(
      ...right.matches.map((match) => Date.parse(summaries.get(match.caseNumber)?.lastOutboundCallAt ?? "") || 0),
    );
    if (leftAt !== rightAt) return leftAt - rightAt;
    return left.phone.localeCompare(right.phone);
  });

  const cursor = await loadBackfillCursor();
  const startIndex = cursor.nextPhone
    ? Math.max(
        0,
        phoneEntries.findIndex((entry) => entry.phone === cursor.nextPhone),
      )
    : 0;
  const ordered =
    startIndex > 0
      ? [...phoneEntries.slice(startIndex), ...phoneEntries.slice(0, startIndex)]
      : phoneEntries;

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
  let nextPhone: string | null = null;
  for (const entry of ordered) {
    if (processed >= maxPhones || Date.now() - started >= maxMs) {
      nextPhone = entry.phone;
      break;
    }
    let stoppedMidPhone = false;
    for (const lineId of lines) {
      if (Date.now() - started >= maxMs) {
        nextPhone = entry.phone;
        stoppedMidPhone = true;
        break;
      }
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
    if (stoppedMidPhone) break;
    processed += 1;
    if (processed % 20 === 0) await flush();
  }
  await flush();

  // Full slice finished — wrap to the start of the stale-sorted phone list.
  if (!nextPhone) nextPhone = phoneEntries[0]?.phone ?? null;
  await saveBackfillCursor({ nextPhone });

  return {
    configured: true as const,
    source: "quo_line_backfill" as const,
    phones: phoneEntries.length,
    lines: lines.length,
    cases: savedCases,
    processed,
    nextPhone,
  };
}
