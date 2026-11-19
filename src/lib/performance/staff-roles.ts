import { hasContactRole } from "@/lib/contacts/roles";
import { type AppUser, type UserRole } from "@/lib/types";

/** Strict paralegal capability — includes dual-role contacts with paralegal checked. */
export function isParalegalRole(role: UserRole | null | undefined) {
  return role === "paralegal";
}

export function isAttorneyRole(role: UserRole | null | undefined) {
  return role === "attorney";
}

export function filterParalegals(users: AppUser[]) {
  return users
    .filter((u) => hasContactRole(u, "paralegal"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function filterAttorneys(users: AppUser[]) {
  return users
    .filter((u) => hasContactRole(u, "attorney"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function filterLegalAssistants(users: AppUser[]) {
  return users
    .filter((u) => hasContactRole(u, "legal_assistant"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Sort case numbers numerically when possible (964 before 1185). */
export function compareCaseNumbers(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function sortCasesByNumber<T extends { caseNumber: string }>(cases: T[]): T[] {
  return [...cases].sort((a, b) => compareCaseNumbers(a.caseNumber, b.caseNumber));
}
