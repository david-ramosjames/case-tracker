import { getDocketFlowCaseUrl } from "@/lib/docketflow/links";

/** Shared secret for Case Tracker → DocketFlow server callbacks. */
export function getDocketFlowInternalApiSecret() {
  return process.env.DOCKETFLOW_INTERNAL_API_SECRET?.trim() || process.env.CRON_SECRET?.trim() || "";
}

export function getDocketFlowApiBaseUrl() {
  return process.env.NEXT_PUBLIC_DOCKETFLOW_URL?.trim().replace(/\/$/, "") || null;
}

/**
 * Ask DocketFlow to reconcile Google Calendar invites after assignment changes.
 * Calendar invite ID maps live in DocketFlow — do not duplicate Google logic here.
 */
export async function requestDocketFlowCalendarReconcile(caseId: string) {
  const base = getDocketFlowApiBaseUrl();
  const secret = getDocketFlowInternalApiSecret();
  if (!base) {
    return { ok: false as const, skipped: true as const, reason: "missing_docketflow_url" as const };
  }
  if (!secret) {
    return { ok: false as const, skipped: true as const, reason: "missing_shared_secret" as const };
  }

  const url = `${base}/api/cases/${encodeURIComponent(caseId)}/reassign-calendar`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ source: "case-tracker" }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn("DocketFlow calendar reconcile failed", {
        caseId,
        status: response.status,
        body: text.slice(0, 500),
        caseUrl: getDocketFlowCaseUrl(caseId),
      });
      return { ok: false as const, skipped: false as const, reason: "http_error" as const, status: response.status };
    }

    return { ok: true as const, skipped: false as const };
  } catch (error) {
    console.warn("DocketFlow calendar reconcile request error", {
      caseId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false as const, skipped: false as const, reason: "network_error" as const };
  }
}
