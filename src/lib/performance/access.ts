import { isAdminRole } from "@/lib/auth/access";
import { type UserRole } from "@/lib/types";

/** Broader than fee Goals — paralegals and LAs can use Performance. */
export function canViewPerformance(role: UserRole | null | undefined) {
  return Boolean(role);
}

export function canManagePerformanceTargets(role: UserRole | null | undefined) {
  return isAdminRole(role) || role === "manager" || role === "paralegal_manager";
}

export function canViewAllParalegalWorkloads(role: UserRole | null | undefined) {
  return (
    isAdminRole(role) ||
    role === "manager" ||
    role === "paralegal_manager" ||
    role === "attorney"
  );
}

export function canViewPerformanceHistory(role: UserRole | null | undefined) {
  return canManagePerformanceTargets(role) || role === "attorney";
}

/** Firm Overview is the same for everyone — signed pacing + fee projection across all cases. */
export function canViewPerformanceOverview(role: UserRole | null | undefined) {
  return canViewPerformance(role);
}

/**
 * Detail tables under Overview charts: firm-wide for admins, Ryan (manager), and Lyliana
 * (paralegal_manager). Everyone else sees only their assigned cases.
 */
export function canViewFirmOverviewDetailTables(role: UserRole | null | undefined) {
  return isAdminRole(role) || role === "manager" || role === "paralegal_manager";
}

/** Firm-wide person switcher on board tabs. Attorneys may open a paralegal’s board. */
export function canBrowsePerformancePeople(role: UserRole | null | undefined) {
  return canViewAllParalegalWorkloads(role);
}

/** Admin/manager can pick whose Identify Work form to use. */
export function canBrowseIdentifyPeople(role: UserRole | null | undefined) {
  return canManagePerformanceTargets(role);
}

/** Managers/admins → overview; employees → Identify Work. */
export function defaultPerformancePath(role: UserRole | null | undefined) {
  if (canManagePerformanceTargets(role)) return "/performance/overview";
  return "/performance/identify";
}
