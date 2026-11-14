"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMetricValue } from "@/lib/performance/client-share";
import { type ClosingCaseRef, type PairClosingDetails } from "@/lib/performance/closings-types";
import { type FirmWeekRollup } from "@/lib/performance/firm-metrics";
import {
  PAIR_ATTORNEY_LIT_GOAL,
  PAIR_ATTORNEY_METRICS,
  PAIR_CLOSING_METRICS,
  PAIR_PARALEGAL_METRICS,
  goalStatus,
  type GoalStatus,
  type PairWeekRow,
} from "@/lib/performance/pair-metrics";
import { shiftWeekStart } from "@/lib/performance/weeks";
import { cn } from "@/lib/utils";

type TeamTab = "firm" | "paralegals" | "attorneys" | "closings";

const HISTORY_DEFAULT = 5;

function cellClass(status: GoalStatus | "behind" | "met" | "ahead") {
  if (status === "behind") return "bg-amber-50 font-semibold text-amber-900";
  if (status === "ahead") return "bg-emerald-50 text-emerald-900";
  return "bg-white text-navy-950";
}

function TeamLabel({ row }: { row: PairWeekRow }) {
  return (
    <div className="leading-tight">
      <div className="font-medium text-navy-950">{row.attorneyName}</div>
      <div className="text-xs text-muted-foreground">{row.paralegalName}</div>
      {row.isVacant ? <div className="text-[10px] text-slate-400">Vacant</div> : null}
    </div>
  );
}

function EmptyPairs({ colSpan }: { colSpan: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-muted-foreground">
        No active pairs. Configure them in Settings.
      </TableCell>
    </TableRow>
  );
}

