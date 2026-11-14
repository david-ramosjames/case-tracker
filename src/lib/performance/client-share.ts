/**
 * Multi-client cases: settlements/disbursements credit one unit per client.
 * Spreadsheet fractions (1.5, 2.5, …) are the same idea — more than one client on the matter.
 */

/** How many clients are named in a case/client label. */
export function countClientsInName(clientName: string | null | undefined): number {
  if (!clientName) return 1;
  const cleaned = clientName
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bet\s+al\.?\b/gi, " ")
    .trim();
  if (!cleaned) return 1;

  const parts = cleaned
    .split(/\s*(?:&|\/|,|\band\b|\+|·)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !/^(et\.?\s*al\.?|others?)$/i.test(p));

  return Math.max(1, parts.length);
}

/** Closing metrics (settlement / disbursement) weight by client count; others are 1. */
export function deliverableCredit(
  deliverableType: string,
  clientName: string | null | undefined,
): number {
  if (deliverableType === "settlement" || deliverableType === "disbursement") {
    return countClientsInName(clientName);
  }
  return 1;
}

/** Display weekly totals that may be fractional from multi-client closings. */
export function formatMetricValue(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return (Math.round(value * 10) / 10).toFixed(1);
}
