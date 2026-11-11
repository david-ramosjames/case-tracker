const CASEPATH_ORIGIN = "https://casepath.ramosjames.com";
const CASEPATH_URL = /https:\/\/casepath\.ramosjames\.com\/[^\s<]+/gi;

export function casePathTarget(raw: string | null | undefined) {
  const value = raw?.trim() ?? "";
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "casepath.ramosjames.com") return null;
  // Shared template links point at a page. Already-minted /r/TOKEN links are not templates.
  if (/^\/r\/[A-Za-z0-9_-]{8,128}\/?$/.test(url.pathname)) return null;
  const path = url.pathname.replace(/\/t\/[A-Za-z0-9_-]{8,128}$/, "") || "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.length > 180) return null;
  return { path, lang: url.searchParams.get("lang") === "es" ? ("es" as const) : ("en" as const) };
}

function casePathOrigin() {
  return process.env.CASEPATH_ORIGIN?.trim().replace(/\/$/, "") || CASEPATH_ORIGIN;
}

function isMintedCasePathUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "casepath.ramosjames.com") return false;
    const shortLink = /^\/r\/[A-Za-z0-9_-]{8,128}\/?$/.test(url.pathname);
    const tokenInPath = /\/t\/[A-Za-z0-9_-]{8,128}$/.test(url.pathname);
    return shortLink || tokenInPath || url.searchParams.has("rid") || url.searchParams.has("t");
  } catch {
    return false;
  }
}

async function mintOnce(input: { url: string; caseNumber: string; phone: string; lang?: "en" | "es" }) {
  const target = casePathTarget(input.url);
  const secret = process.env.CASEPATH_TOKEN_SECRET?.trim() ?? "";
  if (!target || !secret || !input.caseNumber.trim() || !input.phone.trim()) {
    if (!secret) console.warn("casepath visit link skipped: CASEPATH_TOKEN_SECRET is not set");
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${casePathOrigin()}/api/visit-tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        caseNumber: input.caseNumber.trim(),
        path: target.path,
        lang: input.lang ?? target.lang,
        phone: input.phone.trim(),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      console.warn("casepath visit link", response.status);
      return null;
    }
    const body = (await response.json().catch(() => null)) as { url?: unknown } | null;
    const minted = typeof body?.url === "string" ? body.url : "";
    return isMintedCasePathUrl(minted) ? minted : null;
  } catch (error) {
    console.warn("casepath visit link", error instanceof Error ? error.message : "request failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Replace a shared CasePath link with one tied to this case and the phone being texted. */
export async function personalizeCasePathLink(input: { url: string | null; caseNumber: string; phone: string }) {
  const shared = input.url?.trim() || null;
  if (!shared) return shared;
  if (isMintedCasePathUrl(shared)) return shared;

  const minted = (await mintOnce({ url: shared, caseNumber: input.caseNumber, phone: input.phone }))
    ?? (await mintOnce({ url: shared, caseNumber: input.caseNumber, phone: input.phone }));
  return minted ?? shared;
}

/**
 * Find every CasePath URL in an SMS body and mint a tracked ?rid= link for each shared one.
 * Used when queueing Slack approvals and again right before Quo send.
 */
export async function personalizeCasePathUrlsInText(input: {
  text: string;
  caseNumber: string;
  phone: string;
  lang?: "en" | "es";
}) {
  const found = input.text.match(CASEPATH_URL) ?? [];
  if (found.length === 0) return input.text;

  let next = input.text;
  const seen = new Set<string>();
  for (const raw of found) {
    const match = raw.replace(/[>,.;:!?)]+$/, "");
    if (seen.has(match)) continue;
    seen.add(match);
    if (isMintedCasePathUrl(match)) continue;
    const minted =
      (await mintOnce({ url: match, caseNumber: input.caseNumber, phone: input.phone, lang: input.lang })) ??
      (await mintOnce({ url: match, caseNumber: input.caseNumber, phone: input.phone, lang: input.lang }));
    if (minted) next = next.split(match).join(minted);
  }
  return next;
}
