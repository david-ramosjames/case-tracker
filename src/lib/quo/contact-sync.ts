import { cleanCaseNumber } from "@/lib/csv/parse";
import { listAllQuoContacts } from "@/lib/quo/client";

/** Parse trailing case number(s) from Quo directory names, e.g. "Mara Hernandez 1570" or "Kisha Williams 1277 & 1280". */
export function parseCaseNumbersFromQuoContactName(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];

  const match = trimmed.match(/(\d{3,5}(?:\s*&\s*\d{3,5})*)\s*$/);
  if (!match) return [];

  return match[1]
    .split(/\s*&\s*/)
    .map((part) => cleanCaseNumber(part))
    .filter(Boolean);
}

export type QuoContactSyncMatch = {
  caseNumber: string;
  displayName: string;
  phone: string;
  quoContactId: string;
};

export async function buildQuoContactMatches(): Promise<QuoContactSyncMatch[]> {
  const rows = await listAllQuoContacts();
  const matches: QuoContactSyncMatch[] = [];

  for (const contact of rows) {
    if (!contact.primaryPhone) continue;
    const caseNumbers = parseCaseNumbersFromQuoContactName(contact.displayName);
    for (const caseNumber of caseNumbers) {
      matches.push({
        caseNumber,
        displayName: contact.displayName,
        phone: contact.primaryPhone,
        quoContactId: contact.id,
      });
    }
  }

  return matches;
}
