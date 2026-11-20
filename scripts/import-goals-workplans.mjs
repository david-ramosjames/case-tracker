/**
 * Backfill attorney plan lines + paralegal deliverables from RJL GOALS (3).xlsx
 *
 * Attorneys sheet → performance_attorney_plan_lines (weeks 2026-11-09 and 2026-11-16)
 * Paralegal pair tabs → performance_deliverables (+ commitments)
 *   Last Week              → done (week 11/09)
 *   To Be Completed This Week → committed (week 11/16), or done if struck / Completed This Week
 *   In Progress            → backlog
 *
 * Usage:
 *   node scripts/import-goals-workplans.mjs [xlsx] [--json out.json] [--sql out.sql]
 */
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const LAST_WEEK = "2026-11-09";
const THIS_WEEK = "2026-11-16";

const ATTORNEY_COLS = [
  { col: 2, name: "Erin", id: "8387bf99-0b0e-48d4-89c3-ecf03034bbd0" },
  { col: 3, name: "Mike", id: "9bb43266-60f9-4070-b29f-ae07d946c8a8" },
  { col: 4, name: "Jesus", id: "52640070-5fb9-47cc-b0b7-ef5cb925269d" },
  // col 5 = TBD (Travis) — skip empty
  { col: 6, name: "Ryan", id: "ca4a22fc-6f74-4b45-8089-843b114a70b3" },
];

const ATTORNEY_BY_TOKEN = {
  ERIN: "8387bf99-0b0e-48d4-89c3-ecf03034bbd0",
  MIKE: "9bb43266-60f9-4070-b29f-ae07d946c8a8",
  JESUS: "52640070-5fb9-47cc-b0b7-ef5cb925269d",
  RYAN: "ca4a22fc-6f74-4b45-8089-843b114a70b3",
  TRAVIS: "27374a3e-44ae-4a9c-a401-26938d9e0392",
  LRJ: "b147feb6-a15e-4ed8-a484-af7d13081988",
  LAURA: "b147feb6-a15e-4ed8-a484-af7d13081988",
  MATT: "ac5c036c-d58e-495b-a5dd-b46e6e4ed9ac",
  KODY: "8ef1e05f-f1e5-484a-a647-0b2bdb7805b6",
  ARIELLE: "4ccbb794-936b-4af6-a257-debf7694bc9d",
};

const PARA_SHEETS = [
  {
    sheet: "Adrian (Jesus)",
    paralegalId: "338e99a9-c9e7-4adc-8d5e-8856e9435f76",
    defaultAttorneyId: "52640070-5fb9-47cc-b0b7-ef5cb925269d",
  },
  {
    sheet: "Aivet (Ryan)",
    paralegalId: "17185579-67bf-41ff-83a8-41bdc98bd455",
    defaultAttorneyId: "ca4a22fc-6f74-4b45-8089-843b114a70b3",
  },
  {
    sheet: "Jorge (Erin)",
    paralegalId: "4f8add6c-0ebd-42a5-bab5-fb416c2cfce3",
    defaultAttorneyId: "8387bf99-0b0e-48d4-89c3-ecf03034bbd0",
  },
  {
    sheet: "Daya (Mike)",
    paralegalId: "6155429d-79df-429b-b570-c43f3cd6d62d",
    defaultAttorneyId: "9bb43266-60f9-4070-b29f-ae07d946c8a8",
  },
  {
    sheet: "Lyliana (LRJ)",
    paralegalId: "fbb5844d-1d51-4725-ae89-d359d664986e",
    defaultAttorneyId: "b147feb6-a15e-4ed8-a484-af7d13081988",
  },
];

const DELIVERABLE_LABEL_TO_TYPE = {
  "demand sent": "demand_sent",
  demand: "demand_sent",
  "lawsuit filed": "lawsuit_filed",
  lawsuit: "lawsuit_filed",
  "discovery responses": "discovery_responses",
  discovery: "discovery_responses",
  "litigation event": "lit_event_scheduled",
  "lit event": "lit_event_scheduled",
  aso: "aso",
};

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text ?? "").join("");
    if ("text" in value) return String(value.text ?? "");
    if ("result" in value) return cellText(value.result);
    if ("formula" in value) return cellText(value.result ?? "");
  }
  return String(value);
}

function cellStruck(cell) {
  if (cell.font?.strike) return true;
  const v = cell.value;
  if (v && typeof v === "object" && Array.isArray(v.richText)) {
    const parts = v.richText.filter((t) => (t.text || "").trim());
    if (parts.length && parts.every((t) => t.font?.strike)) return true;
  }
  return false;
}

