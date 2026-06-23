export function getQuoAppBaseUrl() {
  const value = process.env.NEXT_PUBLIC_QUO_APP_URL?.trim();
  if (!value) return "https://my.quo.com";
  return value.replace(/\/$/, "");
}

export function getQuoContactUrl(quoContactId: string | null | undefined) {
  const id = quoContactId?.trim();
  if (!id) return null;
  return `${getQuoAppBaseUrl()}/contacts/${id}`;
}

export function getQuoConversationUrl(quoConversationId: string | null | undefined) {
  const id = quoConversationId?.trim();
  if (!id) return null;
  return `${getQuoAppBaseUrl()}/inbox/${id}`;
}

/** Open the Quo inbox thread — only when a conversation id is known. */
export function getQuoClientSmsUrl(input: { quoConversationId?: string | null }) {
  return getQuoConversationUrl(input.quoConversationId);
}
