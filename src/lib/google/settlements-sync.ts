import { caseNumbersMatch, cleanCaseNumber, parseSheetDate, parseSheetYesNoTriState } from "@/lib/csv/parse";
import { fetchGoogleSheetValues, findSheetColumnIndex } from "@/lib/google/client";
import {
  getGoogleSheetsCredentials,
  getGoogleSheetsSettlementConfig,
  isGoogleSheetsSettlementSyncConfigured,
} from "@/lib/slack/config";
import {
  clearSheetSettlementSyncForCase,
  syncSettlementsFromSheet,
  type SettlementSheetCasePayload,
  type SettlementSheetSyncResult as SettlementSheetSyncCoreResult,
} from "@/lib/supabase/services";

export type { SettlementSheetSyncCaseDetail, SettlementSheetSyncPartyDetail } from "@/lib/supabase/services";

export type SettlementSheetSyncResult = SettlementSheetSyncCoreResult & {
  configured: boolean;
  sheetRowsFound?: number;
  caseNumber?: string;
  clearedSheetData?: boolean;
  sheetDisbursementsRemoved?: number;
  stageRestored?: string | null;
  financialLocked?: boolean;
};

type ParsedSettlementRow = {
  sheetRowKey: string;
  caseNumber: string;
  partyLabel: string | null;
  /** Non-blank B = still waiting to disburse; blank B = this row has disbursed. */
  pendingRemaining: boolean;
  settlementDate: string | null;
  /** Column G tri-state — blank on a new party must not undo a case-level Y. */
  fullSettlementFlag: "yes" | "no" | "blank";
  disburseDate: string | null;
  settlementAmount: number | null;
  attorneyFees: number | null;
};

