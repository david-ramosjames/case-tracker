"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { goalStatus, type GoalStatus } from "@/lib/performance/pair-metrics";
import {
  formatAttainmentPct,
  type PersonScorecardBundle,
  type PersonWeekScorecard,
  type ScoreMetricRow,
} from "@/lib/performance/person-scorecard";
import { cn } from "@/lib/utils";

function valueCellClass(status: GoalStatus) {
  if (status === "critical") return "bg-red-50 font-semibold text-red-900";
  if (status === "behind") return "bg-amber-50 font-semibold text-amber-900";
  if (status === "ahead") return "bg-emerald-50 font-semibold text-emerald-900";
  return "font-medium text-navy-950";
}

function titleClass(status: GoalStatus) {
  if (status === "critical") return "text-red-800";
  if (status === "behind") return "text-amber-800";
  if (status === "ahead") return "text-emerald-800";
  return "text-navy-950";
}

function overallGoalStatus(overall: number | null): GoalStatus {
  if (overall == null) return "neutral";
  return goalStatus(overall, 1);
}

function groupRows(rows: ScoreMetricRow[]) {
  const groups: Array<{ name: string; rows: ScoreMetricRow[] }> = [];
  for (const row of rows) {
    const name = row.group ?? "";
    const last = groups[groups.length - 1];
    if (!last || last.name !== name) {
      groups.push({ name, rows: [row] });
    } else {
      last.rows.push(row);
    }
  }
  return groups;
}

function ScoreTable({ card, valueLabel }: { card: PersonWeekScorecard; valueLabel: string }) {
  const groups = groupRows(card.rows);
  const weightHint =
    card.role === "attorney"
      ? "Sections: Pre-Lit 20% · Litigation 40% · Closing 40% (Disengagements shown, not scored)"
      : "Sections: Pre-Lit · Litigation · Scheduling (1/3 each)";
  const overallStatus = overallGoalStatus(card.overall);

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead className="text-center">Target</TableHead>
            <TableHead className="text-center">{valueLabel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) =>
            [
              group.name ? (
                <TableRow
                  key={`group-${group.name}`}
                  className="border-t-2 border-slate-200 bg-slate-50 hover:bg-slate-50"
                >
                  <TableCell colSpan={3} className="py-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700">
                      {group.name}
                    </span>
                  </TableCell>
                </TableRow>
              ) : null,
              ...group.rows.map((row) => {
                const status = row.countsTowardScore
                  ? goalStatus(row.actual, row.target)
                  : ("neutral" as const);
                return (
                  <TableRow key={row.key}>
                    <TableCell className="pl-4">
                      <div>{row.label}</div>
                      {!row.countsTowardScore ? (
                        <div className="text-[10px] text-muted-foreground">Shown only — not in overall</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-center tabular-nums text-muted-foreground">
                      {row.target == null ? "—" : row.target}
                    </TableCell>
                    <TableCell className={cn("text-center tabular-nums", valueCellClass(status))}>
                      {row.actual}
                    </TableCell>
                  </TableRow>
                );
              }),
            ].filter(Boolean),
          )}
          <TableRow className="border-t-2 border-slate-300">
            <TableCell className="font-semibold">Overall</TableCell>
            <TableCell className="text-center text-muted-foreground">100%</TableCell>
            <TableCell className={cn("text-center tabular-nums", valueCellClass(overallStatus))}>
              {formatAttainmentPct(card.overall)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">{weightHint}</p>
        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-red-50 ring-1 ring-red-200" /> &lt;60%
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-amber-50 ring-1 ring-amber-200" /> 60–90%
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-white ring-1 ring-slate-200" /> 90–110%
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-50 ring-1 ring-emerald-200" /> &gt;110%
          </span>
        </div>
      </div>
    </div>
  );
}

function TrendChart({ trend }: { trend: PersonScorecardBundle["trend"] }) {
  const values = trend.map((t) => t.overall).filter((v): v is number => v != null);
  const max = Math.max(1.5, ...values, 1);
  const goalHeightPx = Math.round((1 / max) * 120);
  return (
    <div className="space-y-3">
      <div className="relative flex h-40 items-end gap-1.5">
        <div
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-300"
          style={{ bottom: `${goalHeightPx}px` }}
          aria-hidden
        />
        {trend.map((point) => {
          const pct = point.overall == null ? 0 : Math.max(0.04, point.overall / max);
          const status = overallGoalStatus(point.overall);
          return (
            <div key={point.weekStart} className="relative z-[1] flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {formatAttainmentPct(point.overall)}
              </span>
              <div
                className={cn(
                  "w-full max-w-[1.75rem] rounded-t-sm",
                  status === "critical" && "bg-red-600",
                  status === "behind" && "bg-amber-500",
                  status === "ahead" && "bg-emerald-600",
                  (status === "met" || status === "neutral") && "bg-navy-800",
                )}
                style={{ height: `${Math.round(pct * 120)}px` }}
                title={`${point.weekLabel}: ${formatAttainmentPct(point.overall)} attainment`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{trend[0]?.weekLabel ?? ""}</span>
        <span>Attainment · goal = 100%</span>
        <span>{trend[trend.length - 1]?.weekLabel ?? ""}</span>
      </div>
    </div>
  );
}

export function PersonScorecardView({
  bundle,
  personName,
}: {
  bundle: PersonScorecardBundle;
  personName: string;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Last week performance</CardDescription>
            <CardTitle className={cn("text-xl", titleClass(overallGoalStatus(bundle.lastWeek.overall)))}>
              {formatAttainmentPct(bundle.lastWeek.overall)}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {personName} · {bundle.lastWeek.weekLabel}
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <ScoreTable card={bundle.lastWeek} valueLabel="Actual" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Expected this week</CardDescription>
            <CardTitle
              className={cn("text-xl", titleClass(overallGoalStatus(bundle.thisWeekExpected.overall)))}
            >
              {formatAttainmentPct(bundle.thisWeekExpected.overall)}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              From items committed for {bundle.thisWeekExpected.weekLabel}
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <ScoreTable card={bundle.thisWeekExpected} valueLabel="Committed" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>13-week trend</CardTitle>
          <CardDescription>
            Overall attainment % by completed week (from weekly goals history; prior weeks only).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bundle.trend.length === 0 ? (
            <p className="text-sm text-muted-foreground">No prior weeks yet.</p>
          ) : (
            <TrendChart trend={bundle.trend} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
