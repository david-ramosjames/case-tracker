/**
 * One-off backfill of performance_week_pairs + metrics from Book1.xlsx.
 * Usage: node scripts/import-weekly-check.mjs [path-to-xlsx]
 */
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "").replace(/^'|'$/g, "");
    }
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const filePath = resolve(
  process.argv[2] || "C:/Users/david/Downloads/Book1.xlsx",
);

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
  // Use UTC date parts from the Excel datetime (already UTC midnight-ish)
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

function matchContactId(token, contacts) {
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

function isVacant(paraId, attId, paraLabel, attLabel) {
  const para = paraId || (paraLabel && paraLabel.toUpperCase() !== "TBD" ? paraLabel : null);
  const att = attId || (attLabel && attLabel.toUpperCase() !== "TBD" ? attLabel : null);
  return !para && !att;
}

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: contacts, error: contactError } = await client
  .from("contacts")
  .select("id,name,role");
if (contactError) throw contactError;

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
  const paralegalContactId = matchContactId(paralegalToken, contacts);
  const attorneyContactId = matchContactId(attorneyToken, contacts);
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

if (unmatched.size) {
  console.warn("Unmatched tokens:", [...unmatched].sort().join(", "));
}

const weekStarts = [...new Set(parsed.map((p) => p.weekStart))];
console.log(`Parsed ${parsed.length} seat-weeks across ${weekStarts.length} weeks from ${filePath}`);

// Clear existing imported weeks then reinsert
const { error: delErr } = await client
  .from("performance_week_pairs")
  .delete()
  .in("week_start", weekStarts);
if (delErr) throw delErr;

let insertedPairs = 0;
let insertedMetrics = 0;

for (const weekStart of weekStarts.sort()) {
  const seats = parsed.filter((p) => p.weekStart === weekStart);
  const rows = seats.map((seat) => ({
    week_start: seat.weekStart,
    seat_index: seat.seatIndex,
    paralegal_contact_id: seat.paralegalContactId,
    attorney_contact_id: seat.attorneyContactId,
    paralegal_label: seat.paralegalLabel,
    attorney_label: seat.attorneyLabel,
    is_vacant: isVacant(
      seat.paralegalContactId,
      seat.attorneyContactId,
      seat.paralegalLabel,
      seat.attorneyLabel,
    ),
    updated_at: new Date().toISOString(),
  }));
  const { data: inserted, error } = await client
    .from("performance_week_pairs")
    .insert(rows)
    .select("id,seat_index");
  if (error) throw error;
  insertedPairs += inserted.length;

  const bySeat = new Map(inserted.map((r) => [r.seat_index, r.id]));
  const metricRows = [];
  for (const seat of seats) {
    const weekPairId = bySeat.get(seat.seatIndex);
    if (!weekPairId) continue;
    for (const [metricKey, actualValue] of Object.entries(seat.metrics)) {
      metricRows.push({
        week_pair_id: weekPairId,
        metric_key: metricKey,
        actual_value: actualValue,
        source: "import",
        updated_at: new Date().toISOString(),
      });
    }
  }
  if (metricRows.length) {
    const { error: mErr } = await client.from("performance_week_pair_metrics").upsert(metricRows, {
      onConflict: "week_pair_id,metric_key",
    });
    if (mErr) throw mErr;
    insertedMetrics += metricRows.length;
  }
}

// Also seed effective-dated performance_pairs from the latest week (active roster)
const latest = weekStarts.sort().at(-1);
const latestSeats = parsed.filter((p) => p.weekStart === latest && !isVacant(
  p.paralegalContactId,
  p.attorneyContactId,
  p.paralegalLabel,
  p.attorneyLabel,
));
await client.from("performance_pairs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
if (latestSeats.length) {
  const { error: pErr } = await client.from("performance_pairs").insert(
    latestSeats.map((seat, i) => ({
      attorney_contact_id: seat.attorneyContactId,
      paralegal_contact_id: seat.paralegalContactId,
      attorney_label: seat.attorneyLabel,
      paralegal_label: seat.paralegalLabel,
      effective_from: latest,
      effective_to: null,
      sort_order: i,
      updated_at: new Date().toISOString(),
    })),
  );
  if (pErr) throw pErr;
}

console.log(`Inserted ${insertedPairs} week seats and ${insertedMetrics} metric cells.`);
console.log(`Seeded ${latestSeats.length} active Settings pairs from week ${latest}.`);
