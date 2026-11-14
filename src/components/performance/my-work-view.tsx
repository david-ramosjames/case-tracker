"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PersonSwitcher } from "@/components/performance/person-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DELIVERABLE_TYPE_LABELS,
  PERFORMANCE_DELIVERABLE_TYPES,
  type PerformanceCommitment,
  type PerformanceDeliverable,
  type PerformanceDeliverableType,
} from "@/lib/performance/types";
import { weekEndFromStart } from "@/lib/performance/weeks";
import { type AppUser } from "@/lib/types";

type Props = {
  initialDeliverables: PerformanceDeliverable[];
  initialCommitments: PerformanceCommitment[];
  weekStart: string;
  lastWeekStart: string;
  selectedPerson: AppUser | null;
  viewerContactId: string | null;
  canBrowsePeople: boolean;
  people: AppUser[];
  viewingAsAttorney: boolean;
  caseOptions: Array<{ id: string; caseNumber: string; clientName: string; paralegalId: string; attorneyId: string }>;
  nameById: Record<string, string>;
};

function typeLabel(type: PerformanceDeliverableType) {
  return DELIVERABLE_TYPE_LABELS[type] ?? type;
}

function inWeek(ymd: string | null | undefined, weekStart: string) {
  if (!ymd) return false;
  const day = ymd.slice(0, 10);
  return day >= weekStart && day <= weekEndFromStart(weekStart);
}

