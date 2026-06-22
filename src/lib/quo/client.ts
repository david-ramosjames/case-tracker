import { getQuoApiKey, getQuoFromPhone } from "@/lib/quo/config";
import { normalizePhoneForComparison } from "@/lib/quo/phone";

const QUO_API_BASE = "https://api.quo.com/v1";

export type QuoContact = {
  id: string;
  displayName: string;
  primaryPhone: string | null;
};

type QuoContactRow = {
  id: string;
  defaultFields?: {
    firstName?: string | null;
    lastName?: string | null;
    company?: string | null;
    phoneNumbers?: Array<{ name?: string; value?: string | null }>;
  };
};

type QuoListContactsResponse = {
  data: QuoContactRow[];
  nextPageToken?: string | null;
};

type QuoSendMessageResponse = {
  id?: string;
  data?: { id?: string };
};

type QuoConversationRow = {
  id: string;
  participants?: string[];
};

type QuoListConversationsResponse = {
  data: QuoConversationRow[];
  nextPageToken?: string | null;
};

function quoHeaders() {
  return {
    Authorization: getQuoApiKey(),
    "Content-Type": "application/json",
  };
}

function buildDisplayName(row: QuoContactRow) {
  const first = row.defaultFields?.firstName?.trim() ?? "";
  const last = row.defaultFields?.lastName?.trim() ?? "";
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  return row.defaultFields?.company?.trim() ?? "";
}

function pickPrimaryPhone(row: QuoContactRow) {
  const phones = row.defaultFields?.phoneNumbers ?? [];
  const primary =
    phones.find((item) => item.name?.toLowerCase().includes("primary")) ??
    phones.find((item) => item.value?.trim()) ??
    phones[0];
  return primary?.value?.trim() ?? null;
}

export async function listAllQuoContacts(): Promise<QuoContact[]> {
  const contacts: QuoContact[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ maxResults: "50" });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetch(`${QUO_API_BASE}/contacts?${params.toString()}`, {
      headers: quoHeaders(),
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Quo list contacts failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as QuoListContactsResponse;
    for (const row of payload.data ?? []) {
      const displayName = buildDisplayName(row);
      if (!displayName) continue;
      contacts.push({
        id: row.id,
        displayName,
        primaryPhone: pickPrimaryPhone(row),
      });
    }

    pageToken = payload.nextPageToken?.trim() || undefined;
  } while (pageToken);

  return contacts;
}

export async function listQuoConversationsForLine(): Promise<QuoConversationRow[]> {
  const fromPhone = getQuoFromPhone();
  const conversations: QuoConversationRow[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ maxResults: "100", phoneNumbers: fromPhone });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetch(`${QUO_API_BASE}/conversations?${params.toString()}`, {
      headers: quoHeaders(),
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Quo list conversations failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as QuoListConversationsResponse;
    conversations.push(...(payload.data ?? []));
    pageToken = payload.nextPageToken?.trim() || undefined;
  } while (pageToken);

  return conversations;
}

/** Map client participant phone (E.164) to Quo conversation id on the firm line. */
export async function buildQuoConversationByParticipantPhone() {
  const fromPhone = normalizePhoneForComparison(getQuoFromPhone());
  const conversations = await listQuoConversationsForLine();
  const byPhone = new Map<string, string>();

  for (const conversation of conversations) {
    const conversationId = conversation.id?.trim();
    if (!conversationId) continue;

    for (const participant of conversation.participants ?? []) {
      const normalized = normalizePhoneForComparison(participant);
      if (!normalized || normalized === fromPhone) continue;
      if (!byPhone.has(normalized)) byPhone.set(normalized, conversationId);
    }
  }

  return byPhone;
}

export async function sendQuoTextMessage(input: { to: string; content: string }) {
  const response = await fetch(`${QUO_API_BASE}/messages`, {
    method: "POST",
    headers: quoHeaders(),
    body: JSON.stringify({
      content: input.content,
      from: getQuoFromPhone(),
      to: [input.to],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Quo send message failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as QuoSendMessageResponse;
  return payload.id ?? payload.data?.id ?? null;
}
