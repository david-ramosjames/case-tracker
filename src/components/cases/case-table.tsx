"use client";

import Link from "next/link";
import { CaseNumberLink } from "@/components/cases/case-number-link";
import { ArrowDown, ArrowUp, ArrowUpDown, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  EXPECTED_LITIGATION_OPTIONS,
  LIABILITY_OPTIONS,
  getTargetPeriodFilterOptions,
  getTargetPeriodSelectOptions,
  toStandardTargetPeriodLabel,
} from "@/lib/case-options";
import { CaseAttorneyScoreCell } from "@/components/attorney-score/attorney-score";
import { getCaseAttorneyScore } from "@/lib/attorney-score";
import { getCaseCompletionScore, getDataQualityFlags } from "@/lib/calculations";
import { getCasePipelineFilter, type CasePipelineFilter, type ViewerContext } from "@/lib/auth/access";
import {
  type AppUser,
  type AttorneyGoal,
  type CaseRecord,
  type CaseStage,
  type CaseTrackerSettings,
  type ExpectedLitigationStatus,
  type TrackerEntry,
} from "@/lib/types";
import { cn, formatDate, formatOptionalDate } from "@/lib/utils";
import { cleanCaseNumber, compareCaseNumbers } from "@/lib/csv/parse";
import { type ReactNode, type RefObject, type UIEvent, useEffect, useMemo, useRef, useState } from "react";

type SortKey = "completion" | "attorneyScore" | "caseNumber" | "clientName" | "dateSigned" | "dol" | "minimumValue" | "policyLimits";
type SortDirection = "asc" | "desc";

