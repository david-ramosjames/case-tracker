import {
  AlertTriangle,
  Banknote,
  BriefcaseBusiness,
  CircleDollarSign,
  ClipboardCheck,
  Sparkles,
  TimerReset,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AttorneyScoreRollupCard } from "@/components/attorney-score/attorney-score-rollup";
import { MetricCard } from "@/components/dashboard/metric-card";
import { type ViewerContext } from "@/lib/auth/access";
import { getAttorneyGoalProgress, getDashboardMetrics } from "@/lib/calculations";
import { type AppUser, type AttorneyGoal, type CaseRecord, type CaseTrackerSettings } from "@/lib/types";
import { formatCurrency, percent } from "@/lib/utils";

export function DashboardView({
  records,
  goals,
  settings,
  users,
  viewer,
}: {
  records: CaseRecord[];
  goals: AttorneyGoal[];
  settings: CaseTrackerSettings;
  users: AppUser[];
  viewer: ViewerContext;
}) {
  const metrics = getDashboardMetrics(records, settings, goals);
  const goalProgress = getAttorneyGoalProgress(records, goals);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          href="/cases"
          icon={BriefcaseBusiness}
          label="Active cases"
          value={String(metrics.totalActiveCases)}
          detail="Active pipeline cases (excludes closed and historical)"
        />
        <MetricCard
          href="/output"
          icon={CircleDollarSign}
          label="Forecasted settlement"
          value={formatCurrency(metrics.totalForecastSettlementValue)}
          detail="Open pipeline settlement value"
        />
        <MetricCard
          href="/goals"
          icon={Banknote}
          label="Forecasted fees"
          value={formatCurrency(metrics.totalForecastFeeValue)}
          detail="Projected attorney fee value"
        />
        <MetricCard
          href="/results?disbursed=No"
          icon={ClipboardCheck}
          label="Settled not disbursed"
          value={formatCurrency(metrics.settledNotDisbursedAmount)}
          detail="Needs collection follow-through"
        />
        <MetricCard
          href="/cases?filter=missing-fields&status=all"
          icon={AlertTriangle}
          label="Missing required fields"
          value={String(metrics.casesMissingRequiredFields)}
          detail="Value, fee, quarter, source, confidence"
        />
        <MetricCard
          href="/cases?filter=stale-review&status=all"
          icon={TimerReset}
          label="Not reviewed recently"
          value={String(metrics.casesNotReviewedRecently)}
          detail={`More than ${settings.staleReviewThresholdDays} days old`}
        />
        <MetricCard
          href="/cases?filter=quarterly-check-in&status=all"
          icon={ClipboardCheck}
          label="Quarterly check-ins due"
          value={String(metrics.casesNeedingQuarterlyCheckIn)}
          detail="Expected disbursement quarter, minimum value"
        />
        <MetricCard
          href="/cases?filter=validation-overdue&status=all"
          icon={TimerReset}
          label="Validation overdue"
          value={String(metrics.casesWithOutdatedValidation)}
          detail="Liability, quarter, minimum, or policy limits >90d"
        />
        <MetricCard
          href="/stage-suggestions"
          icon={Sparkles}
          label="Stage suggestions"
          value={String(metrics.stageSuggestionsOpen)}
          detail="Signals awaiting attorney confirmation"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Case Tracker Score</CardTitle>
            <CardDescription>
              Average case score across active matters — 40% completeness, 60% fields validated within 90 days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AttorneyScoreRollupCard
              records={records}
              goals={goals}
              users={users}
              highlightAttorneyId={viewer.isAttorney ? viewer.contactId : null}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Attorney Goal Progress</CardTitle>
            <CardDescription>Annual pacing for gross settlements disbursed vs top-down goal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {goalProgress.map((item) => {
              const attorney = users.find((user) => user.id === item.goal.attorneyId);

              return (
                <div key={item.goal.id} className="rounded-lg border bg-white p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-navy-950">{attorney?.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Plan {formatCurrency(item.planGross)} · Gross disbursed {formatCurrency(item.actualGrossDisbursed)}
                      </p>
                    </div>
                    <Badge variant={item.pace === "ahead" ? "success" : "warning"}>
                      {item.pace === "ahead" ? "Ahead of pace" : "Behind pace"}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Annual goal progress</span>
                      <span>
                        {percent(item.annualProgress)} of {formatCurrency(item.goal.annualGrossGoal)}
                      </span>
                    </div>
                    <Progress value={item.annualProgress} />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Year elapsed</span>
                      <span>{percent(item.yearElapsed)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
