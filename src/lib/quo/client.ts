import { getQuoApiKey, getQuoFromPhone } from "@/lib/quo/config";
import { contactNamesSimilar, normalizeContactLabel } from "@/lib/quo/contact-sync";
import { quoApiFetch } from "@/lib/quo/http";
import { normalizePhoneForComparison } from "@/lib/quo/phone";

const QUO_API_BASE = "https://api.quo.com/v1";

export type QuoContact = {
  id: string;
  displayName: string;
  primaryPhone: string | null;
  updatedAt: string | null;
};

export type QuoContactRaw = QuoContact & {
  firstName: string;
  lastName: string;
};

type QuoContactRow = {
  id: string;
  updatedAt?: string | null;
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
  phoneNumberId?: string | null;
  createdAt?: string | null;
};

type QuoListMessagesResponse = {
  data: QuoMessageRow[];
};

type QuoConversationRow = {
  id: string;
  name?: string | null;
  participants?: string[];
  phoneNumberId?: string | null;
  lastActivityAt?: string | null;
};

type QuoListConversationsResponse = {
  data: QuoConversationRow[];
  nextPageToken?: string | null;
};

export type QuoInboxMatch = {
  phone: string;
  conversationId: string;
  phoneNumberId: string;
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
        updatedAt: row.updatedAt?.trim() || null,
      });
    }

    pageToken = payload.nextPageToken?.trim() || undefined;
  } while (pageToken);

  return contacts;
}

export async function listAllQuoContactsRaw(): Promise<QuoContactRaw[]> {
  const contacts: QuoContactRaw[] = [];
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
        firstName: row.defaultFields?.firstName?.trim() ?? "",
        lastName: row.defaultFields?.lastName?.trim() ?? "",
        primaryPhone: pickPrimaryPhone(row),
        updatedAt: row.updatedAt?.trim() || null,
      });
    }

    pageToken = payload.nextPageToken?.trim() || undefined;
  } while (pageToken);

  return contacts;
}

export async function updateQuoContactName(contactId: string, firstName: string, lastName: string) {
  const response = await quoApiFetch(`${QUO_API_BASE}/contacts/${contactId}`, {
    method: "PATCH",
    headers: quoHeaders(),
    body: JSON.stringify({
      defaultFields: { firstName, lastName },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Quo update contact failed (${response.status}): ${body}`);
  }

  return (await response.json()) as QuoContactRow;
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

function pickClientParticipant(participants: string[] | undefined, firmLine: string) {
  for (const participant of participants ?? []) {
    const normalized = normalizePhoneForComparison(participant);
    if (normalized && normalized !== firmLine) return normalized;
  }
  return null;
}

async function listRecentQuoConversations(maxPages = 5) {
  const fromPhone = getQuoFromPhone();
  const conversations: QuoConversationRow[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const params = new URLSearchParams({ maxResults: "100", phoneNumbers: fromPhone });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await quoApiFetch(`${QUO_API_BASE}/conversations?${params.toString()}`, {
      headers: quoHeaders(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Quo list conversations failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as QuoListConversationsResponse;
    conversations.push(...(payload.data ?? []));
    pageToken = payload.nextPageToken?.trim() || undefined;
    pages += 1;
  } while (pageToken && pages < maxPages);

  return conversations;
}

/** For Quo contacts without a profile phone, match recent inbox threads by contact label. */
export async function lookupQuoInboxByContactDisplayName(displayName: string): Promise<QuoInboxMatch | null> {
  const target = normalizeContactLabel(displayName);
  if (!target) return null;

  const firmLine = normalizePhoneForComparison(getQuoFromPhone());
  const defaultPhoneNumberId = await resolveQuoPhoneNumberId();
  const conversations = await listRecentQuoConversations();

  for (const conversation of conversations) {
    const conversationId = conversation.id?.trim();
    if (!conversationId) continue;

    const participant = pickClientParticipant(conversation.participants, firmLine);
    if (!participant) continue;

    const conversationLabel = normalizeContactLabel(conversation.name ?? "");
    if (conversationLabel && (conversationLabel === target || contactNamesSimilar(displayName, conversation.name ?? ""))) {
      return {
        phone: participant,
        conversationId,
        phoneNumberId: conversation.phoneNumberId?.trim() || defaultPhoneNumberId,
      };
    }
  }

  return null;
}

/** Resolve inbox thread for one client phone via the messages API (most recent activity). */
export async function lookupQuoInboxForClientPhone(clientPhone: string): Promise<QuoInboxMatch | null> {
  const participant = normalizePhoneForComparison(clientPhone);
  if (!participant) return null;

  const phoneNumberId = await resolveQuoPhoneNumberId();
  const params = new URLSearchParams({
    phoneNumberId,
    maxResults: "25",
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
  const messages = [...(payload.data ?? [])].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt ?? "") || 0;
    const rightTime = Date.parse(right.createdAt ?? "") || 0;
    return rightTime - leftTime;
  });

  const message = messages[0];
  const conversationId = message?.conversationId?.trim();
  if (!conversationId) return null;

  return {
    phone: participant,
    conversationId,
    phoneNumberId: message.phoneNumberId?.trim() || phoneNumberId,
  };
}

/** Resolve inbox thread for a matched Quo contact (phone profile, messages API, then inbox name scan). */
export async function lookupQuoInboxForContact(input: {
  displayName: string;
  phone?: string | null;
}) {
  const normalizedPhone = input.phone ? normalizePhoneForComparison(input.phone) : "";

  if (normalizedPhone) {
    const inbox = await lookupQuoInboxForClientPhone(normalizedPhone);
    if (inbox) return inbox;
  }

  return lookupQuoInboxByContactDisplayName(input.displayName);
}

/** Look up inbox conversation ids for specific client phones (one API call per phone). */
export async function buildQuoConversationByParticipantPhones(phones: string[]) {
  const byPhone = new Map<string, QuoInboxMatch>();
  const unique = [...new Set(phones.map((phone) => normalizePhoneForComparison(phone)).filter(Boolean))];

  for (const phone of unique) {
    try {
      const inbox = await lookupQuoInboxForClientPhone(phone);
      if (inbox) byPhone.set(phone, inbox);
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
