/** Commission year label for a date (year in which the commission period starts). */
export function getCommissionYearLabel(date: Date, startMonth: number): number {
  const month = date.getMonth() + 1;
  const calendarYear = date.getFullYear();
  return month >= startMonth ? calendarYear : calendarYear - 1;
}

export function getCommissionYearStartDate(commissionYear: number, startMonth: number): Date {
  return new Date(commissionYear, startMonth - 1, 1);
}

export function getCommissionYearEndDate(commissionYear: number, startMonth: number): Date {
  const nextStart = getCommissionYearStartDate(commissionYear + 1, startMonth);
  return new Date(nextStart.getTime() - 1);
}

export function getCurrentCommissionYear(startMonth: number, refDate = new Date()): number {
  return getCommissionYearLabel(refDate, startMonth);
}

/** True when a case is past the attorney visibility window (3+ months into current commission year). */
export function isCaseHistoricalForAttorney(
  dateSigned: string,
  startMonth: number,
  refDate = new Date(),
): boolean {
  const signed = new Date(dateSigned);
  if (Number.isNaN(signed.getTime())) return false;

  const caseCommissionYear = getCommissionYearLabel(signed, startMonth);
  const currentCommissionYear = getCurrentCommissionYear(startMonth, refDate);
  if (caseCommissionYear >= currentCommissionYear) return false;

  const currentYearStart = getCommissionYearStartDate(currentCommissionYear, startMonth);
  const historicalCutoff = addMonths(currentYearStart, 3);
  return refDate >= historicalCutoff;
}

export function isDateInCommissionYear(dateValue: string | null | undefined, commissionYear: number, startMonth: number) {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  return getCommissionYearLabel(date, startMonth) === commissionYear;
}

export function parseTargetQuarterYear(quarter: string | null | undefined) {
  if (!quarter) return null;
  const twoDigit = quarter.match(/(?:Q[1-4]|[12]H)-(\d{2})/i)?.[1];
  const fourDigit = quarter.match(/(20\d{2})/)?.[0];
  if (fourDigit) return Number(fourDigit);
  if (twoDigit) return 2000 + Number(twoDigit);
  return null;
}

export function isTargetQuarterInCommissionYear(
  quarter: string | null | undefined,
  commissionYear: number,
  startMonth: number,
) {
  const quarterYear = parseTargetQuarterYear(quarter);
  if (quarterYear == null) return false;
  if (startMonth === 1) return quarterYear === commissionYear;
  return quarterYear === commissionYear || quarterYear === commissionYear + 1;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export const COMMISSION_YEAR_MONTH_OPTIONS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
] as const;
