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
import { getAttorneyGoalProgress, getDashboardMetrics, getDataQualityFlags } from "@/lib/calculations";
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
  const metrics = getDashboardMetrics(records, settings);
  const goalProgress = getAttorneyGoalProgress(records, goals);
  const flaggedCases = records
    .map((record) => ({ record, flags: getDataQualityFlags(record, settings) }))
    .filter((item) => item.flags.length > 0)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          icon={BriefcaseBusiness}
          label="Active cases"
          value={String(metrics.totalActiveCases)}
          detail="Tracker entries marked active"
        />
        <MetricCard
          icon={CircleDollarSign}
          label="Forecasted settlement"
          value={formatCurrency(metrics.totalForecastSettlementValue)}
          detail="Open pipeline settlement value"
        />
        <MetricCard
          icon={Banknote}
          label="Forecasted fees"
          value={formatCurrency(metrics.totalForecastFeeValue)}
          detail="Projected attorney fee value"
        />
        <MetricCard
          icon={ClipboardCheck}
          label="Settled not disbursed"
          value={formatCurrency(metrics.settledNotDisbursedAmount)}
          detail="Needs collection follow-through"
        />
        <MetricCard
          icon={AlertTriangle}
          label="Missing required fields"
          value={String(metrics.casesMissingRequiredFields)}
          detail="Value, fee, quarter, source, confidence"
        />
        <MetricCard
          icon={TimerReset}
          label="Not reviewed recently"
          value={String(metrics.casesNotReviewedRecently)}
          detail={`More than ${settings.staleReviewThresholdDays} days old`}
        />
        <MetricCard
          icon={ClipboardCheck}
          label="Quarterly check-ins due"
          value={String(metrics.casesNeedingQuarterlyCheckIn)}
          detail="Quarter, minimum value, recent activity"
        />
        <MetricCard
          icon={TimerReset}
          label="Validation overdue"
          value={String(metrics.casesWithOutdatedValidation)}
          detail="Liability, quarter, minimum, or policy limits >90d"
        />
        <MetricCard
          icon={Sparkles}
          label="Stage suggestions"
          value={String(metrics.stageSuggestionsOpen)}
          detail="Signals awaiting attorney confirmation"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Attorney score</CardTitle>
          <CardDescription>
            Average case score across active matters — 40% completeness, 60% fields validated within 90 days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AttorneyScoreRollupCard
            records={records}
            users={users}
            highlightAttorneyId={viewer.isAttorney ? viewer.contactId : null}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Attorney Goal Progress</CardTitle>
            <CardDescription>Annual and quarter pacing against actual settled fees.</CardDescription>
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
                        Forecast {formatCurrency(item.forecastedFees)} - Disbursed {formatCurrency(item.actualDisbursedFees)}
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
                        {percent(item.annualProgress)} of {formatCurrency(item.goal.annualFeeGoal)}
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

        <Card>
          <CardHeader>
            <CardTitle>Data Quality Watchlist</CardTitle>
            <CardDescription>Cases needing attorney or manager attention.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {flaggedCases.map(({ record, flags }) => (
              <div key={record.shared.id} className="rounded-lg border bg-white p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-navy-950">{record.shared.clientName}</p>
                    <p className="text-xs text-muted-foreground">
                      {record.shared.caseNumber} - {record.attorney.name}
                    </p>
                  </div>
                  <Badge variant="outline">{record.tracker.caseStage}</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {flags.slice(0, 3).map((flag) => (
                    <Badge key={flag.id} variant={flag.severity}>
                      {flag.label}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
