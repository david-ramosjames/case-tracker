import { findContactForSession } from "@/lib/auth/access";
import { requireSessionUser } from "@/lib/auth/session";
import { MyWorkView } from "@/components/performance/my-work-view";
import { canBrowsePerformancePeople } from "@/lib/performance/access";
import {
  buildParalegalBoardBuckets,
  paralegalFinishedDocketCreatedWindow,
  type AttorneyBoardBuckets,
} from "@/lib/performance/attorney-board";
import {
  listCommitmentsForWeek,
  listDeliverablesForPerson,
} from "@/lib/performance/deliverables";
import { historicActualsByWeekForPerson } from "@/lib/performance/person-historic-actuals";
import { buildPersonScorecardBundle } from "@/lib/performance/person-scorecard";
import { hasContactRole } from "@/lib/contacts/roles";
import { filterParalegals, sortCasesByNumber } from "@/lib/performance/staff-roles";
import { listPerformanceTargets } from "@/lib/performance/targets";
import { shiftWeekStart } from "@/lib/performance/team-rollup";
import { listWeekPairMetricsForPairs, listWeekPairsInRange } from "@/lib/performance/week-pairs";
import { weekStartMondayCt } from "@/lib/performance/weeks";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { listDocketFlowCaseEventsForCases } from "@/lib/supabase/services";
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
  const trendSince = shiftWeekStart(weekStart, -13);
  const canBrowsePeople = canBrowsePerformancePeople(sessionUser.role);

  const paralegals = filterParalegals(users);
  let selectedPerson: AppUser | null =
    contact && hasContactRole(contact, "paralegal") ? contact : paralegals[0] ?? null;
  if (canBrowsePeople && params.person) {
    selectedPerson = paralegals.find((u) => u.id === params.person) ?? selectedPerson;
  }

  const historyPairsPromise = listWeekPairsInRange(trendSince, lastWeekStart).catch(() => []);

  const [deliverables, commitments, targets, historyPairs] = await Promise.all([
    selectedPerson
      ? listDeliverablesForPerson({
          contactId: selectedPerson.id,
          asAttorney: false,
          completedSince: trendSince,
        })
      : Promise.resolve([]),
    listCommitmentsForWeek(weekStart),
    listPerformanceTargets(),
    historyPairsPromise,
  ]);

  const historyMetrics = await listWeekPairMetricsForPairs(historyPairs.map((p) => p.id)).catch(() => []);
  const historicActualsByWeek = selectedPerson
    ? historicActualsByWeekForPerson({
        role: "paralegal",
        personId: selectedPerson.id,
        pairs: historyPairs,
        metrics: historyMetrics,
      })
    : undefined;

  const scorecard = selectedPerson
    ? buildPersonScorecardBundle({
        role: "paralegal",
        personId: selectedPerson.id,
        weekStart,
        lastWeekStart,
        deliverables,
        commitments,
        targets,
        historicActualsByWeek,
      })
    : null;

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

  const paralegalRecords = selectedPerson
    ? records.filter((r) => r.shared.paralegalId === selectedPerson.id)
    : [];

  const createdWindow = paralegalFinishedDocketCreatedWindow(lastWeekStart, weekStart);
  let eventsByCaseId: Record<string, Awaited<ReturnType<typeof listDocketFlowCaseEventsForCases>>> = {};
  try {
    const events = await listDocketFlowCaseEventsForCases({
      caseIds: paralegalRecords.map((r) => r.shared.id),
      createdFrom: createdWindow.createdFrom,
      createdToExclusive: createdWindow.createdToExclusive,
    });
    eventsByCaseId = {};
    for (const event of events) {
      const list = eventsByCaseId[event.caseId] ?? [];
      list.push(event);
      eventsByCaseId[event.caseId] = list;
    }
  } catch {
    eventsByCaseId = {};
  }

  let boardBuckets: AttorneyBoardBuckets | null = null;
  if (selectedPerson) {
    try {
      boardBuckets = buildParalegalBoardBuckets({
        weekStart,
        lastWeekStart,
        personId: selectedPerson.id,
        deliverables,
        commitments,
        records: paralegalRecords,
        eventsByCaseId,
      });
    } catch {
      boardBuckets = null;
    }
  }

  return (
    <MyWorkView
      key={selectedPerson?.id ?? "none"}
      mode="paralegal"
      panel="board"
      initialDeliverables={deliverables}
      initialCommitments={commitments}
      weekStart={weekStart}
      lastWeekStart={lastWeekStart}
      selectedPerson={selectedPerson}
      viewerContactId={contact?.id ?? null}
      canBrowsePeople={canBrowsePeople}
      people={paralegals}
      caseOptions={caseOptions}
      nameById={nameById}
      basePath="/performance/my-work"
      personSwitcherLabel="Paralegal"
      scorecard={scorecard}
      boardBuckets={boardBuckets}
    />
  );
}
