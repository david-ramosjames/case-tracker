import { cleanCaseNumber } from "@/lib/csv/parse";
import { normalizePhoneForComparison } from "@/lib/quo/phone";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ContactCase = { caseId: string | null; caseNumber: string };

export type CaseContactMaps = {
  byPhone: Map<string, ContactCase[]>;
  byQuoContactId: Map<string, ContactCase[]>;
};

/** Quo directory contacts (name ends with case #) and tracker client phones → cases. */
export async function loadCaseContactMaps(): Promise<CaseContactMaps> {
  const byPhone = new Map<string, ContactCase[]>();
  const byQuoContactId = new Map<string, ContactCase[]>();
  const admin = createSupabaseAdminClient();
  if (!admin) return { byPhone, byQuoContactId };

  const { data: entries, error: entryError } = await admin
    .from("case_tracker_entries")
    .select("id, case_id, case_number, client_phone");
  if (entryError) throw new Error(entryError.message);

  const trackerById = new Map<string, ContactCase>();
  for (const row of (entries ?? []) as Array<{
    id: string;
    case_id: string | null;
    case_number: string | null;
    client_phone: string | null;
  }>) {
    const caseNumber = cleanCaseNumber(row.case_number ?? "");
    if (!caseNumber) continue;
    const contactCase = { caseId: row.case_id, caseNumber };
    trackerById.set(row.id, contactCase);
    addCase(byPhone, normalizePhoneForComparison(row.client_phone ?? ""), contactCase);
  }

  const { data: contacts, error: contactError } = await admin
    .from("case_quo_contacts")
    .select("tracker_entry_id, phone, quo_contact_id");
  if (contactError) throw new Error(contactError.message);
  for (const row of (contacts ?? []) as Array<{
    tracker_entry_id: string;
    phone: string | null;
    quo_contact_id: string | null;
  }>) {
    const contactCase = trackerById.get(row.tracker_entry_id);
    if (!contactCase) continue;
    addCase(byPhone, normalizePhoneForComparison(row.phone ?? ""), contactCase);
    const quoId = row.quo_contact_id?.trim();
    if (quoId) addCase(byQuoContactId, quoId, contactCase);
  }

  return { byPhone, byQuoContactId };
}

/** @deprecated Prefer loadCaseContactMaps — kept for older call sites. */
export async function loadCasesByClientPhone() {
  return (await loadCaseContactMaps()).byPhone;
}

function addCase(map: Map<string, ContactCase[]>, key: string, contactCase: ContactCase) {
  if (!key) return;
  const list = map.get(key) ?? [];
  if (!list.some((item) => item.caseNumber === contactCase.caseNumber)) list.push(contactCase);
  map.set(key, list);
}
