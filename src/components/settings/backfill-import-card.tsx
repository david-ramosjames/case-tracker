"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const REQUIRED_HEADERS = ["Case #"];

const HEADER_GROUPS = [
  {
    label: "Match and shared case fields",
    headers: ["Case #", "Client", "Attorney", "Paralegal", "Date Signed", "DOL"],
  },
  {
    label: "Cases page editable fields",
    headers: ["Case Status", "Type", "Liability", "Quarter", "Case Size", "Minimum Value", "Referral Fee", "Policy Limits", "Stage", "Expected Lit"],
  },
  {
    label: "Case detail fields",
    headers: ["Sources", "Lit Events Needed", "Timeline for Lit Events", "Injuries", "Description", "Status Notes", "GV Notes", "LRJ Notes"],
  },
  {
    label: "Results fields",
    headers: [
      "Settlement Date",
      "Settlement Amount",
      "Fee Percent",
      "Release",
      "Closing",
      "Check",
      "Disbursed",
      "Release Signed Date",
      "Closing Signed Date",
      "Check Deposited Date",
      "Check Disbursed Date",
      "Disburse Date",
      "Result Quarter",
    ],
  },
];

const ALL_HEADERS = HEADER_GROUPS.flatMap((group) => group.headers);

export function BackfillImportCard() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);

  const missingRequired = useMemo(
    () => REQUIRED_HEADERS.filter((header) => !headers.some((item) => item.toLowerCase() === header.toLowerCase())),
    [headers],
  );
  const recognizedCount = useMemo(
    () => headers.filter((header) => ALL_HEADERS.some((expected) => expected.toLowerCase() === header.toLowerCase())).length,
    [headers],
  );

  async function previewCsv(file: File | null) {
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim()));
    setFileName(file.name);
    setHeaders(rows[0]?.map((header) => header.trim()).filter(Boolean) ?? []);
    setRowCount(Math.max(rows.length - 1, 0));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>CSV Backfill</CardTitle>
        <CardDescription>
          Admin-only import area for spreadsheet backfills. The importer should match existing DocketFlow cases by Case # and then update tracker/results fields.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div>
              <p className="text-sm font-semibold text-navy-950">Upload CSV preview</p>
              <p className="text-sm text-muted-foreground">Use one row per case. This preview validates the shape before we wire the final Supabase commit step.</p>
            </div>
            <Button asChild variant="pink">
              <label>
                <Upload className="h-4 w-4" />
                Upload CSV
                <input
                  className="sr-only"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    void previewCsv(event.target.files?.[0] ?? null);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </Button>
          </div>
          {fileName ? (
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <Badge variant={missingRequired.length ? "warning" : "success"}>{missingRequired.length ? "Missing Case #" : "Ready to map"}</Badge>
              <Badge variant="outline">{rowCount} rows</Badge>
              <Badge variant="outline">{recognizedCount} recognized headers</Badge>
              <span className="text-muted-foreground">{fileName}</span>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm font-semibold text-navy-950">Recommended CSV structure</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Avoid duplicate header names. Use <span className="font-medium text-navy-950">Case Status</span> for Active/Closed and{" "}
            <span className="font-medium text-navy-950">Status Notes</span> for the deeper case-detail status/narrative field.
          </p>
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
              {HEADER_GROUPS.map((group) => (
                <TableRow key={group.label}>
                  <TableCell className="w-56 align-top font-semibold text-navy-950">{group.label}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {group.headers.map((header) => (
                        <Badge key={header} variant={headers.includes(header) ? "success" : "outline"}>
                          {headers.includes(header) ? <CheckCircle2 className="h-3 w-3" /> : null}
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
      </CardContent>
    </Card>
  );
}

function parseCsv(csvText: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const nextChar = csvText[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}
