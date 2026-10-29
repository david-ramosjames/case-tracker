"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
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
const DAY_RANGE_FILTERS = [
  { value: "0-10", label: "0–10 days" },
  { value: "10-20", label: "10–20 days" },
  { value: "20-30", label: "20–30 days" },
  { value: "30+", label: "30+ days" },
] as const;

type ContactTab = "calls" | "sentiment";
type SortKey = "case" | "days";
type SortDirection = "asc" | "desc";

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
  sentimentWeekLabel: string | null;
  sentimentScoredAt: string | null;
  quoUrl: string | null;
};

const compactHead = "h-8 px-2";
const compactCell = "px-2 py-1.5";

export function ClientContactView({
  rows,
  scoreboardAttorneyIds,
}: {
  rows: ClientContactRow[];
  scoreboardAttorneyIds: string[] | null;
}) {
  const [tab, setTab] = useState<ContactTab>("calls");
  const [query, setQuery] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(true);
  const [attorneys, setAttorneys] = useState<string[]>([]);
  const [paralegals, setParalegals] = useState<string[]>([]);
  const [legalAssistants, setLegalAssistants] = useState<string[]>([]);
  const [sentimentFilters, setSentimentFilters] = useState<string[]>([]);
  const [dayRanges, setDayRanges] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("days");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [focusedCaseNumber, setFocusedCaseNumber] = useState<string | null>(null);

  function requestSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "case" ? "asc" : "desc");
  }

  function openSentimentForRow(row: ClientContactRow) {
    const label = sentimentFilterValue(row);
    setTab("sentiment");
    setFocusedCaseNumber(row.caseNumber);
    setQuery(row.caseNumber);
    setSentimentFilters(label === "No reading" ? ["No reading"] : [label]);
  }

  const callScoreboard = useMemo(() => callAttorneyScoreboard(rows, scoreboardAttorneyIds), [rows, scoreboardAttorneyIds]);
  const sentimentScoreboard = useMemo(
    () => sentimentAttorneyScoreboard(rows, scoreboardAttorneyIds),
    [rows, scoreboardAttorneyIds],
  );
  const attorneyOptions = useMemo(() => nameOptions(rows.map((row) => row.attorneyName)), [rows]);
  const paralegalOptions = useMemo(() => nameOptions(rows.map((row) => row.paralegalName)), [rows]);
  const legalAssistantOptions = useMemo(() => nameOptions(rows.map((row) => row.legalAssistantName)), [rows]);

  const staffFiltered = useMemo(() => {
    return rows.filter((row) => {
      if (!matchesSelection(row.attorneyName, attorneys)) return false;
      if (!matchesSelection(row.paralegalName, paralegals)) return false;
      if (!matchesSelection(row.legalAssistantName, legalAssistants)) return false;
      return true;
    });
  }, [rows, attorneys, paralegals, legalAssistants]);

  const callFiltered = useMemo(() => {
    return staffFiltered.filter((row) => {
      if (!matchesSelection(sentimentFilterValue(row), sentimentFilters)) return false;
      if (!matchesDayRanges(row.lastAttempt, dayRanges)) return false;
      return true;
    });
  }, [staffFiltered, sentimentFilters, dayRanges]);

  const counted = useMemo(() => {
    let never = 0;
    let over45 = 0;
    let over30 = 0;
    let within = 0;
    for (const row of callFiltered) {
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
  }, [callFiltered]);

  const callVisible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const enforceOverdue = overdueOnly && dayRanges.length === 0;
    return callFiltered
      .filter((row) => !enforceOverdue || contactNeedsFollowUp(row.lastAttempt))
      .filter((row) => matchesSearch(row, needle))
      .sort((left, right) => compareRows(left, right, sortKey, sortDirection));
  }, [callFiltered, overdueOnly, dayRanges, query, sortKey, sortDirection]);

  const sentimentFiltered = useMemo(() => {
    return staffFiltered.filter((row) => matchesSelection(sentimentFilterValue(row), sentimentFilters));
  }, [staffFiltered, sentimentFilters]);

  const sentimentVisible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sentimentFiltered
      .filter((row) => matchesSearch(row, needle) || matchesReasonSearch(row, needle))
      .sort((left, right) => {
        if (focusedCaseNumber) {
          const leftFocus = left.caseNumber === focusedCaseNumber ? 0 : 1;
          const rightFocus = right.caseNumber === focusedCaseNumber ? 0 : 1;
          if (leftFocus !== rightFocus) return leftFocus - rightFocus;
        }
        const labelRank = sentimentSortRank(sentimentFilterValue(right)) - sentimentSortRank(sentimentFilterValue(left));
        if (labelRank !== 0) return labelRank;
        const scoreDelta = (right.sentimentScore ?? -1) - (left.sentimentScore ?? -1);
        if (scoreDelta !== 0) return scoreDelta;
        return left.caseNumber.localeCompare(right.caseNumber, undefined, { numeric: true });
      });
  }, [sentimentFiltered, query, focusedCaseNumber]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 border-b border-border pb-0">
        <TabButton active={tab === "calls"} onClick={() => setTab("calls")}>
          Calls
        </TabButton>
        <TabButton active={tab === "sentiment"} onClick={() => setTab("sentiment")}>
          Sentiment
        </TabButton>
      </div>

      {tab === "calls" ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {callScoreboard.map((item) => {
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
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {sentimentScoreboard.map((item) => {
            const selected = attorneys.length === 1 && attorneys[0] === item.name;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setAttorneys(selected ? [] : [item.name])}
                className={cn(
                  "min-w-44 shrink-0 rounded-md border bg-white px-2.5 py-1.5 text-left",
                  selected && "border-pink-300 bg-pink-50",
                )}
              >
                <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{item.name}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <SentimentCount label="Neg" count={item.negative} tone="danger" />
                  <SentimentCount label="Neu" count={item.neutral} tone="warning" />
                  <SentimentCount label="Pos" count={item.positive} tone="success" />
                  <SentimentCount label="Unk" count={item.unknown} tone="outline" />
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">{item.total} open</div>
              </button>
            );
          })}
        </div>
      )}

      {tab === "calls" ? (
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
            {overdueOnly && dayRanges.length === 0 ? "Show all open cases" : "Show only cases needing contact"}
          </button>
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setFocusedCaseNumber(null);
            }}
            placeholder="Search case, client, or staff"
            className="h-8 w-full text-xs sm:w-64"
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="danger" className="px-2 py-0 text-[11px]">
            {sentimentFiltered.filter((row) => sentimentFilterValue(row) === "Negative").length} negative
          </Badge>
          <Badge variant="warning" className="px-2 py-0 text-[11px]">
            {sentimentFiltered.filter((row) => sentimentFilterValue(row) === "Neutral").length} neutral
          </Badge>
          <Badge variant="success" className="px-2 py-0 text-[11px]">
            {sentimentFiltered.filter((row) => sentimentFilterValue(row) === "Positive").length} positive
          </Badge>
          <Badge variant="outline" className="px-2 py-0 text-[11px]">
            {sentimentFiltered.filter((row) => {
              const label = sentimentFilterValue(row);
              return label === "Unknown" || label === "No reading";
            }).length}{" "}
            unknown / none
          </Badge>
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setFocusedCaseNumber(null);
            }}
            placeholder="Search case, client, staff, or reason"
            className="h-8 w-full text-xs sm:w-72"
          />
        </div>
      )}

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
        {tab === "calls" ? (
          <HeaderMultiFilter
            label="Days since contact"
            selected={dayRanges}
            onChange={(values) => {
              setDayRanges(values);
              if (values.length > 0) setOverdueOnly(false);
            }}
            options={DAY_RANGE_FILTERS.map((item) => ({ value: item.value, label: item.label }))}
            className="w-44"
          />
        ) : null}
      </div>

      {tab === "calls" ? (
        <CallsTable
          rows={callVisible}
          overdueOnly={overdueOnly && dayRanges.length === 0}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={requestSort}
          onOpenSentiment={openSentimentForRow}
        />
      ) : (
        <SentimentTable rows={sentimentVisible} focusedCaseNumber={focusedCaseNumber} />
      )}
    </div>
  );
}