function ymdFromCell(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "object" && value && "result" in value) return ymdFromCell(value.result);
  const text = cellText(value).trim();
  if (!text) return null;
  const iso = text.match(/^(20\d{2})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (mdy) {
    const mm = mdy[1].padStart(2, "0");
    const dd = mdy[2].padStart(2, "0");
    let yy = mdy[3];
    if (yy.length === 2) yy = `20${yy}`;
    return `${yy}-${mm}-${dd}`;
  }
  const d = new Date(text);
  if (!Number.isNaN(d.getTime())) return ymdFromCell(d);
  return null;
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function sqlStr(v) {
  if (v == null) return "null";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function sqlUuid(v) {
  return v ? sqlStr(v) : "null";
}

function parseCaseCell(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{3,5})\s*(?:[-–—:]\s*(.*))?$/);
  if (!m) {
    const loose = raw.match(/(\d{3,5})/);
    if (!loose) return null;
    return { caseNumber: loose[1], label: raw.replace(loose[1], "").replace(/^[\s\-–—:]+/, "").trim() };
  }
  return { caseNumber: m[1], label: (m[2] || "").trim() };
}

function mapDeliverableType(label) {
  const key = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return DELIVERABLE_LABEL_TO_TYPE[key] ?? null;
}

function litFieldsFromNotes(notes) {
  const n = String(notes || "").trim();
  const lower = n.toLowerCase();
  let hearingType = "event";
  if (/\btrial\b/.test(lower)) hearingType = "trial";
  else if (/\bmediat/.test(lower)) hearingType = "mediation";
  else if (/\bhearing\b|\bmtq\b|\bmtn\b|\bmotion\b/.test(lower)) hearingType = "hearing";
  else if (/\bdepo\b|\bdeposition\b|\bcorp\s*rep\b/.test(lower)) hearingType = "deposition";
  else if (/\baso\b/.test(lower)) hearingType = "aso";

  // Short party/subtype only — never the full follow-up notes (emails/deadlines).
  let documentLabel = null;
  if (/\bcorp\s*rep\b/.test(lower)) documentLabel = "Corp Rep";
  else if (/\bexpert\b/.test(lower)) documentLabel = "Expert";
  else if (/\bplaintiff\b|\bp['’]?s\b\s*depo|\bp\s*depo/.test(lower)) documentLabel = "Plaintiff";
  else if (/\bdefendant\b|\bd['’]?s\b\s*depo|\bd\s*depo|\bd\s*expert/.test(lower)) {
    documentLabel = "Defendant";
  } else {
    const short = n.split(/\s[-–—]\s*(?:sent|deadline|email|follow)/i)[0].trim();
    documentLabel = (short || hearingType).slice(0, 40);
  }
  return { hearingType, documentLabel };
}

function identityFor(type, notes, label) {
  const detail = (notes || label || type || "item").trim();
  if (type === "lit_event_scheduled") {
    const { hearingType, documentLabel } = litFieldsFromNotes(detail);
    return {
      identityKey: `lit:${slug(hearingType)}:${slug(documentLabel)}:${slug(detail).slice(0, 48)}`,
      identityLabel: `${hearingType}${documentLabel ? ` · ${documentLabel}` : ""}`,
      hearingType,
      documentLabel,
    };
  }
  return {
    identityKey: `import:${slug(detail)}`,
    identityLabel: type,
    hearingType: null,
    // Keep structured subtype empty; freeform text belongs in notes only.
    documentLabel: null,
  };
}

function parseAttorneySheet(sheet) {
  const lines = [];
  const sections = [
    { weekStart: THIS_WEEK, headerRow: 1, ranges: [
      { kind: "lit_event", start: 4, end: 7 },
      { kind: "lawsuit", start: 14, end: 18 },
      { kind: "settlement", start: 21, end: 25 },
    ]},
    { weekStart: LAST_WEEK, headerRow: 27, ranges: [
      { kind: "lit_event", start: 30, end: 33 },
      { kind: "lawsuit", start: 40, end: 44 },
      { kind: "settlement", start: 47, end: 51 },
    ]},
  ];

  for (const section of sections) {
    const sortByKind = { lit_event: 0, lawsuit: 0, settlement: 0 };
    for (const range of section.ranges) {
      for (let r = range.start; r <= range.end; r++) {
        const row = sheet.getRow(r);
        for (const atty of ATTORNEY_COLS) {
          const text = cellText(row.getCell(atty.col).value).trim();
          if (!text) continue;
          const parsed = parseCaseCell(text);
          if (!parsed?.caseNumber) continue;
          lines.push({
            attorneyContactId: atty.id,
            attorneyName: atty.name,
            weekStart: section.weekStart,
            kind: range.kind,
            caseNumber: parsed.caseNumber,
            label: parsed.label || parsed.caseNumber,
            sortOrder: sortByKind[range.kind]++,
            sourceText: text,
            struck: cellStruck(row.getCell(atty.col)),
          });
        }
      }
    }
  }
  return lines;
}

function parseParalegalSheet(sheet, meta) {
  const rows = [];
  let section = null;
  const SECTION_RE = /^(Last Week|To Be Completed This Week|In Progress|Completed This Week)/i;

  for (let r = 1; r <= (sheet.rowCount || 0); r++) {
    const row = sheet.getRow(r);
    const a = cellText(row.getCell(1).value).trim();
    const deliverableLabel = cellText(row.getCell(3).value).trim();
    const caseRaw = cellText(row.getCell(4).value).trim();

    if (SECTION_RE.test(a)) {
      section = a.match(SECTION_RE)[1];
      continue;
    }
    if (!section) continue;
    if (/^Paralegal$/i.test(a)) continue;
    if (!caseRaw || !deliverableLabel) continue;
    if (/^(Deliverable|Case)/i.test(deliverableLabel)) continue;

    const type = mapDeliverableType(deliverableLabel);
    if (!type) continue;

    const caseNumber = (caseRaw.match(/\d{3,5}/) || [])[0];
    if (!caseNumber) continue;

    const client = cellText(row.getCell(5).value).trim();
    const dateYmd = ymdFromCell(row.getCell(6).value);
    const notes = cellText(row.getCell(7).value).trim();
    const attorneyToken = cellText(row.getCell(2).value).trim().toUpperCase().split(/\s+/)[0];
    const attorneyUserId = ATTORNEY_BY_TOKEN[attorneyToken] || meta.defaultAttorneyId;

    const struck =
      cellStruck(row.getCell(3)) ||
      cellStruck(row.getCell(4)) ||
      cellStruck(row.getCell(5)) ||
      cellStruck(row.getCell(7));

    const sectionKey = section.toLowerCase();
    let workflowStatus = "backlog";
    let weekStart = THIS_WEEK;
    let completedAt = null;
    let plannedDate = dateYmd;
    let commitmentOutcome = null;

    if (sectionKey === "last week") {
      workflowStatus = "done";
      weekStart = LAST_WEEK;
      completedAt = dateYmd || LAST_WEEK;
      plannedDate = dateYmd || LAST_WEEK;
      commitmentOutcome = "completed";
    } else if (sectionKey.startsWith("to be completed") || sectionKey.startsWith("completed this week")) {
      weekStart = THIS_WEEK;
      if (struck || sectionKey.startsWith("completed")) {
        workflowStatus = "done";
        completedAt = dateYmd || THIS_WEEK;
        plannedDate = dateYmd || THIS_WEEK;
        commitmentOutcome = "completed";
      } else {
        // Sheet "To Be Completed This Week" feeds Committed for this week.
        workflowStatus = "committed";
        plannedDate = dateYmd || THIS_WEEK;
        commitmentOutcome = "promised";
      }
    } else {
      // In Progress → backlog for future weeks
      workflowStatus = "backlog";
      weekStart = null;
      plannedDate = dateYmd;
      commitmentOutcome = null;
    }

    const idParts = identityFor(type, notes, client);
    // Keep identities unique across repeated case/type rows in the sheet.
    idParts.identityKey = `${idParts.identityKey}:r${r}`;
    rows.push({
      sheetRow: r,
      section,
      paralegalId: meta.paralegalId,
      attorneyUserId,
      caseNumber,
      clientName: client || null,
      deliverableType: type,
      notes: notes || null,
      struck,
      workflowStatus,
      weekStart,
      completedAt,
      plannedDate,
      commitmentOutcome,
      ...idParts,
    });
  }
  return rows;
}

const args = process.argv.slice(2);
const filePath = resolve(
  args.find((a) => !a.startsWith("--")) || "C:/Users/david/Downloads/RJL 2026 GOALS (3).xlsx",
);
const jsonIdx = args.indexOf("--json");
const sqlIdx = args.indexOf("--sql");
const jsonPath = jsonIdx >= 0 ? resolve(args[jsonIdx + 1]) : null;
const sqlPath = sqlIdx >= 0 ? resolve(args[sqlIdx + 1]) : null;

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(filePath);

const attorneySheet = wb.getWorksheet("Attorneys");
if (!attorneySheet) {
  console.error("No Attorneys sheet");
  process.exit(1);
}
const attorneyLines = parseAttorneySheet(attorneySheet);

const deliverables = [];
for (const meta of PARA_SHEETS) {
  const sheet = wb.getWorksheet(meta.sheet);
  if (!sheet) {
    console.error("Missing sheet", meta.sheet);
    continue;
  }
  deliverables.push(...parseParalegalSheet(sheet, meta));
}

const payload = {
  generatedAt: new Date().toISOString(),
  filePath,
  lastWeek: LAST_WEEK,
  thisWeek: THIS_WEEK,
  attorneyLines,
  deliverables,
};

console.error(
  `Attorneys: ${attorneyLines.length} plan lines | Paralegals: ${deliverables.length} deliverables`,
);
console.error(
  `  attorney weeks: ${[...new Set(attorneyLines.map((l) => l.weekStart))].join(", ")}`,
);
const byStatus = {};
for (const d of deliverables) byStatus[d.workflowStatus] = (byStatus[d.workflowStatus] || 0) + 1;
console.error(`  deliverable status: ${JSON.stringify(byStatus)}`);

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  console.error(`Wrote JSON ${jsonPath}`);
}

if (sqlPath) {
  const lines = [];
  lines.push("-- Backfill attorney plans + paralegal work from RJL 2026 GOALS (3)");
  lines.push(`-- Generated ${payload.generatedAt}`);
  lines.push("begin;");

  const attorneyIds = [...new Set(attorneyLines.map((l) => l.attorneyContactId))];
  lines.push(
    `delete from public.performance_attorney_plan_lines
 where week_start in (${sqlStr(LAST_WEEK)}, ${sqlStr(THIS_WEEK)})
   and attorney_contact_id in (${attorneyIds.map(sqlStr).join(", ")});`,
  );

  for (const line of attorneyLines) {
    lines.push(`insert into public.performance_attorney_plan_lines (
  attorney_contact_id, week_start, kind, case_id, case_number, label, sort_order, updated_at
) values (
  ${sqlStr(line.attorneyContactId)}, ${sqlStr(line.weekStart)}, ${sqlStr(line.kind)},
  (select id from public.cases where case_number = ${sqlStr(line.caseNumber)} order by updated_at desc nulls last limit 1),
  ${sqlStr(line.caseNumber)}, ${sqlStr(line.label)}, ${line.sortOrder}, now()
);`);
  }

  // Wipe prior import-tagged deliverables for these assignees (safe re-run).
  const paraIds = [...new Set(deliverables.map((d) => d.paralegalId))];
  lines.push(`
delete from public.performance_deliverables
 where assignee_user_id in (${paraIds.map(sqlStr).join(", ")})
   and coalesce(notes, '') like '%[goals-import]%';`);

  for (const d of deliverables) {
    const notes = d.notes ? `${d.notes} [goals-import]` : "[goals-import]";
    // Noon CT keeps the calendar day stable when cast/sliced in UTC.
    const completedTs = d.completedAt ? `${d.completedAt}T12:00:00-06:00` : null;
    const wantsCommitment = Boolean(d.weekStart && d.commitmentOutcome);
    lines.push(`
with inserted as (
  insert into public.performance_deliverables (
    case_id, case_number, client_name_snapshot, deliverable_type,
    identity_key, identity_label, attorney_user_id, assignee_user_id,
    workflow_status, requested_completion_date, planned_date, completed_at,
    completion_source, hearing_type, document_label, notes, updated_at
  ) values (
    (select id from public.cases where regexp_replace(case_number, '[^0-9]', '', 'g') = ${sqlStr(d.caseNumber)}
      order by updated_at desc nulls last limit 1),
    ${sqlStr(d.caseNumber)}, ${sqlStr(d.clientName)}, ${sqlStr(d.deliverableType)},
    ${sqlStr(d.identityKey)}, ${sqlStr(d.identityLabel)},
    ${sqlUuid(d.attorneyUserId)}, ${sqlUuid(d.paralegalId)},
    ${sqlStr(d.workflowStatus)}, ${sqlStr(d.plannedDate)}, ${sqlStr(d.plannedDate)},
    ${completedTs ? sqlStr(completedTs) : "null"},
    ${d.workflowStatus === "done" ? sqlStr("manual") : "null"},
    ${sqlStr(d.hearingType)}, ${sqlStr(d.documentLabel)}, ${sqlStr(notes)}, now()
  ) returning id
)
insert into public.performance_commitments (deliverable_id, week_start, planned_date, outcome)
select inserted.id, ${sqlStr(d.weekStart)}, ${sqlStr(d.plannedDate)}, ${sqlStr(d.commitmentOutcome)}
from inserted
where ${wantsCommitment ? "true" : "false"};`);
  }

  lines.push("commit;");
  writeFileSync(sqlPath, lines.join("\n"));
  console.error(`Wrote SQL ${sqlPath}`);
}

if (!jsonPath && !sqlPath) {
  writeFileSync(resolve("tmp-workplans.json"), JSON.stringify(payload, null, 2));
  console.error("Wrote tmp-workplans.json");
}
