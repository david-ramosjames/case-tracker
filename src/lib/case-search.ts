import { cleanCaseNumber } from "@/lib/csv/parse";
import { type CaseRecord } from "@/lib/types";

export function matchesCaseSearch(record: CaseRecord, query: string) {
  const normalizedSearch = query.trim().toLowerCase().replace(/^#/, "");
  if (!normalizedSearch) return false;

  const searchCaseNumber = cleanCaseNumber(normalizedSearch);
  const recordCaseNumber = cleanCaseNumber(record.shared.caseNumber);

  return (
    record.shared.caseNumber.toLowerCase().includes(normalizedSearch) ||
    recordCaseNumber.includes(searchCaseNumber) ||
    (searchCaseNumber.length > 0 && recordCaseNumber === searchCaseNumber) ||
    record.shared.clientName.toLowerCase().includes(normalizedSearch) ||
    record.attorney.name.toLowerCase().includes(normalizedSearch)
  );
}

/** Lower score = better match for sorting autocomplete results. */
export function caseSearchRank(record: CaseRecord, query: string) {
  const normalizedSearch = query.trim().toLowerCase().replace(/^#/, "");
  const searchCaseNumber = cleanCaseNumber(normalizedSearch);
  const caseNumber = record.shared.caseNumber.toLowerCase();
  const recordCaseNumber = cleanCaseNumber(record.shared.caseNumber);
  const clientName = record.shared.clientName.toLowerCase();

  if (searchCaseNumber && recordCaseNumber === searchCaseNumber) return 0;
  if (caseNumber.startsWith(normalizedSearch)) return 1;
  if (recordCaseNumber.startsWith(searchCaseNumber)) return 2;
  if (caseNumber.includes(normalizedSearch)) return 3;
  if (clientName.startsWith(normalizedSearch)) return 4;
  if (clientName.includes(normalizedSearch)) return 5;
  return 6;
}

export function sortCaseSearchResults(records: CaseRecord[], query: string) {
  return [...records].sort((a, b) => {
    const rankDiff = caseSearchRank(a, query) - caseSearchRank(b, query);
    if (rankDiff !== 0) return rankDiff;
    return a.shared.caseNumber.localeCompare(b.shared.caseNumber, undefined, { numeric: true });
  });
}
