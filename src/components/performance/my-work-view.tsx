"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AutoProgressPanel } from "@/components/performance/auto-progress-panel";
import { CasePicker } from "@/components/performance/case-picker";
import { PersonScorecardView } from "@/components/performance/person-scorecard-view";
import { PersonSwitcher } from "@/components/performance/person-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ATTORNEY_IDENTIFY_CATEGORIES,
  DEPOSITION_PARTY_ROLES,
  LIT_EVENT_KINDS,
  PARALEGAL_CATEGORIES,
  completedLitEventDeliverableType,
  isLitEventIdentifyCategory,
  litEventKindLabel,
  type AttorneyIdentifyCategoryKey,
  type LitEventKind,
  type ParalegalCategoryKey,
} from "@/lib/performance/deliverable-categories";
import {
  isSyntheticBoardDeliverable,
  isVisibleOnParalegalBoard,
  type AttorneyBoardBuckets,
} from "@/lib/performance/attorney-board";
import { type PersonScorecardBundle } from "@/lib/performance/person-scorecard";
import { sortCasesByNumber } from "@/lib/performance/staff-roles";
import {
  DELIVERABLE_TYPE_LABELS,
  type PerformanceCommitment,
  type PerformanceDeliverable,
  type PerformanceDeliverableType,
} from "@/lib/performance/types";
import { daysBetweenYmd } from "@/lib/performance/pacing";
import { asYmdPrefix, chicagoTodayYmd, weekEndFromStart } from "@/lib/performance/weeks";
import { type AppUser } from "@/lib/types";

function deliverableStartYmd(d: PerformanceDeliverable) {
  return asYmdPrefix(d.createdAt) || asYmdPrefix(d.identifiedAt);
}

/** Days from create/start until complete (finished) or today (still open). */
function daysSinceStarted(d: PerformanceDeliverable, todayYmd = chicagoTodayYmd()) {
  const start = deliverableStartYmd(d);
  if (!start) return null;
  const end = asYmdPrefix(d.completedAt) || todayYmd;
  return Math.max(0, daysBetweenYmd(start, end));
}

type CaseOption = {
  id: string;
  caseNumber: string;
  clientName: string;
  paralegalId: string;
  attorneyId: string;
};

type Props = {
  mode?: "paralegal" | "attorney";
  /** identify = entry form + new this week; board = full Finished/Committed/In progress lists */
  panel?: "identify" | "board";
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
  basePath?: string;
  personSwitcherLabel?: string;
  scorecard?: PersonScorecardBundle | null;
  /** Attorney Output board: DF lit events + settlements (overrides default filters). */
  boardBuckets?: AttorneyBoardBuckets | null;
};

type CreateDestination = "backlog" | "this_week" | "last_week";

function typeLabel(type: PerformanceDeliverableType) {
  return DELIVERABLE_TYPE_LABELS[type] ?? type;
}

function inWeek(ymd: string | null | undefined, weekStart: string) {
  const day = asYmdPrefix(ymd);
  if (!day) return false;
  return day >= weekStart && day <= weekEndFromStart(weekStart);
}

function lastWeekCompletedAt(lastWeekStart: string) {
  return `${weekEndFromStart(lastWeekStart)}T18:00:00.000Z`;
}

