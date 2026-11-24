/**
 * Apply tmp-workplans JSON (from import-goals-workplans.mjs) via service role.
 * Usage: node scripts/apply-goals-workplans.mjs [path-to-json]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      if (!process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^"|"$/g, "").replace(/^'|'$/g, "");
      }
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

const jsonPath = resolve(process.argv[2] || "tmp-workplans-w46.json");
const payload = JSON.parse(readFileSync(jsonPath, "utf8"));
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const LAST_WEEK = payload.lastWeek;
const THIS_WEEK = payload.thisWeek;
const attorneyLines = payload.attorneyLines || [];
const deliverables = payload.deliverables || [];

async function caseIdFor(caseNumber) {
  if (!caseNumber) return null;
  const { data } = await client
    .from("cases")
    .select("id, case_number, updated_at")
    .eq("case_number", caseNumber)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (data?.[0]?.id) return data[0].id;
  // Digits-only fallback
  const { data: all } = await client.from("cases").select("id, case_number, updated_at").limit(5000);
  const digits = String(caseNumber).replace(/\D/g, "");
  const match = (all || [])
    .filter((c) => String(c.case_number || "").replace(/\D/g, "") === digits)
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))[0];
  return match?.id ?? null;
}

console.log(`Applying ${attorneyLines.length} attorney lines + ${deliverables.length} deliverables`);
console.log(`Weeks: last=${LAST_WEEK} this=${THIS_WEEK}`);

const attorneyIds = [...new Set(attorneyLines.map((l) => l.attorneyContactId))];
{
  const { error } = await client
    .from("performance_attorney_plan_lines")
    .delete()
    .in("week_start", [LAST_WEEK, THIS_WEEK])
    .in("attorney_contact_id", attorneyIds);
  if (error) throw error;
}

for (const line of attorneyLines) {
  const caseId = await caseIdFor(line.caseNumber);
  const { error } = await client.from("performance_attorney_plan_lines").insert({
    attorney_contact_id: line.attorneyContactId,
    week_start: line.weekStart,
    kind: line.kind,
    case_id: caseId,
    case_number: line.caseNumber,
    label: line.label,
    sort_order: line.sortOrder,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
console.log(`Attorney plan lines inserted: ${attorneyLines.length}`);

const paraIds = [...new Set(deliverables.map((d) => d.paralegalId))];
{
  // Delete prior goals-import rows for these assignees (commitments cascade / orphan OK)
  const { data: oldRows, error: listErr } = await client
    .from("performance_deliverables")
    .select("id, notes")
    .in("assignee_user_id", paraIds);
  if (listErr) throw listErr;
  const oldIds = (oldRows || [])
    .filter((r) => String(r.notes || "").includes("[goals-import]"))
    .map((r) => r.id);
  if (oldIds.length) {
    // Commitments first
    for (let i = 0; i < oldIds.length; i += 100) {
      const chunk = oldIds.slice(i, i + 100);
      const { error: cErr } = await client.from("performance_commitments").delete().in("deliverable_id", chunk);
      if (cErr) throw cErr;
      const { error: dErr } = await client.from("performance_deliverables").delete().in("id", chunk);
      if (dErr) throw dErr;
    }
    console.log(`Deleted prior goals-import deliverables: ${oldIds.length}`);
  }
}

// Cache case lookups
const caseCache = new Map();
async function cachedCaseId(caseNumber) {
  if (caseCache.has(caseNumber)) return caseCache.get(caseNumber);
  const id = await caseIdFor(caseNumber);
  caseCache.set(caseNumber, id);
  return id;
}

let inserted = 0;
for (const d of deliverables) {
  const notes = d.notes ? `${d.notes} [goals-import]` : "[goals-import]";
  const completedAt = d.completedAt ? `${d.completedAt}T12:00:00-06:00` : null;
  const caseId = await cachedCaseId(d.caseNumber);
  const { data, error } = await client
    .from("performance_deliverables")
    .insert({
      case_id: caseId,
      case_number: d.caseNumber,
      client_name_snapshot: d.clientName,
      deliverable_type: d.deliverableType,
      identity_key: d.identityKey,
      identity_label: d.identityLabel,
      attorney_user_id: d.attorneyUserId,
      assignee_user_id: d.paralegalId,
      workflow_status: d.workflowStatus,
      requested_completion_date: d.plannedDate,
      planned_date: d.plannedDate,
      completed_at: completedAt,
      completion_source: d.workflowStatus === "done" ? "manual" : null,
      hearing_type: d.hearingType,
      document_label: d.documentLabel,
      notes,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  inserted++;
  if (d.weekStart && d.commitmentOutcome && data?.id) {
    const { error: cErr } = await client.from("performance_commitments").insert({
      deliverable_id: data.id,
      week_start: d.weekStart,
      planned_date: d.plannedDate,
      outcome: d.commitmentOutcome,
    });
    if (cErr) throw cErr;
  }
}

console.log(`Deliverables inserted: ${inserted}`);
console.log("Done.");
