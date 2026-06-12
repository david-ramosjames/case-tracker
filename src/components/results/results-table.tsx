"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Eye } from "lucide-react";
import { CaseCompletionCell } from "@/components/cases/case-completion-cell";
import { CaseNumberLink } from "@/components/cases/case-number-link";
import { type ViewerContext } from "@/lib/auth/access";
import { getCaseCompletionScore } from "@/lib/calculations";
import { compareCaseNumbers } from "@/lib/csv/parse";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HeaderFilter } from "@/components/ui/header-filter";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  applyDerivedSettlementResult,
  REDUCTIONS_MANUAL_STATUS_OPTIONS,
  CHECK_STATUS_OPTIONS,
  CLOSING_STATUS_OPTIONS,
  DISBURSED_STATUS_OPTIONS,
  REDUCTIONS_STATUS_OPTIONS,
  RELEASE_STATUS_OPTIONS,
  getTargetPeriodOptions,
} from "@/lib/case-options";
import {
  type AppUser,
  type CaseRecord,
  type CaseTrackerSettings,
  type CheckStatus,
  type ClosingStatus,
  type DisbursedStatus,
  type ReductionsStatus,
  type ReleaseStatus,
  type SettlementResult,
} from "@/lib/types";
import { formatCurrency, getCalculatedAttorneyFees } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";

type SortKey = "completion" | "caseNumber" | "clientName" | "settlementDate" | "settlementAmount" | "attorneyFees";
type SortDirection = "asc" | "desc";

function hasSettlementDate(record: CaseRecord) {
  return Boolean(record.tracker.result.settlementDate);
}