export function CaseTable({
  records,
  users,
  settings,
  goals,
  viewer,
  initialSearch = "",
}: {
  records: CaseRecord[];
  users: AppUser[];
  settings: CaseTrackerSettings;
  goals: AttorneyGoal[];
  viewer: ViewerContext;
  initialSearch?: string;
}) {
  const [workingRecords, setWorkingRecords] = useState(records);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [search, setSearch] = useState(initialSearch);
  const [attorneyIds, setAttorneyIds] = useState<string[]>([]);
  const [paralegal, setParalegal] = useState("all");
  const [stage, setStage] = useState("all");
  const [status, setStatus] = useState<CasePipelineFilter>("Active");
  const [caseType, setCaseType] = useState("all");
  const [liability, setLiability] = useState("all");
  const [caseSize, setCaseSize] = useState("all");
  const [expectedLitigation, setExpectedLitigation] = useState("all");
  const [quarter, setQuarter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("attorneyScore");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [scrollWidth, setScrollWidth] = useState(2140);

  const needsAttentionCount = useMemo(
    () => workingRecords.filter((record) => getCaseCompletionScore(record, settings).percent < 85).length,
    [settings, workingRecords],
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
    expectedLitigation !== "all",
  ].filter(Boolean).length;

  useEffect(() => {
    if (initialSearch) setSearch(initialSearch);
  }, [initialSearch]);

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
        if (stage !== "all" && record.tracker.caseStage !== stage) return false;
        const pipeline = getCasePipelineFilter(record, goals);
        if (status !== "all" && pipeline !== status) return false;
        if (caseType !== "all" && record.shared.caseType !== caseType) return false;
        if (liability !== "all" && record.tracker.liability !== liability) return false;
        if (caseSize !== "all" && record.tracker.caseSize !== caseSize) return false;
        if (expectedLitigation !== "all" && record.tracker.expectedLitigation !== expectedLitigation) return false;
        if (quarter !== "all" && toStandardTargetPeriodLabel(record.tracker.targetResolutionQuarter) !== quarter) return false;

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
          const aTime = a.shared.dateOfIncident ? new Date(a.shared.dateOfIncident).getTime() : 0;
          const bTime = b.shared.dateOfIncident ? new Date(b.shared.dateOfIncident).getTime() : 0;
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
  }, [attorneyIds, caseSize, caseType, expectedLitigation, goals, liability, paralegal, quarter, search, settings, sortDirection, sortKey, stage, status, workingRecords]);

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
    setExpectedLitigation("all");
    setQuarter("all");
  }

  function updateRecord(recordId: string, updater: (record: CaseRecord) => CaseRecord) {
    let nextRecord: CaseRecord | null = null;
    setWorkingRecords((current) =>
      current.map((record) => {
        if (record.shared.id !== recordId) return record;
        nextRecord = updater(record);
        return nextRecord;
      }),
    );

    if (nextRecord) {
      void persistRecord(nextRecord);
    }
  }

  async function persistRecord(record: CaseRecord) {
    const response = await fetch(`/api/tracker/${record.shared.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shared: {
          caseType: record.shared.caseType,
        },
        tracker: {
          caseStage: record.tracker.caseStage,
          targetResolutionQuarter: record.tracker.targetResolutionQuarter,
          liability: record.tracker.liability,
          caseSize: record.tracker.caseSize,
          minimumValue: record.tracker.minimumValue,
          referralFee: record.tracker.referralFee,
          policyLimits: record.tracker.policyLimits,
          expectedLitigation: record.tracker.expectedLitigation,
        },
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setSaveMessage(body?.error ?? "Unable to save inline case update.");
    }
  }

  function updateSharedField(recordId: string, key: "caseType", value: string) {
    updateRecord(recordId, (record) => ({
      ...record,
      shared: {
        ...record.shared,
        [key]: value,
      },
    }));
  }

  function updateTrackerField<K extends "caseStage" | "targetResolutionQuarter" | "liability" | "minimumValue" | "referralFee" | "policyLimits" | "expectedLitigation">(
    recordId: string,
    key: K,
    value: TrackerEntry[K],
  ) {
    updateRecord(recordId, (record) => {
      const tracker = {
        ...record.tracker,
        [key]: value,
        ...(key === "minimumValue"
          ? { caseSize: deriveCaseSizeFromMinimumValue(value as number | null) }
          : {}),
      };
      return {
        ...record,
        tracker,
        shared: {
          ...record.shared,
          status: deriveCaseStatusFromTracker(tracker.caseStage, tracker.result.disbursedStatus),
        },
      };
    });
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
              {status === "all" ? (
                <>Showing {filteredRecords.length} of {workingRecords.length} cases</>
              ) : (
                <>
                  Showing {filteredRecords.length} {status.toLowerCase()} case{filteredRecords.length === 1 ? "" : "s"}
                  {filteredRecords.length !== workingRecords.length ? (
                    <> of {workingRecords.length} total</>
                  ) : null}
                </>
              )}
            </p>
          </div>
          {saveMessage ? <p className="text-sm font-medium text-pink-500">{saveMessage}</p> : null}

          {needsAttentionCount > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <span className="font-semibold">{needsAttentionCount} case{needsAttentionCount === 1 ? "" : "s"}</span> below 85% complete — sort by{" "}
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
                      ...CASE_SIZE_OPTIONS.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                </TableHead>
                <SortableHead label="Minimum Value" sortKey="minimumValue" active={sortKey} direction={sortDirection} onSort={requestSort} className="w-36" />
                <TableHead className="w-32">Referral Fee</TableHead>
                <SortableHead label="Policy Limits" sortKey="policyLimits" active={sortKey} direction={sortDirection} onSort={requestSort} className="w-36" />
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
                <TableHead className="w-44 align-top">
                  <HeaderFilter
                    label="Expected Lit"
                    value={expectedLitigation}
                    onChange={setExpectedLitigation}
                    options={[
                      { value: "all", label: "All" },
                      ...EXPECTED_LITIGATION_OPTIONS.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                </TableHead>
                <TableHead className="w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.map((record) => {
                const flags = getDataQualityFlags(record, settings);

                return (
                  <TableRow key={record.shared.id}>
                    <TableCell className="sticky left-0 z-10 bg-white shadow-[1px_0_0_0_hsl(var(--border))]">
                      <CaseAttorneyScoreCell record={record} prominent />
                    </TableCell>
                    <TableCell className="sticky left-28 z-10 bg-white shadow-[1px_0_0_0_hsl(var(--border))]">
                      <CaseNumberLink caseId={record.shared.id} caseNumber={record.shared.caseNumber} />
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
                      <InlineSelect value={record.tracker.caseStage} onChange={(value) => updateTrackerField(record.shared.id, "caseStage", value as CaseStage)}>
                        {CASE_STAGE_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </InlineSelect>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <InlineSelect value={record.tracker.expectedLitigation ?? ""} onChange={(value) => updateTrackerField(record.shared.id, "expectedLitigation", (value || null) as TrackerEntry["expectedLitigation"])}>
                          <option value="">Needs info</option>
                          {EXPECTED_LITIGATION_OPTIONS.filter(
                            (option) => option !== "Lit" || record.tracker.caseStage === "Lit",
                          ).map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </InlineSelect>
                        {flags.length > 0 ? <Badge variant={flags[0].severity}>{flags[0].id === "stale-review" ? "Stale" : "Needs info"}</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/cases/${record.shared.id}`}>
                          <Eye className="h-4 w-4" />
                          View
                        </Link>
                      </Button>
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
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <Select className="h-9 min-w-0 text-xs" value={value} onChange={(event) => onChange(event.target.value)}>
      {children}
    </Select>
  );
}

function InlineNumberInput({
  value,
  onCommit,
  prefix,
  suffix,
}: {
  value: number | null;
  onCommit: (value: number | null) => void;
  prefix?: string;
  suffix?: string;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(value == null ? "" : formatNumberForInput(value));

  useEffect(() => {
    if (!isFocused) setDraft(value == null ? "" : formatNumberForInput(value));
  }, [isFocused, value]);

  function commit() {
    const nextValue = parseFormattedNumber(draft);
    if (nextValue !== null && Number.isNaN(nextValue)) {
      setDraft(value == null ? "" : formatNumberForInput(value));
      return;
    }
    if (nextValue !== value) onCommit(nextValue);
    setDraft(nextValue == null ? "" : formatNumberForInput(nextValue));
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
            setDraft(value == null ? "" : formatNumberForInput(value));
            setIsFocused(false);
            event.currentTarget.blur();
          }
        }}
      />
      {suffix ? <span className="ml-1 text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

function formatNumberForInput(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function parseFormattedNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number(trimmed.replace(/[$,%\s,]/g, ""));
}
