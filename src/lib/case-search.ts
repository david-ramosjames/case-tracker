import { cleanCaseNumber, caseNumberSortKey } from "@/lib/csv/parse";
import { type CaseRecord } from "@/lib/types";

/** Digit string used for case-number autocomplete (handles `nicolasmacdonald-1208`). */
export function caseNumberDigitsForSearch(caseNumber: string) {
  const cleaned = cleanCaseNumber(caseNumber);
  if (/^\d+$/.test(cleaned)) return cleaned;

  const trailingHyphen = caseNumber.trim().match(/-(\d+)\s*$/);
  if (trailingHyphen) return trailingHyphen[1];

  const key = caseNumberSortKey(caseNumber);
  if (key != null) return String(key);

  return caseNumber.replace(/\D/g, "");
}

export function searchDigitsFromQuery(query: string) {
  return query.trim().replace(/^#/, "").replace(/\D/g, "");
}

function matchesCaseNumberDigits(recordDigits: string, searchDigits: string) {
  if (!searchDigits || !recordDigits) return false;
  if (recordDigits === searchDigits) return true;
  // Prefix match while typing a case number (120 → 1208), not substring (120 in 1120).
  return recordDigits.startsWith(searchDigits);
}

function matchesHybridCaseNumber(caseNumber: string, searchDigits: string) {
  if (!searchDigits) return false;
  const normalized = caseNumber.trim().toLowerCase();
  return normalized.endsWith(`-${searchDigits}`) || normalized.endsWith(searchDigits);
}

export function matchesCaseSearch(record: CaseRecord, query: string) {
  const normalizedSearch = query.trim().toLowerCase().replace(/^#/, "");
  if (!normalizedSearch) return false;

  const searchDigits = searchDigitsFromQuery(query);
  const recordDigits = caseNumberDigitsForSearch(record.shared.caseNumber);

  if (searchDigits) {
    if (
      matchesCaseNumberDigits(recordDigits, searchDigits) ||
      matchesHybridCaseNumber(record.shared.caseNumber, searchDigits)
    ) {
      return true;
    }
  }

  return (
    record.shared.caseNumber.toLowerCase().includes(normalizedSearch) ||
    record.shared.clientName.toLowerCase().includes(normalizedSearch) ||
    record.attorney.name.toLowerCase().includes(normalizedSearch)
  );
}

/** Lower score = better match for sorting autocomplete results. */
export function caseSearchRank(record: CaseRecord, query: string) {
  const normalizedSearch = query.trim().toLowerCase().replace(/^#/, "");
  const searchDigits = searchDigitsFromQuery(query);
  const recordDigits = caseNumberDigitsForSearch(record.shared.caseNumber);
  const caseNumber = record.shared.caseNumber.toLowerCase();
  const clientName = record.shared.clientName.toLowerCase();

  if (searchDigits) {
    if (recordDigits === searchDigits) return 0;
    if (matchesCaseNumberDigits(recordDigits, searchDigits)) return 1;
    if (matchesHybridCaseNumber(record.shared.caseNumber, searchDigits)) return 2;
  }

  if (caseNumber === normalizedSearch || caseNumber.endsWith(`-${normalizedSearch}`)) return 0;
  if (caseNumber.startsWith(normalizedSearch)) return 1;
  if (caseNumber.includes(normalizedSearch)) return 3;
  if (clientName.startsWith(normalizedSearch)) return 4;
  if (clientName.includes(normalizedSearch)) return 5;
  if (record.attorney.name.toLowerCase().includes(normalizedSearch)) return 6;
  return 7;
}

/** Tie-breaker within the same rank — prefer numerically closest case number. */
export function caseSearchTieBreak(record: CaseRecord, query: string) {
  const searchDigits = searchDigitsFromQuery(query);
  const recordDigits = caseNumberDigitsForSearch(record.shared.caseNumber);
  if (!searchDigits || !recordDigits) return 0;

  const searchNum = Number(searchDigits);
  const recordNum = Number(recordDigits);
  if (Number.isFinite(searchNum) && Number.isFinite(recordNum)) {
    return Math.abs(recordNum - searchNum);
  }

  return Math.abs(recordDigits.length - searchDigits.length);
}

export function sortCaseSearchResults(records: CaseRecord[], query: string) {
  return [...records].sort((a, b) => {
    const rankDiff = caseSearchRank(a, query) - caseSearchRank(b, query);
    if (rankDiff !== 0) return rankDiff;

    const tieDiff = caseSearchTieBreak(a, query) - caseSearchTieBreak(b, query);
    if (tieDiff !== 0) return tieDiff;

    const aNum = caseNumberSortKey(a.shared.caseNumber);
    const bNum = caseNumberSortKey(b.shared.caseNumber);
    if (aNum != null && bNum != null) return aNum - bNum;

    return a.shared.caseNumber.localeCompare(b.shared.caseNumber, undefined, { numeric: true });
  });
}