export function ResultsTable({
  records,
  users,
  settings,
  viewer,
}: {
  records: CaseRecord[];
  users: AppUser[];
  settings: CaseTrackerSettings;
  viewer: ViewerContext;
}) {
  const [workingRecords, setWorkingRecords] = useState(() => records.filter(hasSettlementDate));
  const [search, setSearch] = useState("");
  const [attorney, setAttorney] = useState("all");
  const [release, setRelease] = useState("all");
  const [closing, setClosing] = useState("all");
  const [check, setCheck] = useState("all");
  const [disbursed, setDisbursed] = useState("all");
  const [reductions, setReductions] = useState("all");
  const [quarter, setQuarter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("caseNumber");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const attorneys = users.filter((user) => user.role === "attorney");
  const quarters = Array.from(new Set([...getTargetPeriodOptions(), ...workingRecords.map((record) => record.tracker.result.resultQuarter).filter(Boolean)]));

  const activeFilterCount = [
    viewer.canViewAllCases && attorney !== "all",
    release,
    closing,
    check,
    disbursed,
    reductions,
    quarter,
  ].filter((value) => value !== "all").length;

  const filteredRecords = useMemo(() => {
    const normalizedSearch = search.toLowerCase();

    return workingRecords
      .filter(hasSettlementDate)
      .filter((record) => {
        const result = record.tracker.result;
        const matchesSearch =
          record.shared.caseNumber.toLowerCase().includes(normalizedSearch) ||
          record.shared.clientName.toLowerCase().includes(normalizedSearch);

        if (!matchesSearch) return false;
        if (attorney !== "all" && record.shared.attorneyId !== attorney) return false;
        if (release !== "all" && result.releaseStatus !== release) return false;
        if (closing !== "all" && result.closingStatus !== closing) return false;
        if (check !== "all" && result.checkStatus !== check) return false;
        if (disbursed !== "all" && result.disbursedStatus !== disbursed) return false;
        if (reductions !== "all" && result.reductionsStatus !== reductions) return false;
        if (quarter !== "all" && result.resultQuarter !== quarter) return false;

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
          const aValue = a.tracker.result.settlementAmount ?? -Infinity;
          const bValue = b.tracker.result.settlementAmount ?? -Infinity;
          const cmp = aValue - bValue;
          return cmp !== 0 ? dir * cmp : tieBreak();
        }

        const aFees =
          a.tracker.result.attorneyFees ??
          getCalculatedAttorneyFees(a.tracker.result.settlementAmount, a.tracker.result.feePercent) ??
          -Infinity;
        const bFees =
          b.tracker.result.attorneyFees ??
          getCalculatedAttorneyFees(b.tracker.result.settlementAmount, b.tracker.result.feePercent) ??
          -Infinity;
        const cmp = aFees - bFees;
        return cmp !== 0 ? dir * cmp : tieBreak();
      });
  }, [attorney, check, closing, disbursed, quarter, reductions, release, search, settings, sortDirection, sortKey, workingRecords]);

  function clearFilters() {
    setAttorney("all");
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

  function updateResult(recordId: string, updater: (result: SettlementResult) => SettlementResult) {
    let nextRecord: CaseRecord | null = null;
    setWorkingRecords((current) =>
      current.flatMap((record) => {
        if (record.shared.id !== recordId) return [record];
        const result = applyDerivedSettlementResult(updater(record.tracker.result), record.tracker);
        if (!result.settlementDate) return [];
        nextRecord = {
          ...record,
          tracker: {
            ...record.tracker,
            result,
          },
        };
        return [nextRecord];
      }),
    );

    if (nextRecord) void persistResult(nextRecord);
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

  async function persistResult(record: CaseRecord) {
    await fetch(`/api/tracker/${record.shared.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tracker: {
          result: record.tracker.result,
        },
      }),
    });
  }

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

        <div className="mt-4 overflow-x-auto rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="% Complete" sortKey="completion" active={sortKey} direction={sortDirection} onSort={requestSort} />
                <SortableHead label="Case #" sortKey="caseNumber" active={sortKey} direction={sortDirection} onSort={requestSort} />
                <SortableHead label="Client" sortKey="clientName" active={sortKey} direction={sortDirection} onSort={requestSort} />
                <TableHead className="align-top">
                  {viewer.canViewAllCases ? (
                    <HeaderFilter
                      label="Attorney"
                      value={attorney}
                      onChange={setAttorney}
                      options={[
                        { value: "all", label: "All" },
                        ...attorneys.map((item) => ({ value: item.id, label: item.name })),
                      ]}
                    />
                  ) : (
                    <span className="text-xs font-semibold uppercase text-muted-foreground">Attorney</span>
                  )}
                </TableHead>
                <TableHead>Paralegal</TableHead>
                <SortableHead label="Settlement Date" sortKey="settlementDate" active={sortKey} direction={sortDirection} onSort={requestSort} />
                <SortableHead label="Settlement Amount" sortKey="settlementAmount" active={sortKey} direction={sortDirection} onSort={requestSort} />
                <TableHead>Fee Percent</TableHead>
                <SortableHead label="RJL Attorney Fees" sortKey="attorneyFees" active={sortKey} direction={sortDirection} onSort={requestSort} />
                <TableHead className="align-top">
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
                <TableHead className="align-top">
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
                <TableHead className="align-top">
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
                <TableHead className="align-top">
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
                <TableHead className="align-top">
                  <HeaderFilter
                    label="Reductions"
                    value={reductions}
                    onChange={setReductions}
                    options={[
                      { value: "all", label: "All" },
                      ...REDUCTIONS_STATUS_OPTIONS.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                </TableHead>
                <TableHead className="align-top">
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
                <TableHead>Disburse Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.map((record) => {
                const result = record.tracker.result;

                return (
                  <TableRow key={record.shared.id}>
                    <TableCell className="w-28">
                      <CaseCompletionCell record={record} settings={settings} />
                    </TableCell>
                    <TableCell>
                      <CaseNumberLink caseId={record.shared.id} caseNumber={record.shared.caseNumber} />
                    </TableCell>
                    <TableCell>{record.shared.clientName}</TableCell>
                    <TableCell>{record.attorney.name}</TableCell>
                    <TableCell>{record.paralegal.name}</TableCell>
                    <TableCell>
                      <Input className="h-9 min-w-32 text-xs" type="date" value={toDateInput(result.settlementDate)} onChange={(event) => updateResult(record.shared.id, (current) => ({ ...current, settlementDate: fromDateInput(event.target.value) }))} />
                    </TableCell>
                    <TableCell>
                      <InlineNumberInput prefix="$" value={result.settlementAmount} onCommit={(value) => updateResult(record.shared.id, (current) => ({ ...current, settlementAmount: value }))} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {Math.round((result.feePercent ?? 0) * 100)}%
                    </TableCell>
                    <TableCell>{formatCurrency(result.attorneyFees)}</TableCell>
                    <TableCell>
                      <InlineSelect value={result.releaseStatus} onChange={(value) => updateResultWorkflow(record.shared.id, "releaseStatus", value as ReleaseStatus)}>
                        {RELEASE_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      </InlineSelect>
                    </TableCell>
                    <TableCell>
                      <InlineSelect value={result.closingStatus} onChange={(value) => updateResultWorkflow(record.shared.id, "closingStatus", value as ClosingStatus)}>
                        {CLOSING_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      </InlineSelect>
                    </TableCell>
                    <TableCell>
                      <InlineSelect value={result.checkStatus} onChange={(value) => updateResultWorkflow(record.shared.id, "checkStatus", value as CheckStatus)}>
                        {CHECK_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      </InlineSelect>
                    </TableCell>
                    <TableCell>
                      <InlineSelect value={result.disbursedStatus} onChange={(value) => updateResultWorkflow(record.shared.id, "disbursedStatus", value as DisbursedStatus)}>
                        {DISBURSED_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      </InlineSelect>
                    </TableCell>
                    <TableCell>
                      {result.disburseDate ? (
                        <span className="text-sm text-muted-foreground">Deposited</span>
                      ) : (
                        <InlineSelect
                          value={result.reductionsStatus}
                          onChange={(value) =>
                            updateResult(record.shared.id, (current) => ({ ...current, reductionsStatus: value as ReductionsStatus }))
                          }
                        >
                          {REDUCTIONS_MANUAL_STATUS_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </InlineSelect>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {result.resultQuarter ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Input className="h-9 min-w-32 text-xs" type="date" value={toDateInput(result.disburseDate)} onChange={(event) => updateResult(record.shared.id, (current) => ({ ...current, disburseDate: fromDateInput(event.target.value) }))} />
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
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  const isActive = active === sortKey;
  const Icon = !isActive ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <TableHead>
      <button
        type="button"
        className="inline-flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"
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
    <Select className="h-9 min-w-28 text-xs" value={value} onChange={(event) => onChange(event.target.value)}>
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
    <div className="flex h-9 min-w-28 items-center rounded-md border border-input bg-white px-2 text-xs focus-within:ring-2 focus-within:ring-ring">
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

function toDateInput(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

function fromDateInput(value: string) {
  if (!value) return null;
  return new Date(`${value}T10:00:00.000Z`).toISOString();
}
