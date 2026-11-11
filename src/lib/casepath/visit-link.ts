const CASEPATH_ORIGIN = "https://casepath.ramosjames.com";

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
    const tokenInPath = /\/t\/[A-Za-z0-9_-]{8,128}$/.test(url.pathname);
    return url.protocol === "https:" && url.hostname === "casepath.ramosjames.com" && (tokenInPath || url.searchParams.has("t"));
  } catch {
    return false;
  }
}

/** Replace a shared CasePath link with one tied to this case and the phone being texted. */
export async function personalizeCasePathLink(input: { url: string | null; caseNumber: string; phone: string }) {
  const shared = input.url?.trim() || null;
  const target = casePathTarget(shared);
  const secret = process.env.CASEPATH_TOKEN_SECRET?.trim() ?? "";
  if (!shared || !target || !secret || !input.caseNumber.trim() || !input.phone.trim()) return shared;

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
        lang: target.lang,
        phone: input.phone.trim(),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.warn("casepath visit link", response.status);
      return shared;
    }
    const body = (await response.json().catch(() => null)) as { url?: unknown } | null;
    const minted = typeof body?.url === "string" ? body.url : "";
    return isMintedCasePathUrl(minted) ? minted : shared;
  } catch (error) {
    console.warn("casepath visit link", error instanceof Error ? error.message : "request failed");
    return shared;
  }
}
