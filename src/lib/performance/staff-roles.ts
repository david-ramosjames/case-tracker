import { type AppUser, type UserRole } from "@/lib/types";

const PARALEGAL_ROLES: UserRole[] = ["paralegal", "paralegal_manager", "legal_assistant"];

export function isParalegalRole(role: UserRole | null | undefined) {
  return Boolean(role && PARALEGAL_ROLES.includes(role));
}

export function isAttorneyRole(role: UserRole | null | undefined) {
  return role === "attorney";
}

export function filterParalegals(users: AppUser[]) {
  return users.filter((u) => isParalegalRole(u.role)).sort((a, b) => a.name.localeCompare(b.name));
}

export function filterAttorneys(users: AppUser[]) {
  return users.filter((u) => isAttorneyRole(u.role)).sort((a, b) => a.name.localeCompare(b.name));
}