export function MyWorkView({
  mode = "paralegal",
  panel = "board",
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
  basePath,
  personSwitcherLabel,
  scorecard = null,
  boardBuckets = null,
}: Props) {
  const router = useRouter();
  const isAttorney = mode === "attorney";
  const switcherPath = basePath ?? (isAttorney ? "/performance/attorney" : "/performance/my-work");
  const switcherLabel =
    personSwitcherLabel ?? (isAttorney ? "Attorney" : "Paralegal");
  const [deliverables, setDeliverables] = useState(initialDeliverables);
  const [commitments, setCommitments] = useState(initialCommitments);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coverOthers, setCoverOthers] = useState(false);
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState("");

  // PersonSwitcher uses client navigation; remount isn't guaranteed — reset board when person changes.
  useEffect(() => {
    setDeliverables(initialDeliverables);
    setCommitments(initialCommitments);
    // Only when the selected person changes; arrays are new every server render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [selectedPerson?.id]);
  const [form, setForm] = useState({
    caseId: "",
    category: "demand_sent" as ParalegalCategoryKey | AttorneyIdentifyCategoryKey,
    litEventKind: "" as LitEventKind | "",
    /** Deposition party role or free-form hearing sub-type. */
    subType: "",
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

  const boardDeliverables = useMemo(() => {
    if (isAttorney) return deliverables;
    return deliverables.filter(isVisibleOnParalegalBoard);
  }, [deliverables, isAttorney]);

  const finishedLastWeek = useMemo(() => {
    if (boardBuckets) return boardBuckets.finished;
    return boardDeliverables
      .filter((d) => d.workflowStatus === "done" && inWeek(d.completedAt, lastWeekStart))
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  }, [boardBuckets, boardDeliverables, lastWeekStart]);

  const thisWeekCommitted = useMemo(() => {
    if (boardBuckets) return boardBuckets.committed;
    return boardDeliverables.filter((d) => {
      if (d.workflowStatus !== "committed") return false;
      const commitment = commitmentByDeliverable.get(d.id);
      return commitment?.weekStart === weekStart;
    });
  }, [boardBuckets, boardDeliverables, commitmentByDeliverable, weekStart]);

  const backlog = useMemo(() => {
    if (boardBuckets) return boardBuckets.backlog;
    return boardDeliverables.filter((d) => d.workflowStatus === "backlog");
  }, [boardBuckets, boardDeliverables]);

  const newEntriesThisWeek = useMemo(
    () =>
      boardDeliverables
        .filter((d) => inWeek(d.identifiedAt, weekStart))
        .sort((a, b) => (b.identifiedAt ?? "").localeCompare(a.identifiedAt ?? "")),
    [boardDeliverables, weekStart],
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
    const category = form.category;

    if (category === "lit_event_scheduled" || category === "completed_lit_event") {
      if (!form.litEventKind) throw new Error("Select a Type for the lit event.");
      if (form.litEventKind === "deposition" && !form.subType.trim()) {
        throw new Error("Select a Sub-type for the deposition.");
      }
      if (form.litEventKind === "hearing" && !form.subType.trim()) {
        throw new Error("Enter a Sub-type for the hearing.");
      }
      if (!form.notes.trim()) throw new Error("Add notes with further details.");
      const subType = form.subType.trim() || null;
      if (category === "completed_lit_event") {
        // Off-calendar completion → counts as attended lit event (scorecard / attorney board).
        return {
          deliverableType: completedLitEventDeliverableType(form.litEventKind),
          hearingType:
            form.litEventKind === "deposition" || form.litEventKind === "hearing"
              ? subType
              : form.litEventKind === "trial"
                ? "trial"
                : null,
          documentLabel: subType,
          litPersonName: null,
          roundNumber: null,
          notes: form.notes.trim(),
        };
      }
      return {
        deliverableType: "lit_event_scheduled" as const,
        hearingType: form.litEventKind === "trial" ? "trial" : form.litEventKind,
        documentLabel:
          form.litEventKind === "deposition" || form.litEventKind === "hearing" ? subType : null,
        litPersonName: null,
        roundNumber: null,
        notes: form.notes.trim(),
      };
    }

    if (!form.notes.trim()) throw new Error("Add notes with further details.");
    return {
      deliverableType: category as PerformanceDeliverableType,
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
      // Off-calendar completed lit events are last-week-only — never backlog / this week.
      if (form.category === "completed_lit_event" && destination !== "last_week") {
        throw new Error("Completed Lit Event can only be added to completed last week.");
      }
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
        subType: "",
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
      if (boardBuckets) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Commit failed");
    } finally {
      setBusyId(null);
    }
  }

  async function moveToInProgress(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const commitment = commitmentByDeliverable.get(id);
      const res = await fetch(`/api/performance/deliverables/${id}/uncommit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitmentId: commitment?.id ?? null }),
      });
      const body = (await res.json()) as { deliverable?: PerformanceDeliverable; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Move failed");
      if (body.deliverable) {
        setDeliverables((prev) => prev.map((d) => (d.id === id ? body.deliverable! : d)));
      }
      setCommitments((prev) =>
        prev.map((c) =>
          c.deliverableId === id && c.outcome === "promised" ? { ...c, outcome: "moved" } : c,
        ),
      );
      if (boardBuckets) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Move failed");
    } finally {
      setBusyId(null);
    }
  }

  function startEditNotes(d: PerformanceDeliverable) {
    if (isSyntheticBoardDeliverable(d.id)) return;
    if (d.workflowStatus === "done" || d.workflowStatus === "cancelled") return;
    setEditingNotesId(d.id);
    setDraftNotes(d.notes ?? "");
  }

  async function saveNotes(id: string, nextNotes: string) {
    const current = deliverables.find((d) => d.id === id);
    const normalized = nextNotes.trim();
    const previous = (current?.notes ?? "").trim();
    setEditingNotesId(null);
    if (!current || normalized === previous) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/performance/deliverables/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: normalized || null }),
      });
      const body = (await res.json()) as { deliverable?: PerformanceDeliverable; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Save notes failed");
      if (body.deliverable) {
        setDeliverables((prev) => prev.map((d) => (d.id === id ? body.deliverable! : d)));
      } else {
        setDeliverables((prev) =>
          prev.map((d) => (d.id === id ? { ...d, notes: normalized || null } : d)),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save notes failed");
      setEditingNotesId(id);
      setDraftNotes(nextNotes);
    } finally {
      setBusyId(null);
    }
  }

  async function cancelItem(id: string) {
    if (
      !window.confirm(
        "Remove this deliverable from the board? It won’t count toward this week (still kept in history as cancelled).",
      )
    ) {
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/performance/deliverables/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Removed from board" }),
      });
      const body = (await res.json()) as { deliverable?: PerformanceDeliverable; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Remove failed");
      setDeliverables((prev) => prev.filter((d) => d.id !== id));
      setCommitments((prev) =>
        prev.map((c) =>
          c.deliverableId === id && c.outcome === "promised" ? { ...c, outcome: "cancelled" } : c,
        ),
      );
      if (boardBuckets) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
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
      if (boardBuckets) router.refresh();
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
      <Table className="table-fixed w-full min-w-[64rem]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[8rem]">Paralegal</TableHead>
            <TableHead className="w-[8rem]">Attorney</TableHead>
            <TableHead className="w-[14rem]">Deliverable</TableHead>
            <TableHead className="w-[5.5rem]">Case #</TableHead>
            <TableHead className="w-[9rem]">Client</TableHead>
            <TableHead className="w-[5.5rem]">Started</TableHead>
            <TableHead className="w-[7.5rem]">{mode === "finished" ? "Complete date" : "Status"}</TableHead>
            <TableHead className="w-[14rem]">Notes</TableHead>
            <TableHead className="w-[14rem]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows ?? []).map((d, index) => {
            const startYmd = deliverableStartYmd(d);
            const ageDays = daysSinceStarted(d);
            const canAct =
              mode !== "finished" &&
              !isSyntheticBoardDeliverable(d.id) &&
              (d.workflowStatus === "backlog" || d.workflowStatus === "committed");
            const isEditingNotes = editingNotesId === d.id;
            return (
              <TableRow key={d.id || `row-${index}`}>
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
                <TableCell className="whitespace-nowrap text-xs" title={startYmd ?? undefined}>
                  {ageDays != null ? (
                    <>
                      <div className="font-medium tabular-nums">{ageDays}d</div>
                      <div className="text-muted-foreground">{startYmd}</div>
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
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
                <TableCell className="align-top">
                  {isEditingNotes ? (
                    <Input
                      autoFocus
                      className="h-8 text-xs"
                      value={draftNotes}
                      disabled={busyId === d.id}
                      placeholder="Add notes…"
                      onChange={(e) => setDraftNotes(e.target.value)}
                      onBlur={() => void saveNotes(d.id, draftNotes)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void saveNotes(d.id, draftNotes);
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingNotesId(null);
                          setDraftNotes(d.notes ?? "");
                        }
                      }}
                    />
                  ) : canAct ? (
                    <button
                      type="button"
                      className="block w-full truncate rounded px-1 py-0.5 text-left text-xs hover:bg-slate-50"
                      title={d.notes ? `${d.notes} (click to edit)` : "Click to add notes"}
                      onClick={() => startEditNotes(d)}
                    >
                      {d.notes ?? <span className="text-muted-foreground">Add notes…</span>}
                    </button>
                  ) : (
                    <span className="truncate text-xs" title={d.notes ?? undefined}>
                      {d.notes ?? "—"}
                    </span>
                  )}
                </TableCell>
                <TableCell className="align-top">
                  {mode !== "finished" && isSyntheticBoardDeliverable(d.id) ? (
                    <span className="text-xs text-muted-foreground">
                      {d.id.startsWith("docket:") ? "DocketFlow calendar" : "Case Tracker"}
                    </span>
                  ) : null}
                  {canAct ? (
                    <div className="grid w-[12.5rem] grid-cols-2 gap-1">
                      <Button
                        size="sm"
                        className="h-8 px-2 text-xs"
                        disabled={busyId === d.id}
                        onClick={() => void complete(d.id)}
                      >
                        Complete
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        disabled={busyId === d.id || isEditingNotes}
                        onClick={() => startEditNotes(d)}
                      >
                        Edit
                      </Button>
                      {d.workflowStatus === "backlog" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2 text-xs"
                          disabled={busyId === d.id}
                          onClick={() => void commit(d.id)}
                        >
                          To this week
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2 text-xs"
                          disabled={busyId === d.id}
                          onClick={() => void moveToInProgress(d.id)}
                        >
                          In progress
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        disabled={busyId === d.id}
                        onClick={() => void cancelItem(d.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-muted-foreground">
                No items.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    );
  }

  const creating = busyId?.startsWith("create:") ?? false;

  const identifyForm = (
    <Card>
      <CardHeader>
        <CardTitle>Identify work</CardTitle>
        <CardDescription>
          {isAttorney ? "Attorney" : "Paralegal"} entry for{" "}
          {selectedPerson?.name ?? "selected person"}. Duplicate check runs across everyone — if the same item
          already exists, creation is blocked.
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
        <label className="space-y-1 text-sm">
          <span className="font-medium">Category</span>
          <select
            className="w-full rounded-md border px-3 py-2"
            value={form.category}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                category: e.target.value as ParalegalCategoryKey | AttorneyIdentifyCategoryKey,
                litEventKind: "",
                subType: "",
              }))
            }
          >
            {(isAttorney ? ATTORNEY_IDENTIFY_CATEGORIES : PARALEGAL_CATEGORIES).map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {isLitEventIdentifyCategory(form.category) ? (
          <label className="space-y-1 text-sm">
            <span className="font-medium">Type</span>
            <select
              className="w-full rounded-md border px-3 py-2"
              value={form.litEventKind}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  litEventKind: e.target.value as LitEventKind | "",
                  subType: "",
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
        {isLitEventIdentifyCategory(form.category) && form.litEventKind === "deposition" ? (
          <label className="space-y-1 text-sm">
            <span className="font-medium">Sub-type</span>
            <select
              className="w-full rounded-md border px-3 py-2"
              value={form.subType}
              onChange={(e) => setForm((f) => ({ ...f, subType: e.target.value }))}
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
        {isLitEventIdentifyCategory(form.category) && form.litEventKind === "hearing" ? (
          <label className="space-y-1 text-sm">
            <span className="font-medium">Sub-type</span>
            <Input
              value={form.subType}
              onChange={(e) => setForm((f) => ({ ...f, subType: e.target.value }))}
              placeholder="Type of hearing"
            />
          </label>
        ) : null}
        {form.category === "completed_lit_event" ? (
          <p className="text-xs text-muted-foreground md:col-span-2 lg:col-span-3">
            Use only for lit events that were completed but not on the calendar. They go straight to
            Completed last week and count toward lit events completed — not scheduling or this week’s
            plan.
          </p>
        ) : null}
        {form.category !== "completed_lit_event" ? (
          <label className="space-y-1 text-sm">
            <span className="font-medium">Requested date</span>
            <Input
              type="date"
              value={form.requestedCompletionDate}
              onChange={(e) => setForm((f) => ({ ...f, requestedCompletionDate: e.target.value }))}
            />
          </label>
        ) : null}
        <label className="space-y-1 text-sm md:col-span-2 lg:col-span-3">
          <span className="font-medium">Notes</span>
          <Input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Further details"
          />
        </label>
        <div className="flex flex-wrap items-end gap-2 md:col-span-2 lg:col-span-3">
          {form.category !== "completed_lit_event" ? (
            <>
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
            </>
          ) : null}
          <Button
            variant={form.category === "completed_lit_event" ? "default" : "secondary"}
            disabled={creating || !form.caseId}
            onClick={() => void createItem("last_week")}
          >
            {busyId === "create:last_week" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Add to completed last week
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-navy-950">
            {selectedPerson?.name ?? (isAttorney ? "Attorney" : "Paralegal")}
            {viewerContactId && selectedPerson?.id === viewerContactId ? " (you)" : ""}
          </h2>
          <p className="text-sm text-muted-foreground">
            Week of {weekStart} ·{" "}
            {panel === "identify"
              ? isAttorney
                ? "attorney identify"
                : "paralegal identify"
              : isAttorney
                ? "attorney board"
                : "paralegal board"}
          </p>
        </div>
        {canBrowsePeople ? (
          <PersonSwitcher
            people={people}
            selectedId={selectedPerson?.id ?? null}
            basePath={switcherPath}
            label={switcherLabel}
          />
        ) : null}
      </div>

      {panel === "identify" ? (
        <>
          {identifyForm}
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          <Card>
            <CardHeader>
              <CardTitle>New entries this week</CardTitle>
              <CardDescription>
                Items identified on this board during the week of {weekStart}. Full Finished / Committed / In
                progress lists live on the Paralegal and Attorney tabs.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {renderWorkTable(newEntriesThisWeek, "thisWeek")}
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {scorecard && selectedPerson ? (
            <PersonScorecardView bundle={scorecard} personName={selectedPerson.name} />
          ) : null}

          {selectedPerson ? (
            <AutoProgressPanel
              role={isAttorney ? "attorney" : "paralegal"}
              personId={selectedPerson.id}
              weekStart={weekStart}
            />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Finished last week</CardTitle>
              <CardDescription>
                {boardBuckets
                  ? `Week of ${lastWeekStart} — shared completed work, plus verified lit events and settlements (attorney-only).`
                  : `Week of ${lastWeekStart} — bring this list to the Monday 9:30 check. Pair totals roll up on Team.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">{renderWorkTable(finishedLastWeek, "finished")}</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Committed for this week</CardTitle>
              <CardDescription>
                {boardBuckets
                  ? "Lit events on the DocketFlow calendar this week, plus settlements dated or committed this week."
                  : "Full list of work expected to finish in the current week."}
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">{renderWorkTable(thisWeekCommitted, "thisWeek")}</CardContent>
          </Card>

          {error ? <p className="text-sm text-rose-700">{error}</p> : null}

          <Card>
            <CardHeader>
              <CardTitle>In progress for future weeks</CardTitle>
              <CardDescription>
                {boardBuckets
                  ? "Lit events on the DocketFlow calendar for the next two weeks (week +1 and +2)."
                  : "Full backlog of active work that will not finish this week. Add new items on Identify Work."}
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">{renderWorkTable(backlog, "backlog")}</CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
