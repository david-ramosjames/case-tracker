import { findContactForSession } from "@/lib/auth/access";
import { requireSessionUser } from "@/lib/auth/session";
import { MyWorkView } from "@/components/performance/my-work-view";
import { canBrowseIdentifyPeople } from "@/lib/performance/access";
import {
  listCommitmentsForWeek,
  listDeliverablesForPerson,
} from "@/lib/performance/deliverables";
import { hasContactRole } from "@/lib/contacts/roles";
import {
  filterAttorneys,
  filterParalegals,
  sortCasesByNumber,
} from "@/lib/performance/staff-roles";
import { shiftWeekStart } from "@/lib/performance/team-rollup";
import { weekStartMondayCt } from "@/lib/performance/weeks";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { type AppUser } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PerformanceIdentifyPage({
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
  const canBrowsePeople = canBrowseIdentifyPeople(sessionUser.role);

  const paralegals = filterParalegals(users);
  const attorneys = filterAttorneys(users);
  const switcherPeople = [...attorneys, ...paralegals].sort((a, b) => a.name.localeCompare(b.name));

  let selectedPerson: AppUser | null = contact ?? null;
  if (canBrowsePeople && params.person) {
    selectedPerson = switcherPeople.find((u) => u.id === params.person) ?? selectedPerson;
  } else if (
    !selectedPerson ||
    (!hasContactRole(selectedPerson, "attorney") && !hasContactRole(selectedPerson, "paralegal"))
  ) {
    // Managers without a staff seat: default to first switchable person when browsing.
    selectedPerson = canBrowsePeople ? switcherPeople[0] ?? null : null;
  }

  const isAttorney = selectedPerson ? hasContactRole(selectedPerson, "attorney") : false;
  const deliverables = selectedPerson
    ? await listDeliverablesForPerson({
        contactId: selectedPerson.id,
        asAttorney: isAttorney,
        completedSince: lastWeekStart,
      })
    : [];
  const commitments = await listCommitmentsForWeek(weekStart);

  const caseOptions = sortCasesByNumber(
    records.map((r) => ({
      id: r.shared.id,
      caseNumber: r.shared.caseNumber,
      clientName: r.shared.clientName,
      paralegalId: r.shared.paralegalId,
      attorneyId: r.shared.attorneyId,
    })),
  );

  const nameById = Object.fromEntries(users.map((u) => [u.id, u.name]));

  return (
    <MyWorkView
      mode={isAttorney ? "attorney" : "paralegal"}
      panel="identify"
      initialDeliverables={deliverables}
      initialCommitments={commitments}
      weekStart={weekStart}
      lastWeekStart={lastWeekStart}
      selectedPerson={selectedPerson}
      viewerContactId={contact?.id ?? null}
      canBrowsePeople={canBrowsePeople}
      people={canBrowsePeople ? switcherPeople : selectedPerson ? [selectedPerson] : []}
      caseOptions={caseOptions}
      nameById={nameById}
      basePath="/performance/identify"
      personSwitcherLabel="Entering as"
    />
  );
}
