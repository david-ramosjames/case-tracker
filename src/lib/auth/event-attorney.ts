import { buildViewerContext } from "@/lib/auth/access";
import { type SessionUser } from "@/lib/auth/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { type AppUser } from "@/lib/types";

/**
 * DocketFlow case ids where the viewer is an extra internal attendee on any case event
 * (e.g. the attorney covering a deposition on another attorney's case).
 * Only attorneys get event-based access; empty for every other role.
 */
export async function getEventAttorneyCaseIds(session: SessionUser, users: AppUser[]): Promise<Set<string>> {
  const viewer = buildViewerContext(session, users);
  if (!viewer.isAttorney || !viewer.contactId) return new Set();

  const admin = createSupabaseAdminClient();
  if (!admin) return new Set();

  const { data, error } = await admin
    .from("case_events")
    .select("case_id")
    .contains("extra_internal_contact_ids", [viewer.contactId]);
  if (error) {
    console.warn("Event attorney case lookup failed", { contactId: viewer.contactId, error: error.message });
    return new Set();
  }

  return new Set((data ?? []).map((row) => String(row.case_id)).filter(Boolean));
}
