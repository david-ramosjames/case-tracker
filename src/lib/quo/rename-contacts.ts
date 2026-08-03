import { cleanCaseNumber } from "@/lib/csv/parse";
import { normalizePreferredLanguage } from "@/lib/case-options";
import { createSupabaseAdminClient, fetchAllSupabaseRows } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getQuoContactById,
  listAllQuoContactsRaw,
  updateQuoContactName,
  type QuoContactRaw,
} from "@/lib/quo/client";
import { parseCaseNumbersFromQuoContactName } from "@/lib/quo/contact-sync";

const TRAILING_CASE_NUMBERS_RE = /(\d{3,6}(?:\s*&\s*\d{3,6})*)\s*$/;

export type RenameResult = {
  totalContacts: number;
  matched: number;
  renamed: number;
  skipped: number;
  alreadyTagged: number;
  noLanguage: number;
  notFound: string[];
  errors: string[];
  details: string[];
};

async function buildCaseLanguageMap(): Promise<Map<string, string>> {
  const client = createSupabaseAdminClient() ?? (await createSupabaseServerClient());
  const rows = await fetchAllSupabaseRows<{ case_number: string | null; preferred_language: string | null }>(
    client,
    "cases",
    "case_number,preferred_language",
  );

  const map = new Map<string, string>();
  for (const row of rows) {
    const num = cleanCaseNumber(row.case_number ?? "");
    if (!num) continue;
    const lang = normalizePreferredLanguage(row.preferred_language);
    map.set(num, lang.toUpperCase());
  }
  return map;
}

/**
 * Insert a language tag (EN/ES) before the trailing case number(s).
 * Returns null when the name already has the tag or has no trailing case number.
 */
function buildRenamedFields(
  contact: QuoContactRaw,
  languageTag: string,
): { firstName: string; lastName: string } | null {
  const fullName = `${contact.firstName} ${contact.lastName}`.trim();
  const nameWithoutNumbers = fullName.replace(TRAILING_CASE_NUMBERS_RE, "").trimEnd();
  const existingTag = nameWithoutNumbers.match(/(?:^|\s)(EN|ES)$/i)?.[1]?.toUpperCase();
  if (existingTag === languageTag) return null;

  const replaceTrailingLanguageTag = (value: string) =>
    value.replace(/(?:^|\s)(EN|ES)$/i, "").trimEnd();

  const addLanguageBeforeNumbers = (value: string, numbers: string) => {
    const name = replaceTrailingLanguageTag(value);
    return name ? `${name} ${languageTag} ${numbers.trim()}` : `${languageTag} ${numbers.trim()}`;
  };

  const lastNameMatch = contact.lastName.match(TRAILING_CASE_NUMBERS_RE);
  if (lastNameMatch) {
    const beforeNumbers = contact.lastName.slice(0, lastNameMatch.index).trimEnd();
    return {
      firstName: existingTag ? replaceTrailingLanguageTag(contact.firstName) : contact.firstName,
      lastName: addLanguageBeforeNumbers(beforeNumbers, lastNameMatch[0]),
    };
  }

  const firstNameMatch = contact.firstName.match(TRAILING_CASE_NUMBERS_RE);
  if (firstNameMatch) {
    const beforeNumbers = contact.firstName.slice(0, firstNameMatch.index).trimEnd();
    return {
      firstName: addLanguageBeforeNumbers(beforeNumbers, firstNameMatch[0]),
      lastName: existingTag ? replaceTrailingLanguageTag(contact.lastName) : contact.lastName,
    };
  }

  return null;
}

type LinkedQuoContact = {
  quoContactId: string;
  phone: string | null;
};

