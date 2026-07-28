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
  return getCommissionPeriodEndDate(commissionYear, startMonth, 12);
}

export const COMMISSION_PERIOD_MONTH_OPTIONS = [12, 13, 14] as const;
export type CommissionPeriodMonthCount = (typeof COMMISSION_PERIOD_MONTH_OPTIONS)[number];

export function normalizeCommissionMonthCount(monthCount?: number): CommissionPeriodMonthCount {
  if (monthCount === 14) return 14;
  if (monthCount === 13) return 13;
  return 12;
}

/** Last moment of the final month in a commission period (12, 13, or 14 months). */
export function getCommissionPeriodEndDate(
  commissionYear: number,
  startMonth: number,
  monthCount: number = 12,
): Date {
  const periodMonths = normalizeCommissionMonthCount(monthCount);
  const start = getCommissionYearStartDate(commissionYear, startMonth);
  return new Date(start.getFullYear(), start.getMonth() + periodMonths, 0, 23, 59, 59, 999);
}

export function getCurrentCommissionYear(startMonth: number, refDate = new Date()): number {
  return getCommissionYearLabel(refDate, startMonth);
}

export function getRecordDisburseDate(input: {
  disburseDate: string | null;
  checkDisbursedAt: string | null;
}): string | null {
  return input.disburseDate?.trim() || input.checkDisbursedAt?.trim() || null;
}

/** True when a disbursed case belongs to a prior commission year (commission years follow disburse date). */
export function isCaseHistoricalForAttorney(
  disburseDate: string | null | undefined,
  startMonth: number,
  refDate = new Date(),
): boolean {
  if (!disburseDate?.trim()) return false;

  const disbursed = new Date(disburseDate);
  if (Number.isNaN(disbursed.getTime())) return false;

  const caseCommissionYear = getCommissionYearLabel(disbursed, startMonth);
  const currentCommissionYear = getCurrentCommissionYear(startMonth, refDate);
  return caseCommissionYear < currentCommissionYear;
}

export function isDateInCommissionYear(
  dateValue: string | null | undefined,
  commissionYear: number,
  startMonth: number,
  monthCount: number = 12,
) {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  const start = getCommissionYearStartDate(commissionYear, startMonth);
  const end = getCommissionPeriodEndDate(commissionYear, startMonth, monthCount);
  return date >= start && date <= end;
}

export function isDateInCalendarYear(dateValue: string | null | undefined, calendarYear: number) {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === calendarYear;
}

export function getCalendarYearElapsedPercentage(calendarYear: number, refDate = new Date()) {
  const start = new Date(calendarYear, 0, 1);
  const end = new Date(calendarYear, 11, 31, 23, 59, 59, 999);
  if (refDate <= start) return 0;
  if (refDate >= end) return 100;
  const total = end.getTime() - start.getTime();
  const elapsed = refDate.getTime() - start.getTime();
  return total > 0 ? (elapsed / total) * 100 : 0;
}

/** Hide from attorney UI when disburse date is set and falls outside the current commission year. */
export function isDisbursementOutsideCurrentCommissionYear(
  disburseDate: string | null | undefined,
  startMonth: number,
  refDate = new Date(),
): boolean {
  if (!disburseDate?.trim()) return false;
  const currentCommissionYear = getCurrentCommissionYear(startMonth, refDate);
  return !isDateInCommissionYear(disburseDate, currentCommissionYear, startMonth);
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

export type CommissionYearQuarter = 1 | 2 | 3 | 4;

export type CommissionQuarterWindow = {
  quarter: CommissionYearQuarter;
  start: Date;
  end: Date;
};

/** CY Q1–Q3 are three months each; CY Q4 covers the remainder (3–5 months for 12/13/14-month periods). */
export function getCommissionYearQuarterWindows(
  commissionYear: number,
  startMonth: number,
  monthCount: number = 12,
): CommissionQuarterWindow[] {
  const periodMonths = normalizeCommissionMonthCount(monthCount);
  const yearStart = getCommissionYearStartDate(commissionYear, startMonth);
  const q4Months = periodMonths - 9;

  return ([0, 1, 2, 3] as const).map((index) => {
    const monthsBefore = index < 3 ? index * 3 : 9;
    const quarterMonths = index < 3 ? 3 : q4Months;
    const start = new Date(yearStart.getFullYear(), yearStart.getMonth() + monthsBefore, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + quarterMonths, 0, 23, 59, 59, 999);
    return {
      quarter: (index + 1) as CommissionYearQuarter,
      start,
      end,
    };
  });
}

export function getCommissionQuarterForDate(
  dateValue: string | Date,
  commissionYear: number,
  startMonth: number,
  monthCount: number = 12,
): CommissionYearQuarter | null {
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return null;

  const periodStart = getCommissionYearStartDate(commissionYear, startMonth);
  const periodEnd = getCommissionPeriodEndDate(commissionYear, startMonth, monthCount);
  if (date < periodStart || date > periodEnd) return null;

  for (const window of getCommissionYearQuarterWindows(commissionYear, startMonth, monthCount)) {
    if (date >= window.start && date <= window.end) return window.quarter;
  }

  return null;
}

function formatShortMonthYear(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date);
}

export function formatCommissionYearPeriod(commissionYear: number, startMonth: number, monthCount: number = 12) {
  return formatCommissionPeriod(commissionYear, startMonth, monthCount);
}

export function formatCommissionPeriod(commissionYear: number, startMonth: number, monthCount: number = 12) {
  const start = getCommissionYearStartDate(commissionYear, startMonth);
  const end = new Date(start.getFullYear(), start.getMonth() + normalizeCommissionMonthCount(monthCount) - 1, 1);
  return `${formatShortMonthYear(start)} – ${formatShortMonthYear(end)}`;
}

export function formatCommissionQuarterPeriod(
  commissionYear: number,
  startMonth: number,
  quarter: CommissionYearQuarter,
  monthCount: number = 12,
) {
  const window = getCommissionYearQuarterWindows(commissionYear, startMonth, monthCount).find(
    (item) => item.quarter === quarter,
  );
  if (!window) return "";
  return `${formatShortMonthYear(window.start)} – ${formatShortMonthYear(window.end)}`;
}

export function getCommissionYearStartMonthLabel(startMonth: number) {
  return COMMISSION_YEAR_MONTH_OPTIONS.find((item) => item.value === startMonth)?.label ?? "January";
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
