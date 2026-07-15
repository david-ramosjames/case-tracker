import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizePreferredLanguage } from "@/lib/case-options";
import { listAllQuoContactsRaw, updateQuoContactName, type QuoContactRaw } from "@/lib/quo/client";
import { parseCaseNumbersFromQuoContactName } from "@/lib/quo/contact-sync";

const TRAILING_CASE_NUMBERS_RE = /(\d{3,6}(?:\s*&\s*\d{3,6})*)\s*$/;

type RenameResult = {
  totalContacts: number;
  renamed: number;
  skipped: number;
  errors: string[];
};

async function buildCaseLanguageMap(): Promise<Map<string, string>> {
  const client = createSupabaseAdminClient() ?? (await createSupabaseServerClient());
  const { data, error } = await client
    .from("cases")
    .select("case_number,preferred_language");
  if (error) throw new Error(`Failed to load cases: ${error.message}`);

  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ case_number: string | null; preferred_language: string | null }>) {
    const num = row.case_number?.trim();
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
  if (/\s(EN|ES)$/i.test(nameWithoutNumbers)) return null;

  const lastNameMatch = contact.lastName.match(TRAILING_CASE_NUMBERS_RE);
  if (lastNameMatch) {
    const beforeNumbers = contact.lastName.slice(0, lastNameMatch.index).trimEnd();
    const numbers = lastNameMatch[0];
    const newLast = beforeNumbers ? `${beforeNumbers} ${languageTag} ${numbers}` : `${languageTag} ${numbers}`;
    return { firstName: contact.firstName, lastName: newLast };
  }

  const firstNameMatch = contact.firstName.match(TRAILING_CASE_NUMBERS_RE);
  if (firstNameMatch) {
    const beforeNumbers = contact.firstName.slice(0, firstNameMatch.index).trimEnd();
    const numbers = firstNameMatch[0];
    const newFirst = beforeNumbers ? `${beforeNumbers} ${languageTag} ${numbers}` : `${languageTag} ${numbers}`;
    return { firstName: newFirst, lastName: contact.lastName };
  }

  return null;
}

/**
 * Rename Quo contacts to include a language tag (EN/ES) before the case number.
 * When `filterCaseNumbers` is provided, only contacts matching those case numbers are updated.
 */
export async function renameQuoContactsWithLanguage(filterCaseNumbers?: string[]): Promise<RenameResult> {
  const filterSet = filterCaseNumbers?.length
    ? new Set(filterCaseNumbers.map((n) => n.trim()).filter(Boolean))
    : null;

  const [contacts, caseLanguageMap] = await Promise.all([listAllQuoContactsRaw(), buildCaseLanguageMap()]);

  const result: RenameResult = { totalContacts: contacts.length, renamed: 0, skipped: 0, errors: [] };

  for (const contact of contacts) {
    const caseNumbers = parseCaseNumbersFromQuoContactName(contact.displayName);
    if (!caseNumbers.length) {
      result.skipped += 1;
      continue;
    }

    if (filterSet && !caseNumbers.some((n) => filterSet.has(n))) {
      result.skipped += 1;
      continue;
    }

    const languageTag = caseLanguageMap.get(caseNumbers[0]);
    if (!languageTag) {
      result.skipped += 1;
      continue;
    }

    const renamed = buildRenamedFields(contact, languageTag);
    if (!renamed) {
      result.skipped += 1;
      continue;
    }

    try {
      await updateQuoContactName(contact.id, renamed.firstName, renamed.lastName);
      result.renamed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      result.errors.push(`${contact.displayName}: ${msg}`);
    }
  }

  return result;
}
