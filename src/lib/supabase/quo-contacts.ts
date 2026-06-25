import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { type CaseQuoContact } from "@/lib/types";

type QuoContactRow = {
  id: string;
  tracker_entry_id: string;
  quo_contact_id: string;
  display_name: string;
  phone: string | null;
  quo_conversation_id: string | null;
  quo_phone_number_id: string | null;
  sms_enabled: boolean;
  created_at: string;
  updated_at: string;
};

function rowToContact(row: QuoContactRow): CaseQuoContact {
  return {
    id: row.id,
    quoContactId: row.quo_contact_id,
    displayName: row.display_name,
    phone: row.phone,
    quoConversationId: row.quo_conversation_id,
    quoPhoneNumberId: row.quo_phone_number_id,
    smsEnabled: row.sms_enabled,
  };
}

function requireAdmin() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required for Quo contacts.");
  return admin;
}

export async function listQuoContactsByTrackerIds(trackerEntryIds: string[]): Promise<Map<string, CaseQuoContact[]>> {
  const grouped = new Map<string, CaseQuoContact[]>();
  if (trackerEntryIds.length === 0) return grouped;

  const admin = requireAdmin();
  const { data, error } = await admin
    .from("case_quo_contacts")
    .select("*")
    .in("tracker_entry_id", trackerEntryIds)
    .order("display_name", { ascending: true });

  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as QuoContactRow[]) {
    const bucket = grouped.get(row.tracker_entry_id) ?? [];
    bucket.push(rowToContact(row));
    grouped.set(row.tracker_entry_id, bucket);
  }

  return grouped;
}

export type QuoContactSyncInput = {
  quoContactId: string;
  displayName: string;
  phone: string | null;
  quoConversationId: string | null;
  quoPhoneNumberId: string | null;
};

export async function syncTrackerQuoContacts(
  trackerEntryId: string,
  contacts: QuoContactSyncInput[],
): Promise<CaseQuoContact[]> {
  const admin = requireAdmin();
  const now = new Date().toISOString();

  const { data: existingRows, error: existingError } = await admin
    .from("case_quo_contacts")
    .select("*")
    .eq("tracker_entry_id", trackerEntryId);

  if (existingError) throw new Error(existingError.message);

  const existingByQuoId = new Map(
    ((existingRows ?? []) as QuoContactRow[]).map((row) => [row.quo_contact_id, row]),
  );
  const nextQuoIds = new Set(contacts.map((contact) => contact.quoContactId));

  for (const contact of contacts) {
    const existing = existingByQuoId.get(contact.quoContactId);
    const payload = {
      tracker_entry_id: trackerEntryId,
      quo_contact_id: contact.quoContactId,
      display_name: contact.displayName,
      phone: contact.phone,
      quo_conversation_id: contact.quoConversationId,
      quo_phone_number_id: contact.quoPhoneNumberId,
      sms_enabled: existing?.sms_enabled ?? true,
      updated_at: now,
    };

    if (existing) {
      const { error } = await admin.from("case_quo_contacts").update(payload).eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from("case_quo_contacts").insert(payload);
      if (error) throw new Error(error.message);
    }
  }

  for (const existing of (existingRows ?? []) as QuoContactRow[]) {
    if (!nextQuoIds.has(existing.quo_contact_id)) {
      const { error } = await admin.from("case_quo_contacts").delete().eq("id", existing.id);
      if (error) throw new Error(error.message);
    }
  }

  const { data: refreshed, error: refreshError } = await admin
    .from("case_quo_contacts")
    .select("*")
    .eq("tracker_entry_id", trackerEntryId)
    .order("display_name", { ascending: true });

  if (refreshError) throw new Error(refreshError.message);
  return ((refreshed ?? []) as QuoContactRow[]).map(rowToContact);
}

export async function updateQuoContactSmsPreferences(
  trackerEntryId: string,
  preferences: Array<{ id: string; smsEnabled: boolean }>,
): Promise<CaseQuoContact[]> {
  const admin = requireAdmin();
  const now = new Date().toISOString();

  for (const preference of preferences) {
    const { error } = await admin
      .from("case_quo_contacts")
      .update({ sms_enabled: preference.smsEnabled, updated_at: now })
      .eq("id", preference.id)
      .eq("tracker_entry_id", trackerEntryId);

    if (error) throw new Error(error.message);
  }

  const { data, error } = await admin
    .from("case_quo_contacts")
    .select("*")
    .eq("tracker_entry_id", trackerEntryId)
    .order("display_name", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data ?? []) as QuoContactRow[]).map(rowToContact);
}
