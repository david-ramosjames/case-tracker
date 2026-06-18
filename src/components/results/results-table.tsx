"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Eye, Loader2 } from "lucide-react";
import { CaseCompletionCell } from "@/components/cases/case-completion-cell";
import { CaseNumberLink } from "@/components/cases/case-number-link";
import { type ViewerContext } from "@/lib/auth/access";
import { getCaseCompletionScore } from "@/lib/calculations";
import { compareCaseNumbers } from "@/lib/csv/parse";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HeaderFilter, HeaderMultiFilter } from "@/components/ui/header-filter";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentCommissionYearGoals } from "@/lib/calculations";
import {
  applyDerivedSettlementResult,
  coerceReductionsStatus,
  REDUCTIONS_MANUAL_STATUS_OPTIONS,
  CHECK_STATUS_OPTIONS,
  CLOSING_STATUS_OPTIONS,
  DISBURSED_STATUS_OPTIONS,
  RELEASE_STATUS_OPTIONS,
  getTargetPeriodOptions,
} from "@/lib/case-options";
import {
  formatAttorneyCommissionYearLabel,
  getCommissionYearResultAmounts,
  isResultsTabCase,
  resolveAttorneyCommissionYearGoal,
} from "@/lib/results-commission-year";
import {
  type AppUser,
  type AttorneyGoal,
  type CaseRecord,
  type CaseTrackerSettings,
  type CheckStatus,
  type ClosingStatus,
  type DisbursedStatus,
  type ReductionsStatus,
  type ReleaseStatus,
  type SettlementResult,
  type TrackerEntry,
} from "@/lib/types";
import { cn, formatCurrency, getCalculatedAttorneyFees } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState, type RefObject, type UIEvent } from "react";

type SortKey = "completion" | "caseNumber" | "clientName" | "settlementDate" | "settlementAmount" | "attorneyFees";
type SortDirection = "asc" | "desc";
type RowSaveStatus = "saving" | "saved";

type ResultPersistPatch = {
  result: SettlementResult;
};

const SAVED_INDICATOR_MS = 2500;

function isRowPinnedBySaveFeedback(caseId: string, rowSaveStatus: Record<string, RowSaveStatus>) {
  const status = rowSaveStatus[caseId];
  return status === "saving" || status === "saved";
}

function buildNextResultRecord(record: CaseRecord, updater: (result: SettlementResult) => SettlementResult): CaseRecord | null {
  const result = applyDerivedSettlementResult(updater(record.tracker.result), record.tracker, {
    skipDisbursementAggregation: true,
  });
  const nextRecord: CaseRecord = {
    ...record,
    tracker: {
      ...record.tracker,
      result,
    },
  };
  if (!isResultsTabCase(nextRecord)) return null;
  return nextRecord;
}