/** @deprecated Prefer ClientContactView. */
export const ClientContactTable = ClientContactView;

function CallsTable({
  rows,
  overdueOnly,
  sortKey,
  sortDirection,
  onSort,
  onOpenSentiment,
}: {
  rows: ClientContactRow[];
  overdueOnly: boolean;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
  onOpenSentiment: (row: ClientContactRow) => void;
}) {
  return (
    <div className="rounded-lg border">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <SortableHead label="Case" sortKey="case" active={sortKey} direction={sortDirection} onSort={onSort} />
            <TableHead className={compactHead}>Client</TableHead>
            <TableHead className={compactHead}>Quo</TableHead>
            <TableHead className={compactHead}>Attorney</TableHead>
            <TableHead className={compactHead}>Paralegal</TableHead>
            <TableHead className={compactHead}>Legal assistant</TableHead>
            <TableHead className={compactHead}>Last attempt</TableHead>
            <SortableHead label="Days" sortKey="days" active={sortKey} direction={sortDirection} onSort={onSort} />
            <TableHead className={compactHead}>Sentiment</TableHead>
            <TableHead className={compactHead}>Other</TableHead>
            <TableHead className={compactHead}>Outbound call</TableHead>
            <TableHead className={compactHead}>Outbound text</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={12} className={cn(compactCell, "text-muted-foreground")}>
                {overdueOnly ? "Every open case has a contact attempt in the last 30 days." : "No matching cases."}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
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
                    <SentimentCell row={row} onOpen={() => onOpenSentiment(row)} />
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
  );
}