function KpiBar({ actual, goal, status }: { actual: number; goal: number; status: FirmWeekRollup["metrics"][number]["status"] }) {
  const pct = goal > 0 ? Math.min(100, Math.round((actual / goal) * 100)) : 0;
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          status === "behind" && "bg-amber-500",
          status === "met" && "bg-slate-400",
          status === "ahead" && "bg-emerald-500",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function ClosingsDrilldown({
  title,
  items,
  onClose,
}: {
  title: string;
  items: ClosingCaseRef[];
  onClose: () => void;
}) {
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/80 p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-navy-950">{title}</div>
          <p className="text-xs text-muted-foreground">
            Attributed by current case assignment. Reassignments can mis-attribute older events.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cases for this count.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case #</TableHead>
              <TableHead>Client / party</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={`${item.caseId}-${item.date}-${item.clientName}`}>
                <TableCell>
                  <Link className="text-pink-700 hover:underline" href={`/cases/${item.caseId}`}>
                    {item.caseNumber}
                  </Link>
                </TableCell>
                <TableCell>{item.clientName}</TableCell>
                <TableCell className="tabular-nums">{item.date}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMetricValue(item.credit)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function TeamView({
  weekStart,
  weekRangeLabel,
  weekLabel,
  isCurrentWeek,
  selectedWeek,
  firmWeek,
  history,
  trackedWeekStarts,
  pairRows,
  closingDetails,
}: {
  weekStart: string;
  weekRangeLabel: string;
  weekLabel: string;
  isCurrentWeek: boolean;
  selectedWeek: string;
  firmWeek: FirmWeekRollup;
  history: FirmWeekRollup[];
  trackedWeekStarts: string[];
  pairRows: PairWeekRow[];
  closingDetails: PairClosingDetails[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TeamTab>("firm");
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [drilldown, setDrilldown] = useState<{
    pairId: string;
    kind: "settlement" | "disbursement";
    teamLabel: string;
  } | null>(null);

  const tracked = useMemo(() => new Set(trackedWeekStarts), [trackedWeekStarts]);
  const detailsByPair = useMemo(() => {
    const map = new Map<string, PairClosingDetails>();
    for (const d of closingDetails) map.set(d.pairId, d);
    return map;
  }, [closingDetails]);

  function goWeek(next: string) {
    router.push(`/performance/team?week=${next}`);
  }

  const visibleHistory = historyExpanded ? history : history.slice(0, HISTORY_DEFAULT);

  const drillItems =
    drilldown == null
      ? []
      : drilldown.kind === "settlement"
        ? (detailsByPair.get(drilldown.pairId)?.settlements ?? [])
        : (detailsByPair.get(drilldown.pairId)?.disbursements ?? []);

  const tabs: { id: TeamTab; label: string }[] = [
    { id: "firm", label: "Firm activity" },
    { id: "paralegals", label: "Paralegals" },
    { id: "attorneys", label: "Attorneys" },
    { id: "closings", label: "Closings" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-950">Team Performance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Weekly pair results, firm activity, and recent trends.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Previous week"
            onClick={() => goWeek(shiftWeekStart(selectedWeek, -1))}
          >
            ←
          </Button>
          <div className="min-w-[11rem] text-center">
            <div className="text-sm font-semibold text-navy-950">{weekRangeLabel}</div>
            <div className="text-xs text-muted-foreground">
              {weekLabel}
              {isCurrentWeek ? " · Current week" : ""}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Next week"
            disabled={selectedWeek >= weekStart}
            onClick={() => goWeek(shiftWeekStart(selectedWeek, 1))}
          >
            →
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-px">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setDrilldown(null);
            }}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === item.id
                ? "border-pink-500 text-navy-950"
                : "border-transparent text-muted-foreground hover:text-navy-900",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "paralegals" ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Paralegals</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  {PAIR_PARALEGAL_METRICS.map((metric) => (
                    <TableHead key={metric.key} className="whitespace-nowrap text-center">
                      <div>{metric.label}</div>
                      <div className="text-[10px] font-normal text-muted-foreground">{metric.secondary}</div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pairRows.map((row) => (
                  <TableRow key={`para-${row.pairId}`}>
                    <TableCell className="min-w-[9rem]">
                      <TeamLabel row={row} />
                    </TableCell>
                    {PAIR_PARALEGAL_METRICS.map((metric) => {
                      const actual = row.counts[metric.key];
                      const status = goalStatus(actual, metric.goal, { vacant: row.isVacant });
                      return (
                        <TableCell
                          key={metric.key}
                          className={cn("text-center tabular-nums", cellClass(status), row.isVacant && "opacity-50")}
                        >
                          <div className="font-semibold">{formatMetricValue(actual)}</div>
                          {!row.isVacant ? (
                            <div className="text-[10px] font-normal opacity-70">/{metric.goal}</div>
                          ) : null}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
                {pairRows.length === 0 ? <EmptyPairs colSpan={1 + PAIR_PARALEGAL_METRICS.length} /> : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {tab === "attorneys" ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Attorneys</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  {PAIR_ATTORNEY_METRICS.map((metric) => (
                    <TableHead key={metric.key} className="whitespace-nowrap text-center">
                      {metric.label}
                    </TableHead>
                  ))}
                  <TableHead className="whitespace-nowrap text-center">
                    <div>Litigation events</div>
                    <div className="text-[10px] font-normal text-muted-foreground">
                      Combined goal {PAIR_ATTORNEY_LIT_GOAL}
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pairRows.map((row) => {
                  const litStatus = goalStatus(row.attorneyLitTotal, PAIR_ATTORNEY_LIT_GOAL, {
                    vacant: row.isVacant,
                  });
                  return (
                    <TableRow key={`att-${row.pairId}`}>
                      <TableCell className="min-w-[9rem]">
                        <TeamLabel row={row} />
                      </TableCell>
                      {PAIR_ATTORNEY_METRICS.map((metric) => (
                        <TableCell
                          key={metric.key}
                          className={cn("text-center tabular-nums font-semibold", row.isVacant && "opacity-50")}
                        >
                          {formatMetricValue(row.counts[metric.key])}
                        </TableCell>
                      ))}
                      <TableCell
                        className={cn(
                          "text-center tabular-nums",
                          cellClass(litStatus),
                          row.isVacant && "opacity-50",
                        )}
                      >
                        <div className="font-semibold">{formatMetricValue(row.attorneyLitTotal)}</div>
                        {!row.isVacant ? (
                          <div className="text-[10px] font-normal opacity-70">/{PAIR_ATTORNEY_LIT_GOAL}</div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {pairRows.length === 0 ? <EmptyPairs colSpan={2 + PAIR_ATTORNEY_METRICS.length} /> : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {tab === "closings" ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Closings</CardTitle>
            <CardDescription>
              Settlements and disbursements from Case Tracker financial records. Click a count to see contributing
              cases.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  {PAIR_CLOSING_METRICS.map((metric) => (
                    <TableHead key={metric.key} className="whitespace-nowrap text-center">
                      <div>{metric.label}</div>
                      {metric.secondary ? (
                        <div className="text-[10px] font-normal text-muted-foreground">{metric.secondary}</div>
                      ) : null}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pairRows.map((row) => (
                  <TableRow key={`close-${row.pairId}`}>
                    <TableCell className="min-w-[9rem]">
                      <TeamLabel row={row} />
                    </TableCell>
                    {PAIR_CLOSING_METRICS.map((metric) => {
                      const actual = row.counts[metric.key];
                      const status = goalStatus(actual, metric.goal, { vacant: row.isVacant });
                      const clickable = metric.key === "settlement" || metric.key === "disbursement";
                      return (
                        <TableCell
                          key={metric.key}
                          className={cn("text-center tabular-nums", cellClass(status), row.isVacant && "opacity-50")}
                        >
                          {clickable && !row.isVacant ? (
                            <button
                              type="button"
                              className="mx-auto block rounded px-1 hover:bg-white/80 hover:underline"
                              onClick={() =>
                                setDrilldown({
                                  pairId: row.pairId,
                                  kind: metric.key as "settlement" | "disbursement",
                                  teamLabel: `${row.attorneyName} / ${row.paralegalName}`,
                                })
                              }
                            >
                              <div className="font-semibold">{formatMetricValue(actual)}</div>
                              {metric.goal != null ? (
                                <div className="text-[10px] font-normal opacity-70">/{metric.goal}</div>
                              ) : null}
                            </button>
                          ) : (
                            <>
                              <div className="font-semibold">{formatMetricValue(actual)}</div>
                              {metric.goal != null && !row.isVacant ? (
                                <div className="text-[10px] font-normal opacity-70">/{metric.goal}</div>
                              ) : null}
                            </>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
                {pairRows.length === 0 ? <EmptyPairs colSpan={1 + PAIR_CLOSING_METRICS.length} /> : null}
              </TableBody>
            </Table>
            {drilldown ? (
              <ClosingsDrilldown
                title={`${drilldown.kind === "settlement" ? "Settlements" : "Disbursements"} · ${drilldown.teamLabel}`}
                items={drillItems}
                onClose={() => setDrilldown(null)}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {tab === "firm" ? (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Firm activity</CardTitle>
              <CardDescription>
                Sum of team pair results for the selected week versus firm weekly targets.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {firmWeek.metrics.map((metric) => (
                  <div
                    key={metric.key}
                    className={cn(
                      "rounded-md border px-3 py-2.5",
                      metric.status === "behind" && "border-amber-200 bg-amber-50/60",
                      metric.status === "ahead" && "border-emerald-200 bg-emerald-50/40",
                      metric.status === "met" && "border-slate-200 bg-white",
                    )}
                  >
                    <div className="text-xs font-medium text-muted-foreground">{metric.label}</div>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="text-xl font-semibold tabular-nums text-navy-950">
                        {formatMetricValue(metric.actual)}
                      </span>
                      <span className="text-xs text-muted-foreground">/ {metric.goal}</span>
                    </div>
                    <KpiBar actual={metric.actual} goal={metric.goal} status={metric.status} />
                  </div>
                ))}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {firmWeek.behindCount === 0
                  ? "On track across all metrics this week."
                  : `${firmWeek.behindCount} metric${firmWeek.behindCount === 1 ? "" : "s"} behind pace.`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">Weekly history</CardTitle>
                  <CardDescription>
                    Firm totals summed from team pairs. Em dash means no pair seats for that week.
                  </CardDescription>
                </div>
                <Link href="/performance/history" className="text-sm font-medium text-pink-700 hover:underline">
                  Open History →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 bg-white">Week</TableHead>
                    {firmWeek.metrics.map((metric) => (
                      <TableHead key={metric.key} className="whitespace-nowrap text-center">
                        {metric.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleHistory.map((week) => {
                    const hasTracking = tracked.has(week.weekStart);
                    return (
                      <TableRow key={week.weekStart}>
                        <TableCell className="sticky left-0 z-10 whitespace-nowrap bg-white font-medium">
                          <button
                            type="button"
                            className="text-left hover:text-pink-700 hover:underline"
                            onClick={() => goWeek(week.weekStart)}
                          >
                            {week.weekLabel}
                          </button>
                        </TableCell>
                        {week.metrics.map((metric) => (
                          <TableCell
                            key={metric.key}
                            className={cn(
                              "text-center tabular-nums",
                              hasTracking ? cellClass(metric.status) : "text-muted-foreground",
                            )}
                          >
                            {hasTracking ? (
                              <>
                                <div className="font-semibold">{formatMetricValue(metric.actual)}</div>
                                <div className="text-[10px] font-normal opacity-70">/{metric.goal}</div>
                              </>
                            ) : (
                              <span title="Not tracked">—</span>
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm bg-amber-50 ring-1 ring-amber-200" /> Behind
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm bg-white ring-1 ring-slate-200" /> Met
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm bg-emerald-50 ring-1 ring-emerald-200" /> Ahead
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-sm leading-none">—</span> Not tracked
                  </span>
                </div>
                {history.length > HISTORY_DEFAULT ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setHistoryExpanded((v) => !v)}>
                    {historyExpanded ? "Show fewer weeks" : `Show more (${history.length} weeks)`}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
