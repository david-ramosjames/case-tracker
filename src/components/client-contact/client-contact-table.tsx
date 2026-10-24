"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { CaseNumberLink } from "@/components/cases/case-number-link";
import { Badge } from "@/components/ui/badge";
import { HeaderMultiFilter } from "@/components/ui/header-filter";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CLIENT_CONTACT_LONG_GAP_DAYS,
  CLIENT_CONTACT_WINDOW_DAYS,
  contactNeedsFollowUp,
  contactSentimentLabel,
  daysSinceContact,
} from "@/lib/client-contact/types";
import { cn, formatDate } from "@/lib/utils";

const SENTIMENT_FILTERS = ["Positive", "Neutral", "Negative", "Unknown", "No reading"] as const;

export type ClientContactRow = {
  caseId: string;
  caseNumber: string;
  attorneyId: string;
  clientName: string;
  attorneyName: string;
  paralegalName: string;
  legalAssistantName: string;
  lastAttempt: string | null;
  lastOutboundCall: string | null;
  lastOutboundText: string | null;
  lastOtherAt: string | null;
  lastOtherType: string | null;
  lastOtherDetails: string | null;
  sentiment: string | null;
  sentimentScore: number | null;
  sentimentReason: string | null;
  quoUrl: string | null;
};

type SortKey = "case" | "days";
type SortDirection = "asc" | "desc";

const compactHead = "h-8 px-2";
const compactCell = "px-2 py-1.5";

