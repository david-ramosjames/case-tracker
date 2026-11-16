"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FIRM_WEEKLY_METRICS, defaultFirmWeeklyTarget } from "@/lib/performance/firm-metrics";
import {
  ATTORNEY_SCORE_METRICS,
  PARALEGAL_SCORE_METRICS,
} from "@/lib/performance/person-scorecard";
import {
  DEFAULT_ATTORNEY_TARGETS,
  DEFAULT_PARALEGAL_TARGETS,
} from "@/lib/performance/scoring";
import { type PerformanceStaffDates } from "@/lib/performance/staff-dates";
import { filterAttorneys, filterParalegals } from "@/lib/performance/staff-roles";
import { resolveTargetValue } from "@/lib/performance/targets";
import {
  type PerformanceAssumptions,
  type PerformancePair,
  type PerformanceTarget,
} from "@/lib/performance/types";
import { chicagoTodayYmd, weekStartMondayCt } from "@/lib/performance/weeks";
import { type AppUser } from "@/lib/types";

export function PerformanceSettingsView({
  initialAssumptions,
  initialTargets,
  users,
  initialStaffDates,
  initialPairs,
}: {
  initialAssumptions: PerformanceAssumptions;
  initialTargets: PerformanceTarget[];
  users: AppUser[];
  initialStaffDates: PerformanceStaffDates[];
  initialPairs: PerformancePair[];
}) {
  const [assumptions, setAssumptions] = useState(initialAssumptions);
  const [targets, setTargets] = useState(initialTargets);
  const [staffDates, setStaffDates] = useState(initialStaffDates);
  const [pairs, setPairs] = useState(initialPairs);
  const attorneys = filterAttorneys(users);
  const paralegals = filterParalegals(users);
  const [pairDraft, setPairDraft] = useState({
    attorneyContactId: "",
    paralegalContactId: "",
    attorneyLabel: "",
    paralegalLabel: "",
    effectiveFrom: weekStartMondayCt(),
  });
  const [signedGoal, setSignedGoal] = useState(() => {
    const hit = initialTargets.find(
      (t) => t.metricKey === "signed_case" && t.periodGrain === "month" && t.scope === "firm" && !t.effectiveTo,
    );
    return String(hit?.targetValue ?? 40);
  });
  const [lag, setLag] = useState(String(initialAssumptions.settlementToDisburseLagDays));
  const [agingTarget, setAgingTarget] = useState(String(initialAssumptions.agingTargetDays));
  const [agingWarn, setAgingWarn] = useState(String(initialAssumptions.agingWarnDays));
  const [staffDrafts, setStaffDrafts] = useState(() =>
    Object.fromEntries(
      users.map((u) => {
        const row = initialStaffDates.find((s) => s.contactId === u.id);
        return [
          u.id,
          { start: row?.employmentStartDate ?? "", end: row?.employmentEndDate ?? "" },
        ];
      }),
    ) as Record<string, { start: string; end: string }>,
  );
  const [weeklyGoals, setWeeklyGoals] = useState(() =>
    Object.fromEntries(
      FIRM_WEEKLY_METRICS.map((metric) => {
        const open = initialTargets.find(
          (t) =>
            t.metricKey === metric.key &&
            t.periodGrain === "week" &&
            t.scope === "firm" &&
            !t.effectiveTo,
        );
        return [metric.key, String(open?.targetValue ?? metric.defaultTarget)];
      }),
    ) as Record<string, string>,
  );
  const [weeklyEffectiveFrom, setWeeklyEffectiveFrom] = useState(weekStartMondayCt());
  const [roleEffectiveFrom, setRoleEffectiveFrom] = useState(weekStartMondayCt());
  const [paralegalRoleGoals, setParalegalRoleGoals] = useState(() =>
    Object.fromEntries(
      PARALEGAL_SCORE_METRICS.map((m) => {
        const open = initialTargets.find(
          (t) =>
            t.metricKey === m.key &&
            t.periodGrain === "week" &&
            t.scope === "role" &&
            t.scopeRole === "paralegal" &&
            !t.effectiveTo,
        );
        return [m.key, String(open?.targetValue ?? DEFAULT_PARALEGAL_TARGETS[m.key])];
      }),
    ) as Record<string, string>,
  );
  const [attorneyRoleGoals, setAttorneyRoleGoals] = useState(() =>
    Object.fromEntries(
      ATTORNEY_SCORE_METRICS.map((m) => {
        const open = initialTargets.find(
          (t) =>
            t.metricKey === m.key &&
            t.periodGrain === "week" &&
            t.scope === "role" &&
            t.scopeRole === "attorney" &&
            !t.effectiveTo,
        );
        const fallback =
          DEFAULT_ATTORNEY_TARGETS[m.key as keyof typeof DEFAULT_ATTORNEY_TARGETS] ?? 0;
        return [m.key, String(open?.targetValue ?? fallback)];
      }),
    ) as Record<string, string>,
  );
  const [individualPersonId, setIndividualPersonId] = useState(
    () => paralegals[0]?.id ?? attorneys[0]?.id ?? "",
  );
  const [individualEffectiveFrom, setIndividualEffectiveFrom] = useState(weekStartMondayCt());
  const [individualGoals, setIndividualGoals] = useState<Record<string, string>>(() => {
    const personId = paralegals[0]?.id ?? attorneys[0]?.id ?? "";
    const person =
      paralegals.find((u) => u.id === personId) ?? attorneys.find((u) => u.id === personId) ?? null;
    if (!person) return {};
    const isAtty = person.role === "attorney";
    const metrics = isAtty ? ATTORNEY_SCORE_METRICS : PARALEGAL_SCORE_METRICS;
    const role = isAtty ? "attorney" : "paralegal";
    const onDate = weekStartMondayCt();
    return Object.fromEntries(
      metrics.map((m) => [
        m.key,
        String(
          resolveTargetValue({
            targets: initialTargets,
            metricKey: m.key,
            onDate,
            userId: person.id,
            role,
            periodGrain: "week",
          }),
        ),
      ]),
    );
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const individualPerson =
    paralegals.find((u) => u.id === individualPersonId) ??
    attorneys.find((u) => u.id === individualPersonId) ??
    null;
  const individualIsAttorney = individualPerson?.role === "attorney";
  const individualMetrics = individualIsAttorney ? ATTORNEY_SCORE_METRICS : PARALEGAL_SCORE_METRICS;

  function loadIndividualDraft(
    personId: string,
    onDate: string = individualEffectiveFrom,
    sourceTargets: PerformanceTarget[] = targets,
  ) {
    const person =
      paralegals.find((u) => u.id === personId) ?? attorneys.find((u) => u.id === personId) ?? null;
    if (!person) {
      setIndividualGoals({});
      return;
    }
    const isAtty = person.role === "attorney";
    const metrics = isAtty ? ATTORNEY_SCORE_METRICS : PARALEGAL_SCORE_METRICS;
    const role = isAtty ? "attorney" : "paralegal";
    setIndividualGoals(
      Object.fromEntries(
        metrics.map((m) => [
          m.key,
          String(
            resolveTargetValue({
              targets: sourceTargets,
              metricKey: m.key,
              onDate,
              userId: person.id,
              role,
              periodGrain: "week",
            }),
          ),
        ]),
      ),
    );
  }

  async function saveAssumptions() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/performance/assumptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settlementToDisburseLagDays: Number(lag),
          agingTargetDays: Number(agingTarget),
          agingWarnDays: Number(agingWarn),
        }),
      });
      const body = (await res.json()) as { assumptions?: PerformanceAssumptions; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      if (body.assumptions) setAssumptions(body.assumptions);
      setMessage("Assumptions saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveSignedGoal() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const effectiveFrom = `${chicagoTodayYmd().slice(0, 7)}-01`;
      const res = await fetch("/api/performance/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metricKey: "signed_case",
          periodGrain: "month",
          targetValue: Number(signedGoal),
          scope: "firm",
          effectiveFrom,
        }),
      });
      const body = (await res.json()) as { target?: PerformanceTarget; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      if (body.target) setTargets((prev) => [body.target!, ...prev]);
      setMessage("Monthly signed-case goal saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveWeeklyGoals() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      for (const metric of FIRM_WEEKLY_METRICS) {
        const value = Number(weeklyGoals[metric.key] ?? defaultFirmWeeklyTarget(metric.key));
        const res = await fetch("/api/performance/targets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metricKey: metric.key,
            periodGrain: "week",
            targetValue: value,
            scope: "firm",
            effectiveFrom: weeklyEffectiveFrom,
          }),
        });
        const body = (await res.json()) as { target?: PerformanceTarget; error?: string };
        if (!res.ok) throw new Error(body.error ?? `Failed saving ${metric.label}`);
        if (body.target) setTargets((prev) => [body.target!, ...prev]);
      }
      setMessage(`Firm weekly goals saved from ${weeklyEffectiveFrom} forward.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveRoleGoals(kind: "paralegal" | "attorney") {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const metrics = kind === "paralegal" ? PARALEGAL_SCORE_METRICS : ATTORNEY_SCORE_METRICS;
      const draft = kind === "paralegal" ? paralegalRoleGoals : attorneyRoleGoals;
      let nextTargets = targets;
      for (const metric of metrics) {
        const value = Number(draft[metric.key] ?? 0);
        const res = await fetch("/api/performance/targets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metricKey: metric.key,
            periodGrain: "week",
            targetValue: value,
            scope: "role",
            scopeRole: kind,
            effectiveFrom: roleEffectiveFrom,
          }),
        });
        const body = (await res.json()) as { target?: PerformanceTarget; error?: string };
        if (!res.ok) throw new Error(body.error ?? `Failed saving ${metric.label}`);
        if (body.target) nextTargets = [body.target, ...nextTargets];
      }
      setTargets(nextTargets);
      setMessage(`${kind === "paralegal" ? "Paralegal" : "Attorney"} role weekly targets saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveIndividualGoals() {
    if (!individualPerson) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      let nextTargets = targets;
      for (const metric of individualMetrics) {
        const value = Number(individualGoals[metric.key] ?? 0);
        const res = await fetch("/api/performance/targets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metricKey: metric.key,
            periodGrain: "week",
            targetValue: value,
            scope: "user",
            scopeUserId: individualPerson.id,
            effectiveFrom: individualEffectiveFrom,
          }),
        });
        const body = (await res.json()) as { target?: PerformanceTarget; error?: string };
        if (!res.ok) throw new Error(body.error ?? `Failed saving ${metric.label}`);
        if (body.target) nextTargets = [body.target, ...nextTargets];
      }
      setTargets(nextTargets);
      setMessage(`Individual weekly targets saved for ${individualPerson.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function addPair() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/performance/pairs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attorneyContactId: pairDraft.attorneyContactId || null,
          paralegalContactId: pairDraft.paralegalContactId || null,
          attorneyLabel: pairDraft.attorneyContactId ? null : pairDraft.attorneyLabel || "TBD",
          paralegalLabel: pairDraft.paralegalContactId ? null : pairDraft.paralegalLabel || "TBD",
          effectiveFrom: pairDraft.effectiveFrom,
          sortOrder: pairs.length,
        }),
      });
      const body = (await res.json()) as { pair?: PerformancePair; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      if (body.pair) setPairs((prev) => [...prev, body.pair!]);
      setPairDraft((d) => ({ ...d, attorneyContactId: "", paralegalContactId: "", attorneyLabel: "", paralegalLabel: "" }));
      setMessage("Pair saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function endPair(id: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/performance/pairs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, effectiveTo: chicagoTodayYmd() }),
      });
      const body = (await res.json()) as { pair?: PerformancePair; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Update failed");
      if (body.pair) {
        setPairs((prev) => prev.map((p) => (p.id === id ? body.pair! : p)));
      }
      setMessage("Pair ended.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function removePair(id: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/performance/pairs?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Delete failed");
      setPairs((prev) => prev.filter((p) => p.id !== id));
      setMessage("Pair removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  function contactName(id: string | null, fallback: string | null) {
    if (id) return users.find((u) => u.id === id)?.name ?? fallback ?? "Unknown";
    return fallback || "TBD";
  }

  async function saveStaff(contactId: string) {
    const draft = staffDrafts[contactId];
    if (!draft) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/performance/staff-dates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          employmentStartDate: draft.start || null,
          employmentEndDate: draft.end || null,
        }),
      });
      const body = (await res.json()) as { staffDates?: PerformanceStaffDates; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      if (body.staffDates) {
        setStaffDates((prev) => {
          const next = prev.filter((row) => row.contactId !== contactId);
          return [...next, body.staffDates!];
        });
      }
      setMessage("Staff dates saved (Performance table only).");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Reporting assumptions</CardTitle>
          <CardDescription>
            Settlement-to-disbursement lag for Jon fee projections (default 6 weeks). Aging target for Overview tables.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Lag days</span>
            <Input value={lag} onChange={(e) => setLag(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Aging target days</span>
            <Input value={agingTarget} onChange={(e) => setAgingTarget(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Aging warn days</span>
            <Input value={agingWarn} onChange={(e) => setAgingWarn(e.target.value)} />
          </label>
          <Button disabled={busy} onClick={() => void saveAssumptions()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save assumptions
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Firm monthly signed-case goal</CardTitle>
          <CardDescription>Effective from the first of the current month. Prior open rows are closed.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Goal</span>
            <Input value={signedGoal} onChange={(e) => setSignedGoal(e.target.value)} className="w-32" />
          </label>
          <Button disabled={busy} onClick={() => void saveSignedGoal()}>
            Save signed goal
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Firm weekly activity goals</CardTitle>
          <CardDescription>
            Team rollup targets (DS OUT, Lawsuit, Discovery, …). Saving closes prior open goals and applies from the
            effective Monday forward — past weeks keep their old targets.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="inline-flex flex-col gap-1 text-sm">
            <span className="font-medium">Effective from (Monday)</span>
            <Input
              type="date"
              className="w-44"
              value={weeklyEffectiveFrom}
              onChange={(e) => setWeeklyEffectiveFrom(e.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {FIRM_WEEKLY_METRICS.map((metric) => (
              <label key={metric.key} className="space-y-1 text-sm">
                <span className="font-medium">
                  {metric.label} <span className="font-normal text-muted-foreground">/wk</span>
                </span>
                <Input
                  value={weeklyGoals[metric.key] ?? String(metric.defaultTarget)}
                  onChange={(e) =>
                    setWeeklyGoals((cur) => ({
                      ...cur,
                      [metric.key]: e.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <Button disabled={busy} onClick={() => void saveWeeklyGoals()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save weekly goals
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Individual / role weekly scorecard targets</CardTitle>
          <CardDescription>
            These drive Paralegal and Attorney board scorecards (last week, expected this week, 13-week trend).
            Resolution order: person override → role default → workbook defaults (para 1/1/2/3). Firm Team goals
            above stay separate.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <label className="inline-flex flex-col gap-1 text-sm">
            <span className="font-medium">Role defaults effective from (Monday)</span>
            <Input
              type="date"
              className="w-44"
              value={roleEffectiveFrom}
              onChange={(e) => setRoleEffectiveFrom(e.target.value)}
            />
          </label>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-navy-950">Paralegal role defaults</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {PARALEGAL_SCORE_METRICS.map((metric) => (
                <label key={metric.key} className="space-y-1 text-sm">
                  <span className="font-medium">{metric.label}</span>
                  <Input
                    value={paralegalRoleGoals[metric.key] ?? ""}
                    onChange={(e) =>
                      setParalegalRoleGoals((cur) => ({ ...cur, [metric.key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            <Button disabled={busy} variant="outline" onClick={() => void saveRoleGoals("paralegal")}>
              Save paralegal role targets
            </Button>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-navy-950">Attorney role defaults</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ATTORNEY_SCORE_METRICS.map((metric) => (
                <label key={metric.key} className="space-y-1 text-sm">
                  <span className="font-medium">{metric.label}</span>
                  <Input
                    value={attorneyRoleGoals[metric.key] ?? ""}
                    onChange={(e) =>
                      setAttorneyRoleGoals((cur) => ({ ...cur, [metric.key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            <Button disabled={busy} variant="outline" onClick={() => void saveRoleGoals("attorney")}>
              Save attorney role targets
            </Button>
          </div>

          <div className="space-y-3 border-t pt-6">
            <h3 className="text-sm font-semibold text-navy-950">Per-person overrides</h3>
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Person</span>
                <select
                  className="block min-w-[14rem] rounded-md border px-3 py-2"
                  value={individualPersonId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setIndividualPersonId(id);
                    loadIndividualDraft(id);
                  }}
                >
                  <optgroup label="Paralegals">
                    {paralegals.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Attorneys">
                    {attorneys.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Effective from</span>
                <Input
                  type="date"
                  className="w-44"
                  value={individualEffectiveFrom}
                  onChange={(e) => {
                    const next = e.target.value;
                    setIndividualEffectiveFrom(next);
                    if (individualPersonId) loadIndividualDraft(individualPersonId, next);
                  }}
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  individualPersonId && loadIndividualDraft(individualPersonId, individualEffectiveFrom)
                }
              >
                Reload resolved values
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {individualMetrics.map((metric) => (
                <label key={metric.key} className="space-y-1 text-sm">
                  <span className="font-medium">{metric.label}</span>
                  <Input
                    value={individualGoals[metric.key] ?? ""}
                    onChange={(e) =>
                      setIndividualGoals((cur) => ({ ...cur, [metric.key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            <Button disabled={busy || !individualPerson} onClick={() => void saveIndividualGoals()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save {individualPerson?.name ?? "person"} targets
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fee goals</CardTitle>
          <CardDescription>
            Quarterly attorney fee goals stay on the existing Goals screen. Performance does not replace `/goals` math.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/goals">Open Goals</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Attorney–paralegal pairs</CardTitle>
          <CardDescription>
            Baseline roster for reference. Day-to-day team changes belong on Team → “This week’s pairs” (copy last
            week, swap seats). One TBD keeps the seat; TBD + TBD is vacant. Pair check history is stored per week.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Paralegal</span>
              <select
                className="w-full rounded-md border px-3 py-2"
                value={pairDraft.paralegalContactId}
                onChange={(e) => setPairDraft((d) => ({ ...d, paralegalContactId: e.target.value }))}
              >
                <option value="">TBD / label</option>
                {paralegals.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Attorney</span>
              <select
                className="w-full rounded-md border px-3 py-2"
                value={pairDraft.attorneyContactId}
                onChange={(e) => setPairDraft((d) => ({ ...d, attorneyContactId: e.target.value }))}
              >
                <option value="">TBD / label</option>
                {attorneys.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            {!pairDraft.paralegalContactId ? (
              <label className="space-y-1 text-sm">
                <span className="font-medium">Paralegal label</span>
                <Input
                  value={pairDraft.paralegalLabel}
                  onChange={(e) => setPairDraft((d) => ({ ...d, paralegalLabel: e.target.value }))}
                  placeholder="TBD"
                />
              </label>
            ) : null}
            {!pairDraft.attorneyContactId ? (
              <label className="space-y-1 text-sm">
                <span className="font-medium">Attorney label</span>
                <Input
                  value={pairDraft.attorneyLabel}
                  onChange={(e) => setPairDraft((d) => ({ ...d, attorneyLabel: e.target.value }))}
                  placeholder="TBD"
                />
              </label>
            ) : null}
            <label className="space-y-1 text-sm">
              <span className="font-medium">Effective from</span>
              <Input
                type="date"
                value={pairDraft.effectiveFrom}
                onChange={(e) => setPairDraft((d) => ({ ...d, effectiveFrom: e.target.value }))}
              />
            </label>
          </div>
          <Button disabled={busy} onClick={() => void addPair()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Add pair
          </Button>
          <div className="space-y-2">
            {pairs.map((pair) => (
              <div key={pair.id} className="flex flex-wrap items-center gap-2 border-b py-2 text-sm">
                <span className="min-w-[14rem] font-medium">
                  {contactName(pair.paralegalContactId, pair.paralegalLabel)} +{" "}
                  {contactName(pair.attorneyContactId, pair.attorneyLabel)}
                </span>
                <span className="text-muted-foreground">
                  from {pair.effectiveFrom}
                  {pair.effectiveTo ? ` to ${pair.effectiveTo}` : " · active"}
                </span>
                {!pair.effectiveTo ? (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void endPair(pair.id)}>
                    End
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void removePair(pair.id)}>
                  Delete
                </Button>
              </div>
            ))}
            {pairs.length === 0 ? <p className="text-muted-foreground">No pairs configured yet.</p> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Staff employment dates</CardTitle>
          <CardDescription>
            Stored only in `performance_staff_dates`. Last day affects headcount math only — never case assignments.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {users.map((user) => {
            const draft = staffDrafts[user.id] ?? { start: "", end: "" };
            return (
              <div key={user.id} className="flex flex-wrap items-end gap-2 border-b py-2">
                <div className="min-w-[10rem] font-medium">{user.name}</div>
                <label className="space-y-1 text-xs">
                  Start
                  <Input
                    type="date"
                    value={draft.start}
                    onChange={(e) =>
                      setStaffDrafts((cur) => ({
                        ...cur,
                        [user.id]: { ...draft, start: e.target.value },
                      }))
                    }
                  />
                </label>
                <label className="space-y-1 text-xs">
                  End
                  <Input
                    type="date"
                    value={draft.end}
                    onChange={(e) =>
                      setStaffDrafts((cur) => ({
                        ...cur,
                        [user.id]: { ...draft, end: e.target.value },
                      }))
                    }
                  />
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void saveStaff(user.id)}
                >
                  Save
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent target rows</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {targets.slice(0, 12).map((t) => (
            <div key={t.id} className="flex flex-wrap gap-2 border-b py-2">
              <span className="font-medium">{t.metricKey}</span>
              <span>
                {t.targetValue} ({t.periodGrain})
              </span>
              <span className="text-muted-foreground">
                {t.scope}
                {t.scopeRole ? `/${t.scopeRole}` : ""} · from {t.effectiveFrom}
                {t.effectiveTo ? ` to ${t.effectiveTo}` : ""}
              </span>
            </div>
          ))}
          {targets.length === 0 ? <p className="text-muted-foreground">No targets saved yet.</p> : null}
        </CardContent>
      </Card>

      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <p className="text-xs text-muted-foreground">Current lag setting: {assumptions.settlementToDisburseLagDays} days</p>
    </div>
  );
}