function SentimentTable({ rows, focusedCaseNumber }: { rows: ClientContactRow[]; focusedCaseNumber: string | null }) {
  return (
    <div className="rounded-lg border">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className={compactHead}>Case</TableHead>
            <TableHead className={compactHead}>Client</TableHead>
            <TableHead className={compactHead}>Attorney</TableHead>
            <TableHead className={compactHead}>Sentiment</TableHead>
            <TableHead className={compactHead}>Score</TableHead>
            <TableHead className={compactHead}>Week</TableHead>
            <TableHead className={compactHead}>Why</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className={cn(compactCell, "text-muted-foreground")}>
                No matching sentiment readings.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const label = contactSentimentLabel(row.lastAttempt, row.sentiment);
              const showScore = label !== "Unknown" && label !== "—" && row.sentimentScore != null;
              const reason =
                label === "Unknown"
                  ? "Last contact attempt is older than 30 days, so this reading is not current enough."
                  : label === "—"
                    ? "No weekly sentiment reading is stored for this case yet."
                    : row.sentimentReason?.trim() || "No explanation was stored with this reading.";
              return (
                <TableRow key={row.caseId} className={cn(focusedCaseNumber === row.caseNumber && "bg-pink-50/70")}>
                  <TableCell className={compactCell}>
                    <CaseNumberLink caseId={row.caseId} caseNumber={row.caseNumber} />
                  </TableCell>
                  <TableCell className={cn(compactCell, "max-w-40 truncate")}>{row.clientName}</TableCell>
                  <TableCell className={cn(compactCell, "max-w-36 truncate")}>{row.attorneyName}</TableCell>
                  <TableCell className={cn(compactCell, "whitespace-nowrap")}>
                    <Badge variant={sentimentBadgeVariant(label)} className="px-1.5 py-0 text-[10px]">
                      {label}
                    </Badge>
                  </TableCell>
                  <TableCell className={compactCell}>{showScore ? row.sentimentScore : "—"}</TableCell>
                  <TableCell className={cn(compactCell, "max-w-48 truncate")} title={row.sentimentWeekLabel ?? undefined}>
                    {row.sentimentWeekLabel?.trim() || formatContactDate(row.sentimentScoredAt)}
                  </TableCell>
                  <TableCell className={cn(compactCell, "min-w-64 max-w-xl whitespace-normal text-[11px] leading-snug text-muted-foreground")}>
                    {reason}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
        active ? "border-pink-500 text-navy-950" : "border-transparent text-muted-foreground hover:text-navy-950",
      )}
    >
      {children}
    </button>
  );
}

