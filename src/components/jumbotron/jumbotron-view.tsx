"use client";

import { useMemo, useState } from "react";
import {
  ArrowRightLeft,
  BarChart3,
  BriefcaseBusiness,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  Hourglass,
  Percent,
  SlidersHorizontal,
  Timer,
} from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SignedCasesTrendChart } from "@/components/jumbotron/signed-cases-trend-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HeaderMultiFilter } from "@/components/ui/header-filter";
import { Select } from "@/components/ui/select";
import { type ViewerContext } from "@/lib/auth/access";
import { CASE_TYPE_OPTIONS, getGoalYearOptions } from "@/lib/case-options";
import { computeJumbotronMetrics, computeSignedCasesByMonth } from "@/lib/jumbotron-metrics";
import { type AppUser, type AttorneyGoal, type CaseRecord } from "@/lib/types";

export function JumbotronView({
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
  const lockedAttorneyId = viewer.isAttorney ? viewer.contactId : null;
  const [attorneyIds, setAttorneyIds] = useState<string[]>([]);
  const [caseTypes, setCaseTypes] = useState<string[]>([]);
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());

  const attorneys = users.filter((user) => user.role === "attorney");
  const attorneyOptions = lockedAttorneyId
    ? attorneys.filter((user) => user.id === lockedAttorneyId)
    : attorneys;
  const yearOptions = useMemo(() => getGoalYearOptions(), []);

  const filters = useMemo(
    () => ({
      attorneyIds: lockedAttorneyId ? [lockedAttorneyId] : attorneyIds,
      caseTypes,
      calendarYear,
    }),
    [attorneyIds, caseTypes, calendarYear, lockedAttorneyId],
  );

  const metrics = useMemo(() => computeJumbotronMetrics(records, goals, filters), [records, goals, filters]);
  const signedCasesByMonth = useMemo(
    () => computeSignedCasesByMonth(records, filters),
    [records, filters],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-pink-500" />
            <CardTitle className="text-base">Filters</CardTitle>
          </div>
          <CardDescription>
            Open-case metrics use every active pipeline case. Settlement and timing metrics use the selected calendar
            year. Disbursement success is all-time (closed date history is incomplete).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {lockedAttorneyId ? (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Attorney</span>
              <div className="flex h-8 items-center rounded-md border border-input bg-muted/40 px-2 text-xs font-medium text-navy-950">
                {attorneyOptions[0]?.name ?? "You"}
              </div>
            </div>
          ) : (
            <HeaderMultiFilter
              label="Attorneys"
              selected={attorneyIds}
              onChange={setAttorneyIds}
              options={attorneyOptions.map((attorney) => ({ value: attorney.id, label: attorney.name }))}
            />
          )}
          <HeaderMultiFilter
            label="Case types"
            selected={caseTypes}
            onChange={setCaseTypes}
            options={CASE_TYPE_OPTIONS.map((caseType) => ({ value: caseType, label: caseType }))}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Calendar year
            </span>
            <Select
              className="h-8 text-xs"
              value={String(calendarYear)}
              onChange={(event) => setCalendarYear(Number(event.target.value))}
              aria-label="Filter closed cases by calendar year"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="Active cases"
          value={metrics.activeCases.value}
          detail={metrics.activeCases.detail}
          icon={BriefcaseBusiness}
        />
        <MetricCard
          label="Average case age"
          value={metrics.averageCaseAgeDays.value}
          detail={metrics.averageCaseAgeDays.detail}
          icon={Clock3}
        />
        <MetricCard
          label="Average settlement"
          value={metrics.averageSettlement.value}
          detail={metrics.averageSettlement.detail}
          icon={CircleDollarSign}
        />
        <MetricCard
          label="Avg RJL fees"
          value={metrics.averageRjlFees.value}
          detail={metrics.averageRjlFees.detail}
          icon={CircleDollarSign}
        />
        <MetricCard
          label="Days intake → settlement"
          value={metrics.daysIntakeToSettlement.value}
          detail={metrics.daysIntakeToSettlement.detail}
          icon={Hourglass}
        />
        <MetricCard
          label="Days settlement → disbursement"
          value={metrics.daysSettlementToDisbursement.value}
          detail={metrics.daysSettlementToDisbursement.detail}
          icon={ArrowRightLeft}
        />
        <MetricCard
          label="Closed outcomes"
          value={metrics.closedDisbursementSuccess.value}
          detail={metrics.closedDisbursementSuccess.detail}
          icon={Percent}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <BarChart3 className="h-4 w-4 text-pink-500" />
            <CardTitle className="text-base">Signed cases by month</CardTitle>
          </div>
          <CardDescription>
            Cases with a date signed in {calendarYear}, grouped by month. Attorney and case-type filters apply.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignedCasesTrendChart buckets={signedCasesByMonth} calendarYear={calendarYear} />
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm text-muted-foreground">
          <Timer className="h-4 w-4 shrink-0 text-pink-500" />
          <p>
            <span className="font-medium text-navy-950">Intake</span> uses date signed.{" "}
            <span className="font-medium text-navy-950">Settlement</span> and{" "}
            <span className="font-medium text-navy-950">disbursement</span> dates come from the results workflow and
            disbursing sheet sync.
          </p>
          <CalendarClock className="ml-auto h-4 w-4 shrink-0 text-pink-500" />
        </CardContent>
      </Card>
    </div>
  );
}
