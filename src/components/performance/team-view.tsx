import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  PAIR_ATTORNEY_LIT_GOAL,
  PAIR_ATTORNEY_METRICS,
  PAIR_CLOSING_METRICS,
  PAIR_PARALEGAL_METRICS,
  goalStatus,
  type GoalStatus,
  type PairWeekRow,
} from "@/lib/performance/pair-rollup";
import { type FirmWeekRollup } from "@/lib/performance/team-rollup";
import { cn } from "@/lib/utils";

function cellClass(status: GoalStatus | "behind" | "met" | "ahead") {
  if (status === "behind") return "bg-rose-50 font-semibold text-rose-800";
  if (status === "ahead") return "bg-emerald-50 text-emerald-900";
  if (status === "neutral") return "bg-white text-navy-950";
  return "bg-white text-navy-950";
}

function PairLabel({ row }: { row: PairWeekRow }) {
  if (row.paralegalContactId) {
    return (
      <Link className="text-pink-700 hover:underline" href={`/performance/my-work?person=${row.paralegalContactId}`}>
        {row.label}
      </Link>
    );
  }
  return <>{row.label}</>;
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

export function TeamView({
  currentWeek,
  history,
  pairRows,
}: {
  currentWeek: FirmWeekRollup;
  history: FirmWeekRollup[];
  pairRows: PairWeekRow[];
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Pair check — Paralegals</CardTitle>
          <CardDescription>
            {currentWeek.weekLabel} · per pair. Goals: 1 demand sent, 1 lawsuit filed, 2 discovery responses, 3 lit
            events scheduled (depo / mediation / hearing).
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                {PAIR_PARALEGAL_METRICS.map((metric) => (
                  <TableHead key={metric.key} className="whitespace-nowrap text-center" title={metric.detail}>
                    <div>{metric.label}</div>
                    <div className="text-[10px] font-normal text-muted-foreground">goal {metric.goal}</div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pairRows.map((row) => (
                <TableRow key={`para-${row.pairId}`}>
                  <TableCell className="whitespace-nowrap font-medium">
                    <PairLabel row={row} />
                  </TableCell>
                  {PAIR_PARALEGAL_METRICS.map((metric) => {
                    const actual = row.counts[metric.key];
                    const status = goalStatus(actual, metric.goal);
                    return (
                      <TableCell
                        key={metric.key}
                        className={cn("text-center tabular-nums", cellClass(status))}
                        title={`${metric.detail}: ${actual} / ${metric.goal}`}
                      >
                        <div className="font-semibold">{actual}</div>
                        <div className="text-[10px] font-normal opacity-70">/{metric.goal}</div>
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

      <Card>
        <CardHeader>
          <CardTitle>Pair check — Attorneys</CardTitle>
          <CardDescription>
            {currentWeek.weekLabel} · depositions, mediations, and hearings completed. Combined goal:{" "}
            {PAIR_ATTORNEY_LIT_GOAL} lit events completed per pair this week.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                {PAIR_ATTORNEY_METRICS.map((metric) => (
                  <TableHead key={metric.key} className="whitespace-nowrap text-center" title={metric.detail}>
                    {metric.label}
                  </TableHead>
                ))}
                <TableHead className="whitespace-nowrap text-center">
                  <div>LIT TOTAL</div>
                  <div className="text-[10px] font-normal text-muted-foreground">goal {PAIR_ATTORNEY_LIT_GOAL}</div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pairRows.map((row) => {
                const litStatus = goalStatus(row.attorneyLitTotal, PAIR_ATTORNEY_LIT_GOAL);
                return (
                  <TableRow key={`att-${row.pairId}`}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {row.attorneyContactId ? (
                        <Link
                          className="text-pink-700 hover:underline"
                          href={`/performance/attorney?person=${row.attorneyContactId}`}
                        >
                          {row.label}
                        </Link>
                      ) : (
                        row.label
                      )}
                    </TableCell>
                    {PAIR_ATTORNEY_METRICS.map((metric) => (
                      <TableCell key={metric.key} className="text-center tabular-nums font-semibold">
                        {row.counts[metric.key]}
                      </TableCell>
                    ))}
                    <TableCell
                      className={cn("text-center tabular-nums", cellClass(litStatus))}
                      title={`Lit completed: ${row.attorneyLitTotal} / ${PAIR_ATTORNEY_LIT_GOAL}`}
                    >
                      <div className="font-semibold">{row.attorneyLitTotal}</div>
                      <div className="text-[10px] font-normal opacity-70">/{PAIR_ATTORNEY_LIT_GOAL}</div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {pairRows.length === 0 ? (
                <EmptyPairs colSpan={2 + PAIR_ATTORNEY_METRICS.length} />
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pair check — Closings</CardTitle>
          <CardDescription>
            {currentWeek.weekLabel} · disengagements, settlements (goal 1), disbursements (goal 1) per pair.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                {PAIR_CLOSING_METRICS.map((metric) => (
                  <TableHead key={metric.key} className="whitespace-nowrap text-center" title={metric.detail}>
                    <div>{metric.label}</div>
                    {metric.goal != null ? (
                      <div className="text-[10px] font-normal text-muted-foreground">goal {metric.goal}</div>
                    ) : null}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pairRows.map((row) => (
                <TableRow key={`close-${row.pairId}`}>
                  <TableCell className="whitespace-nowrap font-medium">
                    <PairLabel row={row} />
                  </TableCell>
                  {PAIR_CLOSING_METRICS.map((metric) => {
                    const actual = row.counts[metric.key];
                    const status = goalStatus(actual, metric.goal);
                    return (
                      <TableCell
                        key={metric.key}
                        className={cn("text-center tabular-nums", cellClass(status))}
                        title={
                          metric.goal != null
                            ? `${metric.detail}: ${actual} / ${metric.goal}`
                            : `${metric.detail}: ${actual}`
                        }
                      >
                        <div className="font-semibold">{actual}</div>
                        {metric.goal != null ? (
                          <div className="text-[10px] font-normal opacity-70">/{metric.goal}</div>
                        ) : null}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {pairRows.length === 0 ? <EmptyPairs colSpan={1 + PAIR_CLOSING_METRICS.length} /> : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>This week — firm rollup</CardTitle>
          <CardDescription>
            {currentWeek.weekLabel} · whole-staff totals vs weekly goals. Rose = behind goal, green = ahead.
            Goals are set in Settings with an effective-from date so history keeps the old target.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
            {currentWeek.metrics.map((metric) => (
              <div
                key={metric.key}
                className={cn(
                  "rounded-lg border px-3 py-3",
                  metric.status === "behind" && "border-rose-200 bg-rose-50",
                  metric.status === "ahead" && "border-emerald-200 bg-emerald-50",
                  metric.status === "met" && "border-slate-200 bg-white",
                )}
              >
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {metric.label}
                  <span className="ml-1 font-normal normal-case text-slate-500">({metric.goal}/wk)</span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold text-navy-950">{metric.actual}</span>
                  <span className="text-sm text-muted-foreground">/ {metric.goal}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {currentWeek.behindCount === 0
              ? "On track across all metrics this week."
              : `${currentWeek.behindCount} metric${currentWeek.behindCount === 1 ? "" : "s"} behind goal this week.`}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weekly history</CardTitle>
          <CardDescription>
            Spreadsheet-style firm rollup. Each header shows the goal that applied that week (from Settings effective
            dates). Cells behind goal are highlighted.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 bg-white">Week</TableHead>
                {currentWeek.metrics.map((metric) => (
                  <TableHead key={metric.key} className="whitespace-nowrap text-center">
                    {metric.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((week) => (
                <TableRow key={week.weekStart}>
                  <TableCell className="sticky left-0 z-10 whitespace-nowrap bg-white font-medium">
                    {week.weekLabel}
                  </TableCell>
                  {week.metrics.map((metric) => (
                    <TableCell
                      key={metric.key}
                      className={cn("text-center tabular-nums", cellClass(metric.status))}
                      title={`${metric.label}: ${metric.actual} vs goal ${metric.goal}/wk`}
                    >
                      <div className="font-semibold">{metric.actual}</div>
                      <div className="text-[10px] font-normal opacity-70">/{metric.goal}</div>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-rose-50 ring-1 ring-rose-200" /> Behind goal
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-white ring-1 ring-slate-200" /> Met goal
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-emerald-50 ring-1 ring-emerald-200" /> Ahead of goal
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
