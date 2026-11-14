import { type PerformanceStaffDates } from "@/lib/performance/staff-dates";
import { type AppUser } from "@/lib/types";

/**
 * Active for headcount if employed during the week (Performance staff dates only).
 * Missing staff-dates row + active contact → counted. Never mutates case assignments.
 */
export function isEmployedDuringWeek(
  user: Pick<AppUser, "active" | "id">,
  staff: PerformanceStaffDates | null | undefined,
  weekStartYmd: string,
  weekEndYmd: string,
) {
  if (user.active === false) return false;
  const start = staff?.employmentStartDate ?? null;
  const end = staff?.employmentEndDate ?? null;
  if (start && start > weekEndYmd) return false;
  if (end && end < weekStartYmd) return false;
  return true;
}

export function countActiveByRole(
  users: AppUser[],
  staffByContactId: Map<string, PerformanceStaffDates>,
  weekStartYmd: string,
  weekEndYmd: string,
  role: AppUser["role"],
) {
  return users.filter(
    (user) =>
      user.role === role &&
      isEmployedDuringWeek(user, staffByContactId.get(user.id), weekStartYmd, weekEndYmd),
  ).length;
}

export function productivityPerHead(
  completedCount: number,
  activeHeadcount: number,
): number | null {
  if (activeHeadcount <= 0) return null;
  return completedCount / activeHeadcount;
}
