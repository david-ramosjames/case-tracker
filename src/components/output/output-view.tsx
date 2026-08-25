"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type ViewerContext } from "@/lib/auth/access";
import {
  getCurrentCommissionYearGoals,
  getFirmOutputMetrics,
  type FirmCalendarGoalMode,
  type OutputPeriodMode,
} from "@/lib/calculations";
import { formatCommissionYearPeriod } from "@/lib/commission-year";
import { getAttorneyOnlyGoals } from "@/lib/firm-goals";
import { buildOutputAuditCsv, buildOutputAuditRows, downloadOutputAuditCsv } from "@/lib/results-period";
import { getGoalYearOptions } from "@/lib/case-options";
import { type AppUser, type AttorneyGoal, type CaseRecord } from "@/lib/types";
import { formatCurrency, percent } from "@/lib/utils";

const DEFAULT_FIRM_SCOPE = "firm:combined";

type OutputScope =
  | { kind: "attorney"; attorneyId: string }
  | { kind: "firm"; goalMode: FirmCalendarGoalMode };

function attorneyScopeValue(attorneyId: string) {
  return `attorney:${attorneyId}`;
}

function parseOutputScope(value: string): OutputScope {
  if (value.startsWith("attorney:")) {
    return { kind: "attorney", attorneyId: value.slice("attorney:".length) };
  }
  if (value === "firm:attorneys") return { kind: "firm", goalMode: "attorneys" };
  if (value === "firm:combined") return { kind: "firm", goalMode: "combined" };
  return { kind: "firm", goalMode: "outperform" };
}

function outputScopeToValue(scope: OutputScope) {
  if (scope.kind === "attorney") return attorneyScopeValue(scope.attorneyId);
  if (scope.goalMode === "attorneys") return "firm:attorneys";
  if (scope.goalMode === "combined") return "firm:combined";
  return "firm:outperform";
}

