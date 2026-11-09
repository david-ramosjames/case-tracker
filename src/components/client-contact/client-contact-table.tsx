"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CaseNumberLink } from "@/components/cases/case-number-link";
import { Badge } from "@/components/ui/badge";
import { HeaderMultiFilter } from "@/components/ui/header-filter";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type SentimentEvidenceItem } from "@/lib/client-contact/evidence-slack";
import { QUALIFYING_CALL_SECONDS, TEXT_EXCHANGE_WINDOW_DAYS } from "@/lib/client-contact/qualify";
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
  { value: "30-45", label: "30–45 days" },
  { value: "45-60", label: "45–60 days" },
  { value: "60-90", label: "60–90 days" },
  { value: "90+", label: "90+ days" },
  { value: "never", label: "Never contacted" },
] as const;

type ContactTab = "calls" | "sentiment";
type CallSortKey = "case" | "days";
type SentimentSortKey = "week" | "case";
type SortDirection = "asc" | "desc";

export type ClientContactRow = {
  caseId: string;
  caseNumber: string;
  attorneyId: string;
  clientName: string;
  attorneyName: string;
  paralegalName: string;
  legalAssistantName: string;
  lastInteraction: string | null;
  lastAttempt: string | null;
  /** Latest call of at least 60 seconds (Sona excluded). */
  lastQualifyingCall: string | null;
  lastQualifyingCallId?: string | null;
  lastQualifyingCallSlackUrl?: string | null;
  lastInboundText: string | null;
  lastOutboundText: string | null;
  /** Later message of the latest inbound+outbound pair within 7 days. */
  lastTextExchange: string | null;
  lastOutboundCall: string | null;
  lastOtherAt: string | null;
  lastOtherType: string | null;
  lastOtherDetails: string | null;
  sentiment: string | null;
  sentimentScore: number | null;
  sentimentReason: string | null;
  sentimentEvidenceUrls: string[];
  sentimentEvidence: SentimentEvidenceItem[];
  sentimentWeekLabel: string | null;
  sentimentWindowStart?: string | null;
  sentimentWindowEnd?: string | null;
  sentimentScoredAt: string | null;
  clientPhones?: string[];
  actionRequired: boolean;
  quoUrl: string | null;
};

const compactHead = "h-8 px-2";
const compactCell = "px-2 py-1.5";

