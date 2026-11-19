import { addDaysYmd, chicagoTodayYmdForPolicy } from "@/lib/policy-coverage";
import { type CaseTrackerSettings } from "@/lib/types";

export const DEFAULT_FIELD_REMINDER_FREQUENCY_DAYS = 7;

export function normalizeFieldReminderFrequencyDays(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_FIELD_REMINDER_FREQUENCY_DAYS;
  return Math.min(90, Math.round(n));
}

/** YYYY-MM-DD or null. */
export function normalizeFieldReminderNextAllowedOn(value: unknown): string | null {
  if (value == null || value === "") return null;
  const text = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

/**
 * Scheduled field-reminder batches only run on/after this Central calendar date.
 * Manual/force pushes bypass this gate.
 */
export function getFieldReminderScheduleSkipReason(
  settings: Pick<CaseTrackerSettings, "fieldReminderNextAllowedOn">,
  now = new Date(),
): string | null {
  const next = settings.fieldReminderNextAllowedOn?.trim() || null;
  if (!next) return null;
  const today = chicagoTodayYmdForPolicy(now);
  if (today < next) return `next batch ${next}`;
  return null;
}

export function nextFieldReminderAllowedOnAfterSend(
  frequencyDays: number,
  now = new Date(),
): string {
  const days = normalizeFieldReminderFrequencyDays(frequencyDays);
  return addDaysYmd(chicagoTodayYmdForPolicy(now), days);
}
