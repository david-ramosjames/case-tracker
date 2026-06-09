import { getAttorneyDisbursementVisibility } from "@/lib/disbursements";
import { type SessionUser } from "@/lib/auth/types";
import { type AppUser, type AttorneyGoal, type CaseRecord, type UserRole } from "@/lib/types";

export type CasePipelineFilter = "Active" | "Closed" | "Historical" | "all";

export type ViewerContext = {
  isAdmin: boolean;
  isAttorney: boolean;
  contactId: string | null;
  canViewAllCases: boolean;
  canViewHistorical: boolean;
};

export function isAdminRole(role: UserRole | null | undefined) {
  return role === "admin" || role === "super_admin";
}

export function findContactForSession(users: AppUser[], session: SessionUser): AppUser | null {
  const email = session.email.trim().toLowerCase();
  return users.find((user) => user.email.trim().toLowerCase() === email) ?? null;
}

export function buildViewerContext(session: SessionUser, users: AppUser[]): ViewerContext {
  const isAdmin = isAdminRole(session.role);
  const contact = findContactForSession(users, session);
  const isAttorney = session.role === "attorney" && Boolean(contact);

  return {
    isAdmin,
    isAttorney,
    contactId: contact?.id ?? null,
    canViewAllCases: isAdmin || session.role === "manager" || session.role === "paralegal",
    canViewHistorical: isAdmin,
  };
}

export function getAttorneyCommissionStartMonth(goals: AttorneyGoal[], attorneyId: string) {
  const matches = goals.filter((goal) => goal.attorneyId === attorneyId);
  if (matches.length === 0) return 1;
  const sorted = [...matches].sort((a, b) => b.year - a.year);
  return sorted[0]?.commissionYearStartMonth ?? 1;
}

export function isRecordHistoricalForViewer(record: CaseRecord, goals: AttorneyGoal[]) {
  const startMonth = getAttorneyCommissionStartMonth(goals, record.shared.attorneyId);
  return getAttorneyDisbursementVisibility(record.tracker, startMonth).historical;
}

function isRecordHiddenFromAttorney(record: CaseRecord, attorneyId: string, goals: AttorneyGoal[]) {
  const startMonth = getAttorneyCommissionStartMonth(goals, attorneyId);
  return getAttorneyDisbursementVisibility(record.tracker, startMonth).hidden;
}

export function getCasePipelineFilter(record: CaseRecord, goals: AttorneyGoal[]): CasePipelineFilter {
  if (isRecordHistoricalForViewer(record, goals)) return "Historical";
  return record.shared.status;
}

export function filterRecordsForViewer(
  records: CaseRecord[],
  session: SessionUser,
  users: AppUser[],
  goals: AttorneyGoal[],
): CaseRecord[] {
  const viewer = buildViewerContext(session, users);

  if (viewer.isAdmin) return records;

  if (viewer.isAttorney && viewer.contactId) {
    return records.filter((record) => {
      if (record.shared.attorneyId !== viewer.contactId) return false;
      return !isRecordHiddenFromAttorney(record, viewer.contactId, goals);
    });
  }

  return records;
}

export function canViewerAccessCase(
  record: CaseRecord,
  session: SessionUser,
  users: AppUser[],
  goals: AttorneyGoal[],
) {
  const viewer = buildViewerContext(session, users);
  if (viewer.isAdmin) return true;
  if (viewer.isAttorney && viewer.contactId) {
    if (record.shared.attorneyId !== viewer.contactId) return false;
    return !isRecordHiddenFromAttorney(record, viewer.contactId, goals);
  }
  return true;
}
