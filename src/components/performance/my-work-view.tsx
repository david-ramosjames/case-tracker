"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Loader2,
} from "lucide-react";
import { AutoProgressPanel } from "@/components/performance/auto-progress-panel";
import { CasePicker } from "@/components/performance/case-picker";
import { PersonScorecardView } from "@/components/performance/person-scorecard-view";
import { PersonSwitcher } from "@/components/performance/person-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
import {
  asYmdPrefix,
  chicagoTodayYmd,
  formatWeekRangeLabel,
  shiftWeekStart,
  weekEndFromStart,
} from "@/lib/performance/weeks";
import { type AppUser } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  /** Current Monday in CT — caps the week toggle (no future weeks). */
  currentWeekStart?: string;
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
  /** Show ← / → week navigation (paralegal board / identify). */
  showWeekToggle?: boolean;
};

type CreateDestination = "backlog" | "this_week" | "last_week";

/** Board Category column — short name only (no type/subtype/notes). */
function boardCategoryLabel(type: PerformanceDeliverableType) {
  const paralegal = PARALEGAL_CATEGORIES.find((c) => c.key === type);
  if (paralegal) return paralegal.label;
  const attorney = ATTORNEY_IDENTIFY_CATEGORIES.find((c) => c.key === type);
  if (attorney) return attorney.label;
  if (type === "deposition" || type === "mediation" || type === "hearing" || type === "hearing_trial") {
    return "Completed Lit Event";
  }
  return DELIVERABLE_TYPE_LABELS[type] ?? type;
}

function boardTypeLabel(d: PerformanceDeliverable): string | null {
  if (d.deliverableType === "lit_event_scheduled") {
    return litEventKindLabel(d.hearingType) ?? (d.hearingType?.trim() || null);
  }
  if (
    d.deliverableType === "deposition" ||
    d.deliverableType === "mediation" ||
    d.deliverableType === "hearing" ||
    d.deliverableType === "hearing_trial"
  ) {
    const kind = d.deliverableType === "hearing_trial" ? "trial" : d.deliverableType;
    return litEventKindLabel(d.hearingType || kind) ?? DELIVERABLE_TYPE_LABELS[d.deliverableType];
  }
  if (d.hearingType?.trim()) return litEventKindLabel(d.hearingType) ?? d.hearingType.trim();
  return null;
}

function boardSubtypeLabel(d: PerformanceDeliverable): string | null {
  const label = d.documentLabel?.trim();
  if (!label) return null;
  if (label.length > 40) return null;
  if (/\b(sent|deadline|email|follow[- ]?up)\b/i.test(label)) return null;
  return label;
}

function statusLabel(
  d: PerformanceDeliverable,
  mode: "finished" | "thisWeek" | "backlog",
) {
  if (mode === "finished") return d.completedAt?.slice(0, 10) ?? "—";
  if (mode === "thisWeek" && d.workflowStatus === "done") return "Done";
  if (d.workflowStatus === "backlog") return "In progress";
  if (d.workflowStatus === "committed") return "This week";
  return d.workflowStatus;
}