export function ResultsTable({
  records,
  goals,
  users,
  settings,
  viewer,
  initialDisbursed = "all",
}: {
  records: CaseRecord[];
  goals: AttorneyGoal[];
  users: AppUser[];
  settings: CaseTrackerSettings;
  viewer: ViewerContext;
  initialDisbursed?: string;
}) {
  const [workingRecords, setWorkingRecords] = useState(() => records.filter(isResultsTabCase));
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [rowSaveErrors, setRowSaveErrors] = useState<Record<string, string>>({});
  const [rowSaveStatus, setRowSaveStatus] = useState<Record<string, RowSaveStatus>>({});
  const pendingPatchesRef = useRef(new Map<string, ResultPersistPatch>());
  const preEditSnapshotsRef = useRef(new Map<string, CaseRecord>());
  const persistChainRef = useRef(new Map<string, Promise<void>>());
  const savedIndicatorTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const recordsRef = useRef(workingRecords);
  const recordsVersion = useMemo(
    () => records.map((record) => `${record.shared.id}:${record.tracker.updatedAt}:${record.tracker.result.disbursedStatus}`).join("|"),
    [records],
  );
  const [search, setSearch] = useState("");
  const [attorneyIds, setAttorneyIds] = useState<string[]>([]);
  const [release, setRelease] = useState("all");
  const [closing, setClosing] = useState("all");
  const [check, setCheck] = useState("all");
  const [disbursed, setDisbursed] = useState(initialDisbursed);
  const [reductions, setReductions] = useState("all");
  const [quarter, setQuarter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("caseNumber");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [scrollWidth, setScrollWidth] = useState(2300);

  useEffect(() => {
    setDisbursed(initialDisbursed);
  }, [initialDisbursed]);

  const attorneys = users.filter((user) => user.role === "attorney");
  const commissionYearGoals = useMemo(
    () => getCurrentCommissionYearGoals(goals, attorneys.map((user) => user.id)),
    [attorneys, goals],
  );
  const commissionYearSummary = useMemo(() => {
    if (viewer.isAttorney && viewer.contactId) {
      const goal = commissionYearGoals.find((item) => item.attorneyId === viewer.contactId) ?? null;
      return formatAttorneyCommissionYearLabel(goal);
    }
    if (commissionYearGoals.length === 1) {
      return formatAttorneyCommissionYearLabel(commissionYearGoals[0] ?? null);
    }
    return "each attorney's current commission year";
  }, [commissionYearGoals, viewer.contactId, viewer.isAttorney]);
  const quarters = Array.from(new Set([...getTargetPeriodOptions(), ...workingRecords.map((record) => record.tracker.result.resultQuarter).filter(Boolean)]));

  const activeFilterCount = [
    viewer.canViewAllCases && attorneyIds.length > 0,
    release,
    closing,
    check,
    disbursed,
    reductions,
    quarter,
  ].filter((value) => value !== "all" && value !== false).length;

  const filteredRecords = useMemo(() => {
    const normalizedSearch = search.toLowerCase();

    return workingRecords
      .filter(isResultsTabCase)
      .filter((record) => {
        const result = record.tracker.result;
        const matchesSearch =
          record.shared.caseNumber.toLowerCase().includes(normalizedSearch) ||
          record.shared.clientName.toLowerCase().includes(normalizedSearch);

        if (!matchesSearch) return false;
        if (attorneyIds.length > 0 && !attorneyIds.includes(record.shared.attorneyId)) return false;
        const pinRow = isRowPinnedBySaveFeedback(record.shared.id, rowSaveStatus);
        if (release !== "all" && result.releaseStatus !== release && !pinRow) return false;
        if (closing !== "all" && result.closingStatus !== closing && !pinRow) return false;
        if (check !== "all" && result.checkStatus !== check && !pinRow) return false;
        if (disbursed !== "all" && result.disbursedStatus !== disbursed && !pinRow) return false;
        if (reductions !== "all" && coerceReductionsStatus(result.reductionsStatus) !== reductions && !pinRow) return false;
        if (quarter !== "all" && result.resultQuarter !== quarter && !pinRow) return false;

        return true;
      })
      .sort((a, b) => {
        const dir = sortDirection === "asc" ? 1 : -1;
        const tieBreak = () => compareCaseNumbers(a.shared.caseNumber, b.shared.caseNumber);

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

        if (sortKey === "settlementDate") {
          const aTime = a.tracker.result.settlementDate ? new Date(a.tracker.result.settlementDate).getTime() : 0;
          const bTime = b.tracker.result.settlementDate ? new Date(b.tracker.result.settlementDate).getTime() : 0;
          const cmp = aTime - bTime;
          return cmp !== 0 ? dir * cmp : tieBreak();
        }

        if (sortKey === "settlementAmount") {
          const goal = resolveAttorneyCommissionYearGoal(a, goals);
          const bGoal = resolveAttorneyCommissionYearGoal(b, goals);
          const aValue = getCommissionYearResultAmounts(a, goal).settlementAmount;
          const bValue = getCommissionYearResultAmounts(b, bGoal).settlementAmount;
          const cmp = aValue - bValue;
          return cmp !== 0 ? dir * cmp : tieBreak();
        }

        const aGoal = resolveAttorneyCommissionYearGoal(a, goals);
        const bGoal = resolveAttorneyCommissionYearGoal(b, goals);
        const aFees = getCommissionYearResultAmounts(a, aGoal).attorneyFees;
        const bFees = getCommissionYearResultAmounts(b, bGoal).attorneyFees;
        const cmp = aFees - bFees;
        return cmp !== 0 ? dir * cmp : tieBreak();
      });
  }, [attorneyIds, check, closing, disbursed, goals, quarter, reductions, release, rowSaveStatus, search, settings, sortDirection, sortKey, workingRecords]);

  useEffect(() => {
    recordsRef.current = workingRecords;
  }, [workingRecords]);

  useEffect(() => {
    setWorkingRecords((current) => {
      const pendingCaseIds = new Set(pendingPatchesRef.current.keys());
      const currentById = new Map(current.map((record) => [record.shared.id, record]));
      return records
        .filter(isResultsTabCase)
        .map((record) => {
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
    function updateScrollWidth() {
      setScrollWidth(tableRef.current?.scrollWidth ?? 2300);
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
    setRelease("all");
    setClosing("all");
    setCheck("all");
    setDisbursed("all");
    setReductions("all");
    setQuarter("all");
  }

  function requestSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "clientName" || nextKey === "completion" ? "asc" : "desc");
  }

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

  function mergePersistPatch(caseId: string, patch: ResultPersistPatch) {
    pendingPatchesRef.current.set(caseId, patch);
  }

  function queuePersist(caseId: string, patch: ResultPersistPatch) {
    ensurePreEditSnapshot(caseId);
    mergePersistPatch(caseId, patch);
    markRowSaving(caseId);
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
            tracker: { result: patch.result },
            changeInput: { result: patch.result },
            markReviewed: true,
          }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Unable to save result update.");
        }

        const body = (await response.json()) as { tracker?: TrackerEntry };
        if (body.tracker) {
          setWorkingRecords((current) =>
            current.map((record) =>
              record.shared.id === caseId ? { ...record, tracker: body.tracker! } : record,
            ),
          );
        }

        preEditSnapshotsRef.current.delete(caseId);
        markRowSaved(caseId);
      } catch (error) {
        clearRowSaveStatus(caseId);
        preEditSnapshotsRef.current.delete(caseId);
        const message = error instanceof Error ? error.message : "Unable to save result update.";
        if (snapshotBefore) {
          setWorkingRecords((current) =>
            current.map((record) => (record.shared.id === caseId ? snapshotBefore : record)),
          );
        }
        setSaveMessage(message);
        setRowSaveErrors((current) => ({ ...current, [caseId]: message }));
      }
    }
  }

  function updateResult(recordId: string, updater: (result: SettlementResult) => SettlementResult) {
    const record = recordsRef.current.find((entry) => entry.shared.id === recordId);
    if (!record) return;

    const nextRecord = buildNextResultRecord(record, updater);
    if (!nextRecord) {
      setWorkingRecords((current) => current.filter((entry) => entry.shared.id !== recordId));
      return;
    }

    setWorkingRecords((current) =>
      current.map((entry) => (entry.shared.id === recordId ? nextRecord : entry)),
    );
    queuePersist(recordId, { result: nextRecord.tracker.result });
  }

  function updateResultWorkflow<K extends "releaseStatus" | "closingStatus" | "checkStatus" | "disbursedStatus">(
    recordId: string,
    key: K,
    value: SettlementResult[K],
  ) {
    const now = new Date().toISOString();
    updateResult(recordId, (current) => {
      const result = { ...current, [key]: value };
      if (key === "releaseStatus") result.releaseSignedAt = value === "Signed" ? (result.releaseSignedAt ?? now) : null;
      if (key === "closingStatus") result.closingSignedAt = value === "Signed" ? (result.closingSignedAt ?? now) : null;
      if (key === "checkStatus") result.checkDepositedAt = value === "Deposited" ? (result.checkDepositedAt ?? now) : null;
      if (key === "disbursedStatus") result.checkDisbursedAt = value === "Yes" ? (result.checkDisbursedAt ?? now) : null;
      return result;
    });
  }

  useEffect(() => {
    return () => {
      for (const timer of savedIndicatorTimersRef.current.values()) clearTimeout(timer);
      savedIndicatorTimersRef.current.clear();
    };
  }, []);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input className="sm:max-w-md" placeholder="Search results..." value={search} onChange={(event) => setSearch(event.target.value)} />
          {activeFilterCount > 0 ? (
            <Button variant="ghost" onClick={clearFilters}>
              Clear column filters
            </Button>
          ) : null}
          <p className="text-sm text-muted-foreground sm:ml-auto">
            Showing {filteredRecords.length} of {workingRecords.length} settled cases. Use column headers to filter; click labels to sort.
          </p>
        </div>
        {saveMessage ? <p className="mt-3 text-sm font-medium text-pink-600">{saveMessage}</p> : null}
        <p className="mt-3 text-xs text-muted-foreground">
          Changes save automatically when you update a field. A green checkmark in Actions confirms the server accepted the update.
          Settlement Amount and RJL Attorney Fees show only amounts dated in {commissionYearSummary}; multi-client cases count each party by its own settlement or disburse date.
        </p>

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
          <Table ref={tableRef} className="min-w-[2300px] table-fixed">
            <TableHeader className="sticky top-0 z-20 bg-slate-50 shadow-sm">
              <TableRow>
                <SortableHead label="% Complete" sortKey="completion" active={sortKey} direction={sortDirection} onSort={requestSort} className="sticky left-0 z-40 w-28 bg-slate-50 shadow-[1px_0_0_0_hsl(var(--border))]" />
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
                <TableHead className="w-36">Paralegal</TableHead>
                <SortableHead label="Settlement Date" sortKey="settlementDate" active={sortKey} direction={sortDirection} onSort={requestSort} className="w-48" />
                <SortableHead
                  label="Settlement Amount (CY)"
                  sortKey="settlementAmount"
                  active={sortKey}
                  direction={sortDirection}
                  onSort={requestSort}
                  className="w-40"
                />
                <TableHead className="w-24">Fee Percent</TableHead>
                <SortableHead
                  label="RJL Fees (CY)"
                  sortKey="attorneyFees"
                  active={sortKey}
                  direction={sortDirection}
                  onSort={requestSort}
                  className="w-36"
                />
                <TableHead className="w-32 align-top">
                  <HeaderFilter
                    label="Release"
                    value={release}
                    onChange={setRelease}
                    options={[
                      { value: "all", label: "All" },
                      ...RELEASE_STATUS_OPTIONS.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                </TableHead>
                <TableHead className="w-32 align-top">
                  <HeaderFilter
                    label="Closing"
                    value={closing}
                    onChange={setClosing}
                    options={[
                      { value: "all", label: "All" },
                      ...CLOSING_STATUS_OPTIONS.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                </TableHead>
                <TableHead className="w-32 align-top">
                  <HeaderFilter
                    label="Check"
                    value={check}
                    onChange={setCheck}
                    options={[
                      { value: "all", label: "All" },
                      ...CHECK_STATUS_OPTIONS.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                </TableHead>
                <TableHead className="w-36 align-top">
                  <HeaderFilter
                    label="Reductions"
                    value={reductions}
                    onChange={setReductions}
                    options={[
                      { value: "all", label: "All" },
                      ...REDUCTIONS_MANUAL_STATUS_OPTIONS.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                </TableHead>
                <TableHead className="w-32 align-top">
                  <HeaderFilter
                    label="Disbursed"
                    value={disbursed}
                    onChange={setDisbursed}
                    options={[
                      { value: "all", label: "All" },
                      ...DISBURSED_STATUS_OPTIONS.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                </TableHead>
                <TableHead className="w-36 align-top">
                  <HeaderFilter
                    label="Result quarter"
                    value={quarter}
                    onChange={setQuarter}
                    options={[
                      { value: "all", label: "All" },
                      ...quarters.map((item) => ({ value: item ?? "", label: item ?? "" })),
                    ]}
                  />
                </TableHead>
                <TableHead className="w-48">Disburse Date</TableHead>
                <TableHead className="w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.map((record) => {
                const result = record.tracker.result;
                const saveStatus = rowSaveStatus[record.shared.id];
                const saveError = rowSaveErrors[record.shared.id];
                const commissionGoal = resolveAttorneyCommissionYearGoal(record, goals);
                const commissionAmounts = getCommissionYearResultAmounts(record, commissionGoal);
                const caseTotalSettlement = result.settlementAmount ?? 0;
                const caseTotalFees =
                  result.attorneyFees ??
                  getCalculatedAttorneyFees(result.settlementAmount, result.feePercent) ??
                  0;
                const showCaseTotalHint =
                  commissionAmounts.settlementAmount !== caseTotalSettlement ||
                  commissionAmounts.attorneyFees !== caseTotalFees;

                return (
                  <TableRow key={record.shared.id}>
                    <TableCell className="sticky left-0 z-10 w-28 bg-white shadow-[1px_0_0_0_hsl(var(--border))]">
                      <CaseCompletionCell record={record} settings={settings} />
                    </TableCell>
                    <TableCell className="sticky left-28 z-10 w-28 bg-white shadow-[1px_0_0_0_hsl(var(--border))]">
                      <CaseNumberLink caseId={record.shared.id} caseNumber={record.shared.caseNumber} openInNewTab />
                    </TableCell>
                    <TableCell className="sticky left-56 z-10 w-44 bg-white font-medium text-navy-950 shadow-[1px_0_0_0_hsl(var(--border))]">{record.shared.clientName}</TableCell>
                    <TableCell className="sticky left-[25rem] z-10 w-40 bg-white font-medium text-navy-950 shadow-[1px_0_0_0_hsl(var(--border))]">{record.attorney.name}</TableCell>
                    <TableCell className="w-36">{record.paralegal.name}</TableCell>
                    <TableCell className="w-48">
                      <Input className="h-9 w-full text-xs" type="date" value={toDateInput(result.settlementDate)} onChange={(event) => updateResult(record.shared.id, (current) => ({ ...current, settlementDate: fromDateInput(event.target.value) }))} />
                    </TableCell>
                    <TableCell className="w-40">
                      <div className="space-y-0.5">
                        <p className="whitespace-nowrap font-medium text-navy-950">
                          {formatCurrency(commissionAmounts.settlementAmount)}
                        </p>
                        {showCaseTotalHint && caseTotalSettlement > 0 ? (
                          <p className="text-[10px] text-muted-foreground" title="Full case total">
                            Case total {formatCurrency(caseTotalSettlement)}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="w-24 whitespace-nowrap text-sm text-muted-foreground">
                      {commissionAmounts.feePercent != null
                        ? `${Math.round(commissionAmounts.feePercent * 100)}%`
                        : result.feePercent != null
                          ? `${Math.round(result.feePercent * 100)}%`
                          : "—"}
                    </TableCell>
                    <TableCell className="w-36">
                      <div className="space-y-0.5">
                        <p className="whitespace-nowrap font-medium text-navy-950">
                          {formatCurrency(commissionAmounts.attorneyFees)}
                        </p>
                        {showCaseTotalHint && caseTotalFees > 0 ? (
                          <p className="text-[10px] text-muted-foreground" title="Full case total">
                            Case total {formatCurrency(caseTotalFees)}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="w-32">
                      <InlineSelect value={result.releaseStatus} onChange={(value) => updateResultWorkflow(record.shared.id, "releaseStatus", value as ReleaseStatus)}>
                        {RELEASE_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      </InlineSelect>
                    </TableCell>
                    <TableCell className="w-32">
                      <InlineSelect value={result.closingStatus} onChange={(value) => updateResultWorkflow(record.shared.id, "closingStatus", value as ClosingStatus)}>
                        {CLOSING_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      </InlineSelect>
                    </TableCell>
                    <TableCell className="w-32">
                      <InlineSelect value={result.checkStatus} onChange={(value) => updateResultWorkflow(record.shared.id, "checkStatus", value as CheckStatus)}>
                        {CHECK_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      </InlineSelect>
                    </TableCell>
                    <TableCell className="w-36">
                      <InlineSelect
                        value={coerceReductionsStatus(result.reductionsStatus)}
                        onChange={(value) =>
                          updateResult(record.shared.id, (current) => ({
                            ...current,
                            reductionsStatus: value as ReductionsStatus,
                          }))
                        }
                      >
                        {REDUCTIONS_MANUAL_STATUS_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </InlineSelect>
                    </TableCell>
                    <TableCell className="w-32">
                      <InlineSelect value={result.disbursedStatus} onChange={(value) => updateResultWorkflow(record.shared.id, "disbursedStatus", value as DisbursedStatus)}>
                        {DISBURSED_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      </InlineSelect>
                    </TableCell>
                    <TableCell className="w-36 whitespace-nowrap text-sm text-muted-foreground">
                      {result.resultQuarter ?? "—"}
                    </TableCell>
                    <TableCell className="w-48">
                      <Input className="h-9 w-full text-xs" type="date" value={toDateInput(result.disburseDate)} onChange={(event) => updateResult(record.shared.id, (current) => ({ ...current, disburseDate: fromDateInput(event.target.value) }))} />
                    </TableCell>
                    <TableCell className="w-28">
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
        type="button"
        className="inline-flex max-w-full items-center gap-1 whitespace-normal text-left text-xs font-semibold uppercase leading-tight text-muted-foreground"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <Icon className={isActive ? "h-3.5 w-3.5 text-pink-500" : "h-3.5 w-3.5"} />
      </button>
    </TableHead>
  );
}

function InlineSelect({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <Select className="h-9 w-full min-w-0 text-xs" value={value} onChange={(event) => onChange(event.target.value)}>
      {children}
    </Select>
  );
}

function toDateInput(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

function fromDateInput(value: string) {
  if (!value) return null;
  return new Date(`${value}T10:00:00.000Z`).toISOString();
}
