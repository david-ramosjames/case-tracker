/**
 * Backfill performance_week_pairs from RJL GOALS "Individual" tab.
 * Writes SQL to stdout (or --out path) for apply via Supabase.
 *
 * Usage:
 *   node scripts/import-goals-individual.mjs [xlsx] [--out path.sql] [--json path.json]
 */
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const contacts = [
  { id: "4ccbb794-936b-4af6-a257-debf7694bc9d", name: "Arielle Allen", role: "attorney" },
  { id: "8387bf99-0b0e-48d4-89c3-ecf03034bbd0", name: "Erin", role: "attorney" },
  { id: "52640070-5fb9-47cc-b0b7-ef5cb925269d", name: "Jesus Zuniga", role: "attorney" },
  { id: "8ef1e05f-f1e5-484a-a647-0b2bdb7805b6", name: "Kody Garza", role: "attorney" },
  { id: "b147feb6-a15e-4ed8-a484-af7d13081988", name: "Laura Ramos James", role: "attorney" },
  { id: "ac5c036c-d58e-495b-a5dd-b46e6e4ed9ac", name: "Matt", role: "attorney" },
  { id: "9bb43266-60f9-4070-b29f-ae07d946c8a8", name: "Mike", role: "attorney" },
  { id: "ca4a22fc-6f74-4b45-8089-843b114a70b3", name: "Ryan Toomey", role: "attorney" },
  { id: "27374a3e-44ae-4a9c-a401-26938d9e0392", name: "Travis Witherspoon", role: "attorney" },
  { id: "338e99a9-c9e7-4adc-8d5e-8856e9435f76", name: "Adrian", role: "paralegal" },
  { id: "17185579-67bf-41ff-83a8-41bdc98bd455", name: "Aivet Lopez", role: "paralegal" },
  { id: "6155429d-79df-429b-b570-c43f3cd6d62d", name: "Daya", role: "paralegal" },
  { id: "6740fc27-99ca-4c59-bac0-401ecf7d977d", name: "Dina Flores", role: "paralegal" },
  { id: "4f8add6c-0ebd-42a5-bab5-fb416c2cfce3", name: "Jorge", role: "paralegal" },
  { id: "cd52fe5b-0b1a-4daa-9e7e-fc88128b35c3", name: "Josslyn", role: "paralegal" },
  { id: "fbb5844d-1d51-4725-ae89-d359d664986e", name: "Lyliana", role: "paralegal" },
  { id: "e0d485fc-2186-4a2a-8886-2554667eac64", name: "Valeria Flores", role: "legal_assistant" },
];

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
];

const PARA_COLUMNS = {
  5: "demand_sent",
  7: "lawsuit_filed",
  8: "discovery_responses",
  9: "lit_event_scheduled",
};

