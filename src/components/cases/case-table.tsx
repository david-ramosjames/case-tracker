"use client";

import Link from "next/link";
import { CaseNumberLink } from "@/components/cases/case-number-link";
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeaderFilter, HeaderMultiFilter } from "@/components/ui/header-filter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DerivedCaseStatusBadge } from "@/components/cases/case-status-badge";
import { deriveCaseStatusFromTracker } from "@/lib/case-status";
import {
  CASE_STAGE_OPTIONS,
  CASE_TYPE_OPTIONS,
  caseTypeSelectOptions,
  CASE_SIZE_OPTIONS,
  deriveCaseSizeFromMinimumValue,
  coerceExpectedLitigationForStage,
  matchesOptionalFieldFilter,
  matchesTargetPeriodFilter,
  notSetFilterOption,
  LIABILITY_OPTIONS,
  getTargetPeriodFilterOptions,
  getTargetPeriodSelectOptions,
  toStandardTargetPeriodLabel,
} from "@/lib/case-options";
import { CaseAttorneyScoreCell } from "@/components/attorney-score/attorney-score";
import { getCaseAttorneyScore } from "@/lib/attorney-score";
import { deriveResultFeePercent, getCaseCompletionScore } from "@/lib/calculations";
import { getCasePipelineFilter, isActivePipelineCase, type CasePipelineFilter, type ViewerContext } from "@/lib/auth/access";
import {
  getCaseListQualityFilterLabel,
  matchesCaseListQualityFilter,
  type CaseListQualityFilter,
} from "@/lib/case-list-filters";
import {
  type AppUser,
  type AttorneyGoal,
  type CaseRecord,
  type CaseStage,
  type CaseTrackerSettings,
  type TrackerEntry,
  type TrackerUpdateInput,
} from "@/lib/types";
import { cn, formatDate, formatOptionalDate, parseCalendarDate } from "@/lib/utils";
import { cleanCaseNumber, compareCaseNumbers } from "@/lib/csv/parse";
import { type ReactNode, type RefObject, type UIEvent, useEffect, useMemo, useRef, useState } from "react";

type SortKey = "completion" | "attorneyScore" | "caseNumber" | "clientName" | "dateSigned" | "dol" | "minimumValue" | "policyLimits";
type SortDirection = "asc" | "desc";

type CaseTablePersistPatch = {
  shared?: { caseType?: string };
  tracker?: TrackerUpdateInput;
};

const SAVED_INDICATOR_MS = 2500;

type RowSaveStatus = "saving" | "saved";

function stageSelectOptions(current: CaseStage) {
  if (CASE_STAGE_OPTIONS.includes(current)) return CASE_STAGE_OPTIONS;
  return [current, ...CASE_STAGE_OPTIONS];
}

function assertTrackerPatchApplied(tracker: TrackerEntry, patch: CaseTablePersistPatch) {
  const t = patch.tracker;
  if (!t) return;
  if (t.caseStage !== undefined && tracker.caseStage !== t.caseStage) {
    throw new Error(`Stage did not save (still "${tracker.caseStage}"). You may need database migration 030 for your role.`);
  }
  if (t.liability !== undefined && tracker.liability !== t.liability) {
    throw new Error("Liability did not save.");
  }
  if (t.targetResolutionQuarter !== undefined) {
    const expected =
      toStandardTargetPeriodLabel(t.targetResolutionQuarter) ?? t.targetResolutionQuarter;
    const actual =
      toStandardTargetPeriodLabel(tracker.targetResolutionQuarter) ?? tracker.targetResolutionQuarter;
    if (expected !== actual) {
      throw new Error("Expected disbursement quarter did not save.");
    }
  }
  if (t.minimumValue !== undefined && tracker.minimumValue !== t.minimumValue) {
    throw new Error("Minimum value did not save.");
  }
  if (t.referralFee !== undefined && tracker.referralFee !== t.referralFee) {
    throw new Error("Referral fee did not save.");
  }
  if (t.policyLimits !== undefined && tracker.policyLimits !== t.policyLimits) {
    throw new Error("Policy limits did not save.");
  }
}

function isRowPinnedBySaveFeedback(caseId: string, rowSaveStatus: Record<string, RowSaveStatus>) {
  const status = rowSaveStatus[caseId];
  return status === "saving" || status === "saved";
}

function normalizeTrackerFieldValue<K extends "caseStage" | "targetResolutionQuarter" | "liability" | "minimumValue" | "referralFee" | "policyLimits">(
  key: K,
  value: TrackerEntry[K],
): TrackerEntry[K] {
  if (key === "targetResolutionQuarter" && typeof value === "string" && value.trim()) {
    return (toStandardTargetPeriodLabel(value) ?? value) as TrackerEntry[K];
  }
  return value;
}

