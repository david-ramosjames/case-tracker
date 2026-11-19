import ExcelJS from "exceljs";
import {
  FIRM_WEEKLY_METRICS,
  type FirmWeeklyMetricKey,
} from "@/lib/performance/firm-metrics";
import { WEEK_PAIR_METRIC_KEYS, type WeekPairMetricKey } from "@/lib/performance/week-pair-types";
import { formatYmd, shiftWeekStart } from "@/lib/performance/weeks";

export type ParsedWeeklyCheckRow = {
  weekStart: string;
  weekLabel: string;
  seatIndex: number;
  teamLabel: string;
  paralegalToken: string;
  attorneyToken: string;
  metrics: Partial<Record<WeekPairMetricKey, number>>;
};

/** One firm-total row from the RJL GOALS "Team" sheet. */
export type ParsedFirmWeekTotals = {
  weekStart: string;
  weekLabel: string;
  weekEndYmd: string;
  metrics: Partial<Record<FirmWeeklyMetricKey, number>>;
};

/** Team sheet columns (row 7 header): DEMANDS…NEW CASES. No DISENGAGE column. */
const TEAM_SHEET_COLUMN_TO_METRIC: Record<number, FirmWeeklyMetricKey> = {
  3: "demand_sent",
  4: "lawsuit_filed",
  5: "discovery_responses",
  6: "lit_event_scheduled",
  7: "deposition",
  8: "mediation",
  9: "hearing",
  10: "settlement",
  11: "disbursement",
  12: "new_case",
};

const COLUMN_TO_METRIC: Record<number, WeekPairMetricKey> = {
  4: "demand_sent",
  5: "lawsuit_filed",
  6: "discovery_responses",
  7: "lit_event_scheduled",
  8: "deposition",
  9: "mediation",
  10: "hearing",
  11: "disengagement",
  12: "settlement",
  13: "disbursement",
};

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("result" in obj) return cellText(obj.result);
    if ("text" in obj) return cellText(obj.text);
    if (Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>).map((t) => t.text ?? "").join("");
    }
    if (value instanceof Date) return value.toISOString();
  }
  return String(value);
}

/** Monday of the UTC calendar date (Excel serials are date-only, not CT wall-clock). */
function utcMondayFromDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const asUtc = Date.UTC(y, m, day);
  const dow = new Date(asUtc).getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(asUtc);
  monday.setUTCDate(monday.getUTCDate() + offset);
  return formatYmd(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
}

function parseExcelDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = cellText(value).trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Team sheet "WEEK END" → work-week Monday (no meeting−1 shift).
 * e.g. Week 45 ending 2026-11-15 → 2026-11-09.
 */
export function teamWeekEndToWorkWeekStart(value: unknown): string | null {
  const d = parseExcelDate(value);
  if (!d) return null;
  return utcMondayFromDate(d);
}

function teamCellNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "result" in value) {
    return teamCellNumber((value as { result: unknown }).result);
  }
  const text = cellText(value).trim();
  if (!text || text === "-" || text === "—" || /^n\/?a$/i.test(text)) return null;
  const leading = text.match(/^(-?\d+(?:\.\d+)?)/);
  if (leading) return Number(leading[1]);
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * Spreadsheet dates are the meeting day (reviewing the prior week's work).
 * Week labels (e.g. Week 21) match the work week — so store meeting Monday − 1 week.
 */
export function meetingDateToWorkWeekStart(value: unknown): string | null {
  let d: Date | null = null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    d = value;
  } else {
    const text = cellText(value).trim();
    if (!text) return null;
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }
  if (!d) return null;
  return shiftWeekStart(utcMondayFromDate(d), -1);
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "result" in value) {
    return num((value as { result: unknown }).result);
  }
  const text = cellText(value).trim();
  if (!text || /^n\/?a$/i.test(text) || /^tbd$/i.test(text) || text === "-" || text === "—") {
    return 0;
  }
  // Cells like "1 Beatriz Hernandez" or "2 (Hector Escamilla 486)"
  const leading = text.match(/^(-?\d+(?:\.\d+)?)/);
  if (leading) return Number(leading[1]);
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

/** Individual sheet: paralegal goal columns (skip NEW CASES / MEDICALS). */
const INDIVIDUAL_PARA_COLUMNS: Record<number, WeekPairMetricKey> = {
  5: "demand_sent",
  7: "lawsuit_filed",
  8: "discovery_responses",
  9: "lit_event_scheduled",
};

/** Individual sheet: attorney + closing columns. */
const INDIVIDUAL_ATTY_COLUMNS: Record<number, WeekPairMetricKey> = {
  10: "deposition",
  11: "mediation",
  12: "hearing",
  13: "disengagement",
  14: "settlement",
  15: "disbursement",
};

function isNaCell(value: unknown): boolean {
  const text = cellText(value).trim();
  return /^n\/?a$/i.test(text);
}

