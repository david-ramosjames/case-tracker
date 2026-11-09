import {
  AlertTriangle,
  Banknote,
  BriefcaseBusiness,
  CircleDollarSign,
  ClipboardCheck,
  Frown,
  MessageCircleWarning,
  Phone,
  Scale,
  Sparkles,
  TimerReset,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AttorneyScoreRollupCard } from "@/components/attorney-score/attorney-score-rollup";
import { MetricCard, MetricSection } from "@/components/dashboard/metric-card";
import { type ViewerContext } from "@/lib/auth/access";
import { getAttorneyGoalProgress, getDashboardMetrics } from "@/lib/calculations";
import { type DashboardNavMetrics } from "@/lib/dashboard/nav-metrics";
import { type AppUser, type AttorneyGoal, type CaseRecord, type CaseTrackerSettings } from "@/lib/types";
import { formatCurrency, percent } from "@/lib/utils";

export function DashboardView({
  records,
  goals,
  settings,
  users,
  viewer,
  navMetrics,
}: {
  records: CaseRecord[];
  goals: AttorneyGoal[];
  settings: CaseTrackerSettings;
  users: AppUser[];
  viewer: ViewerContext;
  navMetrics: DashboardNavMetrics;
}) {
  const metrics = getDashboardMetrics(records, settings, goals);
  const goalProgress = getAttorneyGoalProgress(records, goals).filter((item) => {
    if (viewer.isAttorney && viewer.contactId) {
      return item.goal.attorneyId === viewer.contactId;
    }
    return true;
  });

  return (
    <div className="space-y-5">
      <MetricSection title="Cases">
        <MetricCard
          href="/cases"
          icon={BriefcaseBusiness}
          label="Active cases"
          value={String(metrics.totalActiveCases)}
          detail="Open pipeline (excludes closed and historical)"
        />
        <MetricCard
          href="/cases?filter=missing-fields&status=Active"
          icon={AlertTriangle}
          label="Missing required fields"
          value={String(metrics.casesMissingRequiredFields)}
          detail="Value, fee, quarter, source, confidence"
        />
        <MetricCard
          href="/cases?filter=stale-review&status=Active"
          icon={TimerReset}
          label="Not reviewed recently"
          value={String(metrics.casesNotReviewedRecently)}
          detail={`Case review older than ${settings.staleReviewThresholdDays} days`}
        />
        <MetricCard
          href="/cases?filter=quarterly-check-in&status=Active"
          icon={ClipboardCheck}
          label="Quarterly check-ins due"
          value={String(metrics.casesNeedingQuarterlyCheckIn)}
          detail="Expected disbursement quarter / minimum value"
        />
        <MetricCard
          href="/cases?filter=validation-overdue&status=Active"
          icon={TimerReset}
          label="Validation overdue"
          value={String(metrics.casesWithOutdatedValidation)}
          detail="Liability, quarter, minimum, or policy limits >90d"
        />
      </MetricSection>

      <MetricSection title="Contact">
        <MetricCard
          href="/client-contact?tab=calls"
          icon={Phone}
          label="Clients 30+ days"
          value={String(navMetrics.clientsNeedingContact)}
          detail="No 60-second call or text exchange in 30 days"
          alert={navMetrics.clientsNeedingContact > 0}
        />
        <MetricCard
          href="/client-contact?tab=sentiment&sentiment=Negative"
          icon={Frown}
          label="Negative sentiment"
          value={String(navMetrics.negativeSentiment)}
          detail="Current negative Quo contact readings"
          alert={navMetrics.negativeSentiment > 0}
        />
        <MetricCard
          href="/needs-response"
          icon={MessageCircleWarning}
          label="Needs response"
          value={String(navMetrics.needsResponse)}
          detail="Missed/Sona, callbacks, and texts still owed"
          alert={navMetrics.needsResponse > 0}
        />
      </MetricSection>

      <MetricSection title="Suggestions · Litigation · Results">
        <MetricCard
          href="/stage-suggestions"
          icon={Sparkles}
          label="Suggestions"
          value={String(metrics.stageSuggestionsOpen)}
          detail="Stage signals awaiting attorney confirmation"
          alert={metrics.stageSuggestionsOpen > 0}
        />
        <MetricCard
          href="/litigation"
          icon={Scale}
          label="Litigation"
          value={String(navMetrics.litigationCases)}
          detail="Cases on the Litigation events tracker"
        />
        <MetricCard
          href="/results?disbursed=No"
          icon={ClipboardCheck}
          label="Settled not disbursed"
          value={formatCurrency(metrics.settledNotDisbursedAmount)}
          detail="Results needing collection follow-through"
        />
      </MetricSection>

      <MetricSection title="Output · Goals">
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
      </MetricSection>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
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
          <CardHeader className="pb-3">
            <CardTitle>Attorney Goal Progress</CardTitle>
            <CardDescription>Annual pacing for gross disbursements vs top-down goal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {goalProgress.map((item) => {
              const attorney = users.find((user) => user.id === item.goal.attorneyId);

              return (
                <div key={item.goal.id} className="rounded-lg border bg-white p-3.5">
                  <div className="mb-2 flex items-start justify-between gap-3">
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
