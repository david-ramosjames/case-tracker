import ExcelJS from "exceljs";
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
  const n = Number(cellText(value));
  return Number.isFinite(n) ? n : 0;
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
