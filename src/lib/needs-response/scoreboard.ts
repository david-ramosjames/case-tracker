import { normalizeEmail } from "@/lib/auth/constants";
import { type AppUser } from "@/lib/types";

/** Always include Laura on Needs response scoreboard even when Contact excludes her. */
export const NEEDS_RESPONSE_EXTRA_ATTORNEY_EMAILS = ["laura@ramosjames.com"] as const;

/**
 * Contact scoreboard allowlist, plus attorneys that should appear on Needs response only.
 * Null allowlist still means “everyone”.
 */
export function needsResponseScoreboardAttorneyIds(
  contactScoreboardAttorneyIds: string[] | null,
  users: AppUser[],
): string[] | null {
  if (!contactScoreboardAttorneyIds) return null;

  const extras = users
    .filter((user) => {
      const email = normalizeEmail(user.email ?? "");
      return (NEEDS_RESPONSE_EXTRA_ATTORNEY_EMAILS as readonly string[]).includes(email);
    })
    .map((user) => user.id);

  if (extras.length === 0) return contactScoreboardAttorneyIds;
  return [...new Set([...contactScoreboardAttorneyIds, ...extras])];
}

/** Seed Needs-response-only extras (e.g. Laura) so they show even at zero open items. */
export function needsResponseScoreboardSeeds(users: AppUser[]): Array<{ id: string; name: string }> {
  return users
    .filter((user) => {
      const email = normalizeEmail(user.email ?? "");
      return (NEEDS_RESPONSE_EXTRA_ATTORNEY_EMAILS as readonly string[]).includes(email);
    })
    .map((user) => ({
      id: user.id,
      name: user.name.trim() || "Unassigned",
    }));
}