function SentimentCount({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "danger" | "warning" | "success" | "outline";
}) {
  return (
    <Badge variant={tone} className="px-1.5 py-0 text-[10px]">
      {label} {count}
    </Badge>
  );
}

function callAttorneyScoreboard(rows: ClientContactRow[], allowlist: string[] | null) {
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

function sentimentAttorneyScoreboard(rows: ClientContactRow[], allowlist: string[] | null) {
  const allowed = allowlist ? new Set(allowlist) : null;
  const byAttorney = new Map<
    string,
    { name: string; positive: number; neutral: number; negative: number; unknown: number; total: number }
  >();
  for (const row of rows) {
    if (allowed && !allowed.has(row.attorneyId)) continue;
    const name = row.attorneyName.trim() || "Unassigned";
    const current = byAttorney.get(row.attorneyId) ?? {
      name,
      positive: 0,
      neutral: 0,
      negative: 0,
      unknown: 0,
      total: 0,
    };
    current.total += 1;
    const label = sentimentFilterValue(row);
    if (label === "Positive") current.positive += 1;
    else if (label === "Neutral") current.neutral += 1;
    else if (label === "Negative") current.negative += 1;
    else current.unknown += 1;
    byAttorney.set(row.attorneyId, current);
  }
  return [...byAttorney.entries()]
    .map(([id, counts]) => ({ id, ...counts }))
    .sort(
      (left, right) =>
        right.negative - left.negative ||
        right.unknown - left.unknown ||
        left.positive - right.positive ||
        left.name.localeCompare(right.name),
    );
}

function sentimentFilterValue(row: ClientContactRow) {
  const label = contactSentimentLabel(row.lastAttempt, row.sentiment);
  return label === "—" ? "No reading" : label;
}

function SentimentCell({ row, onOpen }: { row: ClientContactRow; onOpen: () => void }) {
  const label = contactSentimentLabel(row.lastAttempt, row.sentiment);
  const showScore = label !== "Unknown" && label !== "—" && row.sentimentScore != null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-1 rounded-sm text-left hover:opacity-80"
      title={label === "Unknown" ? "Open sentiment details" : (row.sentimentReason ?? "Open sentiment details")}
    >
      <Badge variant={sentimentBadgeVariant(label)} className="px-1.5 py-0 text-[10px]">
        {label}
      </Badge>
      {showScore ? <span className="text-[10px] text-muted-foreground">{row.sentimentScore}</span> : null}
    </button>
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

function matchesDayRanges(lastAttempt: string | null, selected: string[]) {
  if (selected.length === 0) return true;
  const days = daysSinceContact(lastAttempt);
  return selected.some((range) => {
    if (range === "0-10") return days !== null && days <= 10;
    if (range === "10-20") return days !== null && days > 10 && days <= 20;
    if (range === "20-30") return days !== null && days > 20 && days <= 30;
    if (range === "30+") return days === null || days > 30;
    return false;
  });
}

function matchesSearch(row: ClientContactRow, needle: string) {
  if (!needle) return true;
  return (
    row.caseNumber.toLowerCase().includes(needle) ||
    row.clientName.toLowerCase().includes(needle) ||
    row.attorneyName.toLowerCase().includes(needle) ||
    row.paralegalName.toLowerCase().includes(needle) ||
    row.legalAssistantName.toLowerCase().includes(needle) ||
    (row.lastOtherType ?? "").toLowerCase().includes(needle)
  );
}

function matchesReasonSearch(row: ClientContactRow, needle: string) {
  if (!needle) return true;
  return (row.sentimentReason ?? "").toLowerCase().includes(needle);
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

function sentimentSortRank(label: string) {
  if (label === "Negative") return 4;
  if (label === "Unknown") return 3;
  if (label === "No reading") return 2;
  if (label === "Neutral") return 1;
  if (label === "Positive") return 0;
  return -1;
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
