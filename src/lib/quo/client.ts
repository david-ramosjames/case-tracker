import { getQuoApiKey, getQuoFromPhone } from "@/lib/quo/config";
import { quoApiFetch } from "@/lib/quo/http";
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


type QuoPhoneNumberRow = {
  id: string;
  number?: string | null;
};

type QuoListPhoneNumbersResponse = {
  data: QuoPhoneNumberRow[];
};

type QuoMessageRow = {
  conversationId?: string | null;
};

type QuoListMessagesResponse = {
  data: QuoMessageRow[];
};

let cachedQuoPhoneNumberId: string | null = null;

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

    const response = await quoApiFetch(`${QUO_API_BASE}/contacts?${params.toString()}`, {
      headers: quoHeaders(),
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

export async function resolveQuoPhoneNumberId() {
  const configured = getQuoFromPhone().trim();
  if (/^PN/i.test(configured)) return configured;
  if (cachedQuoPhoneNumberId) return cachedQuoPhoneNumberId;

  const response = await quoApiFetch(`${QUO_API_BASE}/phone-numbers`, {
    headers: quoHeaders(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Quo list phone numbers failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as QuoListPhoneNumbersResponse;
  const target = normalizePhoneForComparison(configured);
  const match = (payload.data ?? []).find((row) => normalizePhoneForComparison(row.number ?? "") === target);
  if (!match?.id?.trim()) {
    throw new Error(`Quo phone number not found for QUO_FROM_PHONE (${configured}).`);
  }

  cachedQuoPhoneNumberId = match.id.trim();
  return cachedQuoPhoneNumberId;
}

/** Resolve inbox conversation id for one client phone via the messages API. */
export async function lookupQuoConversationIdForClientPhone(clientPhone: string) {
  const participant = normalizePhoneForComparison(clientPhone);
  if (!participant) return null;

  const phoneNumberId = await resolveQuoPhoneNumberId();
  const params = new URLSearchParams({
    phoneNumberId,
    maxResults: "1",
  });
  params.append("participants", participant);

  const response = await quoApiFetch(`${QUO_API_BASE}/messages?${params.toString()}`, {
    headers: quoHeaders(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Quo list messages failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as QuoListMessagesResponse;
  return payload.data?.[0]?.conversationId?.trim() || null;
}

/** Look up inbox conversation ids for specific client phones (one API call per phone). */
export async function buildQuoConversationByParticipantPhones(phones: string[]) {
  const byPhone = new Map<string, string>();
  const unique = [...new Set(phones.map((phone) => normalizePhoneForComparison(phone)).filter(Boolean))];

  for (const phone of unique) {
    try {
      const conversationId = await lookupQuoConversationIdForClientPhone(phone);
      if (conversationId) byPhone.set(phone, conversationId);
    } catch (error) {
      console.warn(`Quo conversation lookup failed for ${phone}`, error);
    }
  }

  return byPhone;
}

export async function sendQuoTextMessage(input: { to: string; content: string }) {
  const response = await quoApiFetch(`${QUO_API_BASE}/messages`, {
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
