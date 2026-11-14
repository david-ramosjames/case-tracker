import { findContactForSession } from "@/lib/auth/access";
import { requireSessionUser } from "@/lib/auth/session";
import { AttorneyPlanView } from "@/components/performance/attorney-plan-view";
import { canBrowsePerformancePeople } from "@/lib/performance/access";
import { listAttorneyPlanLines } from "@/lib/performance/attorney-plans";
import { weekStartMondayCt } from "@/lib/performance/weeks";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { type AppUser } from "@/lib/types";

export const dynamic = "force-dynamic";

function isAttorneyLike(user: AppUser) {
  return (
    user.role === "attorney" ||
    user.role === "admin" ||
    user.role === "manager" ||
    user.role === "super_admin"
  );
}

export default async function PerformanceAttorneyPage({
  searchParams,
}: {
  searchParams?: Promise<{ person?: string }>;
}) {
  const sessionUser = await requireSessionUser();
  const params = searchParams ? await searchParams : {};
  const { records, users } = await loadViewerCaseBundle();
  const contact = findContactForSession(users, sessionUser);
  const weekStart = weekStartMondayCt();
  const canBrowsePeople = canBrowsePerformancePeople(sessionUser.role);

  const attorneys = users.filter(isAttorneyLike).sort((a, b) => a.name.localeCompare(b.name));
  let selectedAttorney: AppUser | null =
    contact && isAttorneyLike(contact) ? contact : attorneys[0] ?? null;
  if (canBrowsePeople && params.person) {
    selectedAttorney = attorneys.find((u) => u.id === params.person) ?? selectedAttorney;
  }

  const lines = selectedAttorney
    ? await listAttorneyPlanLines({ attorneyContactId: selectedAttorney.id, weekStart })
    : [];

  const caseOptions = records
    .filter((r) => !selectedAttorney || r.shared.attorneyId === selectedAttorney.id)
    .slice(0, 400)
    .map((r) => ({
      id: r.shared.id,
      caseNumber: r.shared.caseNumber,
      clientName: r.shared.clientName,
    }));

  return (
    <AttorneyPlanView
      initialLines={lines}
      weekStart={weekStart}
      selectedAttorney={selectedAttorney}
      attorneys={attorneys}
      canBrowsePeople={canBrowsePeople}
      caseOptions={caseOptions}
    />
  );
}