function parseSheetMoney(value: string) {
  const numeric = Number(value.replace(/[$,%\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

/** Column B: remaining slots while pending (e.g. 0.5, 1, 2). Blank once disbursed. */
function isPendingDisbursementCountCell(value: string) {
  return value.trim().length > 0;
}

export function parseSettlementSheetRows(rows: string[][], spreadsheetId: string) {
  if (rows.length < 2) return [];

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const countIdx = findSheetColumnIndex(header, [
    (cell) => cell.includes("disbursement") && cell.includes("count"),
    (cell) => cell === "count of disbursements" || cell === "# of disbursements",
    (cell) => cell === "count",
  ]);
  const caseIdx = findSheetColumnIndex(header, [
    (cell) => /case\s*(#|no|number)/.test(cell),
    (cell) => cell === "case no" || cell === "case #" || cell === "case",
  ]);
  const clientIdx = findSheetColumnIndex(header, [
    (cell) => cell.includes("client"),
    (cell) => cell.includes("party"),
  ]);
  const settlementIdx = findSheetColumnIndex(header, [
    (cell) => cell.includes("settlement") && cell.includes("date"),
    (cell) => cell === "settlement date",
  ]);
  const fullSettlementIdx = findSheetColumnIndex(header, [
    (cell) => cell.includes("full") && cell.includes("settlement"),
    (cell) => cell === "full settlement",
  ]);
  const grossSettlementIdx = findSheetColumnIndex(header, [
    (cell) => cell.includes("gross") && cell.includes("settlement"),
    (cell) => cell === "gross settlement",
  ]);
  const netFeesIdx = findSheetColumnIndex(header, [
    (cell) => cell.includes("net") && cell.includes("attorney") && cell.includes("fee"),
    (cell) => cell === "net attorney fees",
  ]);
  const disbursedIdx = findSheetColumnIndex(header, [
    (cell) => cell.includes("date") && cell.includes("disburs"),
    (cell) => cell === "date disbursed" || cell === "disburse date" || cell === "disbursed date",
    (cell) => cell.includes("disbursed") && cell.includes("date"),
    (cell) => cell === "disbursed",
  ]);

  const resolvedCountIdx = countIdx >= 0 ? countIdx : 1;
  const resolvedCaseIdx = caseIdx >= 0 ? caseIdx : 2;
  const resolvedClientIdx = clientIdx >= 0 ? clientIdx : 3;
  const resolvedSettlementIdx = settlementIdx >= 0 ? settlementIdx : 7;
  const resolvedFullSettlementIdx = fullSettlementIdx >= 0 ? fullSettlementIdx : 6;
  const resolvedGrossIdx = grossSettlementIdx >= 0 ? grossSettlementIdx : 9;
  const resolvedNetFeesIdx = netFeesIdx >= 0 ? netFeesIdx : 10;
  const resolvedDisbursedIdx = disbursedIdx >= 0 ? disbursedIdx : 25;

  const parsed: ParsedSettlementRow[] = [];
  rows.slice(1).forEach((row, offset) => {
    const sheetRowNumber = offset + 2;
    const caseNumber = cleanCaseNumber(row[resolvedCaseIdx] ?? "");
    if (!caseNumber) return;

    const countCell = (row[resolvedCountIdx] ?? "").trim();
    const settlementDate = parseSheetDate(row[resolvedSettlementIdx] ?? "");
    const fullSettlementFlag = parseSheetYesNoTriState(row[resolvedFullSettlementIdx] ?? "");
    const disburseDate = parseSheetDate(row[resolvedDisbursedIdx] ?? "");
    const partyLabel = (row[resolvedClientIdx] ?? "").trim() || null;
    const pendingRemaining = disburseDate ? false : isPendingDisbursementCountCell(countCell);

    parsed.push({
      sheetRowKey: `${spreadsheetId}:${sheetRowNumber}`,
      caseNumber,
      partyLabel,
      pendingRemaining,
      settlementDate,
      fullSettlementFlag,
      disburseDate,
      settlementAmount: parseSheetMoney(row[resolvedGrossIdx] ?? ""),
      attorneyFees: parseSheetMoney(row[resolvedNetFeesIdx] ?? ""),
    });
  });

  return parsed;
}

export function buildSettlementCasePayloads(parsed: ParsedSettlementRow[]): SettlementSheetCasePayload[] {
  const byCase = new Map<string, ParsedSettlementRow[]>();
  for (const row of parsed) {
    byCase.set(row.caseNumber, [...(byCase.get(row.caseNumber) ?? []), row]);
  }

  return [...byCase.entries()].map(([caseNumber, caseRows]) => buildSettlementCasePayload(caseNumber, caseRows));
}

function buildSettlementCasePayload(caseNumber: string, caseRows: ParsedSettlementRow[]): SettlementSheetCasePayload {
  const sheetRowCount = caseRows.length;
  const settlementDate = caseRows.map((row) => row.settlementDate).find(Boolean) ?? null;
  // Column G is case-level: any Y settles the case (even before all parties exist).
  // Blank cells on newly added party rows must NOT reopen a settled case.
  // Only an explicit N/No reopens / blocks settle.
  const hasFullSettlementYes = caseRows.some((row) => row.fullSettlementFlag === "yes");
  const hasFullSettlementNo = caseRows.some((row) => row.fullSettlementFlag === "no");
  const fullSettlement = hasFullSettlementYes && !hasFullSettlementNo;
  const disbursements = caseRows.map((row) => ({
    sheetRowKey: row.sheetRowKey,
    partyLabel: row.partyLabel,
    disburseDate: row.disburseDate,
    settlementDate: row.settlementDate ?? settlementDate,
    settlementAmount: row.settlementAmount,
    attorneyFees: row.attorneyFees,
    pendingRemaining: row.pendingRemaining,
  }));
  const disbursedDates = disbursements.map((item) => item.disburseDate).filter(Boolean) as string[];
  const latestDisburseDate = disbursedDates.length
    ? disbursedDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
    : null;
  const pendingCount = disbursements.filter((item) => item.pendingRemaining).length;

  return {
    caseNumber,
    sheetRowCount,
    settlementDate,
    fullSettlement,
    fullSettlementMismatch: hasFullSettlementYes && hasFullSettlementNo,
    totalSettlementAmount: sumMoney(caseRows.map((row) => row.settlementAmount)),
    totalAttorneyFees: sumMoney(caseRows.map((row) => row.attorneyFees)),
    latestDisburseDate,
    allDisbursed: pendingCount === 0,
    pendingDisbursementCount: pendingCount,
    completedDisbursementCount: disbursements.filter((item) => !item.pendingRemaining).length,
    disbursements,
  };
}

export async function syncSettlementsFromGoogleSheetIfConfigured(options?: {
  dryRun?: boolean;
}): Promise<SettlementSheetSyncResult> {
  if (!isGoogleSheetsSettlementSyncConfigured()) {
    return {
      configured: false,
      casesProcessed: 0,
      disbursementsSynced: 0,
      settlementsUpdated: 0,
      stagesAutoSettled: 0,
      stagesRestored: 0,
      skippedNoTracker: 0,
      skippedFinancialLocked: 0,
      sheetCasesFound: 0,
      details: [],
    };
  }
  return { configured: true, ...(await syncSettlementsFromGoogleSheet(options)) };
}

export async function syncSettlementsFromGoogleSheet(options?: { dryRun?: boolean }) {
  const config = getGoogleSheetsSettlementConfig();
  const credentials = getGoogleSheetsCredentials();
  if (!config || !credentials) {
    throw new Error(
      "Settlement sheet sync is not configured. Set GOOGLE_SHEETS_SETTLEMENT_SPREADSHEET_ID, GOOGLE_SHEETS_SETTLEMENT_RANGE, and service account env vars.",
    );
  }

  const rows = await fetchGoogleSheetValues(config.spreadsheetId, config.range, credentials);
  const parsed = parseSettlementSheetRows(rows, config.spreadsheetId);
  const payload = buildSettlementCasePayloads(parsed);
  return syncSettlementsFromSheet(payload, { dryRun: options?.dryRun });
}

export type SettlementSheetCaseSyncOptions = {
  trackerEntryId?: string;
  docketflowCaseId?: string;
};

export async function syncSettlementsFromGoogleSheetForCaseNumber(
  caseNumber: string,
  options?: SettlementSheetCaseSyncOptions,
) {
  const config = getGoogleSheetsSettlementConfig();
  const credentials = getGoogleSheetsCredentials();
  if (!config || !credentials) {
    throw new Error(
      "Settlement sheet sync is not configured. Set GOOGLE_SHEETS_SETTLEMENT_SPREADSHEET_ID, GOOGLE_SHEETS_SETTLEMENT_RANGE, and service account env vars.",
    );
  }

  const targetCaseNumber = cleanCaseNumber(caseNumber);
  if (!targetCaseNumber) {
    throw new Error("A valid case number is required.");
  }

  const rows = await fetchGoogleSheetValues(config.spreadsheetId, config.range, credentials);
  const parsed = parseSettlementSheetRows(rows, config.spreadsheetId).filter((row) =>
    caseNumbersMatch(row.caseNumber, targetCaseNumber),
  );

  if (parsed.length === 0) {
    if (options?.trackerEntryId) {
      const cleared = await clearSheetSettlementSyncForCase({
        caseNumber: targetCaseNumber,
        trackerEntryId: options.trackerEntryId,
        caseId: options.docketflowCaseId ?? null,
      });
      return {
        casesProcessed: cleared.cleared ? 1 : 0,
        disbursementsSynced: 0,
        settlementsUpdated: cleared.cleared ? 1 : 0,
        stagesAutoSettled: 0,
        stagesRestored: 0,
        skippedNoTracker: 0,
        skippedFinancialLocked: cleared.reason === "financial_locked" ? 1 : 0,
        sheetCasesFound: 0,
        details: [],
        sheetRowsFound: 0,
        caseNumber: targetCaseNumber,
        clearedSheetData: cleared.cleared,
        sheetDisbursementsRemoved: cleared.sheetDisbursementsRemoved,
        stageRestored: cleared.stageRestored,
        financialLocked: cleared.reason === "financial_locked",
      };
    }

    return {
      casesProcessed: 0,
      disbursementsSynced: 0,
      settlementsUpdated: 0,
      stagesAutoSettled: 0,
      stagesRestored: 0,
      skippedNoTracker: 0,
      skippedFinancialLocked: 0,
      sheetCasesFound: 0,
      details: [],
      sheetRowsFound: 0,
      caseNumber: targetCaseNumber,
    };
  }

  const payload = [
    {
      ...buildSettlementCasePayload(targetCaseNumber, parsed),
      trackerEntryId: options?.trackerEntryId,
      docketflowCaseId: options?.docketflowCaseId,
    },
  ];
  const result = await syncSettlementsFromSheet(payload);
  return {
    ...result,
    sheetRowsFound: parsed.length,
    caseNumber: targetCaseNumber,
  };
}

function sumMoney(values: Array<number | null>) {
  return values.reduce<number | null>((total, value) => {
    if (value == null) return total;
    return (total ?? 0) + value;
  }, null);
}
