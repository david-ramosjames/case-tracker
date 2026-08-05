import { type UserRole } from "@/lib/types";

export const ALLOWED_EMAIL_DOMAIN = "ramosjames.com";

export const ADMIN_EMAILS = [
  "david@ramosjames.com",
  "jon@ramosjames.com",
  "laura@ramosjames.com",
] as const;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isAllowedEmail(email: string | null | undefined) {
  if (!email) return false;
  return normalizeEmail(email).endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

/** Firm emails that always receive admin on sign-in. */
export function getAdminRoleForEmail(email: string): "admin" | null {
  const normalized = normalizeEmail(email);
  if ((ADMIN_EMAILS as readonly string[]).includes(normalized)) return "admin";
  return null;
}

export function displayNameFromEmail(email: string, metadataName?: string | null) {
  if (metadataName?.trim()) return metadataName.trim();
  const localPart = normalizeEmail(email).split("@")[0] ?? "User";
  return localPart
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function contactRoleToUserRole(role: string | null | undefined): UserRole | null {
  if (role === "attorney" || role === "paralegal" || role === "legal_assistant" || role === "manager") {
    return role;
  }
  return null;
}
