import { cleanCaseNumber } from "@/lib/csv/parse";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  reasonCodeLabel,
  type NeedsResponseChannel,
  type NeedsResponseReasonCode,
  type NeedsResponseRow,
  type NeedsResponseStatus,
} from "@/lib/needs-response/types";

type DbRow = {
  id: string;
  case_number: string;
  case_id: string | null;
  client_name: string;
  phone: string | null;
  channel: NeedsResponseChannel;
  reason: string;
  reason_code: NeedsResponseReasonCode;
  status: NeedsResponseStatus;
  detected_at: string;
  report_window_label: string | null;
  attorney_name: string | null;
  paralegal_name: string | null;
  quo_line: string | null;
  evidence_url: string | null;
  details: string | null;
  event_key: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

function requireAdmin() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required for needs-response.");
  return admin;
}

function mapRow(row: DbRow): NeedsResponseRow {
  return {
    id: row.id,
    caseNumber: row.case_number,
    caseId: row.case_id,
    clientName: row.client_name,
    phone: row.phone,
    channel: row.channel,
    reason: row.reason || reasonCodeLabel(row.reason_code),
    reasonCode: row.reason_code,
    status: row.status,
    detectedAt: row.detected_at,
    reportWindowLabel: row.report_window_label,
    attorneyName: row.attorney_name,
    paralegalName: row.paralegal_name,
    quoLine: row.quo_line,
    evidenceUrl: row.evidence_url,
    details: row.details,
    eventKey: row.event_key,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

export async function listOpenNeedsResponse(caseNumbers?: string[]) {
  const admin = requireAdmin();
  const keys = caseNumbers
    ? [...new Set(caseNumbers.map((value) => cleanCaseNumber(value)).filter(Boolean))]
    : null;

  const rows: NeedsResponseRow[] = [];
  if (keys && keys.length === 0) return rows;

  let from = 0;
  for (;;) {
    let query = admin
      .from("case_needs_response")
      .select(
        "id, case_number, case_id, client_name, phone, channel, reason, reason_code, status, detected_at, report_window_label, attorney_name, paralegal_name, quo_line, evidence_url, details, event_key, resolved_at, resolved_by",
      )
      .eq("status", "open")
      .order("detected_at", { ascending: true })
      .range(from, from + 999);
    if (keys) query = query.in("case_number", keys);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const page = (data ?? []) as DbRow[];
    for (const row of page) rows.push(mapRow(row));
    if (page.length < 1000) break;
    from += page.length;
  }
  return rows;
}

export async function countOpenNeedsResponse() {
  const admin = requireAdmin();
  const { count, error } = await admin
    .from("case_needs_response")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function resolveNeedsResponse(id: string, resolvedBy?: string | null) {
  const admin = requireAdmin();
  const { error } = await admin
    .from("case_needs_response")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "open");
  if (error) throw new Error(error.message);
}
