"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { CaseNumberLink } from "@/components/cases/case-number-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeaderMultiFilter } from "@/components/ui/header-filter";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { reasonCodeLabel, type NeedsResponseRow } from "@/lib/needs-response/types";
import { cn } from "@/lib/utils";

const compactHead = "h-8 px-2";
const compactCell = "px-2 py-1.5";

type SortKey = "detected" | "waiting";
type SortDirection = "asc" | "desc";

function formatDetectedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** Milliseconds waiting since detection (higher = longer wait). */
function waitingMs(detectedAt: string, now = Date.now()) {
  const ms = now - new Date(detectedAt).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

function formatWaitingSince(detectedAt: string, now = Date.now()) {
  const ms = waitingMs(detectedAt, now);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remMin = minutes % 60;
    return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days < 7) return remHours ? `${days}d ${remHours}h` : `${days}d`;
  return `${days}d`;
}

function channelBadge(channel: NeedsResponseRow["channel"]) {
  if (channel === "sms") return "Text";
  if (channel === "both") return "Call + text";
  return "Call";
}

export function NeedsResponseView({ rows }: { rows: NeedsResponseRow[] }) {
  const [query, setQuery] = useState("");
  const [attorneys, setAttorneys] = useState<string[]>([]);
  const [paralegals, setParalegals] = useState<string[]>([]);
  const [reasonCodes, setReasonCodes] = useState<string[]>([]);
  const [localRows, setLocalRows] = useState(rows);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<SortKey>("waiting");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const attorneyOptions = useMemo(
    () =>
      [...new Set(localRows.map((row) => row.attorneyName).filter(Boolean) as string[])]
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    [localRows],
  );
  const paralegalOptions = useMemo(
    () =>
      [...new Set(localRows.map((row) => row.paralegalName).filter(Boolean) as string[])]
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    [localRows],
  );
  const reasonOptions = useMemo(
    () =>
      [...new Set(localRows.map((row) => row.reasonCode))].map((code) => ({
        value: code,
        label: reasonCodeLabel(code),
      })),
    [localRows],
  );

  function onSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "waiting" ? "desc" : "desc");
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    const rows = localRows.filter((row) => {
      if (attorneys.length && (!row.attorneyName || !attorneys.includes(row.attorneyName))) return false;
      if (paralegals.length && (!row.paralegalName || !paralegals.includes(row.paralegalName))) return false;
      if (reasonCodes.length && !reasonCodes.includes(row.reasonCode)) return false;
      if (!q) return true;
      const hay = [row.caseNumber, row.clientName, row.phone, row.reason, row.details, row.quoLine]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    const direction = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((left, right) => {
      if (sortKey === "detected") {
        return direction * String(left.detectedAt).localeCompare(String(right.detectedAt));
      }
      return direction * (waitingMs(left.detectedAt, now) - waitingMs(right.detectedAt, now));
    });
  }, [localRows, query, attorneys, paralegals, reasonCodes, sortKey, sortDirection]);

  async function markResolved(id: string) {
    setSaving((prev) => ({ ...prev, [id]: true }));
    try {
      const response = await fetch("/api/needs-response/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Unable to resolve.");
      }
      setLocalRows((prev) => prev.filter((row) => row.id !== id));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to resolve.");
    } finally {
      setSaving((prev) => ({ ...prev, [id]: false }));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search client, case, phone…"
            className="h-9"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {filtered.length} open · stays until text/call back or Resolved
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={compactHead}>Case</TableHead>
              <TableHead className={compactHead}>Client</TableHead>
              <TableHead className={compactHead}>
                <HeaderMultiFilter label="Why" selected={reasonCodes} onChange={setReasonCodes} options={reasonOptions} />
              </TableHead>
              <TableHead className={compactHead}>Channel</TableHead>
              <SortableHead label="Detected" sortKey="detected" active={sortKey} direction={sortDirection} onSort={onSort} />
              <SortableHead label="Waiting" sortKey="waiting" active={sortKey} direction={sortDirection} onSort={onSort} />
              <TableHead className={compactHead}>
                <HeaderMultiFilter label="Attorney" selected={attorneys} onChange={setAttorneys} options={attorneyOptions} />
              </TableHead>
              <TableHead className={compactHead}>
                <HeaderMultiFilter label="Paralegal" selected={paralegals} onChange={setParalegals} options={paralegalOptions} />
              </TableHead>
              <TableHead className={compactHead}>Details</TableHead>
              <TableHead className={compactHead}>Respond</TableHead>
              <TableHead className={compactHead} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                  No clients currently need a response.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => {
                const quoUrl = row.quoUrl || row.evidenceUrl;
                const waitLabel = formatWaitingSince(row.detectedAt);
                const waitHours = waitingMs(row.detectedAt) / 3_600_000;
                return (
                  <TableRow key={row.id}>
                    <TableCell className={compactCell}>
                      {row.caseId ? (
                        <CaseNumberLink caseId={row.caseId} caseNumber={row.caseNumber} />
                      ) : (
                        row.caseNumber
                      )}
                    </TableCell>
                    <TableCell className={compactCell}>
                      <div className="font-medium">{row.clientName}</div>
                      {row.phone ? <div className="text-xs text-muted-foreground">{row.phone}</div> : null}
                    </TableCell>
                    <TableCell className={compactCell}>
                      <Badge variant="secondary">{reasonCodeLabel(row.reasonCode)}</Badge>
                      <div className="mt-1 max-w-[220px] text-xs text-muted-foreground">{row.reason}</div>
                    </TableCell>
                    <TableCell className={compactCell}>{channelBadge(row.channel)}</TableCell>
                    <TableCell className={compactCell}>{formatDetectedAt(row.detectedAt)}</TableCell>
                    <TableCell className={compactCell}>
                      <span
                        className={cn(
                          "font-medium tabular-nums",
                          waitHours >= 24 ? "text-red-600" : waitHours >= 8 ? "text-amber-700" : "text-navy-950",
                        )}
                      >
                        {waitLabel}
                      </span>
                    </TableCell>
                    <TableCell className={compactCell}>{row.attorneyName || "—"}</TableCell>
                    <TableCell className={compactCell}>{row.paralegalName || "—"}</TableCell>
                    <TableCell className={compactCell}>
                      <div className="max-w-[280px] text-xs text-muted-foreground">{row.details || "—"}</div>
                    </TableCell>
                    <TableCell className={compactCell}>
                      <div className="flex flex-col gap-1">
                        {quoUrl ? (
                          <a
                            href={quoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-pink-600 hover:underline"
                          >
                            Quo <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">No Quo link</span>
                        )}
                        {row.slackUrl ? (
                          <a
                            href={row.slackUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-pink-600 hover:underline"
                          >
                            {row.slackLabel || "Slack"} <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : row.slackLabel ? (
                          <span className="text-xs text-muted-foreground">{row.slackLabel}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">No Slack</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className={compactCell}>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={Boolean(saving[row.id])}
                        onClick={() => markResolved(row.id)}
                      >
                        {saving[row.id] ? "…" : "Resolved"}
                      </Button>
                    </TableCell>
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