/** Prefer linked Quo contact IDs from tracker / case_quo_contacts for targeted renames. */
async function loadLinkedQuoContactsByCaseNumber(
  caseNumbers: string[],
): Promise<Map<string, LinkedQuoContact[]>> {
  const admin = createSupabaseAdminClient();
  const byCase = new Map<string, LinkedQuoContact[]>();
  if (!admin || caseNumbers.length === 0) return byCase;

  const { data: trackers, error: trackerError } = await admin
    .from("case_tracker_entries")
    .select("id,case_number,quo_contact_id,client_phone")
    .in("case_number", caseNumbers);
  if (trackerError) throw new Error(trackerError.message);

  const trackerIds: string[] = [];
  const phoneByQuoId = new Map<string, string>();

  for (const row of trackers ?? []) {
    const caseNumber = cleanCaseNumber(String(row.case_number ?? ""));
    if (!caseNumber) continue;
    trackerIds.push(String(row.id));
    const quoId = String(row.quo_contact_id ?? "").trim();
    const phone = String(row.client_phone ?? "").trim() || null;
    if (!quoId) continue;
    if (phone) phoneByQuoId.set(quoId, phone);
    const bucket = byCase.get(caseNumber) ?? [];
    if (!bucket.some((item) => item.quoContactId === quoId)) {
      bucket.push({ quoContactId: quoId, phone });
      byCase.set(caseNumber, bucket);
    }
  }

  if (trackerIds.length > 0) {
    const { data: linked, error: linkedError } = await admin
      .from("case_quo_contacts")
      .select("tracker_entry_id,quo_contact_id,phone")
      .in("tracker_entry_id", trackerIds);
    if (linkedError) throw new Error(linkedError.message);

    const caseByTrackerId = new Map(
      (trackers ?? []).map((row) => [String(row.id), cleanCaseNumber(String(row.case_number ?? ""))]),
    );

    for (const row of linked ?? []) {
      const caseNumber = caseByTrackerId.get(String(row.tracker_entry_id)) ?? "";
      const quoId = String(row.quo_contact_id ?? "").trim();
      const phone = String(row.phone ?? "").trim() || phoneByQuoId.get(quoId) || null;
      if (!caseNumber || !quoId) continue;
      if (phone) phoneByQuoId.set(quoId, phone);
      const bucket = byCase.get(caseNumber) ?? [];
      const existing = bucket.find((item) => item.quoContactId === quoId);
      if (existing) {
        if (!existing.phone && phone) existing.phone = phone;
      } else {
        bucket.push({ quoContactId: quoId, phone });
        byCase.set(caseNumber, bucket);
      }
    }
  }

  return byCase;
}

