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
import { formatCurrency, formatNumberInput, parseNumberInput } from "@/lib/utils";

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
  return parseNumberInput(value);
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
    commissionThreshold: goal.commissionThreshold > 0 ? formatNumberInput(goal.commissionThreshold) : "",
    endMonth: String(endMonth),
    endYear: String(endYear),
    monthCount: String(monthCount),
    annualGrossGoalTotal: annualTotal > 0 ? formatNumberInput(annualTotal) : "",
    annualRjlFeesGoalTotal: annualFeeTotal > 0 ? formatNumberInput(annualFeeTotal) : "",
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
          <div className="space-y-5">
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
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b bg-muted/30 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-base font-semibold text-navy-950">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {periodLabel}
            <span className="text-muted-foreground/70"> · starts {formatMonthKeyLabel(draft.monthKeys[0] ?? "")}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <SummaryPill label="Gross disbursements" value={formatCurrency(annualTotal)} />
          <SummaryPill label="RJL fees" value={formatCurrency(annualFeeTotal)} />
        </div>
      </div>

      <div className="space-y-6 px-5 py-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Ends in month">
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
          </Field>
          <Field label="Ends in year">
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
          </Field>
          <Field label="Months in period">
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
          </Field>
          <Field label="Commission threshold">
            <GoalAmountInput
              value={draft.commissionThreshold}
              onChange={(value) => onDraftChange({ ...draft, commissionThreshold: value })}
            />
            <span className="mt-1 block text-[11px] leading-tight text-muted-foreground">
              RJL fees disbursed before commissions start
            </span>
          </Field>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <GoalMetricSection
            title="Gross disbursements"
            annualLabel="Annual goal"
            annualValue={draft.annualGrossGoalTotal}
            onAnnualChange={(value) => onDraftChange({ ...draft, annualGrossGoalTotal: value })}
            onSpread={spreadGrossTotal}
            spreadDisabled={!draft.annualGrossGoalTotal.trim()}
            monthCount={draft.monthKeys.length}
            monthKeys={draft.monthKeys}
            monthlyValues={draft.monthlyValues}
            onMonthlyChange={(monthKey, value) =>
              onDraftChange({
                ...draft,
                monthlyValues: { ...draft.monthlyValues, [monthKey]: value },
              })
            }
            quarterSummaries={quarterSummaries}
          />
          <GoalMetricSection
            title="RJL attorney fees"
            annualLabel="Annual goal"
            annualValue={draft.annualRjlFeesGoalTotal}
            onAnnualChange={(value) => onDraftChange({ ...draft, annualRjlFeesGoalTotal: value })}
            onSpread={spreadFeeTotal}
            spreadDisabled={!draft.annualRjlFeesGoalTotal.trim()}
            monthCount={draft.monthKeys.length}
            monthKeys={draft.monthKeys}
            monthlyValues={draft.monthlyFeeValues}
            onMonthlyChange={(monthKey, value) =>
              onDraftChange({
                ...draft,
                monthlyFeeValues: { ...draft.monthlyFeeValues, [monthKey]: value },
              })
            }
            quarterSummaries={feeQuarterSummaries}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 border-t bg-muted/20 px-5 py-3">{actions}</div>
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-semibold text-navy-950">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function GoalMetricSection({
  title,
  annualLabel,
  annualValue,
  onAnnualChange,
  onSpread,
  spreadDisabled,
  monthCount,
  monthKeys,
  monthlyValues,
  onMonthlyChange,
  quarterSummaries,
}: {
  title: string;
  annualLabel: string;
  annualValue: string;
  onAnnualChange: (value: string) => void;
  onSpread: () => void;
  spreadDisabled: boolean;
  monthCount: number;
  monthKeys: string[];
  monthlyValues: Record<string, string>;
  onMonthlyChange: (monthKey: string, value: string) => void;
  quarterSummaries: ReturnType<typeof getCommissionQuarterSummaries>;
}) {
  return (
    <section className="rounded-lg border bg-muted/10 p-4">
      <h4 className="text-sm font-semibold text-navy-950">{title}</h4>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label={annualLabel}>
          <GoalAmountInput
            className="sm:max-w-[11rem]"
            value={annualValue}
            onChange={onAnnualChange}
          />
        </Field>
        <Button variant="outline" size="sm" className="shrink-0" onClick={onSpread} disabled={spreadDisabled}>
          Spread across {monthCount} months
        </Button>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Monthly targets</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {monthKeys.map((monthKey) => (
            <label key={monthKey}>
              <span className="mb-1 block truncate text-[11px] text-muted-foreground">
                {formatMonthKeyLabel(monthKey)}
              </span>
              <GoalAmountInput
                className="h-9"
                value={monthlyValues[monthKey] ?? ""}
                onChange={(value) => onMonthlyChange(monthKey, value)}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {quarterSummaries.map((summary) => (
          <div key={summary.quarter} className="rounded-md border bg-background px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-navy-950">CY Q{summary.quarter}</span>
              <span className="text-sm font-semibold text-navy-950">{formatCurrency(summary.total)}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{summary.period}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function GoalAmountInput({
  value,
  onChange,
  className,
  placeholder = "0",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <Input
      inputMode="decimal"
      placeholder={placeholder}
      className={className}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => {
        if (value.trim()) onChange(formatNumberInput(value));
      }}
    />
  );
}
