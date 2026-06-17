"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SettlementSyncCard() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  async function syncSettlements() {
    setIsSyncing(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/google/sync-settlements", { method: "POST" });
      const body = (await response.json()) as {
        casesProcessed?: number;
        disbursementsSynced?: number;
        settlementsUpdated?: number;
        skippedNoTracker?: number;
        skippedFinancialLocked?: number;
        error?: string;
      };
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
        `Synced ${body.disbursementsSynced ?? 0} disbursement row(s) across ${body.casesProcessed ?? 0} case(s). Updated ${body.settlementsUpdated ?? 0} settlement/disburse fields.${skippedNote}${lockedNote}`,
      );
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
      </CardContent>
    </Card>
  );
}
