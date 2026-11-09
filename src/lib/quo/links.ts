export function getQuoAppBaseUrl() {
  const value = process.env.NEXT_PUBLIC_QUO_APP_URL?.trim();
  if (!value) return "https://my.quo.com";
  return value.replace(/\/$/, "");
}

/** Fallback when tracker row has not been re-synced yet. */
export function getConfiguredQuoPhoneNumberId() {
  return process.env.NEXT_PUBLIC_QUO_PHONE_NUMBER_ID?.trim() || null;
}

export function getQuoContactUrl(quoContactId: string | null | undefined) {
  const id = quoContactId?.trim();
  if (!id) return null;
  return `${getQuoAppBaseUrl()}/contacts/${id}`;
}

/** Quo web inbox URL: /inbox/{PN…}/c/{CN…}. Requires both ids — never guess the firm line. */
export function getQuoConversationUrl(input: {
  quoConversationId?: string | null;
  quoPhoneNumberId?: string | null;
}) {
  const conversationId = input.quoConversationId?.trim();
  const phoneNumberId = input.quoPhoneNumberId?.trim();
  if (!conversationId || !phoneNumberId) return null;

  return `${getQuoAppBaseUrl()}/inbox/${phoneNumberId}/c/${conversationId}`;
}

/** Open the Quo inbox thread when both ids are known. */
export function getQuoClientSmsUrl(input: {
  quoConversationId?: string | null;
  quoPhoneNumberId?: string | null;
}) {
  return getQuoConversationUrl(input);
}
