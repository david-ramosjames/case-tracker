export function getSupabaseUrl() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!value) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL.");
  return value;
}

type ResolvedKey = {
  source: string | null;
  kind: "publishable" | "secret" | "legacy-jwt" | "other" | "missing";
  usingNewKey: boolean;
};

function classifyKey(value: string | null | undefined): ResolvedKey["kind"] {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "missing";
  if (trimmed.startsWith("sb_publishable_")) return "publishable";
  if (trimmed.startsWith("sb_secret_")) return "secret";
  if (trimmed.startsWith("eyJ")) return "legacy-jwt";
  return "other";
}

function resolveKey(
  preferred: { name: string; value: string | undefined },
  fallback: { name: string; value: string | undefined },
): ResolvedKey {
  const preferredValue = preferred.value?.trim();
  if (preferredValue) {
    const kind = classifyKey(preferredValue);
    return {
      source: preferred.name,
      kind,
      usingNewKey: kind === "publishable" || kind === "secret",
    };
  }
  const fallbackValue = fallback.value?.trim();
  if (fallbackValue) {
    return {
      source: fallback.name,
      kind: classifyKey(fallbackValue),
      usingNewKey: false,
    };
  }
  return { source: null, kind: "missing", usingNewKey: false };
}

/** Safe status for admins: which env vars are active, without exposing key values. */
export function getSupabaseKeyStatus() {
  const publishable = resolveKey(
    { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", value: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
    { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
  );
  const secret = resolveKey(
    { name: "SUPABASE_SECRET_KEY", value: process.env.SUPABASE_SECRET_KEY },
    { name: "SUPABASE_SERVICE_ROLE_KEY", value: process.env.SUPABASE_SERVICE_ROLE_KEY },
  );
  return {
    publishable,
    secret,
    safeToRemoveLegacyKeys: publishable.usingNewKey && secret.usingNewKey,
  };
}

/** Browser / SSR client key. Prefers the new publishable key; falls back to legacy anon. */
export function getSupabasePublishableKey() {
  const value =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!value) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY).");
  }
  return value;
}

/** Server-only key that bypasses RLS. Prefers the new secret key; falls back to legacy service_role. */
export function getSupabaseSecretKey() {
  return process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
}

/** @deprecated Prefer getSupabasePublishableKey. */
export function getSupabaseAnonKey() {
  return getSupabasePublishableKey();
}

/** @deprecated Prefer getSupabaseSecretKey. */
export function getSupabaseServiceRoleKey() {
  return getSupabaseSecretKey();
}
