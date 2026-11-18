"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getQuickExpectedDisburseQuarterOptions, toStandardTargetPeriodLabel } from "@/lib/case-options";
import { type ExpectedDisbursementQuarterCase } from "@/lib/performance/pacing";

const STAGE_LABELS: Record<string, string> = {
  Onboarding: "Onboarding",
  Txt: "Treatment",
  Dmd: "Demand",
  Lit: "Litigation",
  Settled: "Settled",
  Disengaged: "Disengaged",
  Terminated: "Terminated",
  Referred: "Referred",
};

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function ExpectedThisQuarterTable({
  rows,
  currentQuarterLabel,
}: {
  rows: ExpectedDisbursementQuarterCase[];
  currentQuarterLabel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [workingRows, setWorkingRows] = useState(rows);
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setWorkingRows(rows);
  }, [rows]);

  const quarterOptions = useMemo(() => getQuickExpectedDisburseQuarterOptions(), []);
  const currentQuarter = toStandardTargetPeriodLabel(currentQuarterLabel) ?? currentQuarterLabel;

  async function updateExpectedDisburseQuarter(caseId: string, nextQuarter: string) {
    const previous = workingRows.find((row) => row.caseId === caseId);
    if (!previous) return;
    const previousStandard = toStandardTargetPeriodLabel(previous.targetResolutionQuarter);
    if (previousStandard === nextQuarter) return;

    setSavingIds((current) => ({ ...current, [caseId]: true }));
    setRowErrors((current) => {
      const next = { ...current };
      delete next[caseId];
      return next;
    });

    // Optimistic: drop from this-quarter table when moved away from current quarter.
    setWorkingRows((current) =>
      nextQuarter === currentQuarter
        ? current.map((row) =>
            row.caseId === caseId ? { ...row, targetResolutionQuarter: nextQuarter } : row,
          )
        : current.filter((row) => row.caseId !== caseId),
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
      setWorkingRows((current) => {
        const stillPresent = current.some((row) => row.caseId === caseId);
        if (stillPresent) {
          return current.map((row) =>
            row.caseId === caseId
              ? { ...row, targetResolutionQuarter: previous.targetResolutionQuarter }
              : row,
          );
        }
        return [...current, previous].sort((a, b) => b.expectedAttorneyFees - a.expectedAttorneyFees);
      });
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
          <TableHead>Stage</TableHead>
          <TableHead>Fees</TableHead>
          <TableHead>Settled</TableHead>
          <TableHead>Exp. disburse Q</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {workingRows.map((row) => {
          const value =
            toStandardTargetPeriodLabel(row.targetResolutionQuarter) ??
            (row.targetResolutionQuarter?.trim() || "");
          const options =
            value && !quarterOptions.includes(value) ? [value, ...quarterOptions] : quarterOptions;
          const saving = Boolean(savingIds[row.caseId]) || isPending;

          return (
            <TableRow key={row.caseId}>
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
              <TableCell>{STAGE_LABELS[row.caseStage] ?? row.caseStage}</TableCell>
              <TableCell>{money(row.expectedAttorneyFees)}</TableCell>
              <TableCell>{row.settlementDate?.trim() || "—"}</TableCell>
              <TableCell>
                <Select
                  className="h-9 min-w-[6.5rem] text-xs"
                  value={value}
                  disabled={saving}
                  onChange={(event) => {
                    void updateExpectedDisburseQuarter(row.caseId, event.target.value);
                  }}
                >
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </TableCell>
            </TableRow>
          );
        })}
        {workingRows.length === 0 ? (
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
