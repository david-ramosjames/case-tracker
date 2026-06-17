"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CASE_BACKFILL_ALL_HEADERS,
  CASE_BACKFILL_ATTORNEY_FEES_HEADERS,
  CASE_BACKFILL_CASE_NUMBER_HEADERS,
  CASE_BACKFILL_DATE_SIGNED_HEADERS,
  CASE_BACKFILL_DOL_HEADERS,
  CASE_BACKFILL_HEADER_GROUPS,
  CASE_BACKFILL_REFERRAL_FEE_HEADERS,
  CASE_BACKFILL_SETTLEMENT_AMOUNT_HEADERS,
  CASE_BACKFILL_STATUS_HEADERS,
  hasCaseBackfillHeaders,
} from "@/lib/csv/case-backfill";
import { parseCsv } from "@/lib/csv/parse";
import { type CaseBackfillImportResult } from "@/lib/types";

type ImportProgress = {
  processed: number;
  total: number;
  updated: number;
  failed: number;
  currentCaseNumber?: string;
};

export function BackfillImportCard() {
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

  const hasCaseNumberHeader = useMemo(
    () => CASE_BACKFILL_CASE_NUMBER_HEADERS.some((header) => headers.some((item) => item.toLowerCase() === header.toLowerCase())),
    [headers],
  );
  const recognizedHeaderNames = useMemo(() => {
    const aliases = [
      ...CASE_BACKFILL_CASE_NUMBER_HEADERS,
      ...CASE_BACKFILL_DOL_HEADERS,
      ...CASE_BACKFILL_DATE_SIGNED_HEADERS,
      ...CASE_BACKFILL_STATUS_HEADERS,
      ...CASE_BACKFILL_REFERRAL_FEE_HEADERS,
      ...CASE_BACKFILL_SETTLEMENT_AMOUNT_HEADERS,
      ...CASE_BACKFILL_ATTORNEY_FEES_HEADERS,
    ];
    return headers.filter(
      (header) =>
        CASE_BACKFILL_ALL_HEADERS.some((expected) => expected.toLowerCase() === header.toLowerCase()) ||
        aliases.some((expected) => expected.toLowerCase() === header.toLowerCase()),
    );
  }, [headers]);
  const canImport = Boolean(csvText) && hasCaseNumberHeader && (preview?.matched ?? 0) > 0;

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

    if (!hasCaseBackfillHeaders(text)) {
      setPreview(null);
      setErrorMessage('CSV must include a case number column (e.g. "Case #" or "Case Number").');
      return;
    }

    setIsPreviewing(true);
    try {
      const response = await fetch("/api/import/backfill", {
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
      const response = await fetch("/api/import/backfill", {
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
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
      }

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
        <CardTitle>CSV Backfill</CardTitle>
        <CardDescription>
          Match existing cases by case number only — extra rows in the CSV are ignored. Upload{" "}
          <span className="font-medium text-navy-950">Case #</span> with <span className="font-medium text-navy-950">DOL</span>{" "}
          and/or <span className="font-medium text-navy-950">Date Signed</span> to overwrite those fields. Filled cells replace
          existing values; empty cells are skipped. Client, attorney, and paralegal are never changed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div>
              <p className="text-sm font-semibold text-navy-950">Upload CSV</p>
              <p className="text-sm text-muted-foreground">One row per case. Preview match counts, then import tracker and results fields.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <a href="/templates/case-backfill-template.csv" download>
                  Download CSV template
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
              <Button variant="outline" disabled={!canImport || isImporting || isPreviewing} onClick={() => void runImport()}>
                {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isImporting && importProgress
                  ? `Importing ${importProgress.processed}/${importProgress.total}`
                  : "Import to tracker"}
              </Button>
            </div>
          </div>
          {isImporting && importProgress ? (
            <div className="mt-4 space-y-2 rounded-lg border border-pink-100 bg-pink-50/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium text-navy-950">
                  Processing row {importProgress.processed} of {importProgress.total}
                  {importProgress.currentCaseNumber ? (
                    <span className="font-normal text-muted-foreground"> · Case #{importProgress.currentCaseNumber}</span>
                  ) : null}
                </span>
                <span className="font-semibold text-pink-600">{importPercent}%</span>
              </div>
              <Progress value={importPercent} />
              <p className="text-xs text-muted-foreground">
                {importProgress.updated} updated · {importProgress.failed} failed
              </p>
            </div>
          ) : null}
          {fileName ? (
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <Badge variant={hasCaseNumberHeader ? "success" : "warning"}>{hasCaseNumberHeader ? "Ready" : "Missing case # column"}</Badge>
              {isPreviewing ? <Badge variant="outline">Analyzing {rowCount} rows…</Badge> : null}
              {preview ? (
                <>
                  <Badge variant="success">{preview.matched} matched</Badge>
                  {preview.unmatched.length ? <Badge variant="warning">{preview.unmatched.length} unmatched</Badge> : null}
                  {preview.unlinked?.length ? <Badge variant="warning">{preview.unlinked.length} unlinked</Badge> : null}
                  {preview.skipped ? <Badge variant="outline">{preview.skipped} empty rows skipped</Badge> : null}
                  {importResult?.failed?.length ? (
                    <Badge variant="warning">{importResult.failed.length} failed</Badge>
                  ) : null}
                </>
              ) : null}
              {importResult && !importResult.dryRun ? <Badge variant="pink">{importResult.updated} updated</Badge> : null}
              <Badge variant="outline">{rowCount} rows</Badge>
              <Badge variant="outline">{recognizedHeaderNames.length} recognized headers</Badge>
              <span className="text-muted-foreground">{fileName}</span>
            </div>
          ) : null}
          {errorMessage ? <p className="mt-3 text-sm text-rose-700">{errorMessage}</p> : null}
        </div>

        {preview?.unmatched.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">Unmatched case numbers</p>
            <p className="mt-1 text-amber-900">These rows were not found in DocketFlow and were not imported: {preview.unmatched.join(", ")}</p>
          </div>
        ) : null}

        {preview?.unlinked.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">Unlinked tracker rows</p>
            <p className="mt-1 text-amber-900">
              These case numbers only exist as detached tracker rows (no live DocketFlow case), so DOL was not updated:{" "}
              {preview.unlinked.join(", ")}
            </p>
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

        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm font-semibold text-navy-950">CSV rules</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Case number column required: {CASE_BACKFILL_CASE_NUMBER_HEADERS.join(", ")}. DOL:{" "}
              {CASE_BACKFILL_DOL_HEADERS.join(", ")}. Date signed: {CASE_BACKFILL_DATE_SIGNED_HEADERS.join(", ")}.
            </li>
            <li>Rows with no matching case are skipped — nothing new is created.</li>
            <li>Leave a cell blank (or &quot;not set&quot;) to keep the existing value for that field.</li>
            <li>Do not include client, attorney, or paralegal — those stay in DocketFlow.</li>
            <li>
              <span className="font-medium text-navy-950">Status</span> — <span className="font-medium text-navy-950">Active</span> or{" "}
              <span className="font-medium text-navy-950">Closed</span> (optional; otherwise derived from stage and disbursed).
              <span className="font-medium text-navy-950"> Referral Fee</span> is a percent (e.g. <span className="font-medium text-navy-950">33%</span>).
              <span className="font-medium text-navy-950"> Settlement Amount</span> and{" "}
              <span className="font-medium text-navy-950">RJL Attorney Fees</span> update the Results section.
            </li>
          </ul>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Section</TableHead>
                <TableHead>Headers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CASE_BACKFILL_HEADER_GROUPS.map((group) => (
                <TableRow key={group.label}>
                  <TableCell className="w-56 align-top font-semibold text-navy-950">{group.label}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {group.headers.map((header) => (
                        <Badge
                          key={header}
                          variant={headers.some((item) => item.toLowerCase() === header.toLowerCase()) ? "success" : "outline"}
                        >
                          {headers.some((item) => item.toLowerCase() === header.toLowerCase()) ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : null}
                          {header}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {preview?.preview.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case #</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead>Fields in row</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.preview.map((row) => (
                  <TableRow key={row.caseNumber}>
                    <TableCell className="font-medium">{row.caseNumber}</TableCell>
                    <TableCell>
                      <Badge variant={row.matched ? "success" : "warning"}>{row.matched ? "Matched" : "Not found"}</Badge>
                    </TableCell>
                    <TableCell>{row.fieldCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
