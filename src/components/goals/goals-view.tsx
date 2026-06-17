import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AchievementCard, QuarterlyGoalChart } from "@/components/goals/goal-achievement-summary";
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
    annualRjlFeesGoal: sum(scopedGoals.map((goal) => goal.annualRjlFeesGoal)),
    grossDisbursed: sum(progress.map((item) => item.actualGrossDisbursed)),
    disbursedFees: sum(progress.map((item) => item.actualDisbursedFees)),
    yearElapsed:
      progress.length > 0
        ? progress.reduce((total, item) => total + item.yearElapsed, 0) / progress.length
        : 0,
  };
  const firmGrossProgress =
    firmTotals.annualGrossGoal > 0 ? (firmTotals.grossDisbursed / firmTotals.annualGrossGoal) * 100 : 0;
  const firmFeeProgress =
    firmTotals.annualRjlFeesGoal > 0 ? (firmTotals.disbursedFees / firmTotals.annualRjlFeesGoal) * 100 : 0;

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
                    Combined totals across {progress.length} attorneys for the current commission year.
                  </CardDescription>
                </div>
                <Badge variant={firmGrossProgress >= firmTotals.yearElapsed ? "success" : "warning"}>
                  {firmGrossProgress >= firmTotals.yearElapsed ? "Ahead" : "Behind"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <AchievementCard
                  label="Gross disbursements"
                  achievedPercent={firmGrossProgress}
                  actual={firmTotals.grossDisbursed}
                  goal={firmTotals.annualGrossGoal}
                />
                <AchievementCard
                  label="RJL attorney fees"
                  achievedPercent={firmFeeProgress}
                  actual={firmTotals.disbursedFees}
                  goal={firmTotals.annualRjlFeesGoal}
                />
                <GoalStat label="Year elapsed" value={percent(firmTotals.yearElapsed)} />
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
                      {item.goal.year} commission year · {commissionPeriod} · starts {startMonthLabel}
                    </CardDescription>
                  </div>
                  <Badge variant={item.pace === "ahead" ? "success" : "warning"}>
                    {item.pace === "ahead" ? "Ahead" : "Behind"} pace
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <AchievementCard
                    label="Gross disbursements"
                    achievedPercent={item.annualProgress}
                    actual={item.actualGrossDisbursed}
                    goal={item.goal.annualGrossGoal}
                  />
                  <AchievementCard
                    label="RJL attorney fees"
                    achievedPercent={item.feeProgress}
                    actual={item.actualDisbursedFees}
                    goal={item.goal.annualRjlFeesGoal}
                  />
                  <GoalStat
                    label="Commission threshold"
                    value={item.thresholdMet ? "Met" : formatCurrency(item.goal.commissionThreshold)}
                  />
                  <GoalStat label="Year elapsed" value={percent(item.yearElapsed)} />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <QuarterlyGoalChart title="Gross disbursements by quarter" rows={grossRows} />
                  <QuarterlyGoalChart title="RJL attorney fees by quarter" rows={feeRows} />
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
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-navy-950">{value}</p>
    </div>
  );
}
