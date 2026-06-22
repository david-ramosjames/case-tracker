/** Normalize to E.164 for comparison (US numbers without country code get +1). */
export function normalizePhoneForComparison(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) return "";

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function formatClientPhoneDisplay(phone: string | null | undefined) {
  const trimmed = phone?.trim();
  if (!trimmed) return "";

  const normalized = normalizePhoneForComparison(trimmed);
  const usMatch = normalized.match(/^\+1(\d{10})$/);
  if (usMatch) {
    const digits = usMatch[1];
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return trimmed;
}
