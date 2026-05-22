const AUTH_CALLBACK_PATH = "/auth/callback";

function normalizeOrigin(value: string) {
  return value.replace(/\/$/, "");
}

/** Public site URL from env — set this in production (Vercel, etc.). */
export function getConfiguredSiteOrigin() {
  const value = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return value ? normalizeOrigin(value) : null;
}

/**
 * Origin for links in server-side Slack messages and emails.
 * Prefers NEXT_PUBLIC_SITE_URL, then Vercel's auto host (VERCEL_URL).
 */
export function resolvePublicAppOrigin() {
  const configured = getConfiguredSiteOrigin();
  if (configured) return configured;

  const vercelHost = process.env.VERCEL_URL?.trim();
  if (vercelHost) {
    const host = vercelHost.replace(/^https?:\/\//, "");
    return `https://${normalizeOrigin(host)}`;
  }

  return null;
}

/** Never use localhost in production Slack/cron links. */
export function getAppOriginForNotifications() {
  return resolvePublicAppOrigin() ?? (process.env.NODE_ENV === "development" ? "http://localhost:3000" : null);
}

/** Build the OAuth callback URL Supabase must redirect to after Google sign-in. */
export function buildAuthCallbackUrl(origin: string, nextPath = "/") {
  const safeNext = nextPath.startsWith("/") ? nextPath : "/";
  const url = new URL(AUTH_CALLBACK_PATH, origin);
  url.searchParams.set("next", safeNext);
  return url.toString();
}

/** Client-safe: prefer configured site URL, then the current browser origin. */
export function getClientAppOrigin() {
  return getConfiguredSiteOrigin() ?? (typeof window !== "undefined" ? window.location.origin : "");
}
