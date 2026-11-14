import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const contacts = [
  { id: "4ccbb794-936b-4af6-a257-debf7694bc9d", name: "Arielle Allen" },
  { id: "8387bf99-0b0e-48d4-89c3-ecf03034bbd0", name: "Erin" },
  { id: "52640070-5fb9-47cc-b0b7-ef5cb925269d", name: "Jesus Zuniga" },
  { id: "8ef1e05f-f1e5-484a-a647-0b2bdb7805b6", name: "Kody Garza" },
  { id: "ac5c036c-d58e-495b-a5dd-b46e6e4ed9ac", name: "Matt" },
  { id: "9bb43266-60f9-4070-b29f-ae07d946c8a8", name: "Mike" },
  { id: "ca4a22fc-6f74-4b45-8089-843b114a70b3", name: "Ryan Toomey" },
  { id: "27374a3e-44ae-4a9c-a401-26938d9e0392", name: "Travis Witherspoon" },
  { id: "338e99a9-c9e7-4adc-8d5e-8856e9435f76", name: "Adrian" },
  { id: "17185579-67bf-41ff-83a8-41bdc98bd455", name: "Aivet Lopez" },
  { id: "6740fc27-99ca-4c59-bac0-401ecf7d977d", name: "Dina Flores" },
  { id: "4f8add6c-0ebd-42a5-bab5-fb416c2cfce3", name: "Jorge" },
  { id: "cd52fe5b-0b1a-4daa-9e7e-fc88128b35c3", name: "Josslyn" },
  { id: "e0d485fc-2186-4a2a-8886-2554667eac64", name: "Valeria Flores" },
];

const COLUMN_TO_METRIC = {
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

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if ("result" in value) return cellText(value.result);
    if ("text" in value) return cellText(value.text);
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text ?? "").join("");
    if (value instanceof Date) return value.toISOString();
  }
  return String(value);
}

function toYmdMonday(value) {
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

function num(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "result" in value) return num(value.result);
  const n = Number(cellText(value));
  return Number.isFinite(n) ? n : 0;
}

function matchContactId(token) {
  const t = token.trim().toUpperCase();
  if (!t || t === "TBD") return null;
  const normalized = contacts.map((c) => ({
    id: c.id,
    upper: c.name.toUpperCase(),
    first: c.name.split(/\s+/)[0]?.toUpperCase() ?? "",
  }));
  const exactFirst = normalized.filter((c) => c.first === t);
  if (exactFirst.length === 1) return exactFirst[0].id;
  if (exactFirst.length > 1) {
    const full = exactFirst.find((c) => c.upper === t || c.upper.startsWith(`${t} `));
    return (full ?? exactFirst[0]).id;
  }
  const starts = normalized.filter((c) => c.upper.startsWith(t) || c.first.startsWith(t));
  if (starts.length === 1) return starts[0].id;
  const includes = normalized.filter((c) => c.upper.includes(t));
  if (includes.length === 1) return includes[0].id;
  return null;
}

