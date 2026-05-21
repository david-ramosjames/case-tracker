import { headers } from "next/headers";
import { getConfiguredSiteOrigin } from "@/lib/auth/redirect-url";

function normalizeOrigin(value: string) {
  return value.replace(/\/$/, "");
}

/** Server: resolve the app origin from env or the incoming request (Vercel/proxy-safe). */
export async function getAppOrigin() {
  const configured = getConfiguredSiteOrigin();
  if (configured) return configured;

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  if (!host) return "http://localhost:3000";

  const proto = headerList.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? (host.includes("localhost") ? "http" : "https");
  return normalizeOrigin(`${proto}://${host}`);
}
