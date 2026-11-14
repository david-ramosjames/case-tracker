import { findContactForSession } from "@/lib/auth/access";
import { requireSessionUser } from "@/lib/auth/session";
import { ConfirmEventsPanel, type ConfirmEventRow } from "@/components/performance/confirm-events-panel";
import { MyWorkView } from "@/components/performance/my-work-view";
import { canBrowsePerformancePeople } from "@/lib/performance/access";
import {
  listCommitmentsForWeek,
  listDeliverablesForPerson,
} from "@/lib/performance/deliverables";
import { shiftWeekStart } from "@/lib/performance/team-rollup";
import { weekStartMondayCt } from "@/lib/performance/weeks";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { getNextScheduledDocketFlowEvents } from "@/lib/supabase/services";
import { type AppUser } from "@/lib/types";

export const dynamic = "force-dynamic";

function isAttorneyLike(user: AppUser | null | undefined) {
  if (!user) return false;
  return user.role === "attorney" || user.role === "admin" || user.role === "manager" || user.role === "super_admin";
}

export default async function PerformanceMyWorkPage({
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

  const people = [...users].sort((a, b) => a.name.localeCompare(b.name));
  let selectedPerson: AppUser | null = contact;
  if (canBrowsePeople && params.person) {
    selectedPerson = people.find((u) => u.id === params.person) ?? contact;
  }

  const viewingAsAttorney = isAttorneyLike(selectedPerson);

  const deliverables = selectedPerson
    ? await listDeliverablesForPerson({
        contactId: selectedPerson.id,
        asAttorney: viewingAsAttorney,
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

  const confirmRows: ConfirmEventRow[] = [];
  const showConfirm =
    viewingAsAttorney &&
    (sessionUser.role === "attorney" ||
      sessionUser.role === "admin" ||
      sessionUser.role === "manager" ||
      sessionUser.role === "super_admin");
  if (showConfirm && selectedPerson) {
    const attorneyRecords = records.filter((r) => r.shared.attorneyId === selectedPerson.id).slice(0, 25);
    for (const record of attorneyRecords) {
      try {
        const events = await getNextScheduledDocketFlowEvents(record.shared.id, 2);
        for (const event of events) {
          confirmRows.push({
            caseId: record.shared.id,
            caseNumber: record.shared.caseNumber,
            clientName: record.shared.clientName,
            attorneyUserId: record.shared.attorneyId,
            assigneeUserId: record.shared.paralegalId,
            event,
          });
        }
      } catch {
        // Calendar read is best-effort for confirmation queue.
      }
    }
  }

  return (
    <div className="space-y-6">
      <MyWorkView
        initialDeliverables={deliverables}
        initialCommitments={commitments}
        weekStart={weekStart}
        lastWeekStart={lastWeekStart}
        selectedPerson={selectedPerson}
        viewerContactId={contact?.id ?? null}
        canBrowsePeople={canBrowsePeople}
        people={people}
        viewingAsAttorney={viewingAsAttorney}
        caseOptions={caseOptions}
        nameById={nameById}
      />
      {confirmRows.length > 0 ? <ConfirmEventsPanel rows={confirmRows} /> : null}
    </div>
  );
}
