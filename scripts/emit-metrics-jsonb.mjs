import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function uuidFrom(key) {
  const h = createHash("sha256").update(key).digest();
  const bytes = Buffer.from(h.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const { parsed } = JSON.parse(readFileSync(resolve("scripts/data/weekly-check-import.json"), "utf8"));
const rows = [];
for (const seat of parsed) {
  const id = uuidFrom(`${seat.weekStart}:${seat.seatIndex}`);
  for (const [metricKey, actualValue] of Object.entries(seat.metrics)) {
    rows.push({
      week_pair_id: id,
      metric_key: metricKey,
      actual_value: actualValue,
      source: "import",
    });
  }
}

const chunkSize = 120;
for (let i = 0, n = 0; i < rows.length; i += chunkSize) {
  n += 1;
  const chunk = rows.slice(i, i + chunkSize);
  const sql = `insert into public.performance_week_pair_metrics
  (week_pair_id, metric_key, actual_value, source)
select week_pair_id, metric_key, actual_value, source
from jsonb_to_recordset('${JSON.stringify(chunk).replace(/'/g, "''")}'::jsonb)
  as x(week_pair_id uuid, metric_key text, actual_value numeric, source text)
on conflict (week_pair_id, metric_key) do update
set actual_value = excluded.actual_value, source = excluded.source, updated_at = now();`;
  writeFileSync(resolve(`scripts/data/sql-chunks/jsonb-metrics-${String(n).padStart(2, "0")}.sql`), sql);
  console.log(`chunk ${n}`, chunk.length, "bytes", sql.length);
}
