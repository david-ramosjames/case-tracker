import { findContactForSession } from "@/lib/auth/access";
import { requireSessionUser } from "@/lib/auth/session";
import { MyWorkView } from "@/components/performance/my-work-view";
import { canBrowsePerformancePeople } from "@/lib/performance/access";
import {
  listCommitmentsForWeek,
  listDeliverablesForPerson,
} from "@/lib/performance/deliverables";
import { filterParalegals, isParalegalRole } from "@/lib/performance/staff-roles";
import { shiftWeekStart } from "@/lib/performance/team-rollup";
import { weekStartMondayCt } from "@/lib/performance/weeks";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { type AppUser } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PerformanceParalegalsPage({
  searchParams,
}: {
  searchParams?: Promise<{ person?: string }>;
}) {
  const sessionUser = await requireSessionUser();
  const params = searchParams ? await searchParams : {};
  const { records, users } = await loadViewerCaseBundle();
  const contact = findContactForSession(users, sessionUser);
  const weekStart = weekStartMondayCt();
  const lastWeekStart = shiftWeekStart(weekStart, -1);
  const canBrowsePeople = canBrowsePerformancePeople(sessionUser.role);

  const paralegals = filterParalegals(users);
  let selectedPerson: AppUser | null =
    contact && isParalegalRole(contact.role) ? contact : paralegals[0] ?? null;
  if (canBrowsePeople && params.person) {
    selectedPerson = paralegals.find((u) => u.id === params.person) ?? selectedPerson;
  }

  const deliverables = selectedPerson
    ? await listDeliverablesForPerson({
        contactId: selectedPerson.id,
        asAttorney: false,
        completedSince: lastWeekStart,
      })
    : [];
  const commitments = await listCommitmentsForWeek(weekStart);

  const caseOptions = records.slice(0, 400).map((r) => ({
    id: r.shared.id,
    caseNumber: r.shared.caseNumber,
    clientName: r.shared.clientName,
    paralegalId: r.shared.paralegalId,
    attorneyId: r.shared.attorneyId,
  }));

  const nameById = Object.fromEntries(users.map((u) => [u.id, u.name]));

  return (
    <MyWorkView
      initialDeliverables={deliverables}
      initialCommitments={commitments}
      weekStart={weekStart}
      lastWeekStart={lastWeekStart}
      selectedPerson={selectedPerson}
      viewerContactId={contact?.id ?? null}
      canBrowsePeople={canBrowsePeople}
      people={paralegals}
      viewingAsAttorney={false}
      caseOptions={caseOptions}
      nameById={nameById}
    />
  );
}
