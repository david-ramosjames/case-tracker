"use client";

import Link from "next/link";
import { CaseNumberLink } from "@/components/cases/case-number-link";
import { ArrowUpDown, Eye, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CASE_STAGE_OPTIONS,
  CASE_STATUS_OPTIONS,
  CASE_TYPE_OPTIONS,
  CASE_SIZE_OPTIONS,
  EXPECTED_LITIGATION_OPTIONS,
  LIABILITY_OPTIONS,
  getTargetPeriodOptions,
} from "@/lib/case-options";
import { getDataQualityFlags, isMissingInfo, isStale } from "@/lib/calculations";
import {
  type AppUser,
  type CaseRecord,
  type CaseStage,
  type CaseStatus,
  type CaseTrackerSettings,
  type ExpectedLitigationStatus,
  type TrackerEntry,
} from "@/lib/types";
import { cn, formatDate, formatOptionalDate } from "@/lib/utils";
import { type ReactNode, type RefObject, type UIEvent, useEffect, useMemo, useRef, useState } from "react";

type SortKey = "caseNumber" | "clientName" | "dateSigned" | "dol" | "minimumValue" | "policyLimits";

export function CaseTable({
  records,
  users,
  settings,
}: {
  records: CaseRecord[];
  users: AppUser[];
  settings: CaseTrackerSettings;
}) {
  const [workingRecords, setWorkingRecords] = useState(records);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [attorney, setAttorney] = useState("all");
  const [paralegal, setParalegal] = useState("all");
  const [stage, setStage] = useState("all");
  const [status, setStatus] = useState("all");
  const [caseType, setCaseType] = useState("all");
  const [expectedLitigation, setExpectedLitigation] = useState("all");
  const [quarter, setQuarter] = useState("all");
  const [quality, setQuality] = useState("all");
  const [active, setActive] = useState("active");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("caseNumber");
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [scrollWidth, setScrollWidth] = useState(2040);

  const attorneys = users.filter((user) => user.role === "attorney");
  const paralegals = users.filter((user) => user.role === "paralegal");
  const quarters = Array.from(
    new Set([...getTargetPeriodOptions(), ...workingRecords.map((record) => record.tracker.targetResolutionQuarter).filter(Boolean)]),
  );
  const activeFilterCount = [
    attorney !== "all",
    paralegal !== "all",
    stage !== "all",
    status !== "all",
    caseType !== "all",
    expectedLitigation !== "all",
    quarter !== "all",
    quality !== "all",
    active !== "active",
    Boolean(dateFrom),
    Boolean(dateTo),
  ].filter(Boolean).length;

  const filteredRecords = useMemo(() => {
    const normalizedSearch = search.toLowerCase();

    return workingRecords
      .filter((record) => {
        const matchesSearch =
          record.shared.caseNumber.toLowerCase().includes(normalizedSearch) ||
          record.shared.clientName.toLowerCase().includes(normalizedSearch) ||
          record.attorney.name.toLowerCase().includes(normalizedSearch);

        if (!matchesSearch) return false;
        if (attorney !== "all" && record.shared.attorneyId !== attorney) return false;
        if (paralegal !== "all" && record.shared.paralegalId !== paralegal) return false;
        if (stage !== "all" && record.tracker.caseStage !== stage) return false;
        if (status !== "all" && record.shared.status !== status) return false;
        if (caseType !== "all" && record.shared.caseType !== caseType) return false;
        if (expectedLitigation !== "all" && record.tracker.expectedLitigation !== expectedLitigation) return false;
        if (quarter !== "all" && record.tracker.targetResolutionQuarter !== quarter) return false;
        if (active === "active" && record.shared.status !== "Active") return false;
        if (active === "inactive" && record.shared.status !== "Closed") return false;
        if (quality === "missing" && !isMissingInfo(record, settings)) return false;
        if (quality === "stale" && !isStale(record, settings)) return false;
        if (dateFrom && new Date(record.shared.dateSigned) < new Date(`${dateFrom}T00:00:00`)) return false;
        if (dateTo && new Date(record.shared.dateSigned) > new Date(`${dateTo}T23:59:59`)) return false;

        return true;
      })
      .sort((a, b) => {
        if (sortKey === "caseNumber") return a.shared.caseNumber.localeCompare(b.shared.caseNumber);
        if (sortKey === "clientName") return a.shared.clientName.localeCompare(b.shared.clientName);
        if (sortKey === "dateSigned") return new Date(a.shared.dateSigned).getTime() - new Date(b.shared.dateSigned).getTime();
        if (sortKey === "dol") {
          const aTime = a.shared.dateOfIncident ? new Date(a.shared.dateOfIncident).getTime() : 0;
          const bTime = b.shared.dateOfIncident ? new Date(b.shared.dateOfIncident).getTime() : 0;
          return aTime - bTime;
        }
        if (sortKey === "minimumValue") return (b.tracker.minimumValue ?? 0) - (a.tracker.minimumValue ?? 0);
        return (b.tracker.policyLimits ?? 0) - (a.tracker.policyLimits ?? 0);
      });
  }, [active, attorney, caseType, dateFrom, dateTo, expectedLitigation, paralegal, quarter, quality, search, settings, sortKey, stage, status, workingRecords]);

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
    setAttorney("all");
    setParalegal("all");
    setStage("all");
    setStatus("all");
    setCaseType("all");
    setExpectedLitigation("all");
    setQuarter("all");
    setQuality("all");
    setActive("active");
    setDateFrom("");
    setDateTo("");
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
          status: record.shared.status,
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

  function updateSharedField(recordId: string, key: "status" | "caseType", value: string) {
    updateRecord(recordId, (record) => ({
      ...record,
      shared: {
        ...record.shared,
        [key]: value,
      },
      tracker: key === "status" ? { ...record.tracker, isActive: value === "Active" } : record.tracker,
    }));
  }

  function updateTrackerField<K extends "caseStage" | "targetResolutionQuarter" | "liability" | "caseSize" | "minimumValue" | "referralFee" | "policyLimits" | "expectedLitigation">(
    recordId: string,
    key: K,
    value: TrackerEntry[K],
  ) {
    updateRecord(recordId, (record) => ({
      ...record,
      tracker: {
        ...record.tracker,
        [key]: value,
      },
    }));
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
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setFiltersOpen((current) => !current)}
                aria-expanded={filtersOpen}
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filters
                {activeFilterCount > 0 ? <Badge variant="pink">{activeFilterCount}</Badge> : null}
              </Button>
              {activeFilterCount > 0 ? (
                <Button variant="ghost" onClick={clearFilters}>
                  Clear
                </Button>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground lg:ml-auto">
              Showing {filteredRecords.length} of {workingRecords.length} cases
            </p>
          </div>
          {saveMessage ? <p className="text-sm font-medium text-pink-500">{saveMessage}</p> : null}

          {filtersOpen ? (
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-3 xl:grid-cols-5">
              <Select value={attorney} onChange={(event) => setAttorney(event.target.value)} aria-label="Attorney">
                <option value="all">All attorneys</option>
                {attorneys.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
              <Select value={paralegal} onChange={(event) => setParalegal(event.target.value)} aria-label="Paralegal">
                <option value="all">All paralegals</option>
                {paralegals.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
              <Select value={stage} onChange={(event) => setStage(event.target.value)} aria-label="Stage">
                <option value="all">All stages</option>
                {CASE_STAGE_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
              <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
                <option value="all">All statuses</option>
                {CASE_STATUS_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
              <Select value={caseType} onChange={(event) => setCaseType(event.target.value)} aria-label="Type">
                <option value="all">All types</option>
                {CASE_TYPE_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
              <Select value={quality} onChange={(event) => setQuality(event.target.value)} aria-label="Quality">
                <option value="all">All quality</option>
                <option value="missing">Missing fields</option>
                <option value="stale">Stale cases</option>
              </Select>
              <Select value={expectedLitigation} onChange={(event) => setExpectedLitigation(event.target.value)} aria-label="Expected litigation">
                <option value="all">All litigation status</option>
                {EXPECTED_LITIGATION_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
              <Select value={quarter} onChange={(event) => setQuarter(event.target.value)} aria-label="Target quarter">
                <option value="all">All target quarters</option>
                {quarters.map((item) => (
                  <option key={item} value={item ?? ""}>
                    {item}
                  </option>
                ))}
              </Select>
              <Select value={active} onChange={(event) => setActive(event.target.value)} aria-label="Active status">
                <option value="active">Active cases</option>
                <option value="inactive">Closed cases</option>
                <option value="all">Active and closed</option>
              </Select>
              <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Date signed from" />
              <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Date signed to" />
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
          <Table ref={tableRef} className="min-w-[2040px] table-fixed">
            <TableHeader className="sticky top-0 z-20 bg-slate-50 shadow-sm">
              <TableRow>
                <SortableHead label="Case #" sortKey="caseNumber" active={sortKey} onSort={setSortKey} className="sticky left-0 z-40 w-28 bg-slate-50 shadow-[1px_0_0_0_hsl(var(--border))]" />
                <SortableHead label="Client" sortKey="clientName" active={sortKey} onSort={setSortKey} className="sticky left-28 z-40 w-44 bg-slate-50 shadow-[1px_0_0_0_hsl(var(--border))]" />
                <TableHead className="sticky left-72 z-40 w-40 bg-slate-50 shadow-[1px_0_0_0_hsl(var(--border))]">Attorney</TableHead>
                <TableHead className="w-36">Paralegal</TableHead>
                <SortableHead label="Date Signed" sortKey="dateSigned" active={sortKey} onSort={setSortKey} className="w-32" />
                <SortableHead label="DOL" sortKey="dol" active={sortKey} onSort={setSortKey} className="w-32" />
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-36">Type</TableHead>
                <TableHead className="w-40">Liability</TableHead>
                <TableHead className="w-28">Quarter</TableHead>
                <TableHead className="w-32">Case Size</TableHead>
                <SortableHead label="Minimum Value" sortKey="minimumValue" active={sortKey} onSort={setSortKey} className="w-36" />
                <TableHead className="w-32">Referral Fee</TableHead>
                <SortableHead label="Policy Limits" sortKey="policyLimits" active={sortKey} onSort={setSortKey} className="w-36" />
                <TableHead className="w-36">Stage</TableHead>
                <TableHead className="w-44">Expected Lit</TableHead>
                <TableHead className="w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.map((record) => {
                const flags = getDataQualityFlags(record, settings);

                return (
                  <TableRow key={record.shared.id}>
                    <TableCell className="sticky left-0 z-10 bg-white shadow-[1px_0_0_0_hsl(var(--border))]">
                      <CaseNumberLink caseId={record.shared.id} caseNumber={record.shared.caseNumber} />
                    </TableCell>
                    <TableCell className="sticky left-28 z-10 bg-white font-medium text-navy-950 shadow-[1px_0_0_0_hsl(var(--border))]">{record.shared.clientName}</TableCell>
                    <TableCell className="sticky left-72 z-10 bg-white font-medium text-navy-950 shadow-[1px_0_0_0_hsl(var(--border))]">{record.attorney.name}</TableCell>
                    <TableCell>{record.paralegal.name}</TableCell>
                    <TableCell>{formatDate(record.shared.dateSigned)}</TableCell>
                    <TableCell>{formatOptionalDate(record.shared.dateOfIncident)}</TableCell>
                    <TableCell>
                      <InlineSelect value={record.shared.status} onChange={(value) => updateSharedField(record.shared.id, "status", value)}>
                        {CASE_STATUS_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </InlineSelect>
                    </TableCell>
                    <TableCell>
                      <InlineSelect value={record.shared.caseType} onChange={(value) => updateSharedField(record.shared.id, "caseType", value)}>
                        {CASE_TYPE_OPTIONS.map((option) => (
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
                      <InlineSelect value={record.tracker.targetResolutionQuarter ?? ""} onChange={(value) => updateTrackerField(record.shared.id, "targetResolutionQuarter", value || null)}>
                        <option value="">Not set</option>
                        {quarters.map((option) => (
                          <option key={option} value={option ?? ""}>{option}</option>
                        ))}
                      </InlineSelect>
                    </TableCell>
                    <TableCell>
                      <InlineSelect value={record.tracker.caseSize ?? ""} onChange={(value) => updateTrackerField(record.shared.id, "caseSize", value || null)}>
                        <option value="">Not set</option>
                        {CASE_SIZE_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </InlineSelect>
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
                          <option value="">Not set</option>
                          {EXPECTED_LITIGATION_OPTIONS.map((option) => (
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
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  return (
    <TableHead className={cn("align-middle", className)}>
      <button
        className="inline-flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <ArrowUpDown className={active === sortKey ? "h-3.5 w-3.5 text-pink-500" : "h-3.5 w-3.5"} />
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
