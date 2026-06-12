import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { QuarterPerformanceTables } from "@/components/goals/quarter-performance-tables";
import { type ViewerContext } from "@/lib/auth/access";
import {
  getAttorneyCommissionQuarterRows,
  getAttorneyGoalProgress,
  getCurrentCommissionYearGoals,
  sum,
} from "@/lib/calculations";
import {
  formatCommissionYearPeriod,
  getCommissionYearStartMonthLabel,
} from "@/lib/commission-year";
import { type AppUser, type AttorneyGoal, type CaseRecord } from "@/lib/types";
import { formatCurrency, percent } from "@/lib/utils";

export function GoalsView({
  records,
  goals,
  users,
  viewer,
}: {
  records: CaseRecord[];
  goals: AttorneyGoal[];
  users: AppUser[];
  viewer: ViewerContext;
}) {
  const attorneyUsers = users.filter((user) => user.role === "attorney");
  const visibleAttorneyIds =
    viewer.isAttorney && viewer.contactId ? [viewer.contactId] : attorneyUsers.map((user) => user.id);

  const scopedGoals = getCurrentCommissionYearGoals(goals, visibleAttorneyIds);
  const scopedRecords =
    viewer.isAttorney && viewer.contactId
      ? records.filter((record) => record.shared.attorneyId === viewer.contactId)
      : records;

  const progress = getAttorneyGoalProgress(scopedRecords, scopedGoals);
  const showFirmOverall = !viewer.isAttorney && progress.length > 1;

  const firmTotals = {
    annualGrossGoal: sum(scopedGoals.map((goal) => goal.annualGrossGoal)),
    grossDisbursed: sum(progress.map((item) => item.actualGrossDisbursed)),
    planGross: sum(progress.map((item) => item.planGross)),
    disbursedFees: sum(progress.map((item) => item.actualDisbursedFees)),
    commissionThreshold: sum(scopedGoals.map((goal) => goal.commissionThreshold)),
    yearElapsed:
      progress.length > 0
        ? progress.reduce((total, item) => total + item.yearElapsed, 0) / progress.length
        : 0,
  };
  const firmAnnualProgress =
    firmTotals.annualGrossGoal > 0 ? (firmTotals.grossDisbursed / firmTotals.annualGrossGoal) * 100 : 0;

  return (
    <div className="space-y-10">
      {showFirmOverall ? (
        <section className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Firm overall</CardTitle>
                  <CardDescription>
                    Current commission year totals across {progress.length} attorneys. Per-attorney commission years and
                    quarterly detail are below.
                  </CardDescription>
                </div>
                <Badge variant={firmAnnualProgress >= firmTotals.yearElapsed ? "success" : "warning"}>
                  {firmAnnualProgress >= firmTotals.yearElapsed ? "Ahead" : "Behind"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">Combined annual progress (gross disbursed)</span>
                  <span className="font-semibold">{percent(firmAnnualProgress)}</span>
                </div>
                <Progress value={firmAnnualProgress} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <GoalStat label="Combined gross goal" value={formatCurrency(firmTotals.annualGrossGoal)} />
                <GoalStat label="Gross disbursed" value={formatCurrency(firmTotals.grossDisbursed)} />
                <GoalStat label="Plan (bottom-up)" value={formatCurrency(firmTotals.planGross)} />
                <GoalStat label="RJL fees disbursed" value={formatCurrency(firmTotals.disbursedFees)} />
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {progress.map((item) => {
        const attorney = users.find((user) => user.id === item.goal.attorneyId);
        const attorneyRecords = scopedRecords.filter((record) => record.shared.attorneyId === item.goal.attorneyId);
        const commissionPeriod = formatCommissionYearPeriod(item.goal.year, item.goal.commissionYearStartMonth);
        const startMonthLabel = getCommissionYearStartMonthLabel(item.goal.commissionYearStartMonth);
        const grossRows = getAttorneyCommissionQuarterRows(attorneyRecords, item.goal, "gross");
        const feeRows = getAttorneyCommissionQuarterRows(attorneyRecords, item.goal, "fees");

        return (
          <section key={item.goal.id} className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{attorney?.name ?? "Attorney"}</CardTitle>
                    <CardDescription>
                      {item.goal.year} commission year · {commissionPeriod} · starts {startMonthLabel} · gross goal{" "}
                      {formatCurrency(item.goal.annualGrossGoal)} · commission threshold{" "}
                      {formatCurrency(item.goal.commissionThreshold)}
                    </CardDescription>
                  </div>
                  <Badge variant={item.pace === "ahead" ? "success" : "warning"}>
                    {item.pace === "ahead" ? "Ahead" : "Behind"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-muted-foreground">Annual progress</span>
                    <span className="font-semibold">{percent(item.annualProgress)}</span>
                  </div>
                  <Progress value={item.annualProgress} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-5">
                  <GoalStat label="Gross disbursed" value={formatCurrency(item.actualGrossDisbursed)} />
                  <GoalStat label="Plan (bottom-up)" value={formatCurrency(item.planGross)} />
                  <GoalStat label="RJL fees disbursed" value={formatCurrency(item.actualDisbursedFees)} />
                  <GoalStat
                    label="Commission threshold"
                    value={item.thresholdMet ? "Met" : formatCurrency(item.goal.commissionThreshold)}
                  />
                  <GoalStat label="Year elapsed" value={percent(item.yearElapsed)} />
                </div>
              </CardContent>
            </Card>

            <QuarterPerformanceTables
              grossRows={grossRows}
              feeRows={feeRows}
              description={`${commissionPeriod} — CY Q1–Q4 are three-month periods from ${startMonthLabel}, not calendar quarters.`}
            />
          </section>
        );
      })}
    </div>
  );
}

function GoalStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold text-navy-950">{value}</p>
    </div>
  );
}