export function ClientContactView({
  rows,
  sentimentRows,
  scoreboardAttorneyIds,
}: {
  rows: ClientContactRow[];
  /** Quo-contact-level rows for the Sentiment tab (falls back to case rows). */
  sentimentRows?: ClientContactRow[];
  scoreboardAttorneyIds: string[] | null;
}) {
  const sentimentSourceRows = sentimentRows ?? rows;
  const [tab, setTab] = useState<ContactTab>("calls");
  const [query, setQuery] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(true);
  const [attorneys, setAttorneys] = useState<string[]>([]);
  const [paralegals, setParalegals] = useState<string[]>([]);
  const [legalAssistants, setLegalAssistants] = useState<string[]>([]);
  const [sentimentFilters, setSentimentFilters] = useState<string[]>([]);
  const [dayRanges, setDayRanges] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<CallSortKey>("days");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [sentimentSortKey, setSentimentSortKey] = useState<SentimentSortKey>("week");
  const [sentimentSortDirection, setSentimentSortDirection] = useState<SortDirection>("desc");
  /** null = default to newest week once options load; [] = all weeks. */
  const [selectedWeeks, setSelectedWeeks] = useState<string[] | null>(null);
  const [actionRequiredOnly, setActionRequiredOnly] = useState(false);
  const [actionOverrides, setActionOverrides] = useState<Record<string, boolean>>({});
  const [actionSaving, setActionSaving] = useState<Record<string, boolean>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [noteSaving, setNoteSaving] = useState<Record<string, boolean>>({});
  const [noteStatus, setNoteStatus] = useState<Record<string, string>>({});
  const [focusedCaseNumber, setFocusedCaseNumber] = useState<string | null>(null);
  const sentimentTabDefaultsApplied = useRef(false);
  const searchParams = useSearchParams();
  const deepLinkApplied = useRef(false);

  function openSentimentTab(options?: { sentiment?: string | null; skipDefaultSentiment?: boolean }) {
    setTab("sentiment");
    // First visit: Negative + newest week (weeks fall back via null selectedWeeks).
    if (!sentimentTabDefaultsApplied.current) {
      sentimentTabDefaultsApplied.current = true;
      if (!options?.skipDefaultSentiment) {
        setSentimentFilters(options?.sentiment ? [options.sentiment] : ["Negative"]);
      } else if (options?.sentiment) {
        setSentimentFilters([options.sentiment]);
      }
      setSelectedWeeks(null);
    } else if (options?.sentiment) {
      setSentimentFilters([options.sentiment]);
    }
  }

  function openCallsTab() {
    setTab("calls");
    // Sentiment's Negative default (and any other sentiment picks) should not stick on Calls.
    setSentimentFilters([]);
    setActionRequiredOnly(false);
    setFocusedCaseNumber(null);
  }

  useEffect(() => {
    if (deepLinkApplied.current) return;
    const tabParam = searchParams.get("tab");
    const sentimentParam = searchParams.get("sentiment");
    if (tabParam !== "sentiment" && tabParam !== "calls" && !sentimentParam) return;
    deepLinkApplied.current = true;
    if (tabParam === "sentiment" || sentimentParam) {
      openSentimentTab({
        sentiment: sentimentParam && SENTIMENT_FILTERS.includes(sentimentParam as (typeof SENTIMENT_FILTERS)[number])
          ? sentimentParam
          : "Negative",
        skipDefaultSentiment: false,
      });
      return;
    }
    if (tabParam === "calls") openCallsTab();
  }, [searchParams]);

  function actionFlagKey(row: Pick<ClientContactRow, "caseNumber" | "clientName">) {
    return `${row.caseNumber.trim()}\t${row.clientName.trim()}`;
  }

  function isActionRequired(row: ClientContactRow) {
    const key = actionFlagKey(row);
    return key in actionOverrides ? actionOverrides[key] : row.actionRequired;
  }

  async function submitSentimentNote(row: ClientContactRow) {
    const key = actionFlagKey(row);
    const note = (noteDrafts[key] ?? "").trim();
    if (!note) return;
    setNoteSaving((current) => ({ ...current, [key]: true }));
    setNoteStatus((current) => ({ ...current, [key]: "" }));
    try {
      const response = await fetch("/api/client-contact/sentiment-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: row.caseId, note }),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error || "Unable to post note.");
      }
      setNoteDrafts((current) => ({ ...current, [key]: "" }));
      setNoteStatus((current) => ({ ...current, [key]: "Posted" }));
    } catch (error) {
      setNoteStatus((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "Unable to post note.",
      }));
      console.error(error);
    } finally {
      setNoteSaving((current) => {
        const copy = { ...current };
        delete copy[key];
        return copy;
      });
    }
  }

  async function toggleActionRequired(row: ClientContactRow, next: boolean) {
    const key = actionFlagKey(row);
    setActionOverrides((current) => ({ ...current, [key]: next }));
    setActionSaving((current) => ({ ...current, [key]: true }));
    try {
      const response = await fetch("/api/client-contact/sentiment-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseNumber: row.caseNumber,
          clientName: row.clientName,
          actionRequired: next,
        }),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error || "Unable to save action required.");
      }
    } catch (error) {
      setActionOverrides((current) => {
        const copy = { ...current };
        delete copy[key];
        return copy;
      });
      console.error(error);
    } finally {
      setActionSaving((current) => {
        const copy = { ...current };
        delete copy[key];
        return copy;
      });
    }
  }

  function requestSort(nextKey: CallSortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "case" ? "asc" : "desc");
  }

  function requestSentimentSort(nextKey: SentimentSortKey) {
    if (sentimentSortKey === nextKey) {
      setSentimentSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSentimentSortKey(nextKey);
    setSentimentSortDirection(nextKey === "case" ? "asc" : "desc");
  }

  function openSentimentForRow(row: ClientContactRow) {
    const label = sentimentFilterValue(row);
    const week = weekFilterKey(row);
    sentimentTabDefaultsApplied.current = true;
    setTab("sentiment");
    setFocusedCaseNumber(row.caseNumber);
    setQuery(row.caseNumber);
    setSentimentFilters(label === "No reading" ? ["No reading"] : [label]);
    if (week) setSelectedWeeks([week]);
  }

  const weekOptions = useMemo(() => buildWeekOptions(sentimentSourceRows), [sentimentSourceRows]);
  const latestWeek = weekOptions[0]?.value ?? "";
  const activeWeeks =
    selectedWeeks === null ? (latestWeek ? [latestWeek] : []) : selectedWeeks.filter((week) => weekOptions.some((option) => option.value === week));

  const callScoreboard = useMemo(() => callAttorneyScoreboard(rows, scoreboardAttorneyIds), [rows, scoreboardAttorneyIds]);
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

  const sentimentStaffBase = useMemo(() => {
    return sentimentSourceRows.filter((row) => {
      if (!matchesSelection(row.attorneyName, attorneys)) return false;
      if (!matchesSelection(row.paralegalName, paralegals)) return false;
      if (!matchesSelection(row.legalAssistantName, legalAssistants)) return false;
      return true;
    });
  }, [sentimentSourceRows, attorneys, paralegals, legalAssistants]);

  // Week filter is for the table; scoreboard always uses every contact so Unknown
  // (no interaction in 30 days) still counts even when specific weeks are selected.
  const sentimentStaffFiltered = useMemo(() => {
    if (activeWeeks.length === 0) return sentimentStaffBase;
    const selected = new Set(activeWeeks);
    return sentimentStaffBase.filter((row) => {
      if (selected.has(weekFilterKey(row))) return true;
      const label = sentimentFilterValue(row);
      return label === "Unknown" || label === "No reading";
    });
  }, [sentimentStaffBase, activeWeeks]);

  // Case-level (same open set as Calls): one current status per client, not per Quo contact.
  const sentimentScoreboard = useMemo(
    () => sentimentAttorneyScoreboard(staffFiltered, scoreboardAttorneyIds),
    [staffFiltered, scoreboardAttorneyIds],
  );

  const callFiltered = useMemo(() => {
    return staffFiltered.filter((row) => matchesDayRanges(row.lastInteraction, dayRanges));
  }, [staffFiltered, dayRanges]);

  const counted = useMemo(() => {
    let never = 0;
    let over45 = 0;
    let over30 = 0;
    let within = 0;
    for (const row of callFiltered) {
      const days = daysSinceContact(row.lastInteraction);
      if (days === null) {
        never += 1;
        over30 += 1;
      } else if (days >= CLIENT_CONTACT_LONG_GAP_DAYS) {
        over45 += 1;
        over30 += 1;
      } else if (days >= CLIENT_CONTACT_WINDOW_DAYS) {
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
      .filter((row) => !enforceOverdue || contactNeedsFollowUp(row.lastInteraction))
      .filter((row) => matchesSearch(row, needle))
      .sort((left, right) => compareRows(left, right, sortKey, sortDirection));
  }, [callFiltered, overdueOnly, dayRanges, query, sortKey, sortDirection]);

  const sentimentFiltered = useMemo(() => {
    return sentimentStaffFiltered.filter((row) => {
      if (!matchesSelection(sentimentFilterValue(row), sentimentFilters)) return false;
      if (actionRequiredOnly && !isActionRequired(row)) return false;
      return true;
    });
  }, [sentimentStaffFiltered, sentimentFilters, actionRequiredOnly, actionOverrides]);

  const actionRequiredCount = useMemo(
    () => sentimentStaffFiltered.filter((row) => isActionRequired(row)).length,
    [sentimentStaffFiltered, actionOverrides],
  );

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
        const leftAction = isActionRequired(left) ? 0 : 1;
        const rightAction = isActionRequired(right) ? 0 : 1;
        if (leftAction !== rightAction) return leftAction - rightAction;
        return compareSentimentRows(left, right, sentimentSortKey, sentimentSortDirection);
      });
  }, [sentimentFiltered, query, focusedCaseNumber, sentimentSortKey, sentimentSortDirection, actionOverrides]);

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-white px-3 py-2 text-xs leading-5 text-muted-foreground">
        <p className="font-semibold text-navy-950">What counts for the {CLIENT_CONTACT_WINDOW_DAYS} days</p>
        <ul className="mt-1 list-disc pl-4">
          <li>
            <span className="font-medium text-navy-950">Last interaction</span> is the latest of Call{" "}
            {QUALIFYING_CALL_SECONDS}+sec, Text exchange, or Other.
          </li>
          <li>
            <span className="font-medium text-navy-950">Call {QUALIFYING_CALL_SECONDS}+sec</span> is a connected call of
            at least {QUALIFYING_CALL_SECONDS} seconds. Sona does not count.
          </li>
          <li>
            <span className="font-medium text-navy-950">Text exchange</span> needs both an inbound and an outbound text
            within {TEXT_EXCHANGE_WINDOW_DAYS} days. A one-way text does not reset the clock.
          </li>
          <li>
            <span className="font-medium text-navy-950">Last attempt</span> still includes outbound calls and texts that
            did not qualify.
          </li>
        </ul>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-border pb-0">
        <TabButton active={tab === "calls"} onClick={openCallsTab}>
          Calls
        </TabButton>
        <TabButton active={tab === "sentiment"} onClick={() => openSentimentTab()}>
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
            {counted.over30} {CLIENT_CONTACT_WINDOW_DAYS}+ days
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
          <button
            type="button"
            onClick={() => setActionRequiredOnly((current) => !current)}
            className={cn(
              "inline-flex items-center rounded-md border px-2 py-0 text-[11px] font-medium",
              actionRequiredOnly ? "border-pink-300 bg-pink-50 text-pink-700" : "border-border text-muted-foreground hover:text-navy-950",
            )}
          >
            {actionRequiredCount} action required
          </button>
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

      <div className="flex flex-wrap items-end gap-2">
        <HeaderMultiFilter label="Attorney" selected={attorneys} onChange={setAttorneys} options={attorneyOptions} className="w-44" />
        <HeaderMultiFilter label="Paralegal" selected={paralegals} onChange={setParalegals} options={paralegalOptions} className="w-44" />
        <HeaderMultiFilter
          label="Legal assistant"
          selected={legalAssistants}
          onChange={setLegalAssistants}
          options={legalAssistantOptions}
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
        ) : (
          <>
            <HeaderMultiFilter
              label="Sentiment"
              selected={sentimentFilters}
              onChange={setSentimentFilters}
              options={SENTIMENT_FILTERS.map((label) => ({ value: label, label }))}
              className="w-44"
            />
            <HeaderMultiFilter
              label="Week"
              selected={activeWeeks}
              onChange={(values) => {
                sentimentTabDefaultsApplied.current = true;
                setSelectedWeeks(values);
              }}
              options={weekOptions}
              className="w-56"
            />
            <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md border bg-white px-2 text-xs">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={actionRequiredOnly}
                onChange={(event) => setActionRequiredOnly(event.target.checked)}
              />
              <span className={actionRequiredOnly ? "font-medium text-pink-700" : "text-muted-foreground"}>Action required</span>
            </label>
          </>
        )}
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
        <SentimentTable
          rows={sentimentVisible}
          focusedCaseNumber={focusedCaseNumber}
          sortKey={sentimentSortKey}
          sortDirection={sentimentSortDirection}
          onSort={requestSentimentSort}
          isActionRequired={isActionRequired}
          actionSaving={actionSaving}
          onToggleActionRequired={toggleActionRequired}
          noteDrafts={noteDrafts}
          noteSaving={noteSaving}
          noteStatus={noteStatus}
          onNoteChange={(row, value) => {
            const key = actionFlagKey(row);
            setNoteDrafts((current) => ({ ...current, [key]: value }));
            setNoteStatus((current) => ({ ...current, [key]: "" }));
          }}
          onNoteSubmit={submitSentimentNote}
        />
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
  sortKey: CallSortKey;
  sortDirection: SortDirection;
  onSort: (key: CallSortKey) => void;
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
            <TableHead className={compactHead} title="Latest qualifying contact">
              Last interaction
            </TableHead>
            <SortableHead label="Days" sortKey="days" active={sortKey} direction={sortDirection} onSort={onSort} />
            <TableHead className={compactHead} title="Includes outbound calls and texts that did not qualify">
              Last attempt
            </TableHead>
            <TableHead className={compactHead}>Outbound call</TableHead>
            <TableHead className={compactHead} title={`Connected call of at least ${QUALIFYING_CALL_SECONDS} seconds. Sona does not count.`}>
              Call {QUALIFYING_CALL_SECONDS}+sec
            </TableHead>
            <TableHead className={compactHead}>Inbound text</TableHead>
            <TableHead className={compactHead}>Outbound text</TableHead>
            <TableHead
              className={compactHead}
              title={`Later message when inbound and outbound fall within ${TEXT_EXCHANGE_WINDOW_DAYS} days`}
            >
              Text exchange
            </TableHead>
            <TableHead className={compactHead}>Other</TableHead>
            <TableHead className={compactHead}>Sentiment</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={15} className={cn(compactCell, "text-muted-foreground")}>
                {overdueOnly ? "Every open case has a client interaction in the last 30 days." : "No matching cases."}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const days = daysSinceContact(row.lastInteraction);
              return (
                <TableRow key={row.caseId}>
                  <TableCell className={compactCell}>
                    <CaseNumberLink caseId={row.caseId} caseNumber={row.caseNumber} openInNewTab />
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
                  <TableCell className={cn(compactCell, "whitespace-nowrap")}>{formatContactDate(row.lastInteraction)}</TableCell>
                  <TableCell className={compactCell}>
                    <Badge variant={daysBadgeVariant(days)} className="px-1.5 py-0 text-[10px]">
                      {days === null ? "Never" : days}
                    </Badge>
                  </TableCell>
                  <TableCell className={cn(compactCell, "whitespace-nowrap")}>{formatContactDate(row.lastAttempt)}</TableCell>
                  <TableCell className={cn(compactCell, "whitespace-nowrap")}>{formatContactDate(row.lastOutboundCall)}</TableCell>
                  <TableCell className={cn(compactCell, "whitespace-nowrap")}>
                    <QualifyingCallDate
                      at={row.lastQualifyingCall}
                      slackUrl={row.lastQualifyingCallSlackUrl}
                    />
                  </TableCell>
                  <TableCell className={cn(compactCell, "whitespace-nowrap")}>{formatContactDate(row.lastInboundText)}</TableCell>
                  <TableCell className={cn(compactCell, "whitespace-nowrap")}>{formatContactDate(row.lastOutboundText)}</TableCell>
                  <TableCell className={cn(compactCell, "whitespace-nowrap")}>{formatContactDate(row.lastTextExchange)}</TableCell>
                  <TableCell className={cn(compactCell, "max-w-44 truncate whitespace-nowrap")} title={row.lastOtherDetails ?? undefined}>
                    {formatOtherContact(row.lastOtherAt, row.lastOtherType)}
                  </TableCell>
                  <TableCell className={cn(compactCell, "whitespace-nowrap")}>
                    <SentimentCell row={row} onOpen={() => onOpenSentiment(row)} />
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

function SentimentTable({
  rows,
  focusedCaseNumber,
  sortKey,
  sortDirection,
  onSort,
  isActionRequired,
  actionSaving,
  onToggleActionRequired,
  noteDrafts,
  noteSaving,
  noteStatus,
  onNoteChange,
  onNoteSubmit,
}: {
  rows: ClientContactRow[];
  focusedCaseNumber: string | null;
  sortKey: SentimentSortKey;
  sortDirection: SortDirection;
  onSort: (key: SentimentSortKey) => void;
  isActionRequired: (row: ClientContactRow) => boolean;
  actionSaving: Record<string, boolean>;
  onToggleActionRequired: (row: ClientContactRow, next: boolean) => void;
  noteDrafts: Record<string, string>;
  noteSaving: Record<string, boolean>;
  noteStatus: Record<string, string>;
  onNoteChange: (row: ClientContactRow, value: string) => void;
  onNoteSubmit: (row: ClientContactRow) => void;
}) {
  return (
    <div className="rounded-lg border">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className={cn(compactHead, "w-10 text-center")} title="Action required">
              Act
            </TableHead>
            <SortableHead label="Case" sortKey="case" active={sortKey} direction={sortDirection} onSort={onSort} />
            <TableHead className={compactHead}>Client</TableHead>
            <TableHead className={compactHead}>Attorney</TableHead>
            <TableHead className={compactHead}>Sentiment</TableHead>
            <TableHead className={compactHead}>Score</TableHead>
            <SortableHead label="Week" sortKey="week" active={sortKey} direction={sortDirection} onSort={onSort} />
            <TableHead className={compactHead}>Why</TableHead>
            <TableHead className={compactHead}>Evidence</TableHead>
            <TableHead className={compactHead}>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className={cn(compactCell, "text-muted-foreground")}>
                No matching sentiment readings.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const label = contactSentimentLabel(row.lastInteraction, row.sentiment);
              const showScore = label !== "Unknown" && label !== "—" && row.sentimentScore != null;
              const weekLabel = formatWeekLabel(row.sentimentWeekLabel, row.sentimentScoredAt);
              const required = isActionRequired(row);
              const rowKey = `${row.caseNumber.trim()}\t${row.clientName.trim()}`;
              const saving = Boolean(actionSaving[rowKey]);
              const noteBusy = Boolean(noteSaving[rowKey]);
              const noteValue = noteDrafts[rowKey] ?? "";
              const noteMessage = noteStatus[rowKey] ?? "";
              const reason =
                label === "Unknown"
                  ? "Last interaction is older than 30 days, so this reading is not current enough."
                  : label === "—"
                    ? "No weekly sentiment reading is stored for this case yet."
                    : row.sentimentReason?.trim() || "No explanation was stored with this reading.";
              return (
                <TableRow
                  key={`${row.caseId}:${row.clientName}`}
                  className={cn(
                    focusedCaseNumber === row.caseNumber && "bg-pink-50/70",
                    required && "bg-amber-50/60",
                  )}
                >
                  <TableCell className={cn(compactCell, "text-center")}>
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      checked={required}
                      disabled={saving}
                      title="Action required"
                      aria-label={`Action required for ${row.clientName}`}
                      onChange={(event) => onToggleActionRequired(row, event.target.checked)}
                    />
                  </TableCell>
                  <TableCell className={compactCell}>
                    <CaseNumberLink caseId={row.caseId} caseNumber={row.caseNumber} openInNewTab />
                  </TableCell>
                  <TableCell className={cn(compactCell, "max-w-40 truncate")}>{row.clientName}</TableCell>
                  <TableCell className={cn(compactCell, "max-w-36 truncate")}>{row.attorneyName}</TableCell>
                  <TableCell className={cn(compactCell, "whitespace-nowrap")}>
                    <Badge variant={sentimentBadgeVariant(label)} className="px-1.5 py-0 text-[10px]">
                      {label}
                    </Badge>
                  </TableCell>
                  <TableCell className={compactCell}>{showScore ? row.sentimentScore : "—"}</TableCell>
                  <TableCell className={cn(compactCell, "whitespace-nowrap")}>{weekLabel}</TableCell>
                  <TableCell className={cn(compactCell, "min-w-64 max-w-xl whitespace-normal text-[11px] leading-snug text-muted-foreground")}>
                    {reason}
                  </TableCell>
                  <TableCell className={cn(compactCell, "min-w-36 max-w-56 whitespace-normal")}>
                    <EvidenceLinks items={row.sentimentEvidence} />
                  </TableCell>
                  <TableCell className={cn(compactCell, "min-w-48 max-w-64")}>
                    <form
                      className="flex flex-col gap-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        onNoteSubmit(row);
                      }}
                    >
                      <Input
                        value={noteValue}
                        disabled={noteBusy}
                        placeholder="Add note…"
                        className="h-7 text-xs"
                        aria-label={`Note for ${row.clientName}`}
                        onChange={(event) => onNoteChange(row, event.target.value)}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={noteBusy || !noteValue.trim()}
                          className="text-[10px] font-medium text-pink-600 disabled:text-muted-foreground"
                        >
                          {noteBusy ? "Posting…" : "Post"}
                        </button>
                        {noteMessage ? (
                          <span
                            className={cn(
                              "text-[10px]",
                              noteMessage === "Posted" ? "text-emerald-700" : "text-pink-600",
                            )}
                          >
                            {noteMessage}
                          </span>
                        ) : null}
                      </div>
                    </form>
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
    if (contactNeedsFollowUp(row.lastInteraction)) current.overdue += 1;
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
  const label = contactSentimentLabel(row.lastInteraction, row.sentiment);
  return label === "—" ? "No reading" : label;
}

function SentimentCell({ row, onOpen }: { row: ClientContactRow; onOpen: () => void }) {
  const label = contactSentimentLabel(row.lastInteraction, row.sentiment);
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

/** Compact evidence links — Slack Quo-router posts when found, with dates. */
function EvidenceLinks({ items }: { items: SentimentEvidenceItem[] }) {
  if (!items.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-1">
      {items.slice(0, 8).map((item, index) => {
        const prefix =
          item.kind === "sms" ? `SMS${index + 1}` : item.kind === "call" ? `V${index + 1}` : `E${index + 1}`;
        const label = item.dateLabel ? `${prefix} ${item.dateLabel}` : prefix;
        return (
          <a
            key={`${item.url}-${index}`}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 whitespace-nowrap font-medium text-pink-600 hover:text-pink-500"
            title={item.url}
          >
            {label}
            <ExternalLink className="h-3 w-3" />
          </a>
        );
      })}
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

function matchesDayRanges(lastInteraction: string | null, selected: string[]) {
  if (selected.length === 0) return true;
  const days = daysSinceContact(lastInteraction);
  return selected.some((range) => {
    if (range === "never") return days === null;
    if (days === null) return false;
    if (range === "0-10") return days <= 10;
    if (range === "10-20") return days > 10 && days < 20;
    if (range === "20-30") return days >= 20 && days < 30;
    if (range === "30-45") return days >= 30 && days < 45;
    if (range === "45-60") return days >= 45 && days < 60;
    if (range === "60-90") return days >= 60 && days < 90;
    if (range === "90+") return days >= 90;
    // Legacy bookmark/query values from the old filter.
    if (range === "30+") return days >= 30;
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

function QualifyingCallDate({ at, slackUrl }: { at: string | null; slackUrl?: string | null }) {
  const label = formatContactDate(at);
  if (label === "—") return <span>—</span>;
  if (!slackUrl) return <span>{label}</span>;
  return (
    <a
      href={slackUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 font-medium text-pink-600 hover:text-pink-500"
      title="Open Quo router Slack post"
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function formatOtherContact(value: string | null, contactType: string | null) {
  const when = formatContactDate(value);
  if (when === "—") return "—";
  return contactType ? `${when} · ${contactType}` : when;
}

function daysBadgeVariant(days: number | null) {
  if (days === null || days >= CLIENT_CONTACT_LONG_GAP_DAYS) return "danger" as const;
  if (days >= CLIENT_CONTACT_WINDOW_DAYS) return "warning" as const;
  return "success" as const;
}

function contactAge(value: string | null) {
  const days = daysSinceContact(value);
  return days === null ? Number.POSITIVE_INFINITY : days;
}

function compareRows(left: ClientContactRow, right: ClientContactRow, sortKey: CallSortKey, direction: SortDirection) {
  const result =
    sortKey === "case"
      ? left.caseNumber.localeCompare(right.caseNumber, undefined, { numeric: true })
      : contactAge(left.lastInteraction) - contactAge(right.lastInteraction);
  if (Number.isNaN(result)) return 0;
  return direction === "asc" ? result : -result;
}

function compareSentimentRows(
  left: ClientContactRow,
  right: ClientContactRow,
  sortKey: SentimentSortKey,
  direction: SortDirection,
) {
  const result =
    sortKey === "case"
      ? left.caseNumber.localeCompare(right.caseNumber, undefined, { numeric: true })
      : sentimentWeekAge(left) - sentimentWeekAge(right);
  if (Number.isNaN(result)) return 0;
  return direction === "asc" ? result : -result;
}

function sentimentWeekAge(row: ClientContactRow) {
  const ms = Date.parse(row.sentimentScoredAt ?? "");
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function formatWeekLabel(label: string | null, scoredAt: string | null) {
  return weekFilterKey({ sentimentWeekLabel: label, sentimentScoredAt: scoredAt }) || formatContactDate(scoredAt);
}

function weekFilterKey(row: Pick<ClientContactRow, "sentimentWeekLabel" | "sentimentScoredAt">) {
  const trimmed = row.sentimentWeekLabel?.trim();
  if (trimmed) {
    const datesOnly = trimmed.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (datesOnly) return datesOnly;
  }
  const scored = formatContactDate(row.sentimentScoredAt);
  return scored === "—" ? "" : scored;
}

function buildWeekOptions(rows: ClientContactRow[]) {
  const byWeek = new Map<string, number>();
  for (const row of rows) {
    const key = weekFilterKey(row);
    if (!key) continue;
    const scored = Date.parse(row.sentimentScoredAt ?? "");
    byWeek.set(key, Math.max(byWeek.get(key) ?? 0, Number.isFinite(scored) ? scored : 0));
  }
  return [...byWeek.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value]) => ({ value, label: value }));
}

function SortableHead<T extends string>({
  label,
  sortKey,
  active,
  direction,
  onSort,
}: {
  label: string;
  sortKey: T;
  active: T;
  direction: SortDirection;
  onSort: (key: T) => void;
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
