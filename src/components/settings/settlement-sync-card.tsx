"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type SettlementSheetSyncCaseDetail } from "@/lib/google/settlements-sync";
import { compareCaseNumbers } from "@/lib/csv/parse";
import { cn, formatCurrency, formatOptionalDate } from "@/lib/utils";

type SyncResponse = {
  casesProcessed?: number;
  disbursementsSynced?: number;
  settlementsUpdated?: number;
  stagesAutoSettled?: number;
  skippedNoTracker?: number;
  skippedFinancialLocked?: number;
  sheetCasesFound?: number;
  details?: SettlementSheetSyncCaseDetail[];
  error?: string;
};

function statusLabel(status: SettlementSheetSyncCaseDetail["status"]) {
  if (status === "synced") return "Synced";
  if (status === "skipped_no_tracker") return "No tracker";
  return "Locked";
}

function statusClassName(status: SettlementSheetSyncCaseDetail["status"]) {
  if (status === "synced") return "text-emerald-700";
  if (status === "skipped_no_tracker") return "text-amber-700";
  return "text-rose-700";
}

function formatPartySummary(parties: SettlementSheetSyncCaseDetail["parties"]) {
  if (!parties?.length) return "—";
  return parties
    .map((party) => {
      const name = party.label?.trim() || "Party";
      const disburse = party.disburseDate ? formatOptionalDate(party.disburseDate) : party.pendingRemaining ? "pending" : "no date";
      return `${name}: ${disburse}`;
    })
    .join(" · ");
}

export function SettlementSyncCard() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [details, setDetails] = useState<SettlementSheetSyncCaseDetail[]>([]);
  const [filter, setFilter] = useState("");

  const filteredDetails = useMemo(() => {
    const normalized = filter.trim().toLowerCase();
    const sorted = [...details].sort((a, b) => compareCaseNumbers(a.caseNumber, b.caseNumber));
    if (!normalized) return sorted;
    return sorted.filter(
      (item) =>
        item.caseNumber.toLowerCase().includes(normalized) ||
        item.summary.toLowerCase().includes(normalized) ||
        item.parties?.some((party) => party.label?.toLowerCase().includes(normalized)),
    );
  }, [details, filter]);

  async function syncSettlements() {
    setIsSyncing(true);
    setMessage(null);
    setError(null);
    setDetails([]);
    try {
      const response = await fetch("/api/google/sync-settlements", { method: "POST" });
      const body = (await response.json()) as SyncResponse;
      if (!response.ok) throw new Error(body.error ?? "Sync failed.");
      const skippedNote =
        body.skippedNoTracker && body.skippedNoTracker > 0
          ? ` ${body.skippedNoTracker} sheet case(s) had no matching tracker row.`
          : "";
      const lockedNote =
        body.skippedFinancialLocked && body.skippedFinancialLocked > 0
          ? ` ${body.skippedFinancialLocked} case(s) skipped (financial CSV backfill is source of truth).`
          : "";
      setMessage(
        `Synced ${body.disbursementsSynced ?? 0} disbursement row(s) across ${body.casesProcessed ?? 0} case(s) from ${body.sheetCasesFound ?? 0} sheet case(s). Updated ${body.settlementsUpdated ?? 0} settlement/disburse fields. Auto-settled ${body.stagesAutoSettled ?? 0} case(s).${skippedNote}${lockedNote}`,
      );
      setDetails(body.details ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settlements & disbursements (Google Sheet)</CardTitle>
        <CardDescription>
          Imports from <strong>RJL Cases Disbursing</strong>. Each row is one disbursement slot; weight = 1÷rows per case.
          Column B shows what is still pending and goes <strong>blank</strong> once that row has disbursed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-navy-950">RJL Cases Disbursing</span>: B = pending count (blank when done), C =
            Case #, H = Settlement Date, Z = Date Disbursed
          </li>
          <li>Share the spreadsheet with your Google service account email</li>
          <li>Set GOOGLE_SHEETS_SETTLEMENT_* env vars — included in the daily cron sync</li>
        </ul>
        <Button variant="outline" disabled={isSyncing} onClick={() => void syncSettlements()}>
          {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Import settlements sheet
        </Button>
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}

        {details.length > 0 ? (
          <div className="space-y-3 rounded-lg border bg-white p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-navy-950">Per-case sync detail ({filteredDetails.length})</p>
              <Input
                className="sm:max-w-xs"
                placeholder="Filter by case # or summary..."
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
            <div className="max-h-[28rem] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Case #</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    <TableHead>What happened</TableHead>
                    <TableHead className="w-28">Settlement</TableHead>
                    <TableHead className="w-28">Disburse</TableHead>
                    <TableHead className="w-24">Disbursed</TableHead>
                    <TableHead>Parties</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDetails.map((item) => (
                    <TableRow key={`${item.caseNumber}-${item.status}`}>
                      <TableCell className="font-medium text-navy-950">{item.caseNumber}</TableCell>
                      <TableCell className={cn("text-xs font-medium", statusClassName(item.status))}>
                        {statusLabel(item.status)}
                      </TableCell>
                      <TableCell className="text-xs text-navy-950">{item.summary}</TableCell>
                      <TableCell className="text-xs">
                        {item.settlementDate ? formatOptionalDate(item.settlementDate) : "—"}
                        {item.settlementAmount != null ? (
                          <div className="text-muted-foreground">{formatCurrency(item.settlementAmount)}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs">
                        {item.disburseDate ? formatOptionalDate(item.disburseDate) : "—"}
                        {item.resultQuarter ? <div className="text-muted-foreground">{item.resultQuarter}</div> : null}
                      </TableCell>
                      <TableCell className="text-xs">{item.disbursedStatus ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatPartySummary(item.parties)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
