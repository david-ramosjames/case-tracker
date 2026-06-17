"use client";

import { type ReactNode, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  deriveQuarterGoalsFromMonthly,
  formatGoalPeriodLabel,
  formatMonthKeyLabel,
  getCommissionPeriodEndFromStart,
  getCommissionPeriodFromEnd,
  getCommissionQuarterSummaries,
  inferCommissionMonthCount,
  monthlyGoalInputFromResolved,
  parseMonthlyGoalsInput,
  resolveMonthlyGoals,
  resolveMonthlyFeeGoals,
  spreadEvenMonthlyGoals,
} from "@/lib/attorney-goal-months";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getGoalYearOptions } from "@/lib/case-options";
import { COMMISSION_PERIOD_MONTH_OPTIONS, COMMISSION_YEAR_MONTH_OPTIONS } from "@/lib/commission-year";
import { type AppUser, type AttorneyGoal } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

type GoalDraft = {
  attorneyId: string;
  commissionThreshold: string;
  endMonth: string;
  endYear: string;
  monthCount: string;
  annualGrossGoalTotal: string;
  annualRjlFeesGoalTotal: string;
  monthKeys: string[];
  monthlyValues: Record<string, string>;
  monthlyFeeValues: Record<string, string>;
};

function parseGoalAmount(value: string) {
  const numeric = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function sumDraftMonthlyGoals(draft: Pick<GoalDraft, "monthKeys" | "monthlyValues">) {
  return draft.monthKeys.reduce((total, monthKey) => total + parseGoalAmount(draft.monthlyValues[monthKey] ?? ""), 0);
}

function sumDraftMonthlyFeeGoals(draft: Pick<GoalDraft, "monthKeys" | "monthlyFeeValues">) {
  return draft.monthKeys.reduce((total, monthKey) => total + parseGoalAmount(draft.monthlyFeeValues[monthKey] ?? ""), 0);
}

function getPeriodFromDraft(draft: GoalDraft) {
  return getCommissionPeriodFromEnd(
    Number(draft.endMonth || 12),
    Number(draft.endYear || new Date().getFullYear()),
    Number(draft.monthCount || 12),
  );
}

function applyPeriodChange(draft: GoalDraft, patch: Partial<Pick<GoalDraft, "endMonth" | "endYear" | "monthCount">>) {
  const nextDraft = { ...draft, ...patch };
  const period = getPeriodFromDraft(nextDraft);
  const monthlyValues = spreadEvenMonthlyGoals(parseGoalAmount(nextDraft.annualGrossGoalTotal), period.monthKeys);
  const monthlyFeeValues = spreadEvenMonthlyGoals(parseGoalAmount(nextDraft.annualRjlFeesGoalTotal), period.monthKeys);
  return {
    ...nextDraft,
    monthKeys: period.monthKeys,
    monthlyValues,
    monthlyFeeValues,
  };
}

function buildDraftFromGoal(goal: AttorneyGoal): GoalDraft {
  const monthCount = inferCommissionMonthCount(goal);
  const startMonth = goal.commissionYearStartMonth ?? 1;
  const { endYear, endMonth } = getCommissionPeriodEndFromStart(goal.year, startMonth, monthCount);
  const resolved =
    goal.monthlyGoals && Object.keys(goal.monthlyGoals).length > 0 ? goal.monthlyGoals : resolveMonthlyGoals(goal);
  const resolvedFees =
    goal.monthlyFeeGoals && Object.keys(goal.monthlyFeeGoals).length > 0
      ? goal.monthlyFeeGoals
      : resolveMonthlyFeeGoals(goal);
  const period = getCommissionPeriodFromEnd(endMonth, endYear, monthCount);
  const annualTotal = Object.values(resolved).reduce((sum, value) => sum + value, 0);
  const annualFeeTotal = Object.values(resolvedFees).reduce((sum, value) => sum + value, 0);

  return {
    attorneyId: goal.attorneyId,
    commissionThreshold: String(Math.round(goal.commissionThreshold)),
    endMonth: String(endMonth),
    endYear: String(endYear),
    monthCount: String(monthCount),
    annualGrossGoalTotal: annualTotal > 0 ? String(Math.round(annualTotal)) : "",
    annualRjlFeesGoalTotal: annualFeeTotal > 0 ? String(Math.round(annualFeeTotal)) : "",
    monthKeys: period.monthKeys,
    monthlyValues: monthlyGoalInputFromResolved(
      Object.fromEntries(period.monthKeys.map((monthKey) => [monthKey, resolved[monthKey] ?? 0])),
    ),
    monthlyFeeValues: monthlyGoalInputFromResolved(
      Object.fromEntries(period.monthKeys.map((monthKey) => [monthKey, resolvedFees[monthKey] ?? 0])),
    ),
  };
}

function createEmptyDraft(attorneyId: string, endYear: number): GoalDraft {
  const endMonth = 12;
  const period = getCommissionPeriodFromEnd(endMonth, endYear, 12);
  return {
    attorneyId,
    commissionThreshold: "",
    endMonth: String(endMonth),
    endYear: String(endYear),
    monthCount: "12",
    annualGrossGoalTotal: "",
    annualRjlFeesGoalTotal: "",
    monthKeys: period.monthKeys,
    monthlyValues: {},
    monthlyFeeValues: {},
  };
}

export function AttorneyGoalsManager({
  users,
  goals,
  canDeleteGoals = false,
}: {
  users: AppUser[];
  goals: AttorneyGoal[];
  canDeleteGoals?: boolean;
}) {
  const router = useRouter();
  const yearOptions = useMemo(() => getGoalYearOptions(), []);
  const endYearOptions = useMemo(() => [...yearOptions, yearOptions[yearOptions.length - 1] + 1], [yearOptions]);
  const attorneys = useMemo(() => users.filter((user) => user.role === "attorney"), [users]);

  const defaultEndYear = yearOptions[yearOptions.length - 1] ?? new Date().getFullYear();
  const [yearFilter, setYearFilter] = useState<number | "all">("all");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingGoalId, setDeletingGoalId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAttorneyId, setNewAttorneyId] = useState(attorneys[0]?.id ?? "");
  const [newDraft, setNewDraft] = useState(() => createEmptyDraft(attorneys[0]?.id ?? "", defaultEndYear));
  const [drafts, setDrafts] = useState<Record<string, GoalDraft>>({});

  const displayedGoals = useMemo(() => {
    const filtered = yearFilter === "all" ? goals : goals.filter((goal) => goal.year === yearFilter);
    return [...filtered].sort((left, right) => {
      if (right.year !== left.year) return right.year - left.year;
      const leftName = attorneys.find((user) => user.id === left.attorneyId)?.name ?? "";
      const rightName = attorneys.find((user) => user.id === right.attorneyId)?.name ?? "";
      return leftName.localeCompare(rightName);
    });
  }, [attorneys, goals, yearFilter]);

  function getDraft(goal: AttorneyGoal): GoalDraft {
    return drafts[goal.id] ?? buildDraftFromGoal(goal);
  }

  function updateDraft(goalId: string, patch: Partial<GoalDraft> | ((current: GoalDraft) => GoalDraft)) {
    const goal = displayedGoals.find((item) => item.id === goalId);
    if (!goal) return;
    setDrafts((current) => {
      const existing = current[goalId] ?? buildDraftFromGoal(goal);
      const next = typeof patch === "function" ? patch(existing) : { ...existing, ...patch };
      return { ...current, [goalId]: next };
    });
  }

  async function saveGoal(attorneyId: string, attorneyName: string, draft: GoalDraft) {
    const period = getPeriodFromDraft(draft);
    const monthlyGoals = parseMonthlyGoalsInput(
      Object.fromEntries(period.monthKeys.map((monthKey) => [monthKey, draft.monthlyValues[monthKey] ?? ""])),
    );
    const monthlyFeeGoals = parseMonthlyGoalsInput(
      Object.fromEntries(period.monthKeys.map((monthKey) => [monthKey, draft.monthlyFeeValues[monthKey] ?? ""])),
    );
    const derived = deriveQuarterGoalsFromMonthly(
      monthlyGoals,
      period.commissionYear,
      period.startMonth,
      period.monthCount,
    );
    const derivedFees = deriveQuarterGoalsFromMonthly(
      monthlyFeeGoals,
      period.commissionYear,
      period.startMonth,
      period.monthCount,
    );

    const response = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attorneyId,
        attorneyName,
        year: period.commissionYear,
        annualGrossGoal: derived.annualGrossGoal,
        annualRjlFeesGoal: derivedFees.annualGrossGoal,
        commissionThreshold: parseGoalAmount(draft.commissionThreshold),
        commissionYearStartMonth: period.startMonth,
        commissionMonthCount: period.monthCount,
        monthlyGoals,
        monthlyFeeGoals,
        q1Goal: derived.q1Goal,
        q2Goal: derived.q2Goal,
        q3Goal: derived.q3Goal,
        q4Goal: derived.q4Goal,
        feeQ1Goal: derivedFees.q1Goal,
        feeQ2Goal: derivedFees.q2Goal,
        feeQ3Goal: derivedFees.q3Goal,
        feeQ4Goal: derivedFees.q4Goal,
      }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Unable to save goal.");

    if (yearFilter !== "all" && period.commissionYear !== yearFilter) {
      setYearFilter(period.commissionYear);
    }
  }

  async function handleSaveExisting(goal: AttorneyGoal) {
    const attorney = attorneys.find((user) => user.id === goal.attorneyId);
    if (!attorney) {
      setErrorMessage("Attorney not found for this goal row.");
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await saveGoal(goal.attorneyId, attorney.name, getDraft(goal));
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to save goal.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteGoal(goal: AttorneyGoal) {
    const attorney = attorneys.find((user) => user.id === goal.attorneyId);
    const attorneyLabel = attorney?.name ?? "this attorney";
    if (!window.confirm(`Delete the ${goal.year} goal for ${attorneyLabel}? This cannot be undone.`)) {
      return;
    }

    setDeletingGoalId(goal.id);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/goals/${goal.id}`, { method: "DELETE" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to delete goal.");

      setDrafts((current) => {
        const next = { ...current };
        delete next[goal.id];
        return next;
      });
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to delete goal.");
    } finally {
      setDeletingGoalId(null);
    }
  }

  async function handleAddGoal() {
    const attorney = attorneys.find((user) => user.id === newAttorneyId);
    if (!attorney) {
      setErrorMessage("Select an attorney.");
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await saveGoal(attorney.id, attorney.name, { ...newDraft, attorneyId: attorney.id });
      setShowAddForm(false);
      setNewDraft(createEmptyDraft(newAttorneyId, defaultEndYear));
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to add goal.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
          <div>
            <CardTitle>Attorney Goals</CardTitle>
            <CardDescription>
              Set top-down <strong>gross disbursements</strong> and <strong>RJL attorney fees</strong> goals for each
              commission year. The <strong>commission threshold</strong> is separate — commissions start once disbursed
              fees exceed that amount.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm font-medium text-navy-950">
              Commission year
              <Select
                className="min-w-[6rem]"
                value={String(yearFilter)}
                onChange={(event) => {
                  const value = event.target.value;
                  setYearFilter(value === "all" ? "all" : Number(value));
                }}
              >
                <option value="all">All</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </Select>
            </label>
            <Button variant="outline" size="sm" asChild>
              <a href="/templates/attorney-goals-template.csv" download>
                Download CSV template
              </a>
            </Button>
            <Button variant="pink" size="sm" onClick={() => setShowAddForm((current) => !current)}>
              <Plus className="h-4 w-4" />
              Add goal
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

        {showAddForm ? (
          <div className="space-y-3">
            <label className="block max-w-xs">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Attorney</span>
              <Select
                value={newAttorneyId}
                onChange={(event) => {
                  const attorneyId = event.target.value;
                  setNewAttorneyId(attorneyId);
                  setNewDraft((current) => ({ ...current, attorneyId }));
                }}
              >
                {attorneys.map((attorney) => (
                  <option key={attorney.id} value={attorney.id}>
                    {attorney.name}
                  </option>
                ))}
              </Select>
            </label>
            <GoalEditorCard
              title="New commission goal"
              draft={newDraft}
              endYearOptions={endYearOptions}
              onDraftChange={setNewDraft}
              actions={
                <Button variant="pink" size="sm" onClick={handleAddGoal} disabled={isSaving}>
                  Save new goal
                </Button>
              }
            />
          </div>
        ) : null}

        {displayedGoals.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            {yearFilter === "all" ? (
              <>
                No attorney goals saved yet. Click <strong>Add goal</strong> or import from the CSV template.
              </>
            ) : (
              <>
                No goals for commission year {yearFilter}. Click <strong>Add goal</strong> or import from the CSV template.
              </>
            )}
          </p>
        ) : (
          <div className="space-y-4">
            {displayedGoals.map((goal) => {
              const attorney = attorneys.find((user) => user.id === goal.attorneyId);
              const draft = getDraft(goal);
              const title =
                yearFilter === "all"
                  ? `${attorney?.name ?? "Unknown attorney"} · ${goal.year}`
                  : (attorney?.name ?? "Unknown attorney");

              return (
                <GoalEditorCard
                  key={goal.id}
                  title={title}
                  draft={draft}
                  endYearOptions={endYearOptions}
                  onDraftChange={(next) => updateDraft(goal.id, next)}
                  actions={
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleSaveExisting(goal)} disabled={isSaving || deletingGoalId != null}>
                        <Save className="h-4 w-4" />
                        Save
                      </Button>
                      {canDeleteGoals ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteGoal(goal)}
                          disabled={isSaving || deletingGoalId === goal.id}
                          aria-label={`Delete goal for ${attorney?.name ?? "attorney"}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      ) : null}
                    </div>
                  }
                />
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Saved total{yearFilter === "all" ? "" : ` for ${yearFilter}`}:{" "}
          <Badge variant="outline">
            {formatCurrency(displayedGoals.reduce((sum, goal) => sum + goal.annualGrossGoal, 0))} gross disbursements
          </Badge>
          <Badge variant="outline" className="ml-2">
            {formatCurrency(displayedGoals.reduce((sum, goal) => sum + goal.annualRjlFeesGoal, 0))} RJL fees
          </Badge>
        </p>
      </CardContent>
    </Card>
  );
}

