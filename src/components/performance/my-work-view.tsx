"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { CasePicker } from "@/components/performance/case-picker";
import { PersonSwitcher } from "@/components/performance/person-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ATTORNEY_OUTPUT_TYPES,
  DEPOSITION_PARTY_ROLES,
  LIT_EVENT_KINDS,
  PARALEGAL_CATEGORIES,
  litEventKindLabel,
  type LitEventKind,
  type ParalegalCategoryKey,
} from "@/lib/performance/deliverable-categories";
import { sortCasesByNumber } from "@/lib/performance/staff-roles";
import {
  DELIVERABLE_TYPE_LABELS,
  type PerformanceCommitment,
  type PerformanceDeliverable,
  type PerformanceDeliverableType,
} from "@/lib/performance/types";
import { weekEndFromStart } from "@/lib/performance/weeks";
import { type AppUser } from "@/lib/types";

type CaseOption = {
  id: string;
  caseNumber: string;
  clientName: string;
  paralegalId: string;
  attorneyId: string;
};

type Props = {
  mode?: "paralegal" | "attorney";
  initialDeliverables: PerformanceDeliverable[];
  initialCommitments: PerformanceCommitment[];
  weekStart: string;
  lastWeekStart: string;
  selectedPerson: AppUser | null;
  viewerContactId: string | null;
  canBrowsePeople: boolean;
  people: AppUser[];
  caseOptions: CaseOption[];
  nameById: Record<string, string>;
};

type CreateDestination = "backlog" | "this_week" | "last_week";

function typeLabel(type: PerformanceDeliverableType) {
  return DELIVERABLE_TYPE_LABELS[type] ?? type;
}

function inWeek(ymd: string | null | undefined, weekStart: string) {
  if (!ymd) return false;
  const day = ymd.slice(0, 10);
  return day >= weekStart && day <= weekEndFromStart(weekStart);
}

function lastWeekCompletedAt(lastWeekStart: string) {
  return `${weekEndFromStart(lastWeekStart)}T18:00:00.000Z`;
}

