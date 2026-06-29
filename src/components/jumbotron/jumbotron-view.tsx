"use client";

import { useMemo, useState } from "react";
import {
  ArrowRightLeft,
  BriefcaseBusiness,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  Hourglass,
  SlidersHorizontal,
  Timer,
} from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HeaderMultiFilter } from "@/components/ui/header-filter";
import { Select } from "@/components/ui/select";
import { CASE_TYPE_OPTIONS, getGoalYearOptions } from "@/lib/case-options";
import { computeJumbotronMetrics } from "@/lib/jumbotron-metrics";
import { type AppUser, type AttorneyGoal, type CaseRecord } from "@/lib/types";

export function JumbotronView({
  records,
  goals,
  users,
}: {
  records: CaseRecord[];
  goals: AttorneyGoal[];
  users: AppUser[];
}) {
  const [attorneyIds, setAttorneyIds] = useState<string[]>([]);
  const [caseTypes, setCaseTypes] = useState<string[]>([]);
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());

  const attorneys = users.filter((user) => user.role === "attorney");
  const yearOptions = useMemo(() => getGoalYearOptions(), []);

  const metrics = useMemo(
    () =>
      computeJumbotronMetrics(records, goals, {
        attorneyIds,
        caseTypes,
        calendarYear,
      }),
    [records, goals, attorneyIds, caseTypes, calendarYear],
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
            Open-case metrics use every active pipeline case. Settlement and timing metrics use closed cases in the
            selected calendar year.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <HeaderMultiFilter
            label="Attorneys"
            selected={attorneyIds}
            onChange={setAttorneyIds}
            options={attorneys.map((attorney) => ({ value: attorney.id, label: attorney.name }))}
          />
          <HeaderMultiFilter
            label="Case types"
            selected={caseTypes}
            onChange={setCaseTypes}
            options={CASE_TYPE_OPTIONS.map((caseType) => ({ value: caseType, label: caseType }))}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Closed-case year
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
      </div>

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