export function ClientContactTable({
  rows,
  scoreboardAttorneyIds,
}: {
  rows: ClientContactRow[];
  scoreboardAttorneyIds: string[] | null;
}) {
  const [query, setQuery] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(true);
  const [attorneys, setAttorneys] = useState<string[]>([]);
  const [paralegals, setParalegals] = useState<string[]>([]);
  const [legalAssistants, setLegalAssistants] = useState<string[]>([]);
  const [sentimentFilters, setSentimentFilters] = useState<string[]>([]);
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

  const scoreboard = useMemo(() => attorneyScoreboard(rows, scoreboardAttorneyIds), [rows, scoreboardAttorneyIds]);
  const attorneyOptions = useMemo(() => nameOptions(rows.map((row) => row.attorneyName)), [rows]);
  const paralegalOptions = useMemo(() => nameOptions(rows.map((row) => row.paralegalName)), [rows]);
  const legalAssistantOptions = useMemo(() => nameOptions(rows.map((row) => row.legalAssistantName)), [rows]);

  const staffFiltered = useMemo(() => {
    return rows.filter((row) => {
      if (!matchesSelection(row.attorneyName, attorneys)) return false;
      if (!matchesSelection(row.paralegalName, paralegals)) return false;
      if (!matchesSelection(row.legalAssistantName, legalAssistants)) return false;
      if (!matchesSelection(sentimentFilterValue(row), sentimentFilters)) return false;
      return true;
    });
  }, [rows, attorneys, paralegals, legalAssistants, sentimentFilters]);

  const counted = useMemo(() => {
    let never = 0;
    let over45 = 0;
    let over30 = 0;
    let within = 0;
    for (const row of staffFiltered) {
      const days = daysSinceContact(row.lastAttempt);
      if (days === null) {
        never += 1;
        over30 += 1;
      } else if (days > CLIENT_CONTACT_LONG_GAP_DAYS) {
        over45 += 1;
        over30 += 1;
      } else if (days > CLIENT_CONTACT_WINDOW_DAYS) {
        over30 += 1;
      } else {
        within += 1;
      }
    }
    return { never, over45, over30, within };
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
          row.legalAssistantName.toLowerCase().includes(needle) ||
          (row.lastOtherType ?? "").toLowerCase().includes(needle)
        );
      })
      .sort((left, right) => compareRows(left, right, sortKey, sortDirection));
  }, [staffFiltered, overdueOnly, query, sortKey, sortDirection]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {scoreboard.map((item) => {
          const selected = attorneys.length === 1 && attorneys[0] === item.name;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setAttorneys(selected ? [] : [item.name])}
              className={cn(
                "min-w-36 shrink-0 rounded-md border bg-white px-2.5 py-1.5 text-left",
                selected && "border-pink-300 bg-pink-50",
              )}
            >
              <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{item.name}</div>
              <div className="text-sm font-semibold text-navy-950">
                {item.overdue}
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">need contact</span>
              </div>
              <div className="text-[10px] text-muted-foreground">{item.total} open</div>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="danger" className="px-2 py-0 text-[11px]">
          {counted.over30} over {CLIENT_CONTACT_WINDOW_DAYS} days
        </Badge>
        <Badge variant="danger" className="px-2 py-0 text-[11px]">
          {counted.over45} over {CLIENT_CONTACT_LONG_GAP_DAYS} days
        </Badge>
        <Badge variant="outline" className="px-2 py-0 text-[11px]">
          {counted.never} never
        </Badge>
        <Badge variant="success" className="px-2 py-0 text-[11px]">
          {counted.within} within {CLIENT_CONTACT_WINDOW_DAYS} days
        </Badge>
        <button
          type="button"
          onClick={() => setOverdueOnly((current) => !current)}
          className="text-xs font-medium text-pink-600 underline-offset-2 hover:underline"
        >
          {overdueOnly ? "Show all open cases" : "Show only cases needing contact"}
        </button>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search case, client, or staff"
          className="h-8 w-full text-xs sm:w-64"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <HeaderMultiFilter label="Attorney" selected={attorneys} onChange={setAttorneys} options={attorneyOptions} className="w-44" />
        <HeaderMultiFilter label="Paralegal" selected={paralegals} onChange={setParalegals} options={paralegalOptions} className="w-44" />
        <HeaderMultiFilter
          label="Legal assistant"
          selected={legalAssistants}
          onChange={setLegalAssistants}
          options={legalAssistantOptions}
          className="w-44"
        />
        <HeaderMultiFilter
          label="Sentiment"
          selected={sentimentFilters}
          onChange={setSentimentFilters}
          options={SENTIMENT_FILTERS.map((label) => ({ value: label, label }))}
          className="w-44"
        />
      </div>

      <div className="rounded-lg border">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <SortableHead label="Case" sortKey="case" active={sortKey} direction={sortDirection} onSort={requestSort} />
              <TableHead className={compactHead}>Client</TableHead>
              <TableHead className={compactHead}>Quo</TableHead>
              <TableHead className={compactHead}>Attorney</TableHead>
              <TableHead className={compactHead}>Paralegal</TableHead>
              <TableHead className={compactHead}>Legal assistant</TableHead>
              <TableHead className={compactHead}>Last attempt</TableHead>
              <SortableHead label="Days" sortKey="days" active={sortKey} direction={sortDirection} onSort={requestSort} />
              <TableHead className={compactHead}>Sentiment</TableHead>
              <TableHead className={compactHead}>Other</TableHead>
              <TableHead className={compactHead}>Outbound call</TableHead>
              <TableHead className={compactHead}>Outbound text</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className={cn(compactCell, "text-muted-foreground")}>
                  {overdueOnly ? "Every open case has a contact attempt in the last 30 days." : "No matching cases."}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => {
                const days = daysSinceContact(row.lastAttempt);
                return (
                  <TableRow key={row.caseId}>
                    <TableCell className={compactCell}>
                      <CaseNumberLink caseId={row.caseId} caseNumber={row.caseNumber} />
                    </TableCell>
                    <TableCell className={cn(compactCell, "max-w-40 truncate")}>{row.clientName}</TableCell>
                    <TableCell className={compactCell}>
                      {row.quoUrl ? (
                        <a
                          href={row.quoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-pink-600 hover:text-pink-500"
                        >
                          Open
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className={cn(compactCell, "max-w-36 truncate")}>{row.attorneyName}</TableCell>
                    <TableCell className={cn(compactCell, "max-w-36 truncate")}>{row.paralegalName || "—"}</TableCell>
                    <TableCell className={cn(compactCell, "max-w-36 truncate")}>{row.legalAssistantName || "—"}</TableCell>
                    <TableCell className={cn(compactCell, "whitespace-nowrap")}>{formatContactDate(row.lastAttempt)}</TableCell>
                    <TableCell className={compactCell}>
                      <Badge variant={daysBadgeVariant(days)} className="px-1.5 py-0 text-[10px]">
                        {days === null ? "Never" : days}
                      </Badge>
                    </TableCell>
                    <TableCell className={cn(compactCell, "whitespace-nowrap")}>
                      <SentimentCell row={row} />
                    </TableCell>
                    <TableCell className={cn(compactCell, "max-w-44 truncate whitespace-nowrap")} title={row.lastOtherDetails ?? undefined}>
                      {formatOtherContact(row.lastOtherAt, row.lastOtherType)}
                    </TableCell>
                    <TableCell className={cn(compactCell, "whitespace-nowrap")}>{formatContactDate(row.lastOutboundCall)}</TableCell>
                    <TableCell className={cn(compactCell, "whitespace-nowrap")}>{formatContactDate(row.lastOutboundText)}</TableCell>
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

function attorneyScoreboard(rows: ClientContactRow[], allowlist: string[] | null) {
  const allowed = allowlist ? new Set(allowlist) : null;
  const byAttorney = new Map<string, { name: string; overdue: number; total: number }>();
  for (const row of rows) {
    if (allowed && !allowed.has(row.attorneyId)) continue;
    const name = row.attorneyName.trim() || "Unassigned";
    const current = byAttorney.get(row.attorneyId) ?? { name, overdue: 0, total: 0 };
    current.total += 1;
    if (contactNeedsFollowUp(row.lastAttempt)) current.overdue += 1;
    byAttorney.set(row.attorneyId, current);
  }
  return [...byAttorney.entries()]
    .map(([id, counts]) => ({ id, ...counts }))
    .sort((left, right) => right.overdue - left.overdue || left.name.localeCompare(right.name));
}

function sentimentFilterValue(row: ClientContactRow) {
  const label = contactSentimentLabel(row.lastAttempt, row.sentiment);
  return label === "—" ? "No reading" : label;
}

function SentimentCell({ row }: { row: ClientContactRow }) {
  const label = contactSentimentLabel(row.lastAttempt, row.sentiment);
  const showScore = label !== "Unknown" && label !== "—" && row.sentimentScore != null;
  return (
    <span className="inline-flex items-center gap-1" title={label === "Unknown" ? undefined : (row.sentimentReason ?? undefined)}>
      <Badge variant={sentimentBadgeVariant(label)} className="px-1.5 py-0 text-[10px]">
        {label}
      </Badge>
      {showScore ? <span className="text-[10px] text-muted-foreground">{row.sentimentScore}</span> : null}
    </span>
  );
}

function sentimentBadgeVariant(label: string) {
  if (label === "Positive") return "success" as const;
  if (label === "Negative") return "danger" as const;
  if (label === "Neutral") return "warning" as const;
  return "outline" as const;
}

function matchesSelection(name: string, selected: string[]) {
  return selected.length === 0 || selected.includes(name);
}

function nameOptions(names: string[]) {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({ value: name, label: name }));
}

function formatContactDate(value: string | null) {
  if (!value) return "—";
  const formatted = formatDate(value);
  return formatted === "Not reviewed" ? "—" : formatted;
}

function formatOtherContact(value: string | null, contactType: string | null) {
  const when = formatContactDate(value);
  if (when === "—") return "—";
  return contactType ? `${when} · ${contactType}` : when;
}

function daysBadgeVariant(days: number | null) {
  if (days === null || days > CLIENT_CONTACT_LONG_GAP_DAYS) return "danger" as const;
  if (days > CLIENT_CONTACT_WINDOW_DAYS) return "warning" as const;
  return "success" as const;
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
    <TableHead className={cn("align-middle", compactHead)}>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <Icon className={cn("h-3 w-3", isActive && "text-pink-500")} />
      </button>
    </TableHead>
  );
}