export function MyWorkView({
  mode = "paralegal",
  initialDeliverables,
  initialCommitments,
  weekStart,
  lastWeekStart,
  selectedPerson,
  viewerContactId,
  canBrowsePeople,
  people,
  caseOptions,
  nameById,
}: Props) {
  const isAttorney = mode === "attorney";
  const [deliverables, setDeliverables] = useState(initialDeliverables);
  const [commitments, setCommitments] = useState(initialCommitments);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coverOthers, setCoverOthers] = useState(false);
  const [form, setForm] = useState({
    caseId: "",
    category: "demand_sent" as ParalegalCategoryKey | PerformanceDeliverableType,
    litEventKind: "" as LitEventKind | "",
    depoParty: "",
    deliverableType: "demand_sent" as PerformanceDeliverableType,
    documentLabel: "",
    roundNumber: "",
    litPersonName: "",
    hearingType: "",
    requestedCompletionDate: "",
    notes: "",
  });

  const sortedCases = useMemo(() => sortCasesByNumber(caseOptions), [caseOptions]);
  const visibleCases = useMemo(() => {
    if (coverOthers || !selectedPerson) return sortedCases;
    return sortedCases.filter((c) =>
      isAttorney ? c.attorneyId === selectedPerson.id : c.paralegalId === selectedPerson.id,
    );
  }, [sortedCases, coverOthers, selectedPerson, isAttorney]);

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
      asAttorney: isAttorney ? "1" : "0",
      completedSince: lastWeekStart,
    });
    const res = await fetch(`/api/performance/deliverables?${params}`);
    const body = (await res.json()) as { deliverables?: PerformanceDeliverable[]; error?: string };
    if (!res.ok) throw new Error(body.error ?? "Refresh failed");
    setDeliverables(body.deliverables ?? []);
  }

  function resolveCreateFields() {
    if (isAttorney) {
      if (!form.notes.trim()) throw new Error("Add notes with further details.");
      const type = form.deliverableType;
      return {
        deliverableType: type,
        documentLabel: form.documentLabel || null,
        hearingType:
          type === "hearing" || type === "hearing_trial"
            ? form.hearingType.trim() || form.notes.trim()
            : form.hearingType || null,
        litPersonName: form.litPersonName || null,
        roundNumber: form.roundNumber ? Number(form.roundNumber) : null,
        notes: form.notes.trim(),
      };
    }

    const category = form.category as ParalegalCategoryKey;
    if (category === "lit_event_scheduled") {
      if (!form.litEventKind) throw new Error("Select a litigation event type.");
      if (form.litEventKind === "deposition" && !form.depoParty) {
        throw new Error("Select a deposition party role.");
      }
      if (!form.notes.trim() && form.litEventKind !== "deposition") {
        throw new Error("Add notes with further details.");
      }
      if (form.litEventKind === "deposition" && !form.notes.trim() && !form.depoParty) {
        throw new Error("Add notes with further details.");
      }
      return {
        deliverableType: "lit_event_scheduled" as const,
        hearingType: form.litEventKind,
        documentLabel: form.litEventKind === "deposition" ? form.depoParty || null : null,
        litPersonName: null,
        roundNumber: null,
        notes: form.notes.trim() || null,
      };
    }

    if (!form.notes.trim()) throw new Error("Add notes with further details.");
    return {
      deliverableType: category,
      documentLabel: null,
      hearingType: null,
      litPersonName: null,
      roundNumber: null,
      notes: form.notes.trim(),
    };
  }

  async function createItem(destination: CreateDestination) {
    setError(null);
    setBusyId(`create:${destination}`);
    try {
      if (!form.caseId) throw new Error("Select a case.");
      const selected = caseOptions.find((c) => c.id === form.caseId);
      const fields = resolveCreateFields();
      const res = await fetch("/api/performance/deliverables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: form.caseId,
          caseNumber: selected?.caseNumber ?? "TBD",
          clientNameSnapshot: selected?.clientName,
          deliverableType: fields.deliverableType,
          documentLabel: fields.documentLabel,
          roundNumber: fields.roundNumber,
          litPersonName: fields.litPersonName,
          hearingType: fields.hearingType,
          requestedCompletionDate: form.requestedCompletionDate || null,
          notes: fields.notes,
          attorneyUserId: isAttorney ? selectedPerson?.id ?? selected?.attorneyId : selected?.attorneyId,
          assigneeUserId: isAttorney
            ? selected?.paralegalId
            : selectedPerson?.id ?? selected?.paralegalId,
        }),
      });
      const body = (await res.json()) as { deliverable?: PerformanceDeliverable; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Create failed");
      let deliverable = body.deliverable;
      if (!deliverable) throw new Error("Create failed");

      if (destination === "this_week") {
        const commitRes = await fetch(`/api/performance/deliverables/${deliverable.id}/commit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weekStart }),
        });
        const commitBody = (await commitRes.json()) as {
          deliverable?: PerformanceDeliverable;
          commitment?: PerformanceCommitment;
          error?: string;
        };
        if (!commitRes.ok) throw new Error(commitBody.error ?? "Commit failed");
        if (commitBody.deliverable) deliverable = commitBody.deliverable;
        if (commitBody.commitment) setCommitments((prev) => [...prev, commitBody.commitment!]);
      }

      if (destination === "last_week") {
        const completeRes = await fetch(`/api/performance/deliverables/${deliverable.id}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completedAt: lastWeekCompletedAt(lastWeekStart) }),
        });
        const completeBody = (await completeRes.json()) as {
          deliverable?: PerformanceDeliverable;
          error?: string;
        };
        if (!completeRes.ok) throw new Error(completeBody.error ?? "Complete failed");
        if (completeBody.deliverable) deliverable = completeBody.deliverable;
      }

      setDeliverables((prev) => [deliverable!, ...prev.filter((d) => d.id !== deliverable!.id)]);
      setForm((f) => ({
        ...f,
        caseId: "",
        litEventKind: "",
        depoParty: "",
        documentLabel: "",
        roundNumber: "",
        litPersonName: "",
        hearingType: "",
        notes: "",
      }));
      if (destination === "last_week") await refresh();
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

  async function complete(id: string, asLastWeek = false) {
    setBusyId(id);
    setError(null);
    try {
      const commitment = commitmentByDeliverable.get(id);
      const res = await fetch(`/api/performance/deliverables/${id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commitmentId: commitment?.id ?? null,
          completedAt: asLastWeek ? lastWeekCompletedAt(lastWeekStart) : null,
        }),
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
                <div className="font-medium">
                  {d.deliverableType === "lit_event_scheduled"
                    ? `Schedule Litigation Event${
                        d.hearingType ? ` · ${litEventKindLabel(d.hearingType) ?? d.hearingType}` : ""
                      }${d.documentLabel ? ` · ${d.documentLabel}` : ""}`
                    : typeLabel(d.deliverableType)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {d.notes || d.identityLabel || d.identityKey}
                </div>
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
                  <Badge variant="outline">
                    {d.workflowStatus === "backlog"
                      ? "In progress"
                      : d.workflowStatus === "committed"
                        ? "This week"
                        : d.workflowStatus}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="max-w-[16rem] truncate text-xs" title={d.notes ?? undefined}>
                {d.notes ?? "—"}
              </TableCell>
              {mode !== "finished" ? (
                <TableCell className="space-x-2 whitespace-nowrap">
                  {d.workflowStatus === "backlog" ? (
                    <>
                      <Button size="sm" variant="outline" disabled={busyId === d.id} onClick={() => void commit(d.id)}>
                        Add to this week
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === d.id}
                        onClick={() => void complete(d.id, true)}
                      >
                        Finished last week
                      </Button>
                    </>
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

  const creating = busyId?.startsWith("create:") ?? false;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-navy-950">
            {selectedPerson?.name ?? (isAttorney ? "Attorney" : "Paralegal")}
            {viewerContactId && selectedPerson?.id === viewerContactId ? " (you)" : ""}
          </h2>
          <p className="text-sm text-muted-foreground">
            Week of {weekStart} · {isAttorney ? "attorney output" : "paralegal weekly check"}
          </p>
        </div>
        {canBrowsePeople ? (
          <PersonSwitcher
            people={people}
            selectedId={selectedPerson?.id ?? null}
            basePath={isAttorney ? "/performance/attorney" : "/performance/my-work"}
            label={isAttorney ? "Attorney" : "Paralegal"}
          />
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Completed last week</CardTitle>
          <CardDescription>
            Week of {lastWeekStart} — bring this list to the Monday 9:30 check. Pair totals roll up on Team.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">{renderWorkTable(finishedLastWeek, "finished")}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Committed for this week</CardTitle>
          <CardDescription>Work expected to finish in the current week.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">{renderWorkTable(thisWeekCommitted, "thisWeek")}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Identify work</CardTitle>
          <CardDescription>
            Pick a case (yours by default, ordered by case #). Add to in progress for future weeks, commit for this
            week, or log as completed last week.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="md:col-span-2 lg:col-span-1">
            <CasePicker
              cases={visibleCases}
              value={form.caseId}
              onChange={(caseId) => setForm((f) => ({ ...f, caseId }))}
              coverOthers={coverOthers}
              onCoverOthersChange={(next) => {
                setCoverOthers(next);
                setForm((f) => ({ ...f, caseId: "" }));
              }}
              mineLabel="Showing my cases"
              coverLabel="Showing all cases (cover)"
            />
          </div>
          {isAttorney ? (
            <label className="space-y-1 text-sm">
              <span className="font-medium">Type</span>
              <select
                className="w-full rounded-md border px-3 py-2"
                value={form.deliverableType}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    deliverableType: e.target.value as PerformanceDeliverableType,
                  }))
                }
              >
                {ATTORNEY_OUTPUT_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Category</span>
                <select
                  className="w-full rounded-md border px-3 py-2"
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      category: e.target.value as ParalegalCategoryKey,
                      litEventKind: "",
                      depoParty: "",
                    }))
                  }
                >
                  {PARALEGAL_CATEGORIES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              {form.category === "lit_event_scheduled" ? (
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Litigation event</span>
                  <select
                    className="w-full rounded-md border px-3 py-2"
                    value={form.litEventKind}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        litEventKind: e.target.value as LitEventKind | "",
                        depoParty: "",
                      }))
                    }
                  >
                    <option value="">Select…</option>
                    {LIT_EVENT_KINDS.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {form.category === "lit_event_scheduled" && form.litEventKind === "deposition" ? (
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Deposition party</span>
                  <select
                    className="w-full rounded-md border px-3 py-2"
                    value={form.depoParty}
                    onChange={(e) => setForm((f) => ({ ...f, depoParty: e.target.value }))}
                  >
                    <option value="">Select…</option>
                    {DEPOSITION_PARTY_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          )}
          <label className="space-y-1 text-sm">
            <span className="font-medium">Requested date</span>
            <Input
              type="date"
              value={form.requestedCompletionDate}
              onChange={(e) => setForm((f) => ({ ...f, requestedCompletionDate: e.target.value }))}
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-2 lg:col-span-3">
            <span className="font-medium">Notes</span>
            <Input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Further details"
            />
          </label>
          <div className="flex flex-wrap items-end gap-2 md:col-span-2 lg:col-span-3">
            <Button
              variant="outline"
              disabled={creating || !form.caseId}
              onClick={() => void createItem("backlog")}
            >
              {busyId === "create:backlog" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add to in progress
            </Button>
            <Button disabled={creating || !form.caseId} onClick={() => void createItem("this_week")}>
              {busyId === "create:this_week" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add to this week
            </Button>
            <Button
              variant="secondary"
              disabled={creating || !form.caseId}
              onClick={() => void createItem("last_week")}
            >
              {busyId === "create:last_week" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add to completed last week
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>In progress for future weeks</CardTitle>
          <CardDescription>
            Active work that will not finish this week. Move items to this week when they are ready to complete, or
            mark them completed last week when appropriate.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">{renderWorkTable(backlog, "backlog")}</CardContent>
      </Card>
    </div>
  );
}
