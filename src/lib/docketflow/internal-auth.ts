import { getDocketFlowInternalApiSecret } from "@/lib/docketflow/calendar-reconcile";

/** Authorize DocketFlow → Case Tracker server callbacks (shared secret). */
export function authorizeDocketFlowInternalRequest(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  const secret = getDocketFlowInternalApiSecret();
  if (!secret) {
    return { ok: false, status: 500, error: "DOCKETFLOW_INTERNAL_API_SECRET is not configured." };
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (auth !== `Bearer ${secret}`) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}