type BoardColKey =
  | "paralegal"
  | "attorney"
  | "category"
  | "type"
  | "subtype"
  | "caseNumber"
  | "client"
  | "started"
  | "status"
  | "notes";

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
  currentWeekStart,
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
  showWeekToggle = false,
}: Props) {
  const router = useRouter();
  const isAttorney = mode === "attorney";
  const switcherPath = basePath ?? (isAttorney ? "/performance/attorney" : "/performance/my-work");
  const weekCap = currentWeekStart ?? weekStart;
  const isCurrentWeek = weekStart >= weekCap;
  const switcherLabel =
    personSwitcherLabel ?? (isAttorney ? "Attorney" : "Paralegal");

  function boardHref(nextWeek: string, personId?: string | null) {
    const params = new URLSearchParams();
    const person = personId === undefined ? selectedPerson?.id : personId;
    if (person && canBrowsePeople) params.set("person", person);
    if (nextWeek) params.set("week", nextWeek);
    const qs = params.toString();
    return qs ? `${switcherPath}?${qs}` : switcherPath;
  }

  function goWeek(next: string) {
    router.push(boardHref(next));
  }

  const weekNav = showWeekToggle ? (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Previous week"
        onClick={() => goWeek(shiftWeekStart(weekStart, -1))}
      >
        ←
      </Button>
      <div className="min-w-[11rem] text-center">
        <div className="text-sm font-semibold text-navy-950">{formatWeekRangeLabel(weekStart)}</div>
        <div className="text-xs text-muted-foreground">
          Week of {weekStart}
          {isCurrentWeek ? " · Current week" : ""}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Next week"
        disabled={isCurrentWeek}
        onClick={() => goWeek(shiftWeekStart(weekStart, 1))}
      >
        →
      </Button>
    </div>
  ) : null;
  const [deliverables, setDeliverables] = useState(initialDeliverables);
  const [commitments, setCommitments] = useState(initialCommitments);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coverOthers, setCoverOthers] = useState(false);
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState("");
  const [showTypeCol, setShowTypeCol] = useState(true);
  const [showSubtypeCol, setShowSubtypeCol] = useState(false);
  /** Hidden synthetic DocketFlow rows after Remove (until refresh rebuilds buckets). */
  const [hiddenSyntheticIds, setHiddenSyntheticIds] = useState<Set<string>>(() => new Set());
  const [boardSort, setBoardSort] = useState<
    Partial<Record<"finished" | "thisWeek" | "backlog", { key: BoardColKey; dir: "asc" | "desc" }>>
  >({});
  const [boardFilter, setBoardFilter] = useState<
    Partial<Record<"finished" | "thisWeek" | "backlog", Partial<Record<BoardColKey, string>>>>
  >({});

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
    const rows = boardBuckets
      ? boardBuckets.finished
      : boardDeliverables
          .filter((d) => d.workflowStatus === "done" && inWeek(d.completedAt, lastWeekStart))
          .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    return rows.filter((d) => !hiddenSyntheticIds.has(d.id));
  }, [boardBuckets, boardDeliverables, lastWeekStart, hiddenSyntheticIds]);

  const thisWeekCommitted = useMemo(() => {
    const rows = boardBuckets
      ? boardBuckets.committed
      : boardDeliverables
          .filter((d) => {
            if (d.workflowStatus !== "committed" && d.workflowStatus !== "done") return false;
            const commitment = commitmentByDeliverable.get(d.id);
            return commitment?.weekStart === weekStart;
          })
          .sort((a, b) => {
            const aDone = a.workflowStatus === "done" ? 1 : 0;
            const bDone = b.workflowStatus === "done" ? 1 : 0;
            if (aDone !== bDone) return aDone - bDone;
            return (a.caseNumber || "").localeCompare(b.caseNumber || "", undefined, { numeric: true });
          });
    return rows.filter((d) => !hiddenSyntheticIds.has(d.id));
  }, [boardBuckets, boardDeliverables, commitmentByDeliverable, weekStart, hiddenSyntheticIds]);

  const backlog = useMemo(() => {
    const rows = boardBuckets
      ? boardBuckets.backlog
      : boardDeliverables.filter((d) => d.workflowStatus === "backlog");
    return rows.filter((d) => !hiddenSyntheticIds.has(d.id));
  }, [boardBuckets, boardDeliverables, hiddenSyntheticIds]);

  const newEntriesThisWeek = useMemo(
    () =>
      boardDeliverables
        .filter((d) => inWeek(d.identifiedAt, weekStart))
        // Case Tracker auto-rows belong on Attorney scorecard/board — not Identify entry list.
        .filter(
          (d) =>
            !(
              d.completionSource === "system" &&
              (d.deliverableType === "settlement" || d.deliverableType === "disbursement")
            ),
        )
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

  async function removeSyntheticDocket(d: PerformanceDeliverable) {
    if (!d.docketEventId || !d.caseId) return;
    if (
      !window.confirm(
        "Remove this DocketFlow calendar item from the board? It won’t count toward weekly goals.",
      )
    ) {
      return;
    }
    setBusyId(d.id);
    setError(null);
    try {
      const res = await fetch("/api/performance/dismiss-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: d.id,
          caseId: d.caseId,
          caseNumber: d.caseNumber,
          clientName: d.clientNameSnapshot,
          deliverableType: d.deliverableType,
          docketEventId: d.docketEventId,
          eventTitle: d.documentLabel || d.identityLabel,
          attorneyUserId: d.attorneyUserId,
          assigneeUserId: d.assigneeUserId,
          reason: "Removed from attorney board — not a counting lit event",
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Remove failed");
      setHiddenSyntheticIds((prev) => new Set(prev).add(d.id));
      if (boardBuckets) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
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
    const sort = boardSort[mode];
    const filters = boardFilter[mode] ?? {};
    const colCount = 8 + (showTypeCol ? 1 : 0) + (showSubtypeCol ? 1 : 0) + 1;

    function cellValue(d: PerformanceDeliverable, key: BoardColKey): string {
      switch (key) {
        case "paralegal":
          return d.assigneeUserId ? nameById[d.assigneeUserId] ?? "" : "";
        case "attorney":
          return d.attorneyUserId ? nameById[d.attorneyUserId] ?? "" : "";
        case "category":
          return boardCategoryLabel(d.deliverableType);
        case "type":
          return boardTypeLabel(d) ?? "";
        case "subtype":
          return boardSubtypeLabel(d) ?? "";
        case "caseNumber":
          return d.caseNumber ?? "";
        case "client":
          return d.clientNameSnapshot ?? "";
        case "started": {
          const startYmd = deliverableStartYmd(d);
          const ageDays = daysSinceStarted(d);
          if (ageDays == null && !startYmd) return "";
          if (ageDays == null) return startYmd ?? "";
          return startYmd ? `${ageDays}d · ${startYmd}` : `${ageDays}d`;
        }
        case "status":
          return statusLabel(d, mode);
        case "notes":
          return d.notes ?? "";
        default:
          return "";
      }
    }

    function toggleSort(key: BoardColKey) {
      setBoardSort((prev) => {
        const current = prev[mode];
        if (!current || current.key !== key) return { ...prev, [mode]: { key, dir: "asc" } };
        if (current.dir === "asc") return { ...prev, [mode]: { key, dir: "desc" } };
        const next = { ...prev };
        delete next[mode];
        return next;
      });
    }

    function setFilter(key: BoardColKey, value: string) {
      setBoardFilter((prev) => ({
        ...prev,
        [mode]: { ...(prev[mode] ?? {}), [key]: value },
      }));
    }

    const filterOptions: Partial<Record<BoardColKey, string[]>> = {};
    {
      const keys: BoardColKey[] = [
        "paralegal",
        "attorney",
        "category",
        "type",
        "subtype",
        "caseNumber",
        "client",
        "started",
        "status",
        "notes",
      ];
      for (const key of keys) {
        const values = new Set<string>();
        for (const d of rows ?? []) {
          const raw = cellValue(d, key).trim();
          if (raw) values.add(raw);
        }
        filterOptions[key] = [...values].sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
        );
      }
    }

    const filtered = (rows ?? []).filter((d) =>
      (Object.entries(filters) as Array<[BoardColKey, string | undefined]>).every(([key, value]) => {
        if (!value?.trim()) return true;
        return cellValue(d, key).trim() === value.trim();
      }),
    );

    const sorted = [...filtered].sort((a, b) => {
      if (!sort) return 0;
      if (sort.key === "started") {
        const aDays = daysSinceStarted(a) ?? -1;
        const bDays = daysSinceStarted(b) ?? -1;
        return sort.dir === "asc" ? aDays - bDays : bDays - aDays;
      }
      if (sort.key === "caseNumber") {
        const cmp = (a.caseNumber || "").localeCompare(b.caseNumber || "", undefined, { numeric: true });
        return sort.dir === "asc" ? cmp : -cmp;
      }
      const cmp = cellValue(a, sort.key).localeCompare(cellValue(b, sort.key), undefined, {
        sensitivity: "base",
        numeric: true,
      });
      return sort.dir === "asc" ? cmp : -cmp;
    });

    function SortHead({
      col,
      label,
      className,
    }: {
      col: BoardColKey;
      label: string;
      className?: string;
    }) {
      const active = sort?.key === col;
      const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
      const options = filterOptions[col] ?? [];
      const selected = filters[col] ?? "";
      return (
        <TableHead className={className}>
          <button
            type="button"
            className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-navy-900"
            onClick={() => toggleSort(col)}
          >
            {label}
            <Icon className="h-3 w-3 opacity-60" aria-hidden />
          </button>
          <div className="relative mt-1">
            <Select
              className={cn(
                "h-7 w-full appearance-none truncate pr-6 text-xs font-normal normal-case tracking-normal",
                !selected && "text-muted-foreground",
              )}
              value={selected}
              onChange={(e) => setFilter(col, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Filter ${label}`}
            >
              <option value="">All</option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option.length > 48 ? `${option.slice(0, 45)}…` : option}
                </option>
              ))}
            </Select>
            <ChevronDown
              className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
              aria-hidden
            />
          </div>
        </TableHead>
      );
    }

    return (
      <div className="space-y-2">
        <Table className="table-fixed w-full min-w-[72rem]">
          <TableHeader>
            <TableRow>
              <SortHead col="paralegal" label="Paralegal" className="w-[8rem]" />
              <SortHead col="attorney" label="Attorney" className="w-[8rem]" />
              <SortHead col="category" label="Category" className="w-[9rem]" />
              {showTypeCol ? <SortHead col="type" label="Type" className="w-[7rem]" /> : null}
              {showSubtypeCol ? <SortHead col="subtype" label="Subtype" className="w-[7rem]" /> : null}
              <SortHead col="caseNumber" label="Case #" className="w-[5.5rem]" />
              <SortHead col="client" label="Client" className="w-[9rem]" />
              <SortHead col="started" label="Start / Days" className="w-[6rem]" />
              <SortHead
                col="status"
                label={mode === "finished" ? "Complete date" : "Status"}
                className="w-[7.5rem]"
              />
              <SortHead col="notes" label="Notes" className="w-[12rem]" />
              <TableHead className="w-[14rem]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((d, index) => {
              const startYmd = deliverableStartYmd(d);
              const ageDays = daysSinceStarted(d);
              const isDoneThisWeek = mode === "thisWeek" && d.workflowStatus === "done";
              const canAct =
                mode !== "finished" &&
                !isDoneThisWeek &&
                !isSyntheticBoardDeliverable(d.id) &&
                (d.workflowStatus === "backlog" || d.workflowStatus === "committed");
              const isEditingNotes = editingNotesId === d.id;
              const category = boardCategoryLabel(d.deliverableType);
              const typeText = boardTypeLabel(d);
              const subtypeText = boardSubtypeLabel(d);
              return (
                <TableRow
                  key={d.id || `row-${index}`}
                  className={isDoneThisWeek ? "bg-emerald-50/40" : undefined}
                >
                  <TableCell className="whitespace-nowrap">
                    {d.assigneeUserId ? nameById[d.assigneeUserId] ?? "—" : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {d.attorneyUserId ? nameById[d.attorneyUserId] ?? "—" : "—"}
                  </TableCell>
                  <TableCell>
                    <div className={cn("font-medium", isDoneThisWeek && "text-muted-foreground line-through")}>
                      {category}
                    </div>
                  </TableCell>
                  {showTypeCol ? (
                    <TableCell className="text-xs text-muted-foreground">{typeText ?? "—"}</TableCell>
                  ) : null}
                  {showSubtypeCol ? (
                    <TableCell className="text-xs text-muted-foreground">{subtypeText ?? "—"}</TableCell>
                  ) : null}
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
                    ) : isDoneThisWeek ? (
                      <Badge variant="success" className="gap-1">
                        <Check className="h-3 w-3" aria-hidden />
                        Done
                      </Badge>
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
                  <TableCell>
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
                  <TableCell>
                    {mode !== "finished" && isSyntheticBoardDeliverable(d.id) ? (
                      <div className="flex flex-col items-start gap-1">
                        <span className="text-xs text-muted-foreground">
                          {d.id.startsWith("docket:") ? "DocketFlow calendar" : "Case Tracker"}
                        </span>
                        {d.id.startsWith("docket:") ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 text-xs"
                            disabled={busyId === d.id}
                            onClick={() => void removeSyntheticDocket(d)}
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
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
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="text-muted-foreground">
                  No items.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
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
            <span className="inline-flex items-center gap-1.5 font-medium">
              Requested date
              <span
                className="inline-flex text-muted-foreground"
                title="Optional target date only — it does not place the item on a board. Use Add to this week for Committed, or Add to in progress for future work."
              >
                <CircleHelp className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">
                  Optional target date only — it does not place the item on a board. Use Add to this week for
                  Committed, or Add to in progress for future work.
                </span>
              </span>
            </span>
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-navy-950">
            {selectedPerson?.name ?? (isAttorney ? "Attorney" : "Paralegal")}
            {viewerContactId && selectedPerson?.id === viewerContactId ? " (you)" : ""}
          </h2>
          <p className="text-sm text-muted-foreground">
            {panel === "identify"
              ? isAttorney
                ? "attorney identify"
                : "paralegal identify"
              : isAttorney
                ? "attorney board"
                : "paralegal board"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {weekNav}
          {canBrowsePeople ? (
            <PersonSwitcher
              people={people}
              selectedId={selectedPerson?.id ?? null}
              basePath={switcherPath}
              label={switcherLabel}
              query={{ week: weekStart }}
            />
          ) : null}
        </div>
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

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Columns:</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => setShowTypeCol((v) => !v)}
              >
                {showTypeCol ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Type {showTypeCol ? "(shown)" : "(hidden)"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => setShowSubtypeCol((v) => !v)}
              >
                {showSubtypeCol ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Subtype {showSubtypeCol ? "(shown)" : "(hidden)"}
              </Button>
            </div>
            {weekNav}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Finished last week</CardTitle>
              <CardDescription>
                {boardBuckets && isAttorney
                  ? `Week of ${lastWeekStart} (${formatWeekRangeLabel(lastWeekStart)}) — shared completed work, plus verified lit events and settlements (attorney-only).`
                  : boardBuckets
                    ? `Week of ${lastWeekStart} (${formatWeekRangeLabel(lastWeekStart)}) — completed work, plus lit events scheduled in DocketFlow last week (attendance events only; any event date).`
                    : `Week of ${lastWeekStart} (${formatWeekRangeLabel(lastWeekStart)}) — bring this list to the Monday 9:30 check. Pair totals roll up on Team.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">{renderWorkTable(finishedLastWeek, "finished")}</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Committed for this week</CardTitle>
              <CardDescription>
                {boardBuckets && isAttorney
                  ? "Lit events on the DocketFlow calendar this week, plus settlements dated or committed this week."
                  : "Work expected this week (manual commitments only) — completed items stay listed with a check."}
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">{renderWorkTable(thisWeekCommitted, "thisWeek")}</CardContent>
          </Card>

          {error ? <p className="text-sm text-rose-700">{error}</p> : null}

          <Card>
            <CardHeader>
              <CardTitle>In progress for future weeks</CardTitle>
              <CardDescription>
                {boardBuckets && isAttorney
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
