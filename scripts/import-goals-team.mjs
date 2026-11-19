/**
 * Backfill performance_firm_week_metrics from RJL GOALS "Team" tab.
 * Firm Weekly history should match this sheet — not a sum of Individual seats.
 *
 * Usage:
 *   node scripts/import-goals-team.mjs [xlsx] [--out path.sql] [--json path.json]
 */
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const METRIC_KEYS = [
  "demand_sent",
  "lawsuit_filed",
  "discovery_responses",
  "lit_event_scheduled",
  "deposition",
  "mediation",
  "hearing",
  "disengagement",
  "settlement",
  "disbursement",
  "new_case",
];

const COLUMN_TO_METRIC = {
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

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result);
    if ("text" in value) return cellText(value.text);
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text ?? "").join("");
    if (value instanceof Date) return value.toISOString();
  }
  return String(value);
}

function toWorkWeekStartFromEnd(value) {
  let d;
  if (value instanceof Date) d = value;
  else d = new Date(cellText(value));
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const asUtc = Date.UTC(y, m, day);
  const dow = new Date(asUtc).getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(asUtc);
  monday.setUTCDate(monday.getUTCDate() + offset);
  const yy = monday.getUTCFullYear();
  const mm = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(monday.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function teamNum(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "result" in value) return teamNum(value.result);
  const text = cellText(value).trim();
  if (!text || text === "-" || text === "—" || /^n\/?a$/i.test(text)) return null;
  const leading = text.match(/^(-?\d+(?:\.\d+)?)/);
  if (leading) return Number(leading[1]);
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function sqlStr(v) {
  if (v == null) return "null";
  return `'${String(v).replace(/'/g, "''")}'`;
}

const args = process.argv.slice(2);
const filePath = resolve(
  args.find((a) => !a.startsWith("--")) || "C:/Users/david/Downloads/RJL 2026 GOALS (2).xlsx",
);
const outIdx = args.indexOf("--out");
const jsonIdx = args.indexOf("--json");
const yearIdx = args.indexOf("--year");
const outPath = outIdx >= 0 ? resolve(args[outIdx + 1]) : null;
const jsonPath = jsonIdx >= 0 ? resolve(args[jsonIdx + 1]) : null;
const year = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2026;

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(filePath);
const sheet = wb.getWorksheet("Team");
if (!sheet) {
  console.error("No Team sheet found");
  process.exit(1);
}

const parsed = [];
for (let r = 8; r <= (sheet.rowCount || 0); r++) {
  const row = sheet.getRow(r);
  const weekLabel = cellText(row.getCell(1).value).trim();
  if (!/^week\s*\d+/i.test(weekLabel)) continue;
  const endValue = row.getCell(2).value;
  const endDate = endValue instanceof Date ? endValue : new Date(cellText(endValue));
  if (Number.isNaN(endDate.getTime())) continue;
  if (endDate.getUTCFullYear() !== year && endDate.getFullYear() !== year) continue;

  const weekStart = toWorkWeekStartFromEnd(endValue);
  if (!weekStart) continue;

  const metrics = { disengagement: 0 };
  let sawValue = false;
  for (const [col, key] of Object.entries(COLUMN_TO_METRIC)) {
    const value = teamNum(row.getCell(Number(col)).value);
    if (value == null) continue;
    metrics[key] = value;
    sawValue = true;
  }
  if (!sawValue) continue;
  for (const key of METRIC_KEYS) {
    if (metrics[key] == null) metrics[key] = 0;
  }
  parsed.push({ weekStart, weekLabel, metrics });
}

console.error(`Parsed ${parsed.length} Team weeks for ${year}`);
const sample = parsed.find((p) => /week\s*45/i.test(p.weekLabel));
if (sample) {
  console.error(
    `Week 45 (${sample.weekStart}): DS=${sample.metrics.demand_sent} lawsuit=${sample.metrics.lawsuit_filed} lit=${sample.metrics.lit_event_scheduled} new=${sample.metrics.new_case}`,
  );
}

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify(parsed, null, 2));
  console.error(`Wrote JSON ${jsonPath}`);
}

const weekStarts = [...new Set(parsed.map((p) => p.weekStart))].sort();
const lines = [];
lines.push("-- Firm weekly totals from RJL GOALS Team sheet");
lines.push(`-- Generated ${new Date().toISOString()}`);
lines.push("begin;");
if (weekStarts.length) {
  lines.push(
    `delete from public.performance_firm_week_metrics where week_start in (${weekStarts.map(sqlStr).join(", ")});`,
  );
}
for (const row of parsed) {
  lines.push(`-- ${row.weekLabel} → ${row.weekStart}`);
  for (const key of METRIC_KEYS) {
    lines.push(
      `insert into public.performance_firm_week_metrics (week_start, metric_key, actual_value, source, updated_at)
values (${sqlStr(row.weekStart)}, ${sqlStr(key)}, ${Number(row.metrics[key]) || 0}, 'import', now())
on conflict (week_start, metric_key) do update
set actual_value = excluded.actual_value, source = excluded.source, updated_at = now();`,
    );
  }
}
lines.push("commit;");

const sql = `${lines.join("\n")}\n`;
if (outPath) {
  writeFileSync(outPath, sql);
  console.error(`Wrote SQL ${outPath} (${sql.length} bytes)`);
} else {
  process.stdout.write(sql);
}
