"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  PERFORMANCE_DELIVERABLE_TYPES,
  type PerformanceCommitment,
  type PerformanceDeliverable,
  type PerformanceDeliverableType,
} from "@/lib/performance/types";
import { weekStartMondayCt } from "@/lib/performance/weeks";

type Props = {
  initialDeliverables: PerformanceDeliverable[];
  initialCommitments: PerformanceCommitment[];
  weekStart: string;
  contactId: string | null;
  canBrowseAll: boolean;
  caseOptions: Array<{ id: string; caseNumber: string; clientName: string; paralegalId: string; attorneyId: string }>;
};

export function MyWorkView({
  initialDeliverables,
  initialCommitments,
  weekStart,
  caseOptions,
}: Props) {
  const [deliverables, setDeliverables] = useState(initialDeliverables);
  const [commitments, setCommitments] = useState(initialCommitments);
  const [filter, setFilter] = useState<"backlog" | "committed" | "all">("backlog");
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

  const visible = deliverables.filter((d) => {
    if (filter === "backlog") return d.workflowStatus === "backlog";
    if (filter === "committed") return d.workflowStatus === "committed";
    return d.workflowStatus !== "cancelled";
  });

  async function refresh() {
    const res = await fetch("/api/performance/deliverables?scope=mine");
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Identify work</CardTitle>
          <CardDescription>
            New items go to the paralegal backlog. Requested dates are advisory — use Add to this week to commit.
            Week of {weekStart} (editable anytime; Monday snapshot is a checkpoint only).
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
                  {t}
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
          <div className="flex items-end">
            <Button disabled={busyId === "create" || !form.caseId} onClick={() => void createItem()}>
              {busyId === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add to backlog
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {(["backlog", "committed", "all"] as const).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? "default" : "outline"}
            onClick={() => setFilter(key)}
          >
            {key === "backlog" ? "Backlog" : key === "committed" ? "This week" : "All open"}
          </Button>
        ))}
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>{filter === "backlog" ? "Backlog" : filter === "committed" ? "Weekly commitments" : "Work"}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Identity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Identified</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    {d.caseId ? (
                      <Link className="font-medium text-pink-700 hover:underline" href={`/cases/${d.caseId}`}>
                        {d.caseNumber}
                      </Link>
                    ) : (
                      d.caseNumber
                    )}
                    <div className="text-xs text-muted-foreground">{d.clientNameSnapshot}</div>
                  </TableCell>
                  <TableCell>{d.deliverableType}</TableCell>
                  <TableCell>{d.identityLabel ?? d.identityKey}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{d.workflowStatus}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {d.identifiedAt.slice(0, 10)}
                    {d.rescheduleCount > 0 ? ` · moved ${d.rescheduleCount}×` : ""}
                  </TableCell>
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
                </TableRow>
              ))}
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No items in this view.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function defaultWeekStart() {
  return weekStartMondayCt();
}
