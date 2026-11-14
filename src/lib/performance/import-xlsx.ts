/**
 * Later-phase historical import from RJL 2026 GOALS.xlsx.
 * Data model already supports deliverables/commitments/snapshots — this module
 * is the intentional hook for best-effort pair-sheet parsing.
 *
 * Does not run automatically. Call from a one-off script when ready.
 */

export type ImportedPairRow = {
  paralegalName: string;
  attorneyName: string;
  deliverableLabel: string;
  caseNumber: string | null;
  clientName: string | null;
  plannedDate: string | null;
  completedDate: string | null;
  weekStart: string | null;
  notes: string | null;
};

export function mapSheetLabelToType(label: string): string {
  const normalized = label.trim().toLowerCase();
  if (normalized.includes("demand")) return "demand_sent";
  if (normalized.includes("lawsuit")) return "lawsuit_filed";
  if (normalized.includes("discovery")) return "discovery_responses";
  if (normalized.includes("litigation event") || normalized.includes("lit event")) {
    return "lit_event_scheduled";
  }
  if (normalized.includes("deposition")) return "deposition";
  if (normalized.includes("mediation")) return "mediation";
  if (normalized.includes("hearing") || normalized.includes("trial")) return "hearing";
  if (normalized.includes("settlement")) return "settlement";
  if (normalized.includes("disbursement") || normalized.includes("paid")) return "disbursement";
  if (normalized.includes("medical")) return "medicals";
  return "other";
}

/** Placeholder parser — returns empty until ExcelJS workbook wiring is enabled. */
export async function parseGoalsWorkbook(_filePath: string): Promise<ImportedPairRow[]> {
  return [];
}
