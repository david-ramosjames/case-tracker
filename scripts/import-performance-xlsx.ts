/**
 * One-off historical import entrypoint for RJL 2026 GOALS.xlsx.
 * Usage (later): npx tsx scripts/import-performance-xlsx.ts path/to/file.xlsx
 *
 * Schema already supports imported commitments/snapshots; parsing is best-effort.
 */
import { parseGoalsWorkbook } from "../src/lib/performance/import-xlsx";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.log("Usage: npx tsx scripts/import-performance-xlsx.ts <path-to-xlsx>");
    console.log("Parser stub returns 0 rows until pair-sheet mapping is completed.");
    process.exit(0);
  }
  const rows = await parseGoalsWorkbook(filePath);
  console.log(`Parsed ${rows.length} row(s). Import into performance_* tables not yet wired.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
