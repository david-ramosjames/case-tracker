"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getGoalYearOptions } from "@/lib/case-options";
import { type AppUser, type AttorneyGoal } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

type GoalDraft = {
  attorneyId: string;
  q1Goal: string;
  q2Goal: string;
  q3Goal: string;
  q4Goal: string;
};

function parseGoalAmount(value: string) {
  const numeric = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function sumQuarterGoals(values: Pick<GoalDraft, "q1Goal" | "q2Goal" | "q3Goal" | "q4Goal">) {
  return parseGoalAmount(values.q1Goal) + parseGoalAmount(values.q2Goal) + parseGoalAmount(values.q3Goal) + parseGoalAmount(values.q4Goal);
}

export function AttorneyGoalsManager({ users, goals }: { users: AppUser[]; goals: AttorneyGoal[] }) {
  const router = useRouter();
  const yearOptions = useMemo(() => getGoalYearOptions(), []);
  const attorneys = useMemo(() => users.filter((user) => user.role === "attorney"), [users]);

  const [selectedYear, setSelectedYear] = useState(yearOptions[yearOptions.length - 1] ?? new Date().getFullYear());
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAttorneyId, setNewAttorneyId] = useState(attorneys[0]?.id ?? "");
  const [newGoals, setNewGoals] = useState({ q1Goal: "", q2Goal: "", q3Goal: "", q4Goal: "" });
  const [drafts, setDrafts] = useState<Record<string, GoalDraft>>({});

  const goalsForYear = useMemo(() => goals.filter((goal) => goal.year === selectedYear), [goals, selectedYear]);

  function getDraft(goal: AttorneyGoal): GoalDraft {
    return (
      drafts[goal.id] ?? {
        attorneyId: goal.attorneyId,
        q1Goal: String(goal.q1Goal || ""),
        q2Goal: String(goal.q2Goal || ""),
        q3Goal: String(goal.q3Goal || ""),
        q4Goal: String(goal.q4Goal || ""),
      }
    );
  }

  function updateDraft(goalId: string, patch: Partial<GoalDraft>) {
    const goal = goalsForYear.find((item) => item.id === goalId);
    if (!goal) return;
    setDrafts((current) => ({
      ...current,
      [goalId]: { ...getDraft(goal), ...patch },
    }));
  }

  async function saveGoal(attorneyId: string, attorneyName: string, values: GoalDraft) {
    const response = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attorneyId,
        attorneyName,
        year: selectedYear,
        annualFeeGoal: sumQuarterGoals(values),
        q1Goal: parseGoalAmount(values.q1Goal),
        q2Goal: parseGoalAmount(values.q2Goal),
        q3Goal: parseGoalAmount(values.q3Goal),
        q4Goal: parseGoalAmount(values.q4Goal),
      }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Unable to save goal.");
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

  async function handleAddGoal() {
    const attorney = attorneys.find((user) => user.id === newAttorneyId);
    if (!attorney) {
      setErrorMessage("Select an attorney.");
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await saveGoal(attorney.id, attorney.name, {
        attorneyId: attorney.id,
        q1Goal: newGoals.q1Goal,
        q2Goal: newGoals.q2Goal,
        q3Goal: newGoals.q3Goal,
        q4Goal: newGoals.q4Goal,
      });
      setShowAddForm(false);
      setNewGoals({ q1Goal: "", q2Goal: "", q3Goal: "", q4Goal: "" });
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
              Enter quarterly fee goals for each attorney. Annual is calculated automatically as Q1 + Q2 + Q3 + Q4.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm font-medium text-navy-950">
              Year
              <Select className="min-w-[6rem]" value={String(selectedYear)} onChange={(event) => setSelectedYear(Number(event.target.value))}>
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
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="mb-3 text-sm font-medium text-navy-950">New goal for {selectedYear}</p>
            <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
              <label>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Attorney</span>
                <Select value={newAttorneyId} onChange={(event) => setNewAttorneyId(event.target.value)}>
                  {attorneys.map((attorney) => (
                    <option key={attorney.id} value={attorney.id}>
                      {attorney.name}
                    </option>
                  ))}
                </Select>
              </label>
              <AnnualTotal label="Annual (sum)" amount={sumQuarterGoals(newGoals)} />
              <GoalInput label={`Q1 ${selectedYear}`} value={newGoals.q1Goal} onChange={(value) => setNewGoals((c) => ({ ...c, q1Goal: value }))} />
              <GoalInput label={`Q2 ${selectedYear}`} value={newGoals.q2Goal} onChange={(value) => setNewGoals((c) => ({ ...c, q2Goal: value }))} />
              <GoalInput label={`Q3 ${selectedYear}`} value={newGoals.q3Goal} onChange={(value) => setNewGoals((c) => ({ ...c, q3Goal: value }))} />
              <GoalInput label={`Q4 ${selectedYear}`} value={newGoals.q4Goal} onChange={(value) => setNewGoals((c) => ({ ...c, q4Goal: value }))} />
            </div>
            <Button className="mt-3" variant="pink" size="sm" onClick={handleAddGoal} disabled={isSaving}>
              Save new goal
            </Button>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Attorney</TableHead>
                <TableHead>Annual ({selectedYear})</TableHead>
                <TableHead>Q1 {selectedYear}</TableHead>
                <TableHead>Q2 {selectedYear}</TableHead>
                <TableHead>Q3 {selectedYear}</TableHead>
                <TableHead>Q4 {selectedYear}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {goalsForYear.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    No goals for {selectedYear}. Click <strong>Add goal</strong> or import from the CSV template.
                  </TableCell>
                </TableRow>
              ) : (
                goalsForYear.map((goal) => {
                  const attorney = attorneys.find((user) => user.id === goal.attorneyId);
                  const draft = getDraft(goal);

                  return (
                    <TableRow key={goal.id}>
                      <TableCell className="font-semibold">{attorney?.name ?? "Unknown attorney"}</TableCell>
                      <TableCell>
                        <AnnualTotal compact amount={sumQuarterGoals(draft)} />
                      </TableCell>
                      <TableCell>
                        <GoalInput compact value={draft.q1Goal} onChange={(value) => updateDraft(goal.id, { q1Goal: value })} />
                      </TableCell>
                      <TableCell>
                        <GoalInput compact value={draft.q2Goal} onChange={(value) => updateDraft(goal.id, { q2Goal: value })} />
                      </TableCell>
                      <TableCell>
                        <GoalInput compact value={draft.q3Goal} onChange={(value) => updateDraft(goal.id, { q3Goal: value })} />
                      </TableCell>
                      <TableCell>
                        <GoalInput compact value={draft.q4Goal} onChange={(value) => updateDraft(goal.id, { q4Goal: value })} />
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => handleSaveExisting(goal)} disabled={isSaving}>
                          <Save className="h-4 w-4" />
                          Save
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground">
          Saved total for {selectedYear}:{" "}
          <Badge variant="outline">
            {formatCurrency(goalsForYear.reduce((sum, goal) => sum + goal.q1Goal + goal.q2Goal + goal.q3Goal + goal.q4Goal, 0))} annual
            {" "}
            (sum of quarters)
          </Badge>
        </p>
      </CardContent>
    </Card>
  );
}

function AnnualTotal({ label, amount, compact }: { label?: string; amount: number; compact?: boolean }) {
  return (
    <div>
      {label ? <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span> : null}
      <div
        className={
          compact
            ? "flex h-9 min-w-[6rem] items-center rounded-md border border-input bg-muted/40 px-2 text-xs font-semibold text-navy-950"
            : "flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-semibold text-navy-950"
        }
        title="Sum of Q1–Q4"
      >
        {formatCurrency(amount)}
      </div>
    </div>
  );
}

function GoalInput({
  label,
  value,
  onChange,
  compact,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <label>
      {label ? <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span> : null}
      <Input
        className={compact ? "h-9 min-w-[6rem] text-xs" : undefined}
        inputMode="decimal"
        placeholder="0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