function GoalEditorCard({
  title,
  draft,
  endYearOptions,
  onDraftChange,
  actions,
}: {
  title: string;
  draft: GoalDraft;
  endYearOptions: number[];
  onDraftChange: (draft: GoalDraft) => void;
  actions: ReactNode;
}) {
  const period = getPeriodFromDraft(draft);
  const periodLabel = formatGoalPeriodLabel(period.commissionYear, period.startMonth, period.monthCount);
  const monthlyGoals = parseMonthlyGoalsInput(
    Object.fromEntries(draft.monthKeys.map((monthKey) => [monthKey, draft.monthlyValues[monthKey] ?? ""])),
  );
  const monthlyFeeGoals = parseMonthlyGoalsInput(
    Object.fromEntries(draft.monthKeys.map((monthKey) => [monthKey, draft.monthlyFeeValues[monthKey] ?? ""])),
  );
  const quarterSummaries = getCommissionQuarterSummaries(
    period.commissionYear,
    period.startMonth,
    monthlyGoals,
    period.monthCount,
  );
  const feeQuarterSummaries = getCommissionQuarterSummaries(
    period.commissionYear,
    period.startMonth,
    monthlyFeeGoals,
    period.monthCount,
  );
  const annualTotal = sumDraftMonthlyGoals(draft);
  const annualFeeTotal = sumDraftMonthlyFeeGoals(draft);

  function spreadGrossTotal() {
    onDraftChange({
      ...draft,
      monthlyValues: spreadEvenMonthlyGoals(parseGoalAmount(draft.annualGrossGoalTotal), draft.monthKeys),
    });
  }

  function spreadFeeTotal() {
    onDraftChange({
      ...draft,
      monthlyFeeValues: spreadEvenMonthlyGoals(parseGoalAmount(draft.annualRjlFeesGoalTotal), draft.monthKeys),
    });
  }

  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <p className="text-sm font-semibold text-navy-950">{title}</p>
          <p className="text-xs text-muted-foreground">
            Commission period: {periodLabel}
            <span className="ml-2 text-muted-foreground/80">(starts {formatMonthKeyLabel(draft.monthKeys[0] ?? "")})</span>
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-semibold text-navy-950">
            Gross disbursements: {formatCurrency(annualTotal)}
          </div>
          <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-semibold text-navy-950">
            RJL fees: {formatCurrency(annualFeeTotal)}
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Ends in month</span>
          <Select
            value={draft.endMonth}
            onChange={(event) => onDraftChange(applyPeriodChange(draft, { endMonth: event.target.value }))}
          >
            {COMMISSION_YEAR_MONTH_OPTIONS.map((month) => (
              <option key={month.value} value={month.value}>
                {month.label}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Ends in year</span>
          <Select
            value={draft.endYear}
            onChange={(event) => onDraftChange(applyPeriodChange(draft, { endYear: event.target.value }))}
          >
            {endYearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Months in period</span>
          <Select
            value={draft.monthCount}
            onChange={(event) => onDraftChange(applyPeriodChange(draft, { monthCount: event.target.value }))}
          >
            {COMMISSION_PERIOD_MONTH_OPTIONS.map((count) => (
              <option key={count} value={count}>
                {count} months
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Commission threshold (RJL fees disbursed)</span>
          <Input
            inputMode="decimal"
            placeholder="0"
            value={draft.commissionThreshold}
            onChange={(event) => onDraftChange({ ...draft, commissionThreshold: event.target.value })}
          />
        </label>
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Total gross disbursements goal</span>
          <Input
            inputMode="decimal"
            placeholder="0"
            value={draft.annualGrossGoalTotal}
            onChange={(event) => onDraftChange({ ...draft, annualGrossGoalTotal: event.target.value })}
          />
        </label>
        <Button variant="outline" size="sm" onClick={spreadGrossTotal} disabled={!draft.annualGrossGoalTotal.trim()}>
          Spread evenly across {draft.monthKeys.length} months
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Monthly gross disbursements targets</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {draft.monthKeys.map((monthKey) => (
            <label key={monthKey}>
              <span className="mb-1 block text-xs text-muted-foreground">{formatMonthKeyLabel(monthKey)}</span>
              <Input
                inputMode="decimal"
                placeholder="0"
                value={draft.monthlyValues[monthKey] ?? ""}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    monthlyValues: { ...draft.monthlyValues, [monthKey]: event.target.value },
                  })
                }
              />
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {quarterSummaries.map((summary) => (
          <Badge key={`gross-${summary.quarter}`} variant="outline" className="text-xs">
            Gross CY Q{summary.quarter} ({summary.period}): {formatCurrency(summary.total)}
          </Badge>
        ))}
      </div>

      <div className="my-6 border-t" />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Total RJL attorney fees goal</span>
          <Input
            inputMode="decimal"
            placeholder="0"
            value={draft.annualRjlFeesGoalTotal}
            onChange={(event) => onDraftChange({ ...draft, annualRjlFeesGoalTotal: event.target.value })}
          />
        </label>
        <Button variant="outline" size="sm" onClick={spreadFeeTotal} disabled={!draft.annualRjlFeesGoalTotal.trim()}>
          Spread evenly across {draft.monthKeys.length} months
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Monthly RJL attorney fees targets</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {draft.monthKeys.map((monthKey) => (
            <label key={`fee-${monthKey}`}>
              <span className="mb-1 block text-xs text-muted-foreground">{formatMonthKeyLabel(monthKey)}</span>
              <Input
                inputMode="decimal"
                placeholder="0"
                value={draft.monthlyFeeValues[monthKey] ?? ""}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    monthlyFeeValues: { ...draft.monthlyFeeValues, [monthKey]: event.target.value },
                  })
                }
              />
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {feeQuarterSummaries.map((summary) => (
          <Badge key={`fee-${summary.quarter}`} variant="outline" className="text-xs">
            Fees CY Q{summary.quarter} ({summary.period}): {formatCurrency(summary.total)}
          </Badge>
        ))}
      </div>

      <div className="mt-4">{actions}</div>
    </div>
  );
}
