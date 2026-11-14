import { readFileSync, writeFileSync } from "node:fs";

const sql = readFileSync("scripts/data/weekly-check-import.sql", "utf8");
const parts = sql.split(/insert into public.performance_week_pair_metrics/i);
const head = parts[0];
const rest = parts[1];
const metricMatch = rest.match(/values\s*([\s\S]*?)\s*on conflict/i);
const metricRows = metricMatch[1]
  .split(/,\n/)
  .map((s) => s.trim())
  .filter(Boolean);
const settings = rest.slice(rest.indexOf("delete from public.performance_pairs"));

writeFileSync("scripts/data/import-01-pairs.sql", `${head.trim()}\n`);
const chunkSize = 200;
let n = 0;
for (let i = 0; i < metricRows.length; i += chunkSize) {
  n += 1;
  const chunk = metricRows.slice(i, i + chunkSize);
  const q = `insert into public.performance_week_pair_metrics (week_pair_id, metric_key, actual_value, source)
values
${chunk.join(",\n")}
on conflict (week_pair_id, metric_key) do update
set actual_value = excluded.actual_value, source = excluded.source, updated_at = now();
`;
  writeFileSync(`scripts/data/import-02-metrics-${String(n).padStart(2, "0")}.sql`, q);
}
writeFileSync("scripts/data/import-03-settings-pairs.sql", `${settings.trim()}\n`);
console.log("pair sql chars", head.length, "metric chunks", n, "rows", metricRows.length);
