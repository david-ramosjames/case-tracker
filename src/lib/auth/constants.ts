import { type UserRole } from "@/lib/types";

export const ALLOWED_EMAIL_DOMAIN = "ramosjames.com";

export const ADMIN_EMAILS = ["david@ramosjames.com", "jon@ramosjames.com"] as const;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isAllowedEmail(email: string | null | undefined) {
  if (!email) return false;
  return normalizeEmail(email).endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

export function getRoleForEmail(email: string): UserRole {
  const normalized = normalizeEmail(email);
  if ((ADMIN_EMAILS as readonly string[]).includes(normalized)) return "admin";
  return "attorney";
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
