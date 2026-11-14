import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve("scripts/data/weekly-check-import.sql"), "utf8");
const parts = sql
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter(Boolean);

const outDir = resolve("scripts/data/sql-chunks");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "01-delete-metrics.sql"), `${parts[0]};`);
writeFileSync(resolve(outDir, "02-delete-pairs.sql"), `${parts[1]};`);
writeFileSync(resolve(outDir, "03-insert-pairs.sql"), `${parts[2]};`);

const metricsSql = parts[3];
const valuesIdx = metricsSql.toLowerCase().indexOf("values");
const header = metricsSql.slice(0, valuesIdx + 6);
const valuesPart = metricsSql.slice(valuesIdx + 6).trim();
const onConflictIdx = valuesPart.toLowerCase().lastIndexOf("on conflict");
const rowsBlob = valuesPart.slice(0, onConflictIdx).trim().replace(/,\s*$/, "");
const conflict = valuesPart.slice(onConflictIdx).trim();

const rowList = [];
let depth = 0;
let start = -1;
for (let i = 0; i < rowsBlob.length; i += 1) {
  const ch = rowsBlob[i];
  if (ch === "(") {
    if (depth === 0) start = i;
    depth += 1;
  } else if (ch === ")") {
    depth -= 1;
    if (depth === 0 && start >= 0) {
      rowList.push(rowsBlob.slice(start, i + 1));
      start = -1;
    }
  }
}

const chunkSize = 200;
let n = 0;
for (let i = 0; i < rowList.length; i += chunkSize) {
  n += 1;
  const chunk = rowList.slice(i, i + chunkSize);
  const body = `${header}\n${chunk.join(",\n")}\n${conflict};`;
  writeFileSync(resolve(outDir, `04-metrics-${String(n).padStart(2, "0")}.sql`), body);
}

writeFileSync(resolve(outDir, "05-delete-settings-pairs.sql"), `${parts[4]};`);
writeFileSync(resolve(outDir, "06-insert-settings-pairs.sql"), `${parts[5]};`);

console.log("metric rows", rowList.length, "files", readdirSync(outDir));