async function resolveContactsForRename(filterCaseNumbers?: string[]): Promise<{
  contacts: QuoContactRaw[];
  totalDirectoryContacts: number;
  usedDirectoryScan: boolean;
  fallbackPhoneByQuoId: Map<string, string>;
}> {
  const filterSet = filterCaseNumbers?.length
    ? new Set(filterCaseNumbers.map((n) => cleanCaseNumber(n)).filter(Boolean))
    : null;
  const fallbackPhoneByQuoId = new Map<string, string>();

  if (!filterSet) {
    const contacts = await listAllQuoContactsRaw();
    return {
      contacts,
      totalDirectoryContacts: contacts.length,
      usedDirectoryScan: true,
      fallbackPhoneByQuoId,
    };
  }

  const linkedByCase = await loadLinkedQuoContactsByCaseNumber([...filterSet]);
  const quoIds = [
    ...new Set([...linkedByCase.values()].flatMap((items) => items.map((item) => item.quoContactId))),
  ];
  const byId = new Map<string, QuoContactRaw>();

  for (const items of linkedByCase.values()) {
    for (const item of items) {
      if (item.phone) fallbackPhoneByQuoId.set(item.quoContactId, item.phone);
    }
  }

  for (const quoId of quoIds) {
    try {
      const contact = await getQuoContactById(quoId);
      if (contact) byId.set(contact.id, contact);
    } catch (err) {
      console.warn("Quo get contact failed during rename", {
        quoId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const matchedCaseNumbers = new Set<string>();
  for (const contact of byId.values()) {
    for (const num of parseCaseNumbersFromQuoContactName(contact.displayName)) {
      if (filterSet.has(num)) matchedCaseNumbers.add(num);
    }
    // Also count DB linkage even if display name parse fails.
    for (const [caseNumber, items] of linkedByCase) {
      if (items.some((item) => item.quoContactId === contact.id)) matchedCaseNumbers.add(caseNumber);
    }
  }

  const missing = [...filterSet].filter((num) => !matchedCaseNumbers.has(num));
  if (missing.length === 0) {
    return {
      contacts: [...byId.values()],
      totalDirectoryContacts: byId.size,
      usedDirectoryScan: false,
      fallbackPhoneByQuoId,
    };
  }

  // Fall back to directory scan only for case numbers we could not resolve via DB links.
  const directory = await listAllQuoContactsRaw();
  for (const contact of directory) {
    const caseNumbers = parseCaseNumbersFromQuoContactName(contact.displayName);
    if (!caseNumbers.some((n) => missing.includes(n) || filterSet.has(n))) continue;
    byId.set(contact.id, contact);
  }

  return {
    contacts: [...byId.values()],
    totalDirectoryContacts: directory.length,
    usedDirectoryScan: true,
    fallbackPhoneByQuoId,
  };
}

/**
 * Rename Quo contacts to include a language tag (EN/ES) before the case number.
 * When `filterCaseNumbers` is provided, only contacts matching those case numbers are updated.
 */
export async function renameQuoContactsWithLanguage(filterCaseNumbers?: string[]): Promise<RenameResult> {
  const filterList = filterCaseNumbers?.length
    ? [...new Set(filterCaseNumbers.map((n) => cleanCaseNumber(n)).filter(Boolean))]
    : null;
  const filterSet = filterList ? new Set(filterList) : null;

  const [{ contacts, totalDirectoryContacts, usedDirectoryScan, fallbackPhoneByQuoId }, caseLanguageMap] =
    await Promise.all([resolveContactsForRename(filterList ?? undefined), buildCaseLanguageMap()]);

  const result: RenameResult = {
    totalContacts: totalDirectoryContacts,
    matched: 0,
    renamed: 0,
    skipped: 0,
    alreadyTagged: 0,
    noLanguage: 0,
    notFound: [],
    errors: [],
    details: [],
  };

  const matchedCaseNumbers = new Set<string>();

  // Enrich fallback phones from DB for any Quo IDs we will touch (including bulk directory scans).
  const admin = createSupabaseAdminClient();
  if (admin && contacts.length > 0) {
    const quoIds = contacts.map((contact) => contact.id);
    const { data: linkedPhones } = await admin
      .from("case_quo_contacts")
      .select("quo_contact_id,phone")
      .in("quo_contact_id", quoIds);
    for (const row of linkedPhones ?? []) {
      const quoId = String(row.quo_contact_id ?? "").trim();
      const phone = String(row.phone ?? "").trim();
      if (quoId && phone && !fallbackPhoneByQuoId.has(quoId)) {
        fallbackPhoneByQuoId.set(quoId, phone);
      }
    }
  }

  for (const contact of contacts) {
    const caseNumbers = parseCaseNumbersFromQuoContactName(contact.displayName);
    if (!caseNumbers.length) {
      if (!filterSet) result.skipped += 1;
      continue;
    }

    if (filterSet && !caseNumbers.some((n) => filterSet.has(n))) {
      continue;
    }

    result.matched += 1;
    for (const num of caseNumbers) {
      if (!filterSet || filterSet.has(num)) matchedCaseNumbers.add(num);
    }

    const languageKey = caseNumbers.find((n) => caseLanguageMap.has(n)) ?? caseNumbers[0]!;
    const languageTag = caseLanguageMap.get(languageKey);
    if (!languageTag) {
      result.noLanguage += 1;
      result.skipped += 1;
      result.details.push(`${contact.displayName}: no preferred language on case ${languageKey}`);
      continue;
    }

    const renamed = buildRenamedFields(contact, languageTag);
    const fallbackPhone = fallbackPhoneByQuoId.get(contact.id) ?? contact.primaryPhone ?? null;
    const needsPhoneRestore = !contact.primaryPhone && Boolean(fallbackPhone);

    if (!renamed && !needsPhoneRestore) {
      result.alreadyTagged += 1;
      result.skipped += 1;
      result.details.push(`${contact.displayName}: already has ${languageTag}`);
      continue;
    }

    try {
      const nextFirst = renamed?.firstName ?? contact.firstName;
      const nextLast = renamed?.lastName ?? contact.lastName;
      await updateQuoContactName(contact.id, nextFirst, nextLast, contact.defaultFields, {
        fallbackPhones: fallbackPhone ? [fallbackPhone] : [],
      });
      if (renamed) {
        result.renamed += 1;
        result.details.push(`${contact.displayName} → ${nextFirst} ${nextLast}`.trim());
      } else {
        result.details.push(`${contact.displayName}: restored missing phone from case data`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      result.errors.push(`${contact.displayName}: ${msg}`);
    }
  }

  if (filterSet) {
    result.notFound = [...filterSet].filter((num) => !matchedCaseNumbers.has(num));
    for (const num of result.notFound) {
      result.details.push(`Case ${num}: no Quo contact found${usedDirectoryScan ? "" : " (linked id missing)"}`);
    }
  }

  return result;
}
