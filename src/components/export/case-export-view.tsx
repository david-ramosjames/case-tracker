"use client";

import { useMemo, useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  CASE_EXPORT_COLUMNS,
  CASE_EXPORT_GROUP_LABELS,
  DEFAULT_CASE_EXPORT_COLUMN_IDS,
  buildCaseExportCsv,
  caseExportNeedsComments,
  downloadCaseExportCsv,
  type CaseExportColumnGroup,
  type CaseExportColumnId,
  type CaseExportContext,
} from "@/lib/csv/case-export";
import { compareCaseNumbers } from "@/lib/csv/parse";
import { deriveCaseStatusFromTracker } from "@/lib/case-status";
import { type CaseRecord, type CaseStatus, type TrackerComment } from "@/lib/types";
import { errorMessage } from "@/lib/utils";

const GROUP_ORDER: CaseExportColumnGroup[] = ["casesTable", "caseDetails", "notes", "results", "litigation"];

export function CaseExportView({
  records,
  initialCommentsByCaseId,
}: {
  records: CaseRecord[];
  initialCommentsByCaseId: Record<string, TrackerComment[]>;
}) {
  const [selectedColumnIds, setSelectedColumnIds] = useState<CaseExportColumnId[]>(DEFAULT_CASE_EXPORT_COLUMN_IDS);
  const [statusFilter, setStatusFilter] = useState<"all" | CaseStatus>("Active");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const commentsByCaseId = useMemo(() => {
    const map = new Map<string, TrackerComment[]>();
    for (const [caseId, comments] of Object.entries(initialCommentsByCaseId)) {
      map.set(caseId, comments);
    }
    return map;
  }, [initialCommentsByCaseId]);

  const filteredRecords = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return records
      .filter((record) => {
        if (statusFilter !== "all") {
          const status = deriveCaseStatusFromTracker(record.tracker.caseStage, record.tracker.result);
          if (status !== statusFilter) return false;
        }
        if (!needle) return true;
        const haystack = [
          record.shared.caseNumber,
          record.shared.clientName,
          record.attorney.name,
          record.paralegal.name,
          record.legalAssistant?.name ?? "",
          record.shared.caseType,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => compareCaseNumbers(a.shared.caseNumber, b.shared.caseNumber));
  }, [records, search, statusFilter]);

  const selectedSet = useMemo(() => new Set(selectedColumnIds), [selectedColumnIds]);

  function toggleColumn(columnId: CaseExportColumnId) {
    setSelectedColumnIds((current) =>
      current.includes(columnId) ? current.filter((id) => id !== columnId) : [...current, columnId],
    );
  }

  function selectDefaults() {
    setSelectedColumnIds(DEFAULT_CASE_EXPORT_COLUMN_IDS);
  }

  function selectGroup(group: CaseExportColumnGroup, selected: boolean) {
    const groupIds = CASE_EXPORT_COLUMNS.filter((column) => column.group === group).map((column) => column.id);
    setSelectedColumnIds((current) => {
      if (selected) {
        return [...new Set([...current, ...groupIds])];
      }
      return current.filter((id) => !groupIds.includes(id));
    });
  }

  function handleDownload() {
    setMessage(null);
    setError(null);

    if (selectedColumnIds.length === 0) {
      setError("Select at least one column to export.");
      return;
    }

    startTransition(() => {
      try {
        const context: CaseExportContext = { commentsByCaseId };
        if (caseExportNeedsComments(selectedColumnIds) && commentsByCaseId.size === 0) {
          // Comments were not preloaded; still export other columns with empty comment cells.
        }

        const orderedColumnIds = CASE_EXPORT_COLUMNS.map((column) => column.id).filter((id) =>
          selectedSet.has(id),
        );
        const csv = buildCaseExportCsv(filteredRecords, orderedColumnIds, context);
        const stamp = new Date().toISOString().slice(0, 10);
        downloadCaseExportCsv(csv, `case-export-${stamp}.csv`);
        setMessage(`Downloaded ${filteredRecords.length} case(s) with ${orderedColumnIds.length} column(s).`);
      } catch (downloadError) {
        setError(errorMessage(downloadError));
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Export filters</CardTitle>
          <CardDescription>
            Defaults match the Cases table. Add detail fields, notes, results, or litigation columns as needed. Money
            fields export as plain numbers for easy sorting in Excel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="block max-w-md flex-1">
              <span className="mb-2 block text-sm font-medium text-navy-950">Search</span>
              <Input
                value={search}
                placeholder="Case #, client, attorney..."
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="block w-full max-w-xs">
              <span className="mb-2 block text-sm font-medium text-navy-950">Case status</span>
              <Select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as "all" | CaseStatus)}
              >
                <option value="all">All</option>
                <option value="Active">Open</option>
                <option value="Closed">Closed</option>
              </Select>
            </label>
            <Badge variant="outline">{filteredRecords.length} of {records.length} case(s)</Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={handleDownload} disabled={isPending || filteredRecords.length === 0}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Download CSV
            </Button>
            <Button type="button" variant="outline" onClick={selectDefaults}>
              Reset to Cases table columns
            </Button>
            {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {GROUP_ORDER.map((group) => {
          const columns = CASE_EXPORT_COLUMNS.filter((column) => column.group === group);
          const selectedCount = columns.filter((column) => selectedSet.has(column.id)).length;
          return (
            <Card key={group}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{CASE_EXPORT_GROUP_LABELS[group]}</CardTitle>
                    <CardDescription>
                      {selectedCount} of {columns.length} selected
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => selectGroup(group, true)}>
                      All
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => selectGroup(group, false)}>
                      None
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {columns.map((column) => (
                  <label
                    key={column.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300"
                      checked={selectedSet.has(column.id)}
                      onChange={() => toggleColumn(column.id)}
                    />
                    <span>{column.label}</span>
                  </label>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
