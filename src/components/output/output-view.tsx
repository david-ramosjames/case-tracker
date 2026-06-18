"use client";

import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getCurrentCommissionYearGoals,
  getFirmOutputMetrics,
  type OutputPeriodMode,
} from "@/lib/calculations";
import { formatCommissionYearPeriod } from "@/lib/commission-year";
import { getAttorneyOnlyGoals } from "@/lib/firm-goals";
import { getGoalYearOptions } from "@/lib/case-options";
import { type AppUser, type AttorneyGoal, type CaseRecord } from "@/lib/types";
import { formatCurrency, percent } from "@/lib/utils";

export function OutputView({
  records,
  goals,
  users,
}: {
  records: CaseRecord[];
  goals: AttorneyGoal[];
  users: AppUser[];
}) {
  const [attorney, setAttorney] = useState("all");
  const [paralegal, setParalegal] = useState("all");
  const [periodMode, setPeriodMode] = useState<OutputPeriodMode>("calendar");
  const [periodYear, setPeriodYear] = useState(() => new Date().getFullYear());

  const attorneys = users.filter((user) => user.role === "attorney");
  const paralegals = users.filter((user) => user.role === "paralegal");
  const attorneyOnlyGoals = useMemo(() => getAttorneyOnlyGoals(goals), [goals]);
  const yearOptions = useMemo(() => getGoalYearOptions(), []);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      if (attorney !== "all" && record.shared.attorneyId !== attorney) return false;
      if (paralegal !== "all" && record.shared.paralegalId !== paralegal) return false;
      return true;
    });
  }, [attorney, paralegal, records]);

  const attorneyIds = useMemo(
    () =>
      attorney !== "all"
        ? [attorney]
        : [...new Set(filteredRecords.map((record) => record.shared.attorneyId))],
    [attorney, filteredRecords],
  );

  const scopedCommissionGoals = useMemo(() => {
    if (periodMode === "commission") {
      return attorneyIds
        .map((attorneyId) => attorneyOnlyGoals.find((goal) => goal.attorneyId === attorneyId && goal.year === periodYear))
        .filter((goal): goal is AttorneyGoal => goal != null);
    }
    return getCurrentCommissionYearGoals(attorneyOnlyGoals, attorneyIds);
  }, [attorneyIds, attorneyOnlyGoals, periodMode, periodYear]);

  const commissionYearOptions = useMemo(() => {
    const years = new Set<number>([...yearOptions, periodYear, new Date().getFullYear()]);
    for (const goal of attorneyOnlyGoals) {
      if (attorney === "all" || goal.attorneyId === attorney) years.add(goal.year);
    }
    return [...years].sort((left, right) => right - left);
  }, [attorney, attorneyOnlyGoals, periodYear, yearOptions]);

  useEffect(() => {
    if (attorney === "all") {
      setPeriodMode("calendar");
      setPeriodYear(new Date().getFullYear());
      return;
    }

    setPeriodMode("commission");
    const attorneyGoal = attorneyOnlyGoals
      .filter((goal) => goal.attorneyId === attorney)
      .sort((left, right) => right.year - left.year)[0];
    if (attorneyGoal) {
      setPeriodYear(attorneyGoal.year);
    }
  }, [attorney, attorneyOnlyGoals]);

  const output = useMemo(
    () =>
      getFirmOutputMetrics(
        filteredRecords,
        periodMode === "calendar" ? attorneyOnlyGoals : scopedCommissionGoals,
        {
          periodMode,
          periodYear,
          pipelineGoals: attorneyOnlyGoals,
        },
      ),
    [attorneyOnlyGoals, filteredRecords, periodMode, periodYear, scopedCommissionGoals],
  );
  const { results } = output;

  const periodLabel = useMemo(() => {
    if (periodMode === "calendar") return String(periodYear);
    const anchorGoal =
      (attorney !== "all"
        ? attorneyOnlyGoals.find((goal) => goal.attorneyId === attorney && goal.year === periodYear)
        : undefined) ??
      scopedCommissionGoals.find((goal) => goal.year === periodYear) ??
      scopedCommissionGoals[0];
    if (anchorGoal) {
      return formatCommissionYearPeriod(anchorGoal.year, anchorGoal.commissionYearStartMonth, anchorGoal.commissionMonthCount);
    }
    return String(periodYear);
  }, [attorney, attorneyOnlyGoals, periodMode, periodYear, scopedCommissionGoals]);

  const periodDescription =
    periodMode === "calendar"
      ? `${periodYear} calendar year — settled and disbursed amounts use settlement/disburse dates in that year.`
      : `${periodLabel} commission year — amounts use each attorney's commission period.`;

  const goalDetailSuffix =
    periodMode === "calendar"
      ? "goal (sum of monthly targets in this calendar year)"
      : results.firmOutperformGoal
        ? "Outperform goal"
        : "gross disbursements goal";

  const activeFilterCount = [attorney !== "all", paralegal !== "all"].filter(Boolean).length;
  const selectedAttorneyName = attorneys.find((user) => user.id === attorney)?.name;
  const selectedParalegalName = paralegals.find((user) => user.id === paralegal)?.name;

  function clearFilters() {
    setAttorney("all");
    setParalegal("all");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex flex-wrap items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-navy-950">Filters</span>
              {activeFilterCount > 0 ? <Badge variant="pink">{activeFilterCount}</Badge> : null}
              {activeFilterCount > 0 ? (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear
                </Button>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground lg:ml-auto">
              Showing {filteredRecords.length} of {records.length} cases
              {selectedAttorneyName ? ` · ${selectedAttorneyName}` : ""}
              {selectedParalegalName ? ` · ${selectedParalegalName}` : ""}
            </p>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:max-w-4xl">
            <Select value={attorney} onChange={(event) => setAttorney(event.target.value)} aria-label="Attorney">
              <option value="all">All attorneys</option>
              {attorneys.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
            <Select value={paralegal} onChange={(event) => setParalegal(event.target.value)} aria-label="Paralegal">
              <option value="all">All paralegals</option>
              {paralegals.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
            {attorney !== "all" ? (
              <Select
                value={periodMode}
                onChange={(event) => setPeriodMode(event.target.value as OutputPeriodMode)}
                aria-label="Period type"
              >
                <option value="calendar">Calendar year</option>
                <option value="commission">Commission year</option>
              </Select>
            ) : (
              <div className="flex items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                Calendar year (firm total)
              </div>
            )}
            <Select
              value={String(periodYear)}
              onChange={(event) => setPeriodYear(Number(event.target.value))}
              aria-label={periodMode === "calendar" ? "Calendar year" : "Commission year"}
            >
              {(periodMode === "calendar" ? yearOptions : commissionYearOptions).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{periodDescription}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <SummaryCard label="Target (top-down)" value={formatCurrency(results.annualGrossGoal)} detail={`${periodLabel} ${goalDetailSuffix}`} />
        <SummaryCard
          label="Plan (bottom-up)"
          value={formatCurrency(results.planGross)}
          detail={
            periodMode === "calendar"
              ? `Forecast gross disbursements from active cases targeting ${periodYear}`
              : "Forecast gross disbursements from active cases in this commission year"
          }
        />
        <SummaryCard label="Gross Settled" value={formatCurrency(results.grossSettled)} detail="Settlement amounts signed in period" />
        <SummaryCard label="Gross Disbursed" value={formatCurrency(results.grossDisbursed)} detail="Settlement dollars disbursed in period" />
        <SummaryCard label="RJL Fees Settled" value={formatCurrency(results.feesSettled)} detail="Attorney fees on cases settled in period" />
        <SummaryCard label="RJL Fees Disbursed" value={formatCurrency(results.feesDisbursed)} detail="Attorney fees disbursed in period" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Results vs Goals</CardTitle>
          <CardDescription>
            {periodDescription} Gross disbursements and RJL fees tracked vs top-down goals
            {attorney !== "all" || paralegal !== "all" ? " (filtered)." : "."}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Settled</TableHead>
                <TableHead>Disbursed</TableHead>
                <TableHead>Full Year Goal</TableHead>
                <TableHead>% of Goal</TableHead>
                <TableHead>% of Goal Settled</TableHead>
                <TableHead>% of Year Complete</TableHead>
                <TableHead>Pacing Goal</TableHead>
                <TableHead>% of Pacing Goal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <ResultsRow
                label="Gross Disbursements"
                settled={results.grossSettled}
                disbursed={results.grossDisbursed}
                fullYearGoal={results.annualGrossGoal}
                pacingGoal={results.pacingGrossGoal}
                yearElapsed={results.yearElapsed}
              />
              <ResultsRow
                label="RJL Attorney Fees"
                settled={results.feesSettled}
                disbursed={results.feesDisbursed}
                fullYearGoal={results.annualRjlFeesGoal}
                pacingGoal={results.pacingFeesGoal}
                yearElapsed={results.yearElapsed}
              />
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <CardHeader>
            <CardTitle>Case Status Rollup</CardTitle>
            <CardDescription>Active pipeline snapshot by case stage — total matches dashboard active cases.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case Status</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead>% of Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {output.caseStatuses.rows.map((row) => (
                  <TableRow key={row.label}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell>{row.count}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-24">
                          <Progress value={row.percentOfTotal} />
                        </div>
                        {percent(row.percentOfTotal)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="font-semibold">{output.caseStatuses.total}</TableCell>
                  <TableCell className="font-semibold">100%</TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <MiniStat label="Completed Disbursements" value={String(results.completedDisbursements)} variant="success" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Commission Overview</CardTitle>
            <CardDescription>Disbursed fees compared with the commission threshold.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <SummaryCard label="Commission Threshold" value={formatCurrency(results.commissionThreshold)} detail="RJL attorney fees disbursed before commissions start" />
            <SummaryCard label="Commissionable Amount" value={formatCurrency(results.commissionableAmount)} detail="RJL fees disbursed above threshold" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-navy-950">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function ResultsRow({
  label,
  settled,
  disbursed,
  fullYearGoal,
  pacingGoal,
  yearElapsed,
}: {
  label: string;
  settled: number;
  disbursed: number;
  fullYearGoal: number;
  pacingGoal: number;
  yearElapsed: number;
}) {
  return (
    <TableRow>
      <TableCell className="font-semibold">{label}</TableCell>
      <TableCell>{formatCurrency(settled)}</TableCell>
      <TableCell>{formatCurrency(disbursed)}</TableCell>
      <TableCell>{formatCurrency(fullYearGoal)}</TableCell>
      <TableCell>{percent(fullYearGoal > 0 ? (disbursed / fullYearGoal) * 100 : 0)}</TableCell>
      <TableCell>{percent(fullYearGoal > 0 ? (settled / fullYearGoal) * 100 : 0)}</TableCell>
      <TableCell>{percent(yearElapsed)}</TableCell>
      <TableCell>{formatCurrency(pacingGoal)}</TableCell>
      <TableCell>{percent(pacingGoal > 0 ? (disbursed / pacingGoal) * 100 : 0)}</TableCell>
    </TableRow>
  );
}

function MiniStat({ label, value, variant = "outline" }: { label: string; value: string; variant?: "success" | "warning" | "outline" }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Badge className="mt-2" variant={variant}>
        {value}
      </Badge>
    </div>
  );
}
