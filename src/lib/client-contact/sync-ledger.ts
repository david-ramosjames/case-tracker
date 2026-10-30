import { loadCaseContactMaps, type ContactCase } from "@/lib/client-contact/case-phones";
import { mergeQuoDirectoryContacts } from "@/lib/client-contact/directory-contacts";
import { applyContactStamps, type ContactStamp } from "@/lib/client-contact/repository";
import { latestDate } from "@/lib/client-contact/types";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { getQuoCallById, listQuoPhoneNumbers } from "@/lib/quo/client";
import { normalizePhoneForComparison } from "@/lib/quo/phone";
import { getCases } from "@/lib/supabase/services";
import { Client } from "pg";

const LOOKBACK_DAYS = 120;
/** Cap Quo GET lookups so orphan recovery stays inside the ledger cron budget. */
const MAX_ORPHAN_ENRICHMENTS = 80;

type LedgerCall = {
  call_id: string | null;
  direction: string | null;
  status: string | null;
  ai_handled: boolean | null;
  created_at: Date | string | null;
  answered_at: Date | string | null;
  duration_sec: number | null;
  participants: {
    to?: string | null;
    from?: string | null;
    external?: unknown;
    workspace?: unknown;
  } | null;
  payload_json: {
    data?: {
      object?: {
        from?: string;
        to?: string | string[];
        participants?: string[];
        contactIds?: string[];
        answeredAt?: string | null;
        duration?: number | null;
        aiHandled?: boolean | string | null;
      };
    };
  } | null;
};

type LedgerMessage = {
  direction: string | null;
  created_at: Date | string | null;
  payload_json: {
    data?: {
      object?: {
        from?: string;
        to?: string | string[];
        contactIds?: string[];
        direction?: string;
      };
    };
  } | null;
};

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function listPhones(...values: unknown[]) {
  const phones = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "string") {
      const phone = normalizePhoneForComparison(value);
      if (phone) phones.add(phone);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          const phone = normalizePhoneForComparison(item);
          if (phone) phones.add(phone);
        }
      }
    }
  }
  return [...phones];
}

function matchesFor(
  maps: Awaited<ReturnType<typeof loadCaseContactMaps>>,
  openCases: Set<string>,
  phones: string[],
  contactIds: string[],
) {
  const found = new Map<string, ContactCase>();
  for (const phone of phones) {
    for (const match of maps.byPhone.get(phone) ?? []) {
      if (openCases.has(match.caseNumber)) found.set(match.caseNumber, match);
    }
  }
  for (const contactId of contactIds) {
    for (const match of maps.byQuoContactId.get(contactId) ?? []) {
      if (openCases.has(match.caseNumber)) found.set(match.caseNumber, match);
    }
  }
  return [...found.values()];
}

function clientPhones(phones: string[], firmNumbers: Set<string>) {
  return phones.filter((phone) => !firmNumbers.has(phone));
}

/**
 * Fills contact dates from the existing Quo reporting ledger (same webhook store
 * intake-manager / quo-reporting already use). Joins phones and Quo contact ids
 * to cases via case_quo_contacts (name ends with case number).
 *
 * Some completed webhooks omit the client phone and contactIds. When Quo API is
 * configured, those orphans are enriched with GET /calls/{id} before matching.
 */
