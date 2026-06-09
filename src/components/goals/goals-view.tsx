import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { QuarterPerformanceTables } from "@/components/goals/quarter-performance-tables";
import { type ViewerContext } from "@/lib/auth/access";
import { getAttorneyGoalProgress, getCurrentCommissionYearGoals, getFirmOutputMetrics } from "@/lib/calculations";
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
  const output = getFirmOutputMetrics(scopedRecords, scopedGoals);

  const commissionYearLabel = (() => {
    const years = [...new Set(scopedGoals.map((goal) => goal.year))].sort((a, b) => a - b);
    if (years.length === 0) return String(new Date().getFullYear());
    if (years.length === 1) return String(years[0]);
    return `${years[0]}–${years[years.length - 1]}`;
  })();

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        {progress.map((item) => {
          const attorney = users.find((user) => user.id === item.goal.attorneyId);

          return (
            <Card key={item.goal.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{attorney?.name}</CardTitle>
                    <CardDescription>
                      {commissionYearLabel} commission year · annual fee goal {formatCurrency(item.goal.annualFeeGoal)}
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
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <GoalStat label="Settled fees" value={formatCurrency(item.actualSettledFees)} />
                  <GoalStat label="Disbursed fees" value={formatCurrency(item.actualDisbursedFees)} />
                  <GoalStat label="Forecasted fees" value={formatCurrency(item.forecastedFees)} />
                  <GoalStat label="Year elapsed" value={percent(item.yearElapsed)} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <QuarterPerformanceTables grossRows={output.grossQuarterRows} feeRows={output.feeQuarterRows} />
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
