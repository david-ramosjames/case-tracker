"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Eye } from "lucide-react";
import { CaseNumberLink } from "@/components/cases/case-number-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CHECK_STATUS_OPTIONS,
  CLOSING_STATUS_OPTIONS,
  DISBURSED_STATUS_OPTIONS,
  RELEASE_STATUS_OPTIONS,
  getTargetPeriodOptions,
} from "@/lib/case-options";
import {
  type AppUser,
  type CaseRecord,
  type CheckStatus,
  type ClosingStatus,
  type DisbursedStatus,
  type ReleaseStatus,
  type SettlementResult,
} from "@/lib/types";
import { formatCurrency, getCalculatedAttorneyFees } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";

type SortKey = "caseNumber" | "clientName" | "settlementDate" | "settlementAmount" | "attorneyFees";
type SortDirection = "asc" | "desc";

export function ResultsTable({ records, users }: { records: CaseRecord[]; users: AppUser[] }) {
  const [workingRecords, setWorkingRecords] = useState(records);
  const [search, setSearch] = useState("");
  const [attorney, setAttorney] = useState("all");
  const [paralegal, setParalegal] = useState("all");
  const [quarter, setQuarter] = useState("all");
  const [resultState, setResultState] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("caseNumber");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const attorneys = users.filter((user) => user.role === "attorney");
  const paralegals = users.filter((user) => user.role === "paralegal");
  const quarters = Array.from(new Set([...getTargetPeriodOptions(), ...workingRecords.map((record) => record.tracker.result.resultQuarter).filter(Boolean)]));

  const filteredRecords = useMemo(() => {
    const normalizedSearch = search.toLowerCase();

    return workingRecords
      .filter((record) => {
        const result = record.tracker.result;
        const matchesSearch =
          record.shared.caseNumber.toLowerCase().includes(normalizedSearch) ||
          record.shared.clientName.toLowerCase().includes(normalizedSearch);

        if (!matchesSearch) return false;
        if (attorney !== "all" && record.shared.attorneyId !== attorney) return false;
        if (paralegal !== "all" && record.shared.paralegalId !== paralegal) return false;
        if (quarter !== "all" && result.resultQuarter !== quarter) return false;
        if (resultState === "open" && result.checkDisbursedAt) return false;
        if (resultState === "disbursed" && !result.checkDisbursedAt) return false;
        if (dateFrom && result.settlementDate && new Date(result.settlementDate) < new Date(`${dateFrom}T00:00:00`)) return false;
        if (dateTo && result.settlementDate && new Date(result.settlementDate) > new Date(`${dateTo}T23:59:59`)) return false;

        return true;
      })
      .sort((a, b) => {
        const dir = sortDirection === "asc" ? 1 : -1;
        const tieBreak = () => a.shared.caseNumber.localeCompare(b.shared.caseNumber);

        if (sortKey === "caseNumber") {
          const aNum = Number(a.shared.caseNumber);
          const bNum = Number(b.shared.caseNumber);
          if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) return dir * (aNum - bNum);
          return dir * a.shared.caseNumber.localeCompare(b.shared.caseNumber);
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
  }, [attorney, dateFrom, dateTo, paralegal, quarter, resultState, search, sortDirection, sortKey, workingRecords]);

  function requestSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "clientName" ? "asc" : "desc");
  }

  function updateResult(recordId: string, updater: (result: SettlementResult) => SettlementResult) {
    let nextRecord: CaseRecord | null = null;
    setWorkingRecords((current) =>
      current.map((record) => {
        if (record.shared.id !== recordId) return record;
        const result = updater(record.tracker.result);
        nextRecord = {
          ...record,
          tracker: {
            ...record.tracker,
            result: {
              ...result,
              attorneyFees: getCalculatedAttorneyFees(result.settlementAmount, result.feePercent),
            },
          },
        };
        return nextRecord;
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
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
          <Input placeholder="Search results..." value={search} onChange={(event) => setSearch(event.target.value)} />
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
          <Select value={quarter} onChange={(event) => setQuarter(event.target.value)} aria-label="Quarter">
            <option value="all">All quarters</option>
            {quarters.map((item) => (
              <option key={item} value={item ?? ""}>
                {item}
              </option>
            ))}
          </Select>
          <Select value={resultState} onChange={(event) => setResultState(event.target.value)} aria-label="Result status">
            <option value="all">All results</option>
            <option value="open">Not disbursed</option>
            <option value="disbursed">Disbursed</option>
          </Select>
          <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Settlement from" />
          <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Settlement to" />
        </div>

        <p className="text-sm text-muted-foreground">
          Showing {filteredRecords.length} of {workingRecords.length} results. Click a column header to sort.
        </p>

        <div className="mt-4 overflow-x-auto rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Case #" sortKey="caseNumber" active={sortKey} direction={sortDirection} onSort={requestSort} />
                <SortableHead label="Client" sortKey="clientName" active={sortKey} direction={sortDirection} onSort={requestSort} />
                <TableHead>Attorney</TableHead>
                <TableHead>Paralegal</TableHead>
                <SortableHead label="Settlement Date" sortKey="settlementDate" active={sortKey} direction={sortDirection} onSort={requestSort} />
                <SortableHead label="Settlement Amount" sortKey="settlementAmount" active={sortKey} direction={sortDirection} onSort={requestSort} />
                <TableHead>Fee Percent</TableHead>
                <SortableHead label="RJL Attorney Fees" sortKey="attorneyFees" active={sortKey} direction={sortDirection} onSort={requestSort} />
                <TableHead>Release</TableHead>
                <TableHead>Closing</TableHead>
                <TableHead>Check</TableHead>
                <TableHead>Disbursed</TableHead>
                <TableHead>Quarter</TableHead>
                <TableHead>Disburse Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.map((record) => {
                const result = record.tracker.result;

                return (
                  <TableRow key={record.shared.id}>
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
                    <TableCell>
                      <InlineNumberInput suffix="%" value={result.feePercent == null ? null : Math.round(result.feePercent * 100)} onCommit={(value) => updateResult(record.shared.id, (current) => ({ ...current, feePercent: value == null ? null : value / 100 }))} />
                    </TableCell>
                    <TableCell>{formatCurrency(getCalculatedAttorneyFees(result.settlementAmount, result.feePercent))}</TableCell>
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
                      <InlineSelect value={result.resultQuarter ?? ""} onChange={(value) => updateResult(record.shared.id, (current) => ({ ...current, resultQuarter: value || null }))}>
                        <option value="">Not set</option>
                        {quarters.map((option) => <option key={option} value={option ?? ""}>{option}</option>)}
                      </InlineSelect>
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