export function CaseTable({
  records,
  users,
  settings,
  goals,
  viewer,
  initialSearch = "",
  initialStatus = "Active",
  initialQualityFilter = null,
}: {
  records: CaseRecord[];
  users: AppUser[];
  settings: CaseTrackerSettings;
  goals: AttorneyGoal[];
  viewer: ViewerContext;
  initialSearch?: string;
  initialStatus?: CasePipelineFilter;
  initialQualityFilter?: CaseListQualityFilter | null;
}) {
  const [workingRecords, setWorkingRecords] = useState(records);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [rowSaveErrors, setRowSaveErrors] = useState<Record<string, string>>({});
  const [rowSaveStatus, setRowSaveStatus] = useState<Record<string, RowSaveStatus>>({});
  const pendingPatchesRef = useRef(new Map<string, CaseTablePersistPatch>());
  const preEditSnapshotsRef = useRef(new Map<string, CaseRecord>());
  const persistChainRef = useRef(new Map<string, Promise<void>>());
  const savedIndicatorTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const recordsRef = useRef(records);
  const recordsVersion = useMemo(
    () => records.map((record) => `${record.shared.id}:${record.tracker.updatedAt}:${record.shared.caseType}`).join("|"),
    [records],
  );
  const [search, setSearch] = useState(initialSearch);
  const [attorneyIds, setAttorneyIds] = useState<string[]>([]);
  const [paralegal, setParalegal] = useState("all");
  const [stage, setStage] = useState("all");
  const [status, setStatus] = useState<CasePipelineFilter>(initialStatus);
  const [qualityFilter, setQualityFilter] = useState<CaseListQualityFilter | null>(initialQualityFilter);
  const [caseType, setCaseType] = useState("all");
  const [liability, setLiability] = useState("all");
  const [caseSize, setCaseSize] = useState("all");
  const [quarter, setQuarter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("attorneyScore");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [scrollWidth, setScrollWidth] = useState(2140);

  const activeRecords = useMemo(
    () => workingRecords.filter((record) => isActivePipelineCase(record, goals)),
    [goals, workingRecords],
  );

  const needsAttentionCount = useMemo(
    () => activeRecords.filter((record) => getCaseCompletionScore(record, settings).percent < 85).length,
    [activeRecords, settings],
  );

  const attorneys = users.filter((user) => user.role === "attorney");
  const paralegals = users.filter((user) => user.role === "paralegal");
  const quarterFilterOptions = useMemo(() => getTargetPeriodFilterOptions(), []);
  const statusFilterOptions = useMemo(() => {
    const options: Array<{ value: CasePipelineFilter; label: string }> = [
      { value: "all", label: "All statuses" },
      { value: "Active", label: "Active" },
      { value: "Closed", label: "Closed" },
    ];
    if (viewer.canViewHistorical) options.push({ value: "Historical", label: "Historical" });
    return options;
  }, [viewer.canViewHistorical]);

  const activeFilterCount = [
    viewer.canViewAllCases && attorneyIds.length > 0,
    paralegal !== "all",
    status !== "Active",
    caseType !== "all",
    liability !== "all",
    quarter !== "all",
    caseSize !== "all",
    stage !== "all",
    qualityFilter != null,
  ].filter(Boolean).length;

  useEffect(() => {
    if (initialSearch) setSearch(initialSearch);
  }, [initialSearch]);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    setQualityFilter(initialQualityFilter);
  }, [initialQualityFilter]);

  const filteredRecords = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase().replace(/^#/, "");
    const searchCaseNumber = normalizedSearch ? cleanCaseNumber(normalizedSearch) : "";

    return workingRecords
      .filter((record) => {
        const recordCaseNumber = cleanCaseNumber(record.shared.caseNumber);
        const matchesSearch =
          !normalizedSearch ||
          record.shared.caseNumber.toLowerCase().includes(normalizedSearch) ||
          recordCaseNumber.includes(searchCaseNumber) ||
          (searchCaseNumber && recordCaseNumber === searchCaseNumber) ||
          record.shared.clientName.toLowerCase().includes(normalizedSearch) ||
          record.attorney.name.toLowerCase().includes(normalizedSearch);

        if (!matchesSearch) return false;
        if (attorneyIds.length > 0 && !attorneyIds.includes(record.shared.attorneyId)) return false;
        if (paralegal !== "all" && record.shared.paralegalId !== paralegal) return false;
        const pinRow = isRowPinnedBySaveFeedback(record.shared.id, rowSaveStatus);
        if (stage !== "all" && record.tracker.caseStage !== stage && !pinRow) return false;
        const pipeline = getCasePipelineFilter(record, goals);
        if (status !== "all" && pipeline !== status) return false;
        if (caseType !== "all" && record.shared.caseType !== caseType) return false;
        if (liability !== "all" && !matchesOptionalFieldFilter(liability, record.tracker.liability) && !pinRow) return false;
        if (caseSize !== "all" && !matchesOptionalFieldFilter(caseSize, record.tracker.caseSize)) return false;
        if (quarter !== "all" && !matchesTargetPeriodFilter(quarter, record.tracker.targetResolutionQuarter) && !pinRow) return false;
        if (qualityFilter && !matchesCaseListQualityFilter(record, qualityFilter, settings)) return false;

        return true;
      })
      .sort((a, b) => {
        const dir = sortDirection === "asc" ? 1 : -1;

        const tieBreak = () => compareCaseNumbers(a.shared.caseNumber, b.shared.caseNumber);

        if (sortKey === "attorneyScore") {
          const aScore = getCaseAttorneyScore(a).percent;
          const bScore = getCaseAttorneyScore(b).percent;
          const cmp = aScore - bScore;
          return cmp !== 0 ? dir * cmp : tieBreak();
        }

        if (sortKey === "completion") {
          const aScore = getCaseCompletionScore(a, settings).percent;
          const bScore = getCaseCompletionScore(b, settings).percent;
          const cmp = aScore - bScore;
          return cmp !== 0 ? dir * cmp : tieBreak();
        }

        if (sortKey === "caseNumber") {
          return dir * compareCaseNumbers(a.shared.caseNumber, b.shared.caseNumber);
        }

        if (sortKey === "clientName") {
          const cmp = a.shared.clientName.localeCompare(b.shared.clientName);
          return cmp !== 0 ? dir * cmp : tieBreak();
        }

        if (sortKey === "dateSigned") {
          const aTime = new Date(a.shared.dateSigned).getTime();
          const bTime = new Date(b.shared.dateSigned).getTime();
          const cmp = aTime - bTime;
          return cmp !== 0 ? dir * cmp : tieBreak();
        }

        if (sortKey === "dol") {
          const aTime = a.shared.dateOfIncident ? (parseCalendarDate(a.shared.dateOfIncident)?.getTime() ?? 0) : 0;
          const bTime = b.shared.dateOfIncident ? (parseCalendarDate(b.shared.dateOfIncident)?.getTime() ?? 0) : 0;
          const cmp = aTime - bTime;
          return cmp !== 0 ? dir * cmp : tieBreak();
        }

        if (sortKey === "minimumValue") {
          const aValue = a.tracker.minimumValue ?? -Infinity;
          const bValue = b.tracker.minimumValue ?? -Infinity;
          const cmp = aValue - bValue;
          return cmp !== 0 ? dir * cmp : tieBreak();
        }

        const aValue = a.tracker.policyLimits ?? -Infinity;
        const bValue = b.tracker.policyLimits ?? -Infinity;
        const cmp = aValue - bValue;
        return cmp !== 0 ? dir * cmp : tieBreak();
      });
  }, [attorneyIds, caseSize, caseType, goals, liability, paralegal, qualityFilter, quarter, rowSaveStatus, search, settings, sortDirection, sortKey, stage, status, workingRecords]);

  function requestSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "clientName" || nextKey === "attorneyScore" || nextKey === "completion" ? "asc" : "desc");
  }

  useEffect(() => {
    function updateScrollWidth() {
      setScrollWidth(tableRef.current?.scrollWidth ?? 1880);
    }

    updateScrollWidth();
    window.addEventListener("resize", updateScrollWidth);
    return () => window.removeEventListener("resize", updateScrollWidth);
  }, [filteredRecords.length]);

  function syncScroll(event: UIEvent<HTMLDivElement>, targetRef: RefObject<HTMLDivElement | null>) {
    if (targetRef.current && targetRef.current.scrollLeft !== event.currentTarget.scrollLeft) {
      targetRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }
  }

  function clearFilters() {
    setAttorneyIds([]);
    setParalegal("all");
    setStage("all");
    setStatus("Active");
    setCaseType("all");
    setLiability("all");
    setCaseSize("all");
    setQuarter("all");
    setQualityFilter(null);
  }

  useEffect(() => {
    recordsRef.current = workingRecords;
  }, [workingRecords]);

  useEffect(() => {
    setWorkingRecords((current) => {
      const pendingCaseIds = new Set(pendingPatchesRef.current.keys());
      const currentById = new Map(current.map((record) => [record.shared.id, record]));
      return records.map((record) => {
        if (pendingCaseIds.has(record.shared.id)) {
          return currentById.get(record.shared.id) ?? record;
        }
        const currentRecord = currentById.get(record.shared.id);
        if (currentRecord && currentRecord.tracker.updatedAt > record.tracker.updatedAt) {
          return currentRecord;
        }
        return record;
      });
    });
  }, [recordsVersion]);

  useEffect(() => {
    function flushAllPendingWithKeepalive() {
      for (const [caseId, patch] of pendingPatchesRef.current.entries()) {
        const hasSharedChanges = patch.shared && Object.keys(patch.shared).length > 0;
        const hasTrackerChanges = patch.tracker && Object.keys(patch.tracker).length > 0;
        if (!hasSharedChanges && !hasTrackerChanges) continue;
        void fetch(`/api/tracker/${caseId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(hasSharedChanges ? { shared: patch.shared } : {}),
            ...(hasTrackerChanges ? { tracker: patch.tracker, changeInput: patch.tracker } : {}),
            markReviewed: true,
          }),
          keepalive: true,
        });
      }
      pendingPatchesRef.current.clear();
    }

    function flushAllPending() {
      for (const caseId of [...pendingPatchesRef.current.keys()]) {
        void flushPersist(caseId);
      }
    }

    window.addEventListener("beforeunload", flushAllPendingWithKeepalive);
    return () => {
      window.removeEventListener("beforeunload", flushAllPendingWithKeepalive);
      flushAllPending();
      for (const timer of savedIndicatorTimersRef.current.values()) clearTimeout(timer);
      savedIndicatorTimersRef.current.clear();
    };
  }, []);

  function markRowSaving(caseId: string) {
    const existing = savedIndicatorTimersRef.current.get(caseId);
    if (existing) {
      clearTimeout(existing);
      savedIndicatorTimersRef.current.delete(caseId);
    }
    setRowSaveStatus((current) => ({ ...current, [caseId]: "saving" }));
  }

  function markRowSaved(caseId: string) {
    setRowSaveStatus((current) => ({ ...current, [caseId]: "saved" }));
    const existing = savedIndicatorTimersRef.current.get(caseId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      savedIndicatorTimersRef.current.delete(caseId);
      setRowSaveStatus((current) => {
        if (current[caseId] !== "saved") return current;
        const next = { ...current };
        delete next[caseId];
        return next;
      });
    }, SAVED_INDICATOR_MS);
    savedIndicatorTimersRef.current.set(caseId, timer);
  }

  function clearRowSaveStatus(caseId: string) {
    const existing = savedIndicatorTimersRef.current.get(caseId);
    if (existing) {
      clearTimeout(existing);
      savedIndicatorTimersRef.current.delete(caseId);
    }
    setRowSaveStatus((current) => {
      if (!current[caseId]) return current;
      const next = { ...current };
      delete next[caseId];
      return next;
    });
  }

  function ensurePreEditSnapshot(caseId: string) {
    if (preEditSnapshotsRef.current.has(caseId)) return;
    const record = recordsRef.current.find((entry) => entry.shared.id === caseId);
    if (record) preEditSnapshotsRef.current.set(caseId, structuredClone(record));
  }

  function mergePersistPatch(caseId: string, patch: CaseTablePersistPatch) {
    const existing = pendingPatchesRef.current.get(caseId) ?? {};
    pendingPatchesRef.current.set(caseId, {
      shared: { ...existing.shared, ...patch.shared },
      tracker: { ...existing.tracker, ...patch.tracker },
    });
  }

  function queuePersist(caseId: string, patch: CaseTablePersistPatch, options?: { skipMarkSaving?: boolean }) {
    ensurePreEditSnapshot(caseId);
    mergePersistPatch(caseId, patch);
    if (!options?.skipMarkSaving) {
      markRowSaving(caseId);
    }
    setRowSaveErrors((current) => {
      if (!current[caseId]) return current;
      const next = { ...current };
      delete next[caseId];
      return next;
    });
    const prior = persistChainRef.current.get(caseId) ?? Promise.resolve();
    const next = prior.then(() => flushPersist(caseId));
    persistChainRef.current.set(caseId, next);
  }

  async function flushPersist(caseId: string) {
    while (true) {
      const patch = pendingPatchesRef.current.get(caseId);
      if (!patch) return;

      const hasSharedChanges = patch.shared && Object.keys(patch.shared).length > 0;
      const hasTrackerChanges = patch.tracker && Object.keys(patch.tracker).length > 0;
      if (!hasSharedChanges && !hasTrackerChanges) {
        pendingPatchesRef.current.delete(caseId);
        return;
      }

      pendingPatchesRef.current.delete(caseId);
      const snapshotBefore =
        preEditSnapshotsRef.current.get(caseId) ?? recordsRef.current.find((record) => record.shared.id === caseId);
      if (!snapshotBefore) continue;

      setSaveMessage(null);

      try {
        const response = await fetch(`/api/tracker/${caseId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(hasSharedChanges ? { shared: patch.shared } : {}),
            ...(hasTrackerChanges ? { tracker: patch.tracker, changeInput: patch.tracker } : {}),
            markReviewed: true,
          }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Unable to save inline case update.");
        }

        const body = (await response.json()) as { tracker?: TrackerEntry };
        if (body.tracker && hasTrackerChanges) {
          assertTrackerPatchApplied(body.tracker, patch);
        }

        if (body.tracker) {
          setWorkingRecords((current) =>
            current.map((record) => {
              if (record.shared.id !== caseId) return record;
              const nextTracker = body.tracker!;
              return {
                ...record,
                tracker: nextTracker,
                shared: {
                  ...record.shared,
                  ...(patch.shared?.caseType !== undefined ? { caseType: patch.shared.caseType } : {}),
                  status: deriveCaseStatusFromTracker(nextTracker.caseStage, nextTracker.result),
                },
              };
            }),
          );
        } else if (patch.shared?.caseType !== undefined) {
          setWorkingRecords((current) =>
            current.map((record) =>
              record.shared.id === caseId
                ? { ...record, shared: { ...record.shared, caseType: patch.shared!.caseType! } }
                : record,
            ),
          );
        }

        preEditSnapshotsRef.current.delete(caseId);
        markRowSaved(caseId);
      } catch (error) {
        clearRowSaveStatus(caseId);
        preEditSnapshotsRef.current.delete(caseId);
        const message = error instanceof Error ? error.message : "Unable to save inline case update.";
        setWorkingRecords((current) =>
          current.map((record) => (record.shared.id === caseId ? snapshotBefore : record)),
        );
        setSaveMessage(message);
        setRowSaveErrors((current) => ({ ...current, [caseId]: message }));
      }
    }
  }

  function updateRecord(
    recordId: string,
    updater: (record: CaseRecord) => CaseRecord,
    persistPatch?: CaseTablePersistPatch,
  ) {
    setWorkingRecords((current) =>
      current.map((record) => {
        if (record.shared.id !== recordId) return record;
        return updater(record);
      }),
    );

    if (persistPatch) {
      queuePersist(recordId, persistPatch);
    }
  }

  function updateSharedField(recordId: string, key: "caseType", value: string) {
    updateRecord(
      recordId,
      (record) => ({
        ...record,
        shared: {
          ...record.shared,
          [key]: value,
        },
      }),
      { shared: { [key]: value } },
    );
  }

  function updateTrackerField<K extends "caseStage" | "targetResolutionQuarter" | "liability" | "minimumValue" | "referralFee" | "policyLimits">(
    recordId: string,
    key: K,
    value: TrackerEntry[K],
  ) {
    const record = recordsRef.current.find((entry) => entry.shared.id === recordId);
    if (!record) return;

    const normalizedValue = normalizeTrackerFieldValue(key, value);
    const currentValue = record.tracker[key];
    if (key === "liability" || key === "targetResolutionQuarter") {
      if ((currentValue ?? null) === (normalizedValue ?? null)) return;
    } else if (currentValue === normalizedValue) {
      return;
    }

    const nextStage = key === "caseStage" ? (normalizedValue as CaseStage) : record.tracker.caseStage;
    const tracker: TrackerEntry = {
      ...record.tracker,
      [key]: normalizedValue,
      ...(key === "caseStage"
        ? { expectedLitigation: coerceExpectedLitigationForStage(nextStage, record.tracker.expectedLitigation) }
        : {}),
      ...(key === "minimumValue"
        ? { caseSize: deriveCaseSizeFromMinimumValue(normalizedValue as number | null) }
        : {}),
    };

    if (key === "caseStage" || key === "referralFee" || key === "minimumValue") {
      // 0 is a valid minimum — clear projected fee instead of keeping a stale estimate.
      tracker.estimatedFeeValue =
        tracker.minimumValue == null
          ? tracker.estimatedFeeValue
          : Math.round(tracker.minimumValue * deriveResultFeePercent(tracker));
    }

    const persistPatch = buildTrackerPersistPatch(record, key, normalizedValue, tracker);

    markRowSaving(recordId);
    setWorkingRecords((current) =>
      current.map((entry) => {
        if (entry.shared.id !== recordId) return entry;
        return {
          ...entry,
          tracker,
          shared: {
            ...entry.shared,
            status: deriveCaseStatusFromTracker(tracker.caseStage, tracker.result),
          },
        };
      }),
    );

    queuePersist(recordId, persistPatch, { skipMarkSaving: true });
  }

  function buildTrackerPersistPatch<K extends "caseStage" | "targetResolutionQuarter" | "liability" | "minimumValue" | "referralFee" | "policyLimits">(
    record: CaseRecord,
    key: K,
    value: TrackerEntry[K],
    tracker: TrackerEntry,
  ): CaseTablePersistPatch {
    const patch: TrackerUpdateInput = { [key]: value };
    if (key === "minimumValue") {
      patch.caseSize = deriveCaseSizeFromMinimumValue(value as number | null);
      patch.estimatedFeeValue = tracker.estimatedFeeValue ?? undefined;
    }
    if (key === "caseStage") {
      patch.expectedLitigation = tracker.expectedLitigation ?? undefined;
      patch.estimatedFeeValue = tracker.estimatedFeeValue ?? undefined;
    }
    if (key === "referralFee") {
      patch.estimatedFeeValue = tracker.estimatedFeeValue ?? undefined;
    }
    return { tracker: patch };
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <Input
              className="lg:max-w-md"
              placeholder="Search cases..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {activeFilterCount > 0 ? (
              <Button variant="ghost" onClick={clearFilters}>
                Clear column filters
              </Button>
            ) : null}
            <p className="text-sm text-muted-foreground lg:ml-auto">
              {status === "Active" ? (
                filteredRecords.length === activeRecords.length ? (
                  <>{activeRecords.length} active case{activeRecords.length === 1 ? "" : "s"}</>
                ) : (
                  <>
                    Showing {filteredRecords.length} of {activeRecords.length} active case{activeRecords.length === 1 ? "" : "s"}
                  </>
                )
              ) : status === "all" ? (
                <>{activeRecords.length} active case{activeRecords.length === 1 ? "" : "s"}</>
              ) : (
                <>
                  {filteredRecords.length} {status.toLowerCase()} case{filteredRecords.length === 1 ? "" : "s"}
                </>
              )}
            </p>
          </div>
          {saveMessage ? <p className="text-sm font-medium text-pink-600">{saveMessage}</p> : null}
          <p className="text-xs text-muted-foreground">Changes save automatically when you update a field. A green checkmark confirms the server accepted the update.</p>

          {qualityFilter ? (
            <div className="rounded-lg border border-pink-200 bg-pink-50 px-4 py-3 text-sm text-navy-950">
              Dashboard filter: <span className="font-semibold">{getCaseListQualityFilterLabel(qualityFilter)}</span>
            </div>
          ) : null}

          {needsAttentionCount > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <span className="font-semibold">{needsAttentionCount} active case{needsAttentionCount === 1 ? "" : "s"}</span> below 85% complete — sort by{" "}
              <strong>% Complete</strong> (lowest first). Use column header dropdowns to filter.
            </div>
          ) : null}

        </div>

        <div className="mt-4 rounded-lg border bg-white">
          <div className="border-b bg-muted/40 px-4 py-2">
            <div
              ref={topScrollRef}
              className="overflow-x-auto rounded-full border bg-white"
              onScroll={(event) => syncScroll(event, tableScrollRef)}
            >
              <div style={{ width: scrollWidth, height: 12 }} />
            </div>
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute right-0 top-0 z-30 h-full w-12 bg-gradient-to-l from-white to-transparent" />
            <div
              ref={tableScrollRef}
              className="max-h-[calc(100vh-23rem)] min-h-[28rem] overflow-auto"
              onScroll={(event) => syncScroll(event, topScrollRef)}
            >
          <Table ref={tableRef} className="min-w-[2140px] table-fixed">
            <TableHeader className="sticky top-0 z-20 bg-slate-50 shadow-sm">
              <TableRow>
                <SortableHead label="Score" sortKey="attorneyScore" active={sortKey} direction={sortDirection} onSort={requestSort} className="sticky left-0 z-40 w-28 bg-slate-50 shadow-[1px_0_0_0_hsl(var(--border))]" />
                <SortableHead label="Case #" sortKey="caseNumber" active={sortKey} direction={sortDirection} onSort={requestSort} className="sticky left-28 z-40 w-28 bg-slate-50 shadow-[1px_0_0_0_hsl(var(--border))]" />
                <SortableHead label="Client" sortKey="clientName" active={sortKey} direction={sortDirection} onSort={requestSort} className="sticky left-56 z-40 w-44 bg-slate-50 shadow-[1px_0_0_0_hsl(var(--border))]" />
                <TableHead className="sticky left-[25rem] z-40 w-40 bg-slate-50 align-top shadow-[1px_0_0_0_hsl(var(--border))]">
                  {viewer.canViewAllCases ? (
                    <HeaderMultiFilter
                      label="Attorney"
                      selected={attorneyIds}
                      onChange={setAttorneyIds}
                      options={attorneys.map((item) => ({ value: item.id, label: item.name }))}
                    />
                  ) : (
                    <span className="text-xs font-semibold uppercase text-muted-foreground">Attorney</span>
                  )}
                </TableHead>
                <TableHead className="w-36 align-top">
                  <HeaderFilter
                    label="Paralegal"
                    value={paralegal}
                    onChange={setParalegal}
                    options={[
                      { value: "all", label: "All" },
                      ...paralegals.map((item) => ({ value: item.id, label: item.name })),
                    ]}
                  />
                </TableHead>
                <SortableHead label="Date Signed" sortKey="dateSigned" active={sortKey} direction={sortDirection} onSort={requestSort} className="w-32" />
                <SortableHead label="DOL" sortKey="dol" active={sortKey} direction={sortDirection} onSort={requestSort} className="w-32" />
                <TableHead className="w-32 align-top">
                  <HeaderFilter
                    label="Status"
                    value={status}
                    onChange={(value) => setStatus(value as CasePipelineFilter)}
                    options={statusFilterOptions}
                  />
                </TableHead>
                <TableHead className="w-36 align-top">
                  <HeaderFilter
                    label="Stage"
                    value={stage}
                    onChange={setStage}
                    options={[
                      { value: "all", label: "All" },
                      ...CASE_STAGE_OPTIONS.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                </TableHead>
                <TableHead className="w-36 align-top">
                  <HeaderFilter
                    label="Type"
                    value={caseType}
                    onChange={setCaseType}
                    options={[
                      { value: "all", label: "All" },
                      ...CASE_TYPE_OPTIONS.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                </TableHead>
                <TableHead className="w-40 align-top">
                  <HeaderFilter
                    label="Liability"
                    value={liability}
                    onChange={setLiability}
                    options={[
                      { value: "all", label: "All" },
                      notSetFilterOption(),
                      ...LIABILITY_OPTIONS.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                </TableHead>
                <TableHead className="w-32 align-top">
                  <HeaderFilter
                    label="Exp. disburse Q"
                    value={quarter}
                    onChange={setQuarter}
                    options={[
                      { value: "all", label: "All" },
                      notSetFilterOption(),
                      ...quarterFilterOptions.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                </TableHead>
                <TableHead className="w-32 align-top">
                  <HeaderFilter
                    label="Case Size"
                    value={caseSize}
                    onChange={setCaseSize}
                    options={[
                      { value: "all", label: "All" },
                      notSetFilterOption(),
                      ...CASE_SIZE_OPTIONS.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                </TableHead>
                <SortableHead label="Minimum Value" sortKey="minimumValue" active={sortKey} direction={sortDirection} onSort={requestSort} className="w-36" />
                <TableHead className="w-32">Referral Fee</TableHead>
                <SortableHead label="Policy Limits" sortKey="policyLimits" active={sortKey} direction={sortDirection} onSort={requestSort} className="w-36" />
                <TableHead className="w-36">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.map((record) => {
                const saveStatus = rowSaveStatus[record.shared.id];
                const saveError = rowSaveErrors[record.shared.id];

                return (
                  <TableRow key={record.shared.id}>
                    <TableCell className="sticky left-0 z-10 bg-white shadow-[1px_0_0_0_hsl(var(--border))]">
                      <CaseAttorneyScoreCell record={record} prominent />
                    </TableCell>
                    <TableCell className="sticky left-28 z-10 bg-white shadow-[1px_0_0_0_hsl(var(--border))]">
                      <CaseNumberLink caseId={record.shared.id} caseNumber={record.shared.caseNumber} openInNewTab />
                    </TableCell>
                    <TableCell className="sticky left-56 z-10 bg-white font-medium text-navy-950 shadow-[1px_0_0_0_hsl(var(--border))]">{record.shared.clientName}</TableCell>
                    <TableCell className="sticky left-[25rem] z-10 bg-white font-medium text-navy-950 shadow-[1px_0_0_0_hsl(var(--border))]">{record.attorney.name}</TableCell>
                    <TableCell>{record.paralegal.name}</TableCell>
                    <TableCell>{formatDate(record.shared.dateSigned)}</TableCell>
                    <TableCell>{formatOptionalDate(record.shared.dateOfIncident)}</TableCell>
                    <TableCell>
                      <DerivedCaseStatusBadge record={record} />
                    </TableCell>
                    <TableCell>
                      <InlineSelect value={record.tracker.caseStage} onChange={(value) => updateTrackerField(record.shared.id, "caseStage", value as CaseStage)}>
                        {stageSelectOptions(record.tracker.caseStage).map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </InlineSelect>
                    </TableCell>
                    <TableCell>
                      <InlineSelect value={record.shared.caseType} onChange={(value) => updateSharedField(record.shared.id, "caseType", value)}>
                        <option value="">Not set</option>
                        {caseTypeSelectOptions(record.shared.caseType).map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </InlineSelect>
                    </TableCell>
                    <TableCell>
                      <InlineSelect value={record.tracker.liability ?? ""} onChange={(value) => updateTrackerField(record.shared.id, "liability", value || null)}>
                        <option value="">Not set</option>
                        {LIABILITY_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </InlineSelect>
                    </TableCell>
                    <TableCell>
                      <InlineSelect
                        value={toStandardTargetPeriodLabel(record.tracker.targetResolutionQuarter) ?? ""}
                        onChange={(value) => updateTrackerField(record.shared.id, "targetResolutionQuarter", value || null)}
                      >
                        <option value="">Not set</option>
                        {getTargetPeriodSelectOptions(record.tracker.targetResolutionQuarter).map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </InlineSelect>
                    </TableCell>
                    <TableCell className="text-sm text-navy-950">
                      {record.tracker.caseSize ?? "—"}
                    </TableCell>
                    <TableCell>
                      <InlineNumberInput
                        prefix="$"
                        value={record.tracker.minimumValue}
                        onCommit={(value) => updateTrackerField(record.shared.id, "minimumValue", value)}
                      />
                    </TableCell>
                    <TableCell>
                      <InlineNumberInput
                        suffix="%"
                        fractionDigits={2}
                        value={record.tracker.referralFee}
                        onCommit={(value) => updateTrackerField(record.shared.id, "referralFee", value)}
                      />
                    </TableCell>
                    <TableCell>
                      <InlineNumberInput
                        prefix="$"
                        value={record.tracker.policyLimits}
                        onCommit={(value) => updateTrackerField(record.shared.id, "policyLimits", value)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          {saveStatus === "saving" ? (
                            <span className="inline-flex w-5 shrink-0 justify-center" title="Saving…">
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
                              <span className="sr-only">Saving</span>
                            </span>
                          ) : saveStatus === "saved" ? (
                            <span className="inline-flex w-5 shrink-0 justify-center" title="Saved">
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                              <span className="sr-only">Saved</span>
                            </span>
                          ) : (
                            <span className="w-5 shrink-0" aria-hidden />
                          )}
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/cases/${record.shared.id}`} target="_blank" rel="noopener noreferrer">
                              <Eye className="h-4 w-4" />
                              View
                            </Link>
                          </Button>
                        </div>
                        {saveError ? <p className="max-w-32 text-xs font-medium text-pink-600">{saveError}</p> : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SortableHead({
  label,
  sortKey,
  active,
  direction,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const isActive = active === sortKey;
  const Icon = !isActive ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={cn("align-middle", className)}>
      <button
        className="inline-flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <Icon className={isActive ? "h-3.5 w-3.5 text-pink-500" : "h-3.5 w-3.5"} />
      </button>
    </TableHead>
  );
}

function InlineSelect({
  value,
  onChange,
  disabled,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Select className="h-9 min-w-0 text-xs" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {children}
    </Select>
  );
}

function InlineNumberInput({
  value,
  onCommit,
  prefix,
  suffix,
  fractionDigits,
}: {
  value: number | null;
  onCommit: (value: number | null) => void;
  prefix?: string;
  suffix?: string;
  fractionDigits?: number;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const formatValue = (next: number) => formatNumberForInput(next, fractionDigits);
  const [draft, setDraft] = useState(value == null ? "" : formatValue(value));

  useEffect(() => {
    if (!isFocused) setDraft(value == null ? "" : formatValue(value));
  }, [isFocused, value, fractionDigits]);

  function commit() {
    const nextValue = parseFormattedNumber(draft);
    if (nextValue !== null && Number.isNaN(nextValue)) {
      setDraft(value == null ? "" : formatValue(value));
      return;
    }
    if (nextValue !== value) onCommit(nextValue);
    setDraft(nextValue == null ? "" : formatValue(nextValue));
    setIsFocused(false);
  }

  return (
    <div className="flex h-9 min-w-0 items-center rounded-md border border-input bg-white px-2 text-xs focus-within:ring-2 focus-within:ring-ring">
      {prefix ? <span className="mr-1 text-muted-foreground">{prefix}</span> : null}
      <Input
        className="h-7 min-w-0 border-0 bg-transparent px-0 py-0 text-xs shadow-none focus-visible:ring-0"
        inputMode="decimal"
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          setIsFocused(true);
          setDraft(value == null ? "" : String(value));
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(value == null ? "" : formatValue(value));
            setIsFocused(false);
            event.currentTarget.blur();
          }
        }}
      />
      {suffix ? <span className="ml-1 text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

function formatNumberForInput(value: number, fractionDigits?: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits ?? 2,
  }).format(value);
}

function parseFormattedNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number(trimmed.replace(/[$,%\s,]/g, ""));
}