export async function syncClientContactsFromLedger() {
  const connectionString = process.env.REPORTING_DATABASE_URL?.trim();
  if (!connectionString) return { configured: false as const, cases: 0, calls: 0, messages: 0, orphansEnriched: 0 };

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

  const firmNumbers = new Set<string>();
  if (process.env.QUO_API_KEY?.trim()) {
    try {
      for (const line of await listQuoPhoneNumbers()) {
        if (line.number) firmNumbers.add(line.number);
      }
    } catch (error) {
      console.error("[client-contact] firm line lookup failed", error);
    }
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
  const client = new Client({
    connectionString,
    ssl: local ? false : { rejectUnauthorized: false },
  });

  const byCase = new Map<string, ContactStamp>();
  function stampFor(match: ContactCase) {
    const current = byCase.get(match.caseNumber) ?? {
      caseNumber: match.caseNumber,
      caseId: match.caseId,
    };
    byCase.set(match.caseNumber, current);
    return current;
  }

  let orphansEnriched = 0;

  try {
    await client.connect();
    const calls = await client.query<LedgerCall>(
      `select call_id, direction, status, ai_handled, created_at, answered_at, duration_sec, participants, payload_json
       from quo_calls
       where coalesce(created_at, updated_at) >= $1
       order by created_at asc nulls last`,
      [since],
    );
    const messages = await client.query<LedgerMessage>(
      `select direction, created_at, payload_json
       from quo_messages
       where coalesce(created_at, updated_at) >= $1
       order by created_at asc nulls last`,
      [since],
    );

    for (const row of calls.rows) {
      const createdAt = iso(row.created_at);
      if (!createdAt) continue;
      const status = (row.status ?? "").toLowerCase();
      if (["queued", "initiated", "ringing", "in-progress"].includes(status)) continue;

      const object = row.payload_json?.data?.object;
      let phones = listPhones(
        row.participants?.from,
        row.participants?.to,
        row.participants?.external,
        row.participants?.workspace,
        object?.from,
        object?.to,
        object?.participants,
      );
      let contactIds = (object?.contactIds ?? []).map((id) => String(id).trim()).filter(Boolean);
      let matches = matchesFor(maps, openCases, phones, contactIds);

      const needsEnrichment =
        matches.length === 0 &&
        Boolean(row.call_id?.trim()) &&
        Boolean(process.env.QUO_API_KEY?.trim()) &&
        contactIds.length === 0 &&
        clientPhones(phones, firmNumbers).length === 0 &&
        orphansEnriched < MAX_ORPHAN_ENRICHMENTS;

      if (needsEnrichment) {
        try {
          const detail = await getQuoCallById(String(row.call_id));
          if (detail) {
            orphansEnriched += 1;
            phones = listPhones(detail.participants, detail.from, detail.to, phones);
            contactIds = [...new Set([...contactIds, ...detail.contactIds])];
            matches = matchesFor(maps, openCases, phones, contactIds);
          }
        } catch (error) {
          console.error("[client-contact] orphan call enrich failed", row.call_id, error);
        }
      }

      if (matches.length === 0) continue;

      const direction = (row.direction ?? "").toLowerCase();
      const aiHandled =
        row.ai_handled === true || object?.aiHandled === true || object?.aiHandled === "true";
      const answered =
        !aiHandled &&
        (Boolean(iso(row.answered_at) || object?.answeredAt) || (row.duration_sec ?? object?.duration ?? 0) > 0);

      for (const match of matches) {
        const stamp = stampFor(match);
        stamp.conversationAt = latestDate([stamp.conversationAt, createdAt]);
        if (direction === "outgoing") stamp.outboundCallAt = latestDate([stamp.outboundCallAt, createdAt]);
        if (answered) stamp.humanCallAt = latestDate([stamp.humanCallAt, createdAt]);
      }
    }

    for (const row of messages.rows) {
      const createdAt = iso(row.created_at);
      if (!createdAt) continue;
      const object = row.payload_json?.data?.object;
      const direction = (row.direction || object?.direction || "").toLowerCase();
      const phones = listPhones(object?.from, object?.to);
      const contactIds = (object?.contactIds ?? []).map((id) => String(id).trim()).filter(Boolean);
      const matches = matchesFor(maps, openCases, phones, contactIds);
      if (matches.length === 0) continue;

      for (const match of matches) {
        const stamp = stampFor(match);
        stamp.conversationAt = latestDate([stamp.conversationAt, createdAt]);
        if (direction === "incoming") stamp.inboundTextAt = latestDate([stamp.inboundTextAt, createdAt]);
        if (direction === "outgoing") stamp.outboundTextAt = latestDate([stamp.outboundTextAt, createdAt]);
      }
    }

    const saved = await applyContactStamps([...byCase.values()]);
    return {
      configured: true as const,
      source: "reporting_ledger" as const,
      cases: saved.cases,
      calls: calls.rowCount ?? calls.rows.length,
      messages: messages.rowCount ?? messages.rows.length,
      orphansEnriched,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}
