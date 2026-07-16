import { cleanCaseNumber } from "@/lib/csv/parse";
import { listAllQuoContacts } from "@/lib/quo/client";

/** Parse trailing case number(s) from Quo directory names, e.g. "Mara Hernandez 1570" or "Kisha Williams 1277 & 1280". */
export function parseCaseNumbersFromQuoContactName(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];

  const match = trimmed.match(/(\d{3,6}(?:\s*&\s*\d{3,6})*)\s*$/);
  if (!match) return [];

  return match[1]
    .split(/\s*&\s*/)
    .map((part) => cleanCaseNumber(part))
    .filter(Boolean);
}

export function normalizeContactLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\d{3,6}(?:\s*&\s*\d{3,6})*\s*$/, "")
    .replace(/\s+\b(en|es)\b\s*$/i, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

export function contactNamesSimilar(clientName: string | null | undefined, displayName: string) {
  const client = normalizeContactLabel(clientName ?? "");
  const contact = normalizeContactLabel(displayName);
  if (!client || !contact) return false;
  return client === contact || client.includes(contact) || contact.includes(client);
}

export type QuoContactSyncMatch = {
  caseNumber: string;
  displayName: string;
  phone: string | null;
  quoContactId: string;
  updatedAt: string | null;
};

export function scoreQuoContactMatch(match: QuoContactSyncMatch, clientName?: string | null) {
  let score = 0;
  if (match.phone) score += 1_000;
  if (contactNamesSimilar(clientName, match.displayName)) score += 500;
  if (match.updatedAt) score += new Date(match.updatedAt).getTime() / 1_000_000_000_000;
  return score;
}

export function pickBestQuoContactMatch(
  candidates: QuoContactSyncMatch[],
  clientName?: string | null,
): QuoContactSyncMatch | null {
  const ordered = listQuoContactMatchesForCase(candidates, clientName);
  return ordered[0] ?? null;
}

/** All unique Quo contacts for a case, best match first. */
export function listQuoContactMatchesForCase(
  candidates: QuoContactSyncMatch[],
  clientName?: string | null,
): QuoContactSyncMatch[] {
  const byId = new Map<string, QuoContactSyncMatch>();
  for (const match of candidates) {
    const existing = byId.get(match.quoContactId);
    if (!existing || scoreQuoContactMatch(match, clientName) > scoreQuoContactMatch(existing, clientName)) {
      byId.set(match.quoContactId, match);
    }
  }
  return [...byId.values()].sort(
    (left, right) => scoreQuoContactMatch(right, clientName) - scoreQuoContactMatch(left, clientName),
  );
}

export type QuoContactMatchResult = {
  matches: QuoContactSyncMatch[];
  totalDirectoryContacts: number;
  noCaseNumber: string[];
};

export async function buildQuoContactMatches(): Promise<QuoContactMatchResult> {
  const rows = await listAllQuoContacts();
  const matches: QuoContactSyncMatch[] = [];
  const noCaseNumber: string[] = [];

  for (const contact of rows) {
    const caseNumbers = parseCaseNumbersFromQuoContactName(contact.displayName);
    if (!caseNumbers.length) {
      noCaseNumber.push(contact.displayName);
      continue;
    }
    for (const caseNumber of caseNumbers) {
      matches.push({
        caseNumber,
        displayName: contact.displayName,
        phone: contact.primaryPhone,
        quoContactId: contact.id,
        updatedAt: contact.updatedAt,
      });
    }
  }

  return { matches, totalDirectoryContacts: rows.length, noCaseNumber };
}

export function groupQuoContactMatchesByCaseNumber(matches: QuoContactSyncMatch[]) {
  const grouped = new Map<string, QuoContactSyncMatch[]>();
  for (const match of matches) {
    const key = cleanCaseNumber(match.caseNumber);
    if (!key) continue;
    const bucket = grouped.get(key) ?? [];
    bucket.push(match);
    grouped.set(key, bucket);
  }
  return grouped;
}
