"use client";

import { ExternalLink, Phone } from "lucide-react";
import { formatClientPhoneDisplay } from "@/lib/quo/phone";
import { getQuoClientSmsUrl, getQuoContactUrl } from "@/lib/quo/links";
import { type CaseQuoContact } from "@/lib/types";

type CaseQuoContactsListProps = {
  contacts: CaseQuoContact[];
  editable?: boolean;
  onSmsEnabledChange?: (contactId: string, smsEnabled: boolean) => void;
};

export function CaseQuoContactsList({ contacts, editable = false, onSmsEnabledChange }: CaseQuoContactsListProps) {
  if (contacts.length === 0) {
    return <span className="text-muted-foreground">Not set — sync from Quo on Client SMS settings</span>;
  }

  return (
    <ul className="space-y-2">
      {contacts.map((contact) => {
        const phoneDisplay = formatClientPhoneDisplay(contact.phone);
        const inboxUrl = getQuoClientSmsUrl({
          quoConversationId: contact.quoConversationId,
          quoPhoneNumberId: contact.quoPhoneNumberId,
        });
        const contactUrl = getQuoContactUrl(contact.quoContactId);

        return (
          <li key={contact.id} className="flex flex-wrap items-start gap-2 text-sm text-navy-950">
            {editable ? (
              <label className="inline-flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={contact.smsEnabled}
                  onChange={(event) => onSmsEnabledChange?.(contact.id, event.target.checked)}
                />
                <span>
                  <span className="font-medium">{contact.displayName}</span>
                  {phoneDisplay ? <span className="text-muted-foreground"> · {phoneDisplay}</span> : null}
                  <span className="mt-0.5 block text-xs text-muted-foreground">Send SMS automations to this contact</span>
                </span>
              </label>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {contact.smsEnabled ? (
                  <span className="text-xs font-medium text-emerald-700">SMS on</span>
                ) : (
                  <span className="text-xs font-medium text-muted-foreground">SMS off</span>
                )}
                <span className="font-medium">{contact.displayName}</span>
                {phoneDisplay ? (
                  inboxUrl ? (
                    <a
                      href={inboxUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-pink-600 hover:text-pink-500"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      {phoneDisplay}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-medium">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      {phoneDisplay}
                    </span>
                  )
                ) : (
                  <span className="text-muted-foreground">No phone</span>
                )}
                {contactUrl ? (
                  <a
                    href={contactUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-pink-600 hover:text-pink-500"
                  >
                    Quo contact
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
