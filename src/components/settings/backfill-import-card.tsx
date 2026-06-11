"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CASE_BACKFILL_ALL_HEADERS,
  CASE_BACKFILL_CASE_NUMBER_HEADERS,
  CASE_BACKFILL_DOL_HEADERS,
  CASE_BACKFILL_HEADER_GROUPS,
  hasCaseBackfillHeaders,
} from "@/lib/csv/case-backfill";
import { parseCsv } from "@/lib/csv/parse";
import { type CaseBackfillImportResult } from "@/lib/types";

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

  const hasCaseNumberHeader = useMemo(
    () => CASE_BACKFILL_CASE_NUMBER_HEADERS.some((header) => headers.some((item) => item.toLowerCase() === header.toLowerCase())),
    [headers],
  );
  const recognizedCount = useMemo(
    () => headers.filter((header) => CASE_BACKFILL_ALL_HEADERS.some((expected) => expected.toLowerCase() === header.toLowerCase())).length,
    [headers],
  );
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
    setErrorMessage(null);
    try {
      const response = await fetch("/api/import/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText, dryRun: false }),
      });
      const payload = (await response.json()) as CaseBackfillImportResult & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Import failed.");
      setImportResult(payload);
      setPreview(payload);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>CSV Backfill</CardTitle>
        <CardDescription>
          Match existing cases by case number only — extra rows in the CSV are ignored. Upload just{" "}
          <span className="font-medium text-navy-950">Case #</span> and <span className="font-medium text-navy-950">DOL</span>{" "}
          to fill missing dates of loss. Empty cells are skipped; client, attorney, and paralegal are never changed.
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
                <a href="/templates/case-dol-template.csv" download>
                  DOL-only template
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href="/templates/case-backfill-template.csv" download>
                  Full template
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
                Import to tracker
              </Button>
            </div>
          </div>
          {fileName ? (
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <Badge variant={hasCaseNumberHeader ? "success" : "warning"}>{hasCaseNumberHeader ? "Ready" : "Missing case # column"}</Badge>
              {isPreviewing ? <Badge variant="outline">Checking matches…</Badge> : null}
              {preview ? (
                <>
                  <Badge variant="success">{preview.matched} matched</Badge>
                  {preview.unmatched.length ? <Badge variant="warning">{preview.unmatched.length} unmatched</Badge> : null}
                  {preview.skipped ? <Badge variant="outline">{preview.skipped} empty rows skipped</Badge> : null}
                </>
              ) : null}
              {importResult && !importResult.dryRun ? <Badge variant="pink">{importResult.updated} updated</Badge> : null}
              <Badge variant="outline">{rowCount} rows</Badge>
              <Badge variant="outline">{recognizedCount} recognized headers</Badge>
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

        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm font-semibold text-navy-950">CSV rules</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Case number column required: {CASE_BACKFILL_CASE_NUMBER_HEADERS.join(", ")}. DOL column:{" "}
              {CASE_BACKFILL_DOL_HEADERS.join(", ")}.
            </li>
            <li>Rows with no matching case are skipped — nothing new is created.</li>
            <li>Leave a cell blank (or &quot;not set&quot;) to keep the existing DOL.</li>
            <li>Do not include client, attorney, or paralegal — those stay in DocketFlow.</li>
            <li>
              Overall <span className="font-medium text-navy-950">Active / Closed</span> is set automatically from{" "}
              <span className="font-medium text-navy-950">Stage</span> and <span className="font-medium text-navy-950">Disbursed</span>.
              Use <span className="font-medium text-navy-950">Status Notes</span> for narrative notes on the case detail page.
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