function classifySoloRole(
  token: string,
  contacts: Array<{ id: string; name: string; role?: string | null }>,
  row: ExcelJS.Row,
): "paralegal" | "attorney" {
  const t = token.trim().toUpperCase();
  const matched = contacts.find((c) => {
    const first = c.name.split(/\s+/)[0]?.toUpperCase() ?? "";
    const upper = c.name.toUpperCase();
    return first === t || upper === t || upper.startsWith(`${t} `);
  });
  const matchedRoles = [
    ...(((matched as { roles?: string[] | null } | undefined)?.roles ?? []) as string[]),
    matched?.role ?? "",
  ]
    .map((value) => String(value).toLowerCase())
    .filter(Boolean);
  if (matchedRoles.includes("attorney")) return "attorney";
  if (matchedRoles.includes("paralegal") || matchedRoles.includes("legal_assistant")) return "paralegal";

  // Fallback: which side has N/A in the sheet
  const paraAllNa = Object.keys(INDIVIDUAL_PARA_COLUMNS).every((col) =>
    isNaCell(row.getCell(Number(col)).value),
  );
  const attyAllNa = Object.keys(INDIVIDUAL_ATTY_COLUMNS).every((col) =>
    isNaCell(row.getCell(Number(col)).value),
  );
  if (paraAllNa && !attyAllNa) return "attorney";
  return "paralegal";
}

function readIndividualMetrics(
  row: ExcelJS.Row,
  mode: "paralegal" | "attorney" | "pair",
): Record<WeekPairMetricKey, number> {
  const metrics = emptyMetricBag();
  if (mode === "paralegal" || mode === "pair") {
    for (const [col, key] of Object.entries(INDIVIDUAL_PARA_COLUMNS)) {
      metrics[key] = num(row.getCell(Number(col)).value);
    }
  }
  if (mode === "attorney" || mode === "pair") {
    for (const [col, key] of Object.entries(INDIVIDUAL_ATTY_COLUMNS)) {
      metrics[key] = num(row.getCell(Number(col)).value);
    }
  }
  return metrics;
}

export function splitTeamLabel(label: string): { paralegalToken: string; attorneyToken: string } {
  const parts = label.split("+").map((p) => p.trim());
  return {
    paralegalToken: (parts[0] || "TBD").toUpperCase(),
    attorneyToken: (parts[1] || "TBD").toUpperCase(),
  };
}

/** Match spreadsheet first-name tokens to contacts (case-insensitive prefix / contains). */
export function matchContactId(
  token: string,
  contacts: Array<{ id: string; name: string; role?: string | null }>,
): string | null {
  const t = token.trim().toUpperCase();
  if (!t || t === "TBD") return null;

  const normalized = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    upper: c.name.toUpperCase(),
    first: c.name.split(/\s+/)[0]?.toUpperCase() ?? "",
  }));

  const exactFirst = normalized.filter((c) => c.first === t);
  if (exactFirst.length === 1) return exactFirst[0].id;
  if (exactFirst.length > 1) {
    // Prefer exact full-name start when ambiguous
    const full = exactFirst.find((c) => c.upper === t || c.upper.startsWith(`${t} `));
    return (full ?? exactFirst[0]).id;
  }

  const starts = normalized.filter((c) => c.upper.startsWith(t) || c.first.startsWith(t));
  if (starts.length === 1) return starts[0].id;

  const includes = normalized.filter((c) => c.upper.includes(t));
  if (includes.length === 1) return includes[0].id;

  return null;
}

export async function parseWeeklyCheckWorkbook(filePath: string): Promise<ParsedWeeklyCheckRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];

  const rows: ParsedWeeklyCheckRow[] = [];
  const seatByWeek = new Map<string, number>();

  for (let r = 2; r <= (sheet.rowCount || 0); r++) {
    const row = sheet.getRow(r);
    const weekLabel = cellText(row.getCell(1).value).trim();
    const teamLabel = cellText(row.getCell(3).value).trim();
    if (!weekLabel || !teamLabel) continue;

    const weekStart = meetingDateToWorkWeekStart(row.getCell(2).value);
    if (!weekStart) continue;

    const seatIndex = seatByWeek.get(weekStart) ?? 0;
    seatByWeek.set(weekStart, seatIndex + 1);

    const { paralegalToken, attorneyToken } = splitTeamLabel(teamLabel);
    const metrics: Partial<Record<WeekPairMetricKey, number>> = {};
    for (const [col, key] of Object.entries(COLUMN_TO_METRIC)) {
      const value = num(row.getCell(Number(col)).value);
      if (value !== 0) metrics[key] = value;
      else metrics[key] = 0;
    }

    rows.push({
      weekStart,
      weekLabel,
      seatIndex,
      teamLabel,
      paralegalToken,
      attorneyToken,
      metrics,
    });
  }

  return rows;
}

export function emptyMetricBag(): Record<WeekPairMetricKey, number> {
  return Object.fromEntries(WEEK_PAIR_METRIC_KEYS.map((k) => [k, 0])) as Record<
    WeekPairMetricKey,
    number
  >;
}

