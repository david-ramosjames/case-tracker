/** Display value for `<input type="date">` from a DB date or timestamp. */
export function toDateInput(value: string | null | undefined) {
  if (!value) return "";
  return value.trim().slice(0, 10);
}

/** Persistable calendar date (`YYYY-MM-DD`) from a date input value. */
export function dateInputToDateOnly(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

/** Persistable timestamp from a date input (noon UTC avoids day-shift in US timezones). */
export function dateInputToTimestamp(value: string | null | undefined): string | null {
  const dateOnly = dateInputToDateOnly(value);
  return dateOnly ? `${dateOnly}T12:00:00.000Z` : null;
}