export function MyWorkView({
  initialDeliverables,
  initialCommitments,
  weekStart,
  lastWeekStart,
  selectedPerson,
  viewerContactId,
  canBrowsePeople,
  people,
  viewingAsAttorney,
  caseOptions,
  nameById,
}: Props) {
  const [deliverables, setDeliverables] = useState(initialDeliverables);
  const [commitments, setCommitments] = useState(initialCommitments);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    caseId: "",
    deliverableType: "demand_sent" as PerformanceDeliverableType,
    documentLabel: "",
    roundNumber: "",
    litPersonName: "",
    hearingType: "",
    requestedCompletionDate: "",
    notes: "",
  });

  const commitmentByDeliverable = useMemo(() => {
    const map = new Map<string, PerformanceCommitment>();
    for (const c of commitments) {
      if (c.outcome === "promised" || c.outcome === "completed") {
        map.set(c.deliverableId, c);
      }
    }
    return map;
  }, [commitments]);

  const finishedLastWeek = useMemo(
    () =>
      deliverables
        .filter((d) => d.workflowStatus === "done" && inWeek(d.completedAt, lastWeekStart))
        .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    [deliverables, lastWeekStart],
  );

  const thisWeekCommitted = useMemo(
    () =>
      deliverables.filter((d) => {
        if (d.workflowStatus !== "committed") return false;
        const commitment = commitmentByDeliverable.get(d.id);
        return commitment?.weekStart === weekStart;
      }),
    [deliverables, commitmentByDeliverable, weekStart],
  );

  const backlog = useMemo(
    () => deliverables.filter((d) => d.workflowStatus === "backlog"),
    [deliverables],
  );

  async function refresh() {
    if (!selectedPerson) return;
    const params = new URLSearchParams({
      personId: selectedPerson.id,
      asAttorney: viewingAsAttorney ? "1" : "0",
      completedSince: lastWeekStart,
    });
    const res = await fetch(`/api/performance/deliverables?${params}`);
    const body = (await res.json()) as { deliverables?: PerformanceDeliverable[]; error?: string };
    if (!res.ok) throw new Error(body.error ?? "Refresh failed");
    setDeliverables(body.deliverables ?? []);
  }

  async function createItem() {
    setError(null);
    setBusyId("create");
    try {
      const selected = caseOptions.find((c) => c.id === form.caseId);
      const res = await fetch("/api/performance/deliverables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: form.caseId || null,
          caseNumber: selected?.caseNumber ?? "TBD",
          clientNameSnapshot: selected?.clientName,
          deliverableType: form.deliverableType,
          documentLabel: form.documentLabel || null,
          roundNumber: form.roundNumber ? Number(form.roundNumber) : null,
          litPersonName: form.litPersonName || null,
          hearingType: form.hearingType || null,
          requestedCompletionDate: form.requestedCompletionDate || null,
          notes: form.notes || null,
          attorneyUserId: selected?.attorneyId,
          assigneeUserId: selected?.paralegalId,
        }),
      });
      const body = (await res.json()) as { deliverable?: PerformanceDeliverable; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Create failed");
      if (body.deliverable) setDeliverables((prev) => [body.deliverable!, ...prev]);
      setForm((f) => ({ ...f, documentLabel: "", roundNumber: "", litPersonName: "", hearingType: "", notes: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusyId(null);
    }
  }

  async function commit(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/performance/deliverables/${id}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart }),
      });
      const body = (await res.json()) as {
        deliverable?: PerformanceDeliverable;
        commitment?: PerformanceCommitment;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Commit failed");
      if (body.deliverable) {
        setDeliverables((prev) => prev.map((d) => (d.id === id ? body.deliverable! : d)));
      }
      if (body.commitment) setCommitments((prev) => [...prev, body.commitment!]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Commit failed");
    } finally {
      setBusyId(null);
    }
  }

  async function complete(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const commitment = commitmentByDeliverable.get(id);
      const res = await fetch(`/api/performance/deliverables/${id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitmentId: commitment?.id ?? null }),
      });
      const body = (await res.json()) as { deliverable?: PerformanceDeliverable; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Complete failed");
      if (body.deliverable) {
        setDeliverables((prev) => prev.map((d) => (d.id === id ? body.deliverable! : d)));
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Complete failed");
    } finally {
      setBusyId(null);
    }
  }

  function renderWorkTable(
    rows: PerformanceDeliverable[],
    mode: "finished" | "thisWeek" | "backlog",
  ) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Paralegal</TableHead>
            <TableHead>Attorney</TableHead>
            <TableHead>Deliverable</TableHead>
            <TableHead>Case #</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>{mode === "finished" ? "Complete date" : "Status"}</TableHead>
            <TableHead>Notes</TableHead>
            {mode !== "finished" ? <TableHead /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="whitespace-nowrap">
                {d.assigneeUserId ? nameById[d.assigneeUserId] ?? "—" : "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {d.attorneyUserId ? nameById[d.attorneyUserId] ?? "—" : "—"}
              </TableCell>
              <TableCell>
                <div className="font-medium">{typeLabel(d.deliverableType)}</div>
                <div className="text-xs text-muted-foreground">{d.identityLabel ?? d.identityKey}</div>
              </TableCell>
              <TableCell>
                {d.caseId ? (
                  <Link className="font-medium text-pink-700 hover:underline" href={`/cases/${d.caseId}`}>
                    {d.caseNumber}
                  </Link>
                ) : (
                  d.caseNumber
                )}
              </TableCell>
              <TableCell>{d.clientNameSnapshot ?? "—"}</TableCell>
              <TableCell className="whitespace-nowrap text-xs">
                {mode === "finished" ? (
                  d.completedAt?.slice(0, 10) ?? "—"
                ) : (
                  <Badge variant="outline">{d.workflowStatus}</Badge>
                )}
              </TableCell>
              <TableCell className="max-w-[16rem] truncate text-xs" title={d.notes ?? undefined}>
                {d.notes ?? "—"}
              </TableCell>
              {mode !== "finished" ? (
                <TableCell className="space-x-2 whitespace-nowrap">
                  {d.workflowStatus === "backlog" ? (
                    <Button size="sm" variant="outline" disabled={busyId === d.id} onClick={() => void commit(d.id)}>
                      Add to this week
                    </Button>
                  ) : null}
                  {d.workflowStatus === "backlog" || d.workflowStatus === "committed" ? (
                    <Button size="sm" disabled={busyId === d.id} onClick={() => void complete(d.id)}>
                      Complete
                    </Button>
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={mode === "finished" ? 7 : 8} className="text-muted-foreground">
                No items.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-navy-950">
            {selectedPerson?.name ?? "My Work"}
            {viewerContactId && selectedPerson?.id === viewerContactId ? " (you)" : ""}
          </h2>
          <p className="text-sm text-muted-foreground">
            Week of {weekStart}
            {viewingAsAttorney ? " · attorney view" : " · paralegal view"}
          </p>
        </div>
        {canBrowsePeople ? (
          <PersonSwitcher people={people} selectedId={selectedPerson?.id ?? null} basePath="/performance/my-work" />
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Finished last week</CardTitle>
          <CardDescription>
            Week of {lastWeekStart} — bring this list to the Monday 9:30 check. Pair totals roll up on Team.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">{renderWorkTable(finishedLastWeek, "finished")}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>This week (committed)</CardTitle>
          <CardDescription>In progress for the current week commitment.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">{renderWorkTable(thisWeekCommitted, "thisWeek")}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Identify work</CardTitle>
          <CardDescription>
            New items go to backlog, then Add to this week to commit. Completing feeds Team pair totals.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Case</span>
            <select
              className="w-full rounded-md border px-3 py-2"
              value={form.caseId}
              onChange={(e) => setForm((f) => ({ ...f, caseId: e.target.value }))}
            >
              <option value="">Select case</option>
              {caseOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.caseNumber} — {c.clientName}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Type</span>
            <select
              className="w-full rounded-md border px-3 py-2"
              value={form.deliverableType}
              onChange={(e) =>
                setForm((f) => ({ ...f, deliverableType: e.target.value as PerformanceDeliverableType }))
              }
            >
              {PERFORMANCE_DELIVERABLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Document / label</span>
            <Input
              value={form.documentLabel}
              onChange={(e) => setForm((f) => ({ ...f, documentLabel: e.target.value }))}
              placeholder="Supplemental demand"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Round #</span>
            <Input
              value={form.roundNumber}
              onChange={(e) => setForm((f) => ({ ...f, roundNumber: e.target.value }))}
              placeholder="2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Deponent</span>
            <Input
              value={form.litPersonName}
              onChange={(e) => setForm((f) => ({ ...f, litPersonName: e.target.value }))}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Hearing type</span>
            <Input
              value={form.hearingType}
              onChange={(e) => setForm((f) => ({ ...f, hearingType: e.target.value }))}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Requested date</span>
            <Input
              type="date"
              value={form.requestedCompletionDate}
              onChange={(e) => setForm((f) => ({ ...f, requestedCompletionDate: e.target.value }))}
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium">Notes</span>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </label>
          <div className="flex items-end">
            <Button disabled={busyId === "create" || !form.caseId} onClick={() => void createItem()}>
              {busyId === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add to backlog
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Backlog / in progress</CardTitle>
          <CardDescription>Identified work not yet committed to this week.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">{renderWorkTable(backlog, "backlog")}</CardContent>
      </Card>
    </div>
  );
}
