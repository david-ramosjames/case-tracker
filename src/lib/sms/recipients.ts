import { type CaseRecord } from "@/lib/types";

export type SmsRecipient = {
  phone: string;
  quoContactId: string | null;
  displayName: string | null;
};

export function getSmsRecipients(record: CaseRecord): SmsRecipient[] {
  const fromContacts = (record.tracker.quoContacts ?? [])
    .filter((contact) => contact.smsEnabled && contact.phone?.trim())
    .map((contact) => ({
      phone: contact.phone!.trim(),
      quoContactId: contact.quoContactId,
      displayName: contact.displayName,
    }));

  if (fromContacts.length > 0) return fromContacts;

  const legacyPhone = record.tracker.clientPhone?.trim();
  if (!legacyPhone) return [];

  return [
    {
      phone: legacyPhone,
      quoContactId: record.tracker.quoContactId,
      displayName: record.shared.clientName,
    },
  ];
}
