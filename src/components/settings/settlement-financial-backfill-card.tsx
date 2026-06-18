"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CASE_BACKFILL_CASE_NUMBER_HEADERS } from "@/lib/csv/case-backfill";
import {
  hasSettlementFinancialBackfillHeaders,
  SETTLEMENT_FINANCIAL_ATTORNEY_FEES_HEADERS,
  SETTLEMENT_FINANCIAL_CLAIMANT_HEADERS,
  SETTLEMENT_FINANCIAL_CLOSED_DATE_HEADERS,
  SETTLEMENT_FINANCIAL_FULL_SETTLEMENT_HEADERS,
  SETTLEMENT_FINANCIAL_REFERRAL_FEE_HEADERS,
  SETTLEMENT_FINANCIAL_SETTLEMENT_AMOUNT_HEADERS,
} from "@/lib/csv/settlement-financial-backfill";
import { compareCaseNumbers } from "@/lib/csv/parse";
import { parseCsv } from "@/lib/csv/parse";
import { type SettlementFinancialBackfillResetDetail } from "@/lib/supabase/services";
import { type CaseBackfillImportResult } from "@/lib/types";

type ImportProgress = {
  processed: number;
  total: number;
  updated: number;
  failed: number;
  currentCaseNumber?: string;
};

export function SettlementFinancialBackfillCard() {
  const router = useRouter();
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [preview, setPreview] = useState<CaseBackfillImportResult | null>(null);
  const [importResult, setImportResult] = useState<CaseBackfillImportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetDetails, setResetDetails] = useState<SettlementFinancialBackfillResetDetail[]>([]);
  const [resetFilter, setResetFilter] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  const hasCaseNumberHeader = useMemo(
    () => CASE_BACKFILL_CASE_NUMBER_HEADERS.some((header) => headers.some((item) => item.toLowerCase() === header.toLowerCase())),
    [headers],
  );

  const recognizedHeaders = useMemo(() => {
    const expected = [
      ...CASE_BACKFILL_CASE_NUMBER_HEADERS,
      ...SETTLEMENT_FINANCIAL_CLAIMANT_HEADERS,
      ...SETTLEMENT_FINANCIAL_FULL_SETTLEMENT_HEADERS,
      ...SETTLEMENT_FINANCIAL_REFERRAL_FEE_HEADERS,
      ...SETTLEMENT_FINANCIAL_CLOSED_DATE_HEADERS,
      ...SETTLEMENT_FINANCIAL_SETTLEMENT_AMOUNT_HEADERS,
      ...SETTLEMENT_FINANCIAL_ATTORNEY_FEES_HEADERS,
    ];
    return headers.filter((header) => expected.some((item) => item.toLowerCase() === header.toLowerCase()));
  }, [headers]);

  const canImport = Boolean(csvText) && hasCaseNumberHeader && (preview?.matched ?? 0) > 0;

  const filteredResetDetails = useMemo(() => {
    const normalized = resetFilter.trim().toLowerCase();
    const sorted = [...resetDetails].sort((a, b) => compareCaseNumbers(a.caseNumber, b.caseNumber));
    if (!normalized) return sorted;
    return sorted.filter(
      (item) => item.caseNumber.toLowerCase().includes(normalized) || item.summary.toLowerCase().includes(normalized),
    );
  }, [resetDetails, resetFilter]);

  async function runReset() {
    setIsResetting(true);
    setResetMessage(null);
    setResetError(null);
    setResetDetails([]);
    try {
      const response = await fetch("/api/import/settlement-financial/reset", { method: "POST" });
      const payload = (await response.json()) as {
        casesReset?: number;
        stagesRestored?: number;
        disbursementsRemoved?: number;
        details?: SettlementFinancialBackfillResetDetail[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Reset failed.");
      setResetMessage(
        `Reset ${payload.casesReset ?? 0} case(s): cleared financial/referral import locks, removed ${payload.disbursementsRemoved ?? 0} manual disbursement row(s), restored stage on ${payload.stagesRestored ?? 0} case(s). Re-run the Google settlements sheet sync or import a fresh CSV.`,
      );
      setResetDetails(payload.details ?? []);
      setConfirmReset(false);
      setPreview(null);
      setImportResult(null);
      router.refresh();
    } catch (error) {
      setResetError(error instanceof Error ? error.message : "Reset failed.");
    } finally {
      setIsResetting(false);
    }
  }

  async function loadCsv(file: File | null) {
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim()));
    setFileName(file.name);
    setCsvText(text);
    setHeaders(rows[0]?.map((header) => header.trim()).filter(Boolean) ?? []);
    setRowCount(Math.max(rows.length - 1, 0));
    setImportResult(null);
    setErrorMessage(null);

    if (!hasSettlementFinancialBackfillHeaders(text)) {
      setPreview(null);
      setErrorMessage('CSV must include a case number column (e.g. "Case Num" or "Case #").');
      return;
    }

    setIsPreviewing(true);
    try {
      const response = await fetch("/api/import/settlement-financial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text, dryRun: true }),
      });
      const payload = (await response.json()) as CaseBackfillImportResult & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Preview failed.");
      setPreview(payload);
    } catch (error) {
      setPreview(null);
      setErrorMessage(error instanceof Error ? error.message : "Preview failed.");
    } finally {
      setIsPreviewing(false);
    }
  }

  async function runImport() {
    if (!csvText) return;
    setIsImporting(true);
    setImportProgress(null);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/import/settlement-financial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText, dryRun: false, stream: true }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Import failed.");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Import failed: no response stream.");

      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: CaseBackfillImportResult | null = null;

      function handleStreamLine(line: string) {
        if (!line.trim()) return;
        const event = JSON.parse(line) as
          | ({ type: "progress" } & ImportProgress)
          | { type: "complete"; result: CaseBackfillImportResult }
          | { type: "error"; error: string };

        if (event.type === "progress") {
          setImportProgress({
            processed: event.processed,
            total: event.total,
            updated: event.updated,
            failed: event.failed,
            currentCaseNumber: event.currentCaseNumber,
          });
        } else if (event.type === "complete") {
          finalResult = event.result;
        } else if (event.type === "error") {
          throw new Error(event.error);
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: !done });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handleStreamLine(line);

        if (done) break;
      }

      buffer += decoder.decode();
      if (buffer.trim()) handleStreamLine(buffer);

      if (!finalResult) throw new Error("Import finished without a result.");
      setImportResult(finalResult);
      setPreview(finalResult);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  }

  const importPercent =
    importProgress && importProgress.total > 0
      ? Math.round((importProgress.processed / importProgress.total) * 100)
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settlement financial backfill</CardTitle>
        <CardDescription>
          Source-of-truth import for closed-case money fields. Separate from the Google disbursing sheet — once imported,
          those cases are <span className="font-medium text-navy-950">skipped by sheet sync</span> so amounts are not
          overwritten.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div>
              <p className="text-sm font-semibold text-navy-950">Upload CSV</p>
              <p className="text-sm text-muted-foreground">
                Columns: Case Num, Claimant name, Referral Fee %, Closed Date, Settlement Amount, Net Attorney Fees,
                Status (Active or Closed). Multiple rows with the same case number are combined.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <a href="/templates/settlement-financial-backfill-template.csv" download>
                  Download template
                </a>
              </Button>
              <Button asChild variant="pink">
                <label>
                  <Upload className="h-4 w-4" />
                  Upload CSV
                  <input
                    className="sr-only"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => {
                      void loadCsv(event.target.files?.[0] ?? null);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </Button>
            </div>
          </div>

          {isPreviewing ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Previewing matches…
            </p>
          ) : null}

          {fileName ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {preview ? (
                <>
                  <Badge variant="success">{preview.matched} matched</Badge>
                  {preview.unmatched.length ? <Badge variant="warning">{preview.unmatched.length} unmatched</Badge> : null}
                  {importResult?.failed?.length ? (
                    <Badge variant="warning">{importResult.failed.length} failed</Badge>
                  ) : null}
                </>
              ) : null}
              {importResult && !importResult.dryRun ? <Badge variant="pink">{importResult.updated} updated</Badge> : null}
              <Badge variant="outline">{rowCount} rows</Badge>
              <Badge variant="outline">{recognizedHeaders.length} recognized headers</Badge>
              <span className="text-muted-foreground">{fileName}</span>
            </div>
          ) : null}
          {errorMessage ? <p className="mt-3 text-sm text-rose-700">{errorMessage}</p> : null}
        </div>

        {preview?.unmatched.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">Unmatched case numbers</p>
            <p className="mt-1 text-amber-900">Not found in the tracker: {preview.unmatched.join(", ")}</p>
          </div>
        ) : null}

        {importResult?.failed.length ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950">
            <p className="font-semibold">Import errors</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {importResult.failed.map((entry) => (
                <li key={entry.caseNumber}>
                  Case #{entry.caseNumber}: {entry.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="rounded-lg border bg-white p-4 text-sm text-muted-foreground">
          <p className="font-semibold text-navy-950">How it works</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <span className="font-medium text-navy-950">Multiple claims</span> — repeat the case number on each row.
              Each row is saved as a disbursement party (claimant name optional); settlement and fees are summed for the
              case total, same as the Google sheet sync.
            </li>
            <li>
              <span className="font-medium text-navy-950">Referral Fee %</span> updates the tracker referral fee (one
              value per case; taken from the first row that has it). Rows with only referral fee and no closed date do
              not change stage or settlement amounts — the case stays active.
            </li>
            <li>
              <span className="font-medium text-navy-950">Closed Date</span> is required before settlement amounts,
              disbursements, or stage Settled are applied.
            </li>
            <li>
              <span className="font-medium text-navy-950">Settlement Amount</span> and{" "}
              <span className="font-medium text-navy-950">Net Attorney Fees</span> (RJL Attorney Fees) update Results.
              Fee % = (RJL fees ÷ (1 − referral fee)) ÷ settlement amount when all three are present.
            </li>
            <li>
              <span className="font-medium text-navy-950">Status</span> — use <span className="font-medium text-navy-950">Active</span>{" "}
              while more claims may still come (amounts save, case stays in current stage). Use{" "}
              <span className="font-medium text-navy-950">Closed</span> when all claims are in and the case should move
              to Settled.
            </li>
            <li>Blank cells are skipped. Rows must match an existing case number (grouped by case before import).</li>
          </ul>
        </div>

        {isImporting && importProgress ? (
          <div className="space-y-2">
            <Progress value={importPercent} />
            <p className="text-sm text-muted-foreground">
              {importProgress.processed} / {importProgress.total}
              {importProgress.currentCaseNumber ? ` — Case #${importProgress.currentCaseNumber}` : ""}
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="pink" disabled={!canImport || isImporting || isPreviewing} onClick={() => void runImport()}>
            {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {isImporting ? "Importing…" : "Import financial backfill"}
          </Button>
        </div>

        <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
            <div className="space-y-3">
              <div>
                <p className="font-semibold text-rose-950">Reset all financial backfill imports</p>
                <p className="mt-1 text-sm text-rose-900">
                  Removes every case touched by this CSV import: settlement amounts, disburse dates, manual disbursement
                  parties, referral fees from backfill, and import locks. Cases return to Google sheet sync. Stage is
                  restored from version history when possible. Sheet-linked disbursement rows are kept.
                </p>
              </div>
              {confirmReset ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-rose-950">
                    This cannot be undone. Reset all financial backfill data and start fresh?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="pink" disabled={isResetting} onClick={() => void runReset()}>
                      {isResetting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Yes, reset everything
                    </Button>
                    <Button variant="outline" disabled={isResetting} onClick={() => setConfirmReset(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" className="border-rose-300 bg-white" onClick={() => setConfirmReset(true)}>
                  Reset all imports…
                </Button>
              )}
              {resetMessage ? <p className="text-sm text-emerald-800">{resetMessage}</p> : null}
              {resetError ? <p className="text-sm text-rose-800">{resetError}</p> : null}
            </div>
          </div>

          {resetDetails.length > 0 ? (
            <div className="mt-4 space-y-3 rounded-md border border-rose-200 bg-white p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-medium text-navy-950">Reset detail by case ({filteredResetDetails.length})</p>
                <Input
                  className="sm:max-w-xs"
                  placeholder="Filter by case #..."
                  value={resetFilter}
                  onChange={(event) => setResetFilter(event.target.value)}
                />
              </div>
              <div className="max-h-80 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Case #</TableHead>
                      <TableHead>What was reset</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredResetDetails.map((item) => (
                      <TableRow key={item.caseNumber}>
                        <TableCell className="font-medium text-navy-950">{item.caseNumber}</TableCell>
                        <TableCell className="text-sm text-navy-950">{item.summary}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