/**
 * Parse RJL GOALS "Individual" tab.
 * - Solo rows (pre–Week 7): one seat per person; para metrics → paralegal, attorney/closing → attorney.
 * - Pair rows (`PARA + ATTY`): one seat; para cols on paralegal side, attorney/closing on attorney side
 *   (stored together on the week_pair, which is how Team rolls up).
 * - N/A / TBD metric cells → 0.
 * Meeting Monday − 1 week (same convention as Book1 / existing Team imports).
 */
/**
 * Parse RJL GOALS "Team" tab — one official firm-total row per week.
 * Used for Team → Weekly history (not a sum of Individual seats).
 */
export async function parseGoalsTeamWorkbook(
  filePath: string,
  options?: { year?: number },
): Promise<ParsedFirmWeekTotals[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet =
    wb.getWorksheet("Team") ??
    wb.worksheets.find((s) => /^team$/i.test(s.name)) ??
    null;
  if (!sheet) return [];

  const year = options?.year;
  const rows: ParsedFirmWeekTotals[] = [];

  for (let r = 8; r <= (sheet.rowCount || 0); r++) {
    const row = sheet.getRow(r);
    const weekLabel = cellText(row.getCell(1).value).trim();
    if (!/^week\s*\d+/i.test(weekLabel)) continue;

    const endValue = row.getCell(2).value;
    const endDate = parseExcelDate(endValue);
    if (!endDate) continue;
    if (year != null && endDate.getUTCFullYear() !== year && endDate.getFullYear() !== year) {
      continue;
    }

    const weekStart = teamWeekEndToWorkWeekStart(endValue);
    if (!weekStart) continue;

    const metrics: Partial<Record<FirmWeeklyMetricKey, number>> = {
      disengagement: 0,
    };
    let sawValue = false;
    for (const [col, key] of Object.entries(TEAM_SHEET_COLUMN_TO_METRIC)) {
      const value = teamCellNumber(row.getCell(Number(col)).value);
      if (value == null) continue;
      metrics[key] = value;
      sawValue = true;
    }
    // Skip future / blank weeks (e.g. Week 46 with empty cells).
    if (!sawValue) continue;

    for (const metric of FIRM_WEEKLY_METRICS) {
      if (metrics[metric.key] == null) metrics[metric.key] = 0;
    }

    rows.push({
      weekStart,
      weekLabel,
      weekEndYmd: formatYmd(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, endDate.getUTCDate()),
      metrics,
    });
  }

  return rows;
}

export async function parseGoalsIndividualWorkbook(
  filePath: string,
  contacts: Array<{ id: string; name: string; role?: string | null }> = [],
  options?: { year?: number },
): Promise<ParsedWeeklyCheckRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet =
    wb.getWorksheet("Individual") ??
    wb.getWorksheet("Individuals") ??
    wb.worksheets.find((s) => /individ/i.test(s.name));
  if (!sheet) return [];

  const year = options?.year ?? 2026;
  const rows: ParsedWeeklyCheckRow[] = [];
  const seatByWeek = new Map<string, number>();

  for (let r = 4; r <= (sheet.rowCount || 0); r++) {
    const row = sheet.getRow(r);
    const weekLabel = cellText(row.getCell(1).value).trim();
    const teamLabel = cellText(row.getCell(3).value).trim();
    if (!weekLabel || !teamLabel) continue;

    const meeting = row.getCell(2).value;
    if (meeting instanceof Date) {
      if (meeting.getUTCFullYear() !== year && meeting.getFullYear() !== year) continue;
    } else {
      const text = cellText(meeting);
      if (!text.includes(String(year))) continue;
    }

    const weekStart = meetingDateToWorkWeekStart(meeting);
    if (!weekStart) continue;

    const seatIndex = seatByWeek.get(weekStart) ?? 0;
    seatByWeek.set(weekStart, seatIndex + 1);

    const isPair = teamLabel.includes("+");
    let paralegalToken: string;
    let attorneyToken: string;
    let metrics: Record<WeekPairMetricKey, number>;

    if (isPair) {
      ({ paralegalToken, attorneyToken } = splitTeamLabel(teamLabel));
      metrics = readIndividualMetrics(row, "pair");
    } else {
      const token = teamLabel.trim().toUpperCase();
      const role = classifySoloRole(token, contacts, row);
      if (role === "attorney") {
        paralegalToken = "TBD";
        attorneyToken = token;
        metrics = readIndividualMetrics(row, "attorney");
      } else {
        paralegalToken = token;
        attorneyToken = "TBD";
        metrics = readIndividualMetrics(row, "paralegal");
      }
    }

    rows.push({
      weekStart,
      weekLabel,
      seatIndex,
      teamLabel,
      paralegalToken,
      attorneyToken,
      metrics,
    });
  }

  return rows;
}
