const CT = "America/Chicago";

/** Monday (YYYY-MM-DD) for a date in America/Chicago. */
export function weekStartMondayCt(date: Date = new Date()): string {
  const parts = chicagoDateParts(date);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const dow = new Date(asUtc).getUTCDay(); // 0 Sun .. 6 Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(asUtc);
  monday.setUTCDate(monday.getUTCDate() + offset);
  return formatYmd(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
}

export function weekEndFromStart(weekStartYmd: string): string {
  const [y, m, d] = weekStartYmd.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + 6));
  return formatYmd(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate());
}

export function isDateInWeek(ymd: string, weekStart: string) {
  const end = weekEndFromStart(weekStart);
  return ymd >= weekStart && ymd <= end;
}

export function chicagoDateParts(date: Date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: CT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour === "24" ? "0" : bag.hour),
    minute: Number(bag.minute),
  };
}

export function chicagoTodayYmd(date: Date = new Date()) {
  const p = chicagoDateParts(date);
  return formatYmd(p.year, p.month, p.day);
}

export function daysInMonth(year: number, month1to12: number) {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

export function formatYmd(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Monday 9:30 CT is a snapshot checkpoint, not an edit lock. */
export function isPastMondaySnapshotCheckpoint(date: Date = new Date()) {
  const p = chicagoDateParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day);
  const dow = new Date(asUtc).getUTCDay();
  if (dow !== 1) return dow === 0 ? false : true;
  return p.hour > 9 || (p.hour === 9 && p.minute >= 30);
}