const ATTY_COLUMNS = {
  10: "deposition",
  11: "mediation",
  12: "hearing",
  13: "disengagement",
  14: "settlement",
  15: "disbursement",
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

function toWorkWeekStart(value) {
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
  monday.setUTCDate(monday.getUTCDate() + offset - 7);
  const yy = monday.getUTCFullYear();
  const mm = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(monday.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function num(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "result" in value) return num(value.result);
  const text = cellText(value).trim();
  if (!text || /^n\/?a$/i.test(text) || /^tbd$/i.test(text) || text === "-" || text === "—") {
    return 0;
  }
  const leading = text.match(/^(-?\d+(?:\.\d+)?)/);
  if (leading) return Number(leading[1]);
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function isNaCell(value) {
  return /^n\/?a$/i.test(cellText(value).trim());
}

function matchContactId(token, preferRoles) {
  const t = token.trim().toUpperCase();
  if (!t || t === "TBD") return null;
  const normalized = contacts.map((c) => ({
    id: c.id,
    role: (c.role ?? "").toLowerCase(),
    upper: c.name.toUpperCase(),
    first: c.name.split(/\s+/)[0]?.toUpperCase() ?? "",
  }));
  let pool = normalized;
  if (preferRoles?.length) {
    const preferred = normalized.filter((c) => preferRoles.includes(c.role));
    if (preferred.length) pool = preferred;
  }
  const exactFirst = pool.filter((c) => c.first === t);
  if (exactFirst.length === 1) return exactFirst[0].id;
  if (exactFirst.length > 1) {
    const full = exactFirst.find((c) => c.upper === t || c.upper.startsWith(`${t} `));
    return (full ?? exactFirst[0]).id;
  }
  const starts = pool.filter((c) => c.upper.startsWith(t) || c.first.startsWith(t));
  if (starts.length === 1) return starts[0].id;
  const includes = pool.filter((c) => c.upper.includes(t));
  if (includes.length === 1) return includes[0].id;
  return null;
}

function classifySoloRole(token, row) {
  const t = token.trim().toUpperCase();
  const matched = contacts.find((c) => {
    const first = c.name.split(/\s+/)[0]?.toUpperCase() ?? "";
    const upper = c.name.toUpperCase();
    return first === t || upper === t || upper.startsWith(`${t} `);
  });
  const role = (matched?.role ?? "").toLowerCase();
  if (role === "attorney") return "attorney";
  if (role === "paralegal" || role === "legal_assistant") return "paralegal";
  const paraAllNa = Object.keys(PARA_COLUMNS).every((col) => isNaCell(row.getCell(Number(col)).value));
  const attyAllNa = Object.keys(ATTY_COLUMNS).every((col) => isNaCell(row.getCell(Number(col)).value));
  if (paraAllNa && !attyAllNa) return "attorney";
  return "paralegal";
}

function emptyMetrics() {
  return Object.fromEntries(METRIC_KEYS.map((k) => [k, 0]));
}

function readMetrics(row, mode) {
  const metrics = emptyMetrics();
  if (mode === "paralegal" || mode === "pair") {
    for (const [col, key] of Object.entries(PARA_COLUMNS)) {
      metrics[key] = num(row.getCell(Number(col)).value);
    }
  }
  if (mode === "attorney" || mode === "pair") {
    for (const [col, key] of Object.entries(ATTY_COLUMNS)) {
      metrics[key] = num(row.getCell(Number(col)).value);
    }
  }
  return metrics;
}

function sqlStr(v) {
  if (v == null) return "null";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function sqlUuid(v) {
  return v ? sqlStr(v) : "null";
}

function isVacant(paraId, attId, paraLabel, attLabel) {
  const para = paraId || (paraLabel && paraLabel.toUpperCase() !== "TBD" ? paraLabel : null);
  const att = attId || (attLabel && attLabel.toUpperCase() !== "TBD" ? attLabel : null);
  return !para && !att;
}

const args = process.argv.slice(2);
const filePath = resolve(
  args.find((a) => !a.startsWith("--")) || "C:/Users/david/Downloads/RJL 2026 GOALS (1).xlsx",
);
const outIdx = args.indexOf("--out");
const jsonIdx = args.indexOf("--json");
const outPath = outIdx >= 0 ? resolve(args[outIdx + 1]) : null;
const jsonPath = jsonIdx >= 0 ? resolve(args[jsonIdx + 1]) : null;

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(filePath);
const sheet = wb.getWorksheet("Individual");
if (!sheet) {
  console.error("No Individual sheet found");
  process.exit(1);
}

const seatByWeek = new Map();
const parsed = [];
const unmatched = new Set();

for (let r = 4; r <= (sheet.rowCount || 0); r++) {
  const row = sheet.getRow(r);
  const weekLabel = cellText(row.getCell(1).value).trim();
  const teamLabel = cellText(row.getCell(3).value).trim();
  if (!weekLabel || !teamLabel) continue;

  const meeting = row.getCell(2).value;
  if (meeting instanceof Date) {
    if (meeting.getUTCFullYear() !== 2026 && meeting.getFullYear() !== 2026) continue;
  } else if (!cellText(meeting).includes("2026")) {
    continue;
  }

  const weekStart = toWorkWeekStart(meeting);
  if (!weekStart) continue;

  const seatIndex = seatByWeek.get(weekStart) ?? 0;
  seatByWeek.set(weekStart, seatIndex + 1);

  let paralegalToken;
  let attorneyToken;
  let metrics;

  if (teamLabel.includes("+")) {
    const parts = teamLabel.split("+").map((p) => p.trim().toUpperCase());
    paralegalToken = parts[0] || "TBD";
    attorneyToken = parts[1] || "TBD";
    metrics = readMetrics(row, "pair");
  } else {
    const token = teamLabel.trim().toUpperCase();
    const role = classifySoloRole(token, row);
    if (role === "attorney") {
      paralegalToken = "TBD";
      attorneyToken = token;
      metrics = readMetrics(row, "attorney");
    } else {
      paralegalToken = token;
      attorneyToken = "TBD";
      metrics = readMetrics(row, "paralegal");
    }
  }

  const paralegalContactId = matchContactId(paralegalToken, ["paralegal", "legal_assistant"]);
  const attorneyContactId = matchContactId(attorneyToken, ["attorney"]);
  if (paralegalToken !== "TBD" && !paralegalContactId) unmatched.add(`paralegal:${paralegalToken}`);
  if (attorneyToken !== "TBD" && !attorneyContactId) unmatched.add(`attorney:${attorneyToken}`);

  parsed.push({
    weekStart,
    weekLabel,
    seatIndex,
    teamLabel,
    paralegalToken,
    attorneyToken,
    paralegalContactId,
    attorneyContactId,
    paralegalLabel: paralegalContactId ? null : paralegalToken,
    attorneyLabel: attorneyContactId ? null : attorneyToken,
    metrics,
  });
}

const weekStarts = [...new Set(parsed.map((p) => p.weekStart))].sort();
console.error(
  `Parsed ${parsed.length} seats across ${weekStarts.length} weeks (${weekStarts[0]} … ${weekStarts.at(-1)})`,
);
if (unmatched.size) {
  console.error("Unmatched:", [...unmatched].sort().join(", "));
}

// Verify Week 6 / Week 7 samples
const w6 = parsed.filter((p) => p.weekLabel.includes("Week 6"));
const w7 = parsed.filter((p) => p.weekLabel.includes("Week 7"));
console.error(
  "Week 6 sample:",
  w6.map((p) => `${p.teamLabel}→${p.paralegalToken}/${p.attorneyToken} d=${p.metrics.demand_sent} dep=${p.metrics.deposition}`).join(" | "),
);
console.error(
  "Week 7 sample:",
  w7.map((p) => `${p.teamLabel} d=${p.metrics.demand_sent} dep=${p.metrics.deposition} set=${p.metrics.settlement}`).join(" | "),
);

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify({ weekStarts, parsed }, null, 2));
  console.error(`Wrote JSON ${jsonPath}`);
}

const lines = [];
lines.push("-- Backfill from RJL 2026 GOALS Individual sheet");
lines.push(`-- Generated ${new Date().toISOString()}`);
lines.push("begin;");
lines.push(
  `delete from public.performance_week_pairs where week_start in (${weekStarts.map(sqlStr).join(", ")});`,
);

for (const weekStart of weekStarts) {
  const seats = parsed.filter((p) => p.weekStart === weekStart);
  lines.push(`-- ${weekStart} (${seats[0]?.weekLabel ?? ""})`);
  for (const seat of seats) {
    const vacant = isVacant(
      seat.paralegalContactId,
      seat.attorneyContactId,
      seat.paralegalLabel,
      seat.attorneyLabel,
    );
    lines.push(`with inserted as (
  insert into public.performance_week_pairs (
    week_start, seat_index, paralegal_contact_id, attorney_contact_id,
    paralegal_label, attorney_label, is_vacant, updated_at
  ) values (
    ${sqlStr(weekStart)}, ${seat.seatIndex},
    ${sqlUuid(seat.paralegalContactId)}, ${sqlUuid(seat.attorneyContactId)},
    ${sqlStr(seat.paralegalLabel)}, ${sqlStr(seat.attorneyLabel)},
    ${vacant}, now()
  ) returning id
)
insert into public.performance_week_pair_metrics (week_pair_id, metric_key, actual_value, source, updated_at)
select inserted.id, m.key, m.val, 'import', now()
from inserted
cross join (values
${METRIC_KEYS.map((k) => `  (${sqlStr(k)}, ${Number(seat.metrics[k]) || 0})`).join(",\n")}
) as m(key, val);`);
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
