import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const jsonPath = resolve(process.argv[2] || "tmp-firm-week-metrics.json");
const outPath = resolve(process.argv[3] || "tmp-firm-week-metrics-compact.sql");
const rows = JSON.parse(readFileSync(jsonPath, "utf8"));
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

const values = [];
for (const row of rows) {
  for (const key of keys) {
    values.push(`('${row.weekStart}','${key}',${Number(row.metrics[key]) || 0},'import')`);
  }
}

const sql = `begin;
delete from public.performance_firm_week_metrics where week_start >= '2026-01-01' and week_start < '2027-01-01';
insert into public.performance_firm_week_metrics (week_start, metric_key, actual_value, source)
values
${values.join(",\n")}
on conflict (week_start, metric_key) do update
set actual_value = excluded.actual_value, source = excluded.source, updated_at = now();
commit;
`;

writeFileSync(outPath, sql);
console.log(`Wrote ${outPath} (${rows.length} weeks, ${values.length} metrics)`);
