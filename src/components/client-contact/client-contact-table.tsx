"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { CaseNumberLink } from "@/components/cases/case-number-link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CLIENT_CONTACT_WINDOW_DAYS, contactNeedsFollowUp, daysSinceContact } from "@/lib/client-contact/types";
import { cn, formatDate } from "@/lib/utils";

export type ClientContactRow = {
  caseId: string;
  caseNumber: string;
  clientName: string;
  attorneyName: string;
  paralegalName: string;
  legalAssistantName: string;
  lastAttempt: string | null;
  lastInteraction: string | null;
  lastOutboundCall: string | null;
  lastOutboundText: string | null;
  quoUrl: string | null;
};

type SortKey = "case" | "days";
type SortDirection = "asc" | "desc";

export function ClientContactTable({ rows }: { rows: ClientContactRow[] }) {
  const [query, setQuery] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(true);
  const [attorney, setAttorney] = useState("all");
  const [paralegal, setParalegal] = useState("all");
  const [legalAssistant, setLegalAssistant] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("days");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  function requestSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "case" ? "asc" : "desc");
  }

  const attorneys = useMemo(() => uniqueNames(rows.map((row) => row.attorneyName)), [rows]);
  const paralegals = useMemo(() => uniqueNames(rows.map((row) => row.paralegalName)), [rows]);
  const legalAssistants = useMemo(() => uniqueNames(rows.map((row) => row.legalAssistantName)), [rows]);

  const staffFiltered = useMemo(() => {
    return rows.filter((row) => {
      if (attorney !== "all" && row.attorneyName !== attorney) return false;
      if (paralegal !== "all" && row.paralegalName !== paralegal) return false;
      if (legalAssistant !== "all" && row.legalAssistantName !== legalAssistant) return false;
      return true;
    });
  }, [rows, attorney, paralegal, legalAssistant]);

  const counted = useMemo(() => {
    let overdue = 0;
    for (const row of staffFiltered) {
      if (contactNeedsFollowUp(row.lastAttempt)) overdue += 1;
    }
    return { overdue, current: staffFiltered.length - overdue };
  }, [staffFiltered]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return staffFiltered
      .filter((row) => !overdueOnly || contactNeedsFollowUp(row.lastAttempt))
      .filter((row) => {
        if (!needle) return true;
        return (
          row.caseNumber.toLowerCase().includes(needle) ||
          row.clientName.toLowerCase().includes(needle) ||
          row.attorneyName.toLowerCase().includes(needle) ||
          row.paralegalName.toLowerCase().includes(needle) ||
          row.legalAssistantName.toLowerCase().includes(needle)
        );
      })
      .sort((left, right) => compareRows(left, right, sortKey, sortDirection));
  }, [staffFiltered, overdueOnly, query, sortKey, sortDirection]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="danger">
          {counted.overdue} over {CLIENT_CONTACT_WINDOW_DAYS} days
        </Badge>
        <Badge variant="success">
          {counted.current} within {CLIENT_CONTACT_WINDOW_DAYS} days
        </Badge>
        <button
          type="button"
          onClick={() => setOverdueOnly((current) => !current)}
          className="text-sm font-medium text-pink-600 underline-offset-2 hover:underline"
        >
          {overdueOnly ? "Show all open cases" : "Show only cases needing contact"}
        </button>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search case, client, or staff"
          className="w-full sm:w-72"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <StaffFilter label="Attorney" value={attorney} onChange={setAttorney} options={attorneys} />
        <StaffFilter label="Paralegal" value={paralegal} onChange={setParalegal} options={paralegals} />
        <StaffFilter label="Legal assistant" value={legalAssistant} onChange={setLegalAssistant} options={legalAssistants} />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Case" sortKey="case" active={sortKey} direction={sortDirection} onSort={requestSort} />
              <TableHead>Client</TableHead>
              <TableHead>Quo</TableHead>
              <TableHead>Attorney</TableHead>
              <TableHead>Last attempt</TableHead>
              <SortableHead label="Days" sortKey="days" active={sortKey} direction={sortDirection} onSort={requestSort} />
              <TableHead>Last interaction</TableHead>
              <TableHead>Outbound call</TableHead>
              <TableHead>Outbound text</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-muted-foreground">
                  {overdueOnly ? "Every open case has a contact attempt in the last 30 days." : "No matching cases."}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => {
                const days = daysSinceContact(row.lastAttempt);
                const overdue = contactNeedsFollowUp(row.lastAttempt);
                return (
                  <TableRow key={row.caseId}>
                    <TableCell>
                      <CaseNumberLink caseId={row.caseId} caseNumber={row.caseNumber} />
                    </TableCell>
                    <TableCell>{row.clientName}</TableCell>
                    <TableCell>
                      {row.quoUrl ? (
                        <a
                          href={row.quoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-pink-600 hover:text-pink-500"
                        >
                          Open
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{row.attorneyName}</TableCell>
                    <TableCell>{formatContactDate(row.lastAttempt)}</TableCell>
                    <TableCell>
                      <Badge variant={overdue ? "danger" : "success"}>{days === null ? "Never" : days}</Badge>
                    </TableCell>
                    <TableCell>{formatContactDate(row.lastInteraction)}</TableCell>
                    <TableCell>{formatContactDate(row.lastOutboundCall)}</TableCell>
                    <TableCell>{formatContactDate(row.lastOutboundText)}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function StaffFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="flex min-w-44 flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
      <Select className="h-9 text-sm font-normal normal-case tracking-normal text-navy-950" value={value} onChange={(event) => onChange(event.target.value)} aria-label={`Filter by ${label}`}>
        <option value="all">All</option>
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </Select>
    </label>
  );
}

function uniqueNames(names: string[]) {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function formatContactDate(value: string | null) {
  if (!value) return "—";
  const formatted = formatDate(value);
  return formatted === "Not reviewed" ? "—" : formatted;
}

function contactAge(value: string | null) {
  const days = daysSinceContact(value);
  return days === null ? Number.POSITIVE_INFINITY : days;
}

function compareRows(left: ClientContactRow, right: ClientContactRow, sortKey: SortKey, direction: SortDirection) {
  const result =
    sortKey === "case"
      ? left.caseNumber.localeCompare(right.caseNumber, undefined, { numeric: true })
      : contactAge(left.lastAttempt) - contactAge(right.lastAttempt);
  if (Number.isNaN(result)) return 0;
  return direction === "asc" ? result : -result;
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
    <TableHead className="align-middle">
      <button
        type="button"
        className="inline-flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <Icon className={cn("h-3.5 w-3.5", isActive && "text-pink-500")} />
      </button>
    </TableHead>
  );
}
