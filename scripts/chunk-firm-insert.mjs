import { readFileSync, writeFileSync } from "node:fs";

const rows = JSON.parse(readFileSync("tmp-firm-week-metrics.json", "utf8"));
const keys = [
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
const chunkSize = 12;
let part = 0;
for (let i = 0; i < rows.length; i += chunkSize) {
  const chunk = rows.slice(i, i + chunkSize);
  const values = [];
  for (const row of chunk) {
    for (const key of keys) {
      values.push(`('${row.weekStart}','${key}',${Number(row.metrics[key]) || 0},'import')`);
    }
  }
  const sql = `insert into public.performance_firm_week_metrics (week_start, metric_key, actual_value, source)
values
${values.join(",\n")}
on conflict (week_start, metric_key) do update
set actual_value = excluded.actual_value, source = excluded.source, updated_at = now();`;
  const path = `tmp-firm-chunk-${part}.sql`;
  writeFileSync(path, sql);
  console.log(path, chunk.length, "weeks");
  part += 1;
}
