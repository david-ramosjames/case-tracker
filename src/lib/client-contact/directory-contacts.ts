import { addContactCase, type CaseContactMaps, type ContactCase } from "@/lib/client-contact/case-phones";
import { caseNumbersInQuoContactName } from "@/lib/quo/contact-sync";
import { listAllQuoContacts } from "@/lib/quo/client";
import { normalizePhoneForComparison } from "@/lib/quo/phone";

/** Attach every Quo directory contact whose name contains an open case number. */
export async function mergeQuoDirectoryContacts(maps: CaseContactMaps, cases: ContactCase[]) {
  if (!process.env.QUO_API_KEY?.trim() || cases.length === 0) return 0;

  const byNumber = new Map(cases.map((item) => [item.caseNumber, item]));
  const caseNumbers = new Set(byNumber.keys());
  const contacts = await listAllQuoContacts();
  let added = 0;
  for (const contact of contacts) {
    const matched = caseNumbersInQuoContactName(contact.displayName, caseNumbers);
    for (const caseNumber of matched) {
      const contactCase = byNumber.get(caseNumber);
      if (!contactCase) continue;
      const before = maps.byQuoContactId.get(contact.id)?.length ?? 0;
      addContactCase(maps.byQuoContactId, contact.id, contactCase);
      addContactCase(maps.byPhone, normalizePhoneForComparison(contact.primaryPhone ?? ""), contactCase);
      if ((maps.byQuoContactId.get(contact.id)?.length ?? 0) > before) added += 1;
    }
  }
  return added;
}
