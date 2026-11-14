import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type FirmWeekRollup } from "@/lib/performance/team-rollup";
import { cn } from "@/lib/utils";

function cellClass(status: "behind" | "met" | "ahead") {
  if (status === "behind") return "bg-rose-50 font-semibold text-rose-800";
  if (status === "ahead") return "bg-emerald-50 text-emerald-900";
  return "bg-white text-navy-950";
}

export function TeamView({
  currentWeek,
  history,
}: {
  currentWeek: FirmWeekRollup;
  history: FirmWeekRollup[];
}) {
  return (
    <div className="space-y-6">
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