function sqlStr(v) {
  if (v == null) return "null";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function isVacant(paraId, attId, paraLabel, attLabel) {
  const para = paraId || (paraLabel && paraLabel.toUpperCase() !== "TBD" ? paraLabel : null);
  const att = attId || (attLabel && attLabel.toUpperCase() !== "TBD" ? attLabel : null);
  return !para && !att;
}

const filePath = resolve(process.argv[2] || "C:/Users/david/Downloads/Book1.xlsx");
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(filePath);
const sheet = wb.worksheets[0];
const seatByWeek = new Map();
const parsed = [];
const unmatched = new Set();

for (let r = 2; r <= (sheet.rowCount || 0); r++) {
  const row = sheet.getRow(r);
  const weekLabel = cellText(row.getCell(1).value).trim();
  const teamLabel = cellText(row.getCell(3).value).trim();
  if (!weekLabel || !teamLabel) continue;
  const weekStart = toYmdMonday(row.getCell(2).value);
  if (!weekStart) continue;
  const seatIndex = seatByWeek.get(weekStart) ?? 0;
  seatByWeek.set(weekStart, seatIndex + 1);
  const [paraTok, attTok] = teamLabel.split("+").map((p) => p.trim().toUpperCase());
  const paralegalToken = paraTok || "TBD";
  const attorneyToken = attTok || "TBD";
  const paralegalContactId = matchContactId(paralegalToken);
  const attorneyContactId = matchContactId(attorneyToken);
  if (paralegalToken !== "TBD" && !paralegalContactId) unmatched.add(`paralegal:${paralegalToken}`);
  if (attorneyToken !== "TBD" && !attorneyContactId) unmatched.add(`attorney:${attorneyToken}`);
  const metrics = {};
  for (const [col, key] of Object.entries(COLUMN_TO_METRIC)) {
    metrics[key] = num(row.getCell(Number(col)).value);
  }
  parsed.push({
    weekStart,
    seatIndex,
    paralegalContactId,
    attorneyContactId,
    paralegalLabel: paralegalContactId ? null : paralegalToken,
    attorneyLabel: attorneyContactId ? null : attorneyToken,
    metrics,
  });
}

const outPath = resolve("scripts/data/weekly-check-import.json");
writeFileSync(outPath, JSON.stringify({ parsed, unmatched: [...unmatched] }, null, 2));
console.log("Wrote", outPath, "rows", parsed.length, "unmatched", [...unmatched]);

// Also emit SQL for MCP apply in one go using deterministic UUIDs from week+seat
import { createHash } from "node:crypto";
function uuidFrom(key) {
  const h = createHash("sha256").update(key).digest();
  const bytes = Buffer.from(h.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const weekStarts = [...new Set(parsed.map((p) => p.weekStart))].sort();
const pairValues = [];
const metricValues = [];
for (const seat of parsed) {
  const id = uuidFrom(`${seat.weekStart}:${seat.seatIndex}`);
  const vacant = isVacant(
    seat.paralegalContactId,
    seat.attorneyContactId,
    seat.paralegalLabel,
    seat.attorneyLabel,
  );
  pairValues.push(
    `(${sqlStr(id)}, ${sqlStr(seat.weekStart)}, ${seat.seatIndex}, ${sqlStr(seat.paralegalContactId)}, ${sqlStr(seat.attorneyContactId)}, ${sqlStr(seat.paralegalLabel)}, ${sqlStr(seat.attorneyLabel)}, ${vacant})`,
  );
  for (const [metricKey, actualValue] of Object.entries(seat.metrics)) {
    metricValues.push(
      `(${sqlStr(id)}, ${sqlStr(metricKey)}, ${actualValue}, 'import')`,
    );
  }
}

const latest = weekStarts.at(-1);
const latestSeats = parsed.filter(
  (p) =>
    p.weekStart === latest &&
    !isVacant(p.paralegalContactId, p.attorneyContactId, p.paralegalLabel, p.attorneyLabel),
);

const sql = `
delete from public.performance_week_pair_metrics
where week_pair_id in (
  select id from public.performance_week_pairs
  where week_start between ${sqlStr(weekStarts[0])} and ${sqlStr(weekStarts.at(-1))}
);
delete from public.performance_week_pairs
where week_start between ${sqlStr(weekStarts[0])} and ${sqlStr(weekStarts.at(-1))};

insert into public.performance_week_pairs
  (id, week_start, seat_index, paralegal_contact_id, attorney_contact_id, paralegal_label, attorney_label, is_vacant)
values
${pairValues.join(",\n")};

insert into public.performance_week_pair_metrics
  (week_pair_id, metric_key, actual_value, source)
values
${metricValues.join(",\n")}
on conflict (week_pair_id, metric_key) do update
set actual_value = excluded.actual_value, source = excluded.source, updated_at = now();

delete from public.performance_pairs;
insert into public.performance_pairs
  (attorney_contact_id, paralegal_contact_id, attorney_label, paralegal_label, effective_from, sort_order)
values
${latestSeats
  .map(
    (seat, i) =>
      `(${sqlStr(seat.attorneyContactId)}, ${sqlStr(seat.paralegalContactId)}, ${sqlStr(seat.attorneyLabel)}, ${sqlStr(seat.paralegalLabel)}, ${sqlStr(latest)}, ${i})`,
  )
  .join(",\n")};
`;

writeFileSync(resolve("scripts/data/weekly-check-import.sql"), sql);
console.log("Wrote SQL with", pairValues.length, "pairs and", metricValues.length, "metrics");
