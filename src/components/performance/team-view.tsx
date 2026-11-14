import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { countActiveByRole, productivityPerHead } from "@/lib/performance/headcount";
import { scoreAttorneyWeek, scoreParalegalWeek, DEFAULT_ATTORNEY_TARGETS, DEFAULT_PARALEGAL_TARGETS } from "@/lib/performance/scoring";
import { type PerformanceStaffDates } from "@/lib/performance/staff-dates";
import { type PerformanceDeliverable } from "@/lib/performance/types";
import { type AppUser } from "@/lib/types";
import { weekEndFromStart } from "@/lib/performance/weeks";

function countCompleted(
  deliverables: PerformanceDeliverable[],
  userId: string,
  types: string[],
  weekStart: string,
  weekEnd: string,
) {
  return deliverables.filter((d) => {
    if (d.assigneeUserId !== userId && d.attorneyUserId !== userId) return false;
    if (d.workflowStatus !== "done" || !d.completedAt) return false;
    const day = d.completedAt.slice(0, 10);
    if (day < weekStart || day > weekEnd) return false;
    return types.includes(d.deliverableType);
  }).length;
}

export function TeamView({
  users,
  deliverables,
  weekStart,
  staffByContactId,
}: {
  users: AppUser[];
  deliverables: PerformanceDeliverable[];
  weekStart: string;
  staffByContactId: Map<string, PerformanceStaffDates>;
}) {
  const weekEnd = weekEndFromStart(weekStart);
  const paralegals = users.filter((u) => u.role === "paralegal" || u.role === "paralegal_manager");
  const attorneys = users.filter((u) => u.role === "attorney");
  const activeParalegals = countActiveByRole(users, staffByContactId, weekStart, weekEnd, "paralegal");
  const demandsDone = deliverables.filter((d) => {
    if (d.deliverableType !== "demand_sent" || d.workflowStatus !== "done" || !d.completedAt) return false;
    const day = d.completedAt.slice(0, 10);
    return day >= weekStart && day <= weekEnd;
  }).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active paralegals this week</CardDescription>
            <CardTitle className="text-2xl">{activeParalegals}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Demands completed</CardDescription>
            <CardTitle className="text-2xl">{demandsDone}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Demands / paralegal</CardDescription>
            <CardTitle className="text-2xl">
              {productivityPerHead(demandsDone, activeParalegals)?.toFixed(2) ?? "—"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Paralegal scores (this week actuals)</CardTitle>
          <CardDescription>Workbook 3-bucket Overall — not capped at 100%</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Pre-Lit</TableHead>
                <TableHead>Litigation</TableHead>
                <TableHead>Scheduling</TableHead>
                <TableHead>Overall</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paralegals.map((user) => {
                const score = scoreParalegalWeek({
                  actualDemands: countCompleted(deliverables, user.id, ["demand_sent"], weekStart, weekEnd),
                  targetDemands: DEFAULT_PARALEGAL_TARGETS.demand_sent,
                  actualLawsuit: countCompleted(deliverables, user.id, ["lawsuit_filed"], weekStart, weekEnd),
                  targetLawsuit: DEFAULT_PARALEGAL_TARGETS.lawsuit_filed,
                  actualDiscovery: countCompleted(deliverables, user.id, ["discovery_responses"], weekStart, weekEnd),
                  targetDiscovery: DEFAULT_PARALEGAL_TARGETS.discovery_responses,
                  actualLitEventsScheduled: countCompleted(
                    deliverables,
                    user.id,
                    ["lit_event_scheduled"],
                    weekStart,
                    weekEnd,
                  ),
                  targetLitEventsScheduled: DEFAULT_PARALEGAL_TARGETS.lit_event_scheduled,
                });
                return (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{fmt(score.preLit)}</TableCell>
                    <TableCell>{fmt(score.litigation)}</TableCell>
                    <TableCell>{fmt(score.scheduling)}</TableCell>
                    <TableCell>{fmt(score.overall)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Attorney attainment (completed only)</CardTitle>
          <CardDescription>No invented weighted Overall — workbook has none for attorneys</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Lit completed</TableHead>
                <TableHead>Settlements</TableHead>
                <TableHead>Disbursements</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attorneys.map((user) => {
                const score = scoreAttorneyWeek({
                  actualLitCompleted: countCompleted(
                    deliverables,
                    user.id,
                    ["deposition", "mediation", "hearing", "hearing_trial"],
                    weekStart,
                    weekEnd,
                  ),
                  targetLitCompleted: DEFAULT_ATTORNEY_TARGETS.lit_completed_combined,
                  actualSettlements: countCompleted(deliverables, user.id, ["settlement"], weekStart, weekEnd),
                  targetSettlements: DEFAULT_ATTORNEY_TARGETS.settlement,
                  actualDisbursements: countCompleted(deliverables, user.id, ["disbursement"], weekStart, weekEnd),
                  targetDisbursements: DEFAULT_ATTORNEY_TARGETS.disbursement,
                });
                return (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{fmt(score.litCompleted)}</TableCell>
                    <TableCell>{fmt(score.settlements)}</TableCell>
                    <TableCell>{fmt(score.disbursements)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function fmt(n: number | null) {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}