export function OutputView({
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
  const [scopeValue, setScopeValue] = useState(() =>
    lockedAttorneyId ? attorneyScopeValue(lockedAttorneyId) : DEFAULT_FIRM_SCOPE,
  );
  const [periodMode, setPeriodMode] = useState<OutputPeriodMode>(lockedAttorneyId ? "commission" : "calendar");
  const [periodYear, setPeriodYear] = useState(() => new Date().getFullYear());

  useEffect(() => {
    if (!lockedAttorneyId) return;
    setScopeValue(attorneyScopeValue(lockedAttorneyId));
  }, [lockedAttorneyId]);

  const scope = useMemo(() => {
    const parsed = parseOutputScope(scopeValue);
    if (lockedAttorneyId) {
      return { kind: "attorney" as const, attorneyId: lockedAttorneyId };
    }
    return parsed;
  }, [lockedAttorneyId, scopeValue]);
  const isFirmScope = scope.kind === "firm";
  const selectedAttorneyId = scope.kind === "attorney" ? scope.attorneyId : null;
  const firmCalendarGoalMode = scope.kind === "firm" ? scope.goalMode : undefined;

  const attorneys = users.filter((user) => user.role === "attorney");
  const attorneyOptions = lockedAttorneyId
    ? attorneys.filter((user) => user.id === lockedAttorneyId)
    : attorneys;
  const attorneyOnlyGoals = useMemo(() => getAttorneyOnlyGoals(goals), [goals]);
  const yearOptions = useMemo(() => getGoalYearOptions(), []);

  const filteredRecords = useMemo(() => {
    if (!selectedAttorneyId) return records;
    return records.filter((record) => record.shared.attorneyId === selectedAttorneyId);
  }, [records, selectedAttorneyId]);

  const attorneyIds = useMemo(
    () =>
      selectedAttorneyId
        ? [selectedAttorneyId]
        : [...new Set(filteredRecords.map((record) => record.shared.attorneyId))],
    [filteredRecords, selectedAttorneyId],
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
      if (!selectedAttorneyId || goal.attorneyId === selectedAttorneyId) years.add(goal.year);
    }
    return [...years].sort((left, right) => right - left);
  }, [attorneyOnlyGoals, periodYear, selectedAttorneyId, yearOptions]);

  useEffect(() => {
    if (isFirmScope) {
      setPeriodMode("calendar");
      setPeriodYear(new Date().getFullYear());
      return;
    }

    setPeriodMode("commission");
    const attorneyGoal = attorneyOnlyGoals
      .filter((goal) => goal.attorneyId === selectedAttorneyId)
      .sort((left, right) => right.year - left.year)[0];
    if (attorneyGoal) {
      setPeriodYear(attorneyGoal.year);
    }
  }, [attorneyOnlyGoals, isFirmScope, selectedAttorneyId]);

  const output = useMemo(
    () =>
      getFirmOutputMetrics(
        filteredRecords,
        periodMode === "calendar" ? attorneyOnlyGoals : scopedCommissionGoals,
        {
          periodMode,
          periodYear,
          pipelineGoals: goals,
          scopedAttorneyIds: attorneyIds,
          firmCalendarGoalMode,
        },
      ),
    [attorneyIds, attorneyOnlyGoals, filteredRecords, firmCalendarGoalMode, goals, periodMode, periodYear, scopedCommissionGoals],
  );
  const { results } = output;

  const periodLabel = useMemo(() => {
    if (periodMode === "calendar") return String(periodYear);
    const anchorGoal =
      (selectedAttorneyId
        ? attorneyOnlyGoals.find((goal) => goal.attorneyId === selectedAttorneyId && goal.year === periodYear)
        : undefined) ??
      scopedCommissionGoals.find((goal) => goal.year === periodYear) ??
      scopedCommissionGoals[0];
    if (anchorGoal) {
      return formatCommissionYearPeriod(anchorGoal.year, anchorGoal.commissionYearStartMonth, anchorGoal.commissionMonthCount);
    }
    return String(periodYear);
  }, [attorneyOnlyGoals, periodMode, periodYear, scopedCommissionGoals, selectedAttorneyId]);

  const periodDescription =
    periodMode === "calendar"
      ? `${periodYear} calendar year — Disbursed uses disburse dates in that year. Settled includes disbursed amounts plus open undisbursed settlements.`
      : `${periodLabel} commission year — Disbursed uses disburse dates in that period. Settled includes disbursed amounts plus open undisbursed settlements.`;

  const goalsByAttorney = useMemo(() => {
    const map = new Map<string, AttorneyGoal>();
    for (const attorneyId of attorneyIds) {
      const goal =
        (periodMode === "commission"
          ? attorneyOnlyGoals.find((item) => item.attorneyId === attorneyId && item.year === periodYear)
          : undefined) ??
        attorneyOnlyGoals
          .filter((item) => item.attorneyId === attorneyId)
          .sort((left, right) => right.year - left.year)[0];
      if (goal) map.set(attorneyId, goal);
    }
    return map;
  }, [attorneyIds, attorneyOnlyGoals, periodMode, periodYear]);

  function handleDownloadAuditCsv() {
    const rows = buildOutputAuditRows(filteredRecords, {
      mode: periodMode,
      periodYear,
      periodLabel,
      goalsByAttorney,
      attorneyGoals: attorneyOnlyGoals,
    });
    const csv = buildOutputAuditCsv(rows);
    const scopeSlug = selectedScopeLabel.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    downloadOutputAuditCsv(csv, `output-audit-${scopeSlug}-${periodMode}-${periodYear}.csv`);
  }

  const goalDetailSuffix = useMemo(() => {
    if (periodMode === "calendar") {
      if (isFirmScope) {
        if (firmCalendarGoalMode === "combined") {
          return "goal (attorneys + Outperform for this calendar year)";
        }
        if (firmCalendarGoalMode === "outperform") {
          return "Outperform goal (calendar year portion)";
        }
        return "goal (sum of attorney targets in this calendar year)";
      }
      return "goal (sum of monthly targets in this calendar year)";
    }
    return results.firmOutperformGoal ? "Outperform goal" : "attorney annual goal";
  }, [firmCalendarGoalMode, isFirmScope, periodMode, results.firmOutperformGoal]);

  const rjlFeesGoalDetailSuffix = useMemo(() => {
    if (periodMode === "calendar") {
      if (isFirmScope) {
        if (firmCalendarGoalMode === "combined") {
          return "RJL fees goal (attorneys + Outperform for this calendar year)";
        }
        if (firmCalendarGoalMode === "outperform") {
          return "Outperform RJL fees goal (calendar year portion)";
        }
        return "RJL fees goal (sum of attorney targets in this calendar year)";
      }
      return "RJL fees goal (sum of monthly targets in this calendar year)";
    }
    return results.firmOutperformGoal ? "Outperform RJL fees goal" : "attorney annual RJL fees goal";
  }, [firmCalendarGoalMode, isFirmScope, periodMode, results.firmOutperformGoal]);

  const selectedScopeLabel = useMemo(() => {
    if (scope.kind === "attorney") {
      return attorneyOptions.find((user) => user.id === scope.attorneyId)?.name
        ?? attorneys.find((user) => user.id === scope.attorneyId)?.name
        ?? "Attorney";
    }
    if (scope.goalMode === "attorneys") return "Total attorney";
    if (scope.goalMode === "combined") return "Total Firm (attorney + outperform)";
    return "Firm Outperformance";
  }, [attorneyOptions, attorneys, scope]);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex flex-wrap items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-navy-950">Filters</span>
            </div>
            <p className="text-sm text-muted-foreground lg:ml-auto">
              Showing {filteredRecords.length} of {records.length} cases · {selectedScopeLabel}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={handleDownloadAuditCsv}>
              <Download className="mr-2 h-4 w-4" />
              Download audit CSV
            </Button>
          </div>
          <div className={`mt-3 grid gap-3 ${selectedAttorneyId ? "sm:grid-cols-2 lg:grid-cols-3 lg:max-w-4xl" : "sm:grid-cols-2 lg:max-w-2xl"}`}>
            {lockedAttorneyId ? (
              <div
                className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-medium text-navy-950"
                aria-label="View"
              >
                {selectedScopeLabel}
              </div>
            ) : (
              <Select value={outputScopeToValue(scope)} onChange={(event) => setScopeValue(event.target.value)} aria-label="View">
                {attorneyOptions.map((item) => (
                  <option key={item.id} value={attorneyScopeValue(item.id)}>
                    {item.name}
                  </option>
                ))}
                <option value="firm:attorneys">Total attorney</option>
                <option value="firm:outperform">Firm Outperformance</option>
                <option value="firm:combined">Total Firm (attorney + outperform)</option>
              </Select>
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
            {selectedAttorneyId ? (
              <Select
                value={periodMode}
                onChange={(event) => setPeriodMode(event.target.value as OutputPeriodMode)}
                aria-label="Period type"
              >
                <option value="calendar">Calendar year</option>
                <option value="commission">Commission year</option>
              </Select>
            ) : null}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{periodDescription}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <SummaryCard label="Target (top-down)" value={formatCurrency(results.annualGrossGoal)} detail={`${periodLabel} ${goalDetailSuffix}`} />
        <SummaryCard
          label="RJL Fees Target (top-down)"
          value={formatCurrency(results.annualRjlFeesGoal)}
          detail={`${periodLabel} ${rjlFeesGoalDetailSuffix}`}
        />
        <SummaryCard
          label="Plan (bottom-up)"
          value={formatCurrency(results.planGross)}
          detail={
            periodMode === "calendar"
              ? `Forecast gross disbursements from active cases targeting ${periodYear}`
              : "Forecast gross disbursements from active cases in this commission year"
          }
        />
        <SummaryCard label="Gross Settlement $" value={formatCurrency(results.grossSettled)} detail="Disbursed in period plus open undisbursed settlements" />
        <SummaryCard label="Gross Disbursed" value={formatCurrency(results.grossDisbursed)} detail="Gross settlement dollars disbursed in period" />
        <SummaryCard label="RJL Fees (Settled)" value={formatCurrency(results.feesSettled)} detail="Fees on disbursed + open undisbursed settlements" />
        <SummaryCard label="RJL Fees Disbursed" value={formatCurrency(results.feesDisbursed)} detail="Net RJL attorney fees disbursed in period" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Results vs Goals</CardTitle>
          <CardDescription>
            {periodDescription} Disbursed columns drive goal progress for {selectedScopeLabel}.
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
                label="Gross Settlement $"
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
