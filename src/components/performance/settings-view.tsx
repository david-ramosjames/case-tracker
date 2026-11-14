"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type PerformanceStaffDates } from "@/lib/performance/staff-dates";
import { type PerformanceAssumptions, type PerformanceTarget } from "@/lib/performance/types";
import { chicagoTodayYmd } from "@/lib/performance/weeks";
import { type AppUser } from "@/lib/types";

export function PerformanceSettingsView({
  initialAssumptions,
  initialTargets,
  users,
  initialStaffDates,
}: {
  initialAssumptions: PerformanceAssumptions;
  initialTargets: PerformanceTarget[];
  users: AppUser[];
  initialStaffDates: PerformanceStaffDates[];
}) {
  const [assumptions, setAssumptions] = useState(initialAssumptions);
  const [targets, setTargets] = useState(initialTargets);
  const [staffDates, setStaffDates] = useState(initialStaffDates);
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
