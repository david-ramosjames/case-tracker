"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getQuickExpectedDisburseQuarterOptions,
  getTargetPeriodRelative,
  toStandardTargetPeriodLabel,
  type TargetPeriodRelative,
} from "@/lib/case-options";
import { agingStatus } from "@/lib/performance/outstanding";
import { type SettledUndisbursedCase } from "@/lib/performance/pacing";
import { cn } from "@/lib/utils";

const DISBURSE_Q_SELECT_TONE: Record<TargetPeriodRelative, string> = {
  current: "bg-emerald-100 text-emerald-900 border-emerald-200",
  past: "bg-rose-100 text-rose-900 border-rose-200",
  future: "",
};

type SortKey = "fees" | "days";
type SortDirection = "asc" | "desc";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function rowKey(row: SettledUndisbursedCase) {
  return row.disbursementId ?? row.caseId;
}

function sortRows(rows: SettledUndisbursedCase[], sortKey: SortKey, direction: SortDirection) {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const delta =
      sortKey === "fees"
        ? a.expectedAttorneyFees - b.expectedAttorneyFees
        : a.daysOutstanding - b.daysOutstanding;
    if (delta !== 0) return delta * sign;
    return a.caseNumber.localeCompare(b.caseNumber, undefined, { numeric: true });
  });
}

export function SettledUndisbursedTable({
  rows,
  agingTargetDays,
  agingWarnDays,
}: {
  rows: SettledUndisbursedCase[];
  agingTargetDays: number;
  agingWarnDays: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [workingRows, setWorkingRows] = useState(rows);
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<SortKey>("days");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  useEffect(() => {
    setWorkingRows(rows);
  }, [rows]);

  const quarterOptions = useMemo(() => getQuickExpectedDisburseQuarterOptions(), []);
  const sortedRows = useMemo(
    () => sortRows(workingRows, sortKey, sortDirection),
    [workingRows, sortKey, sortDirection],
  );

  function requestSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection("desc");
  }

  async function updateExpectedDisburseQuarter(caseId: string, nextQuarter: string) {
    const previousRows = workingRows.filter((row) => row.caseId === caseId);
    if (previousRows.length === 0) return;
    const previousStandard = toStandardTargetPeriodLabel(previousRows[0]?.targetResolutionQuarter);
    if (previousStandard === nextQuarter) return;

    setSavingIds((current) => ({ ...current, [caseId]: true }));
    setRowErrors((current) => {
      const next = { ...current };
      delete next[caseId];
      return next;
    });

    setWorkingRows((current) =>
      current.map((row) =>
        row.caseId === caseId ? { ...row, targetResolutionQuarter: nextQuarter } : row,
      ),
    );

    try {
      const response = await fetch(`/api/tracker/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracker: { targetResolutionQuarter: nextQuarter } }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Unable to update expected disbursement quarter.");
      }
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setWorkingRows((current) =>
        current.map((row) => {
          if (row.caseId !== caseId) return row;
          const previous = previousRows.find((entry) => rowKey(entry) === rowKey(row));
          return previous
            ? { ...row, targetResolutionQuarter: previous.targetResolutionQuarter }
            : row;
        }),
      );
      setRowErrors((current) => ({
        ...current,
        [caseId]: error instanceof Error ? error.message : "Unable to update expected disbursement quarter.",
      }));
    } finally {
      setSavingIds((current) => {
        const next = { ...current };
        delete next[caseId];
        return next;
      });
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Case</TableHead>
          <TableHead>Attorney</TableHead>
          <SortableHead label="Fees" sortKey="fees" active={sortKey} direction={sortDirection} onSort={requestSort} />
          <TableHead>Settled</TableHead>
          <TableHead>Exp. disburse Q</TableHead>
          <SortableHead label="Days" sortKey="days" active={sortKey} direction={sortDirection} onSort={requestSort} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedRows.map((row) => {
          const value =
            toStandardTargetPeriodLabel(row.targetResolutionQuarter) ??
            (row.targetResolutionQuarter?.trim() || "");
          const relative = getTargetPeriodRelative(value);
          const tone = relative ? DISBURSE_Q_SELECT_TONE[relative] : "";
          const options =
            value && !quarterOptions.includes(value) ? [value, ...quarterOptions] : quarterOptions;
          const saving = Boolean(savingIds[row.caseId]) || isPending;
          const status = agingStatus(row.daysOutstanding, agingTargetDays, agingWarnDays);

          return (
            <TableRow key={rowKey(row)}>
              <TableCell>
                <Link href={`/cases/${row.caseId}`} className="font-medium text-pink-700 hover:underline">
                  {row.caseNumber}
                </Link>
                <div className="text-xs text-muted-foreground">{row.clientName}</div>
                {rowErrors[row.caseId] ? (
                  <div className="mt-1 text-xs text-rose-700">{rowErrors[row.caseId]}</div>
                ) : null}
              </TableCell>
              <TableCell>{row.attorneyName}</TableCell>
              <TableCell>{money(row.expectedAttorneyFees)}</TableCell>
              <TableCell>{row.settlementDate}</TableCell>
              <TableCell>
                <Select
                  className={`h-9 min-w-[6.5rem] text-xs font-medium ${tone}`}
                  value={value}
                  disabled={saving}
                  onChange={(event) => {
                    void updateExpectedDisburseQuarter(row.caseId, event.target.value);
                  }}
                >
                  {!value ? <option value="">Not set</option> : null}
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </TableCell>
              <TableCell
                className={
                  status === "over" ? "font-semibold text-rose-700" : status === "warn" ? "text-amber-700" : ""
                }
              >
                {row.daysOutstanding}
              </TableCell>
            </TableRow>
          );
        })}
        {sortedRows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-muted-foreground">
              None
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
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
        className="inline-flex items-center gap-1 font-medium"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <Icon className={cn("h-3.5 w-3.5", isActive ? "text-pink-500" : "text-muted-foreground")} />
      </button>
    </TableHead>
  );
}
