"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatAttainmentPct,
  type PersonScorecardBundle,
  type PersonWeekScorecard,
} from "@/lib/performance/person-scorecard";

function ScoreTable({ card, valueLabel }: { card: PersonWeekScorecard; valueLabel: string }) {
  let lastGroup: string | undefined;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Metric</TableHead>
          <TableHead className="text-right">Target</TableHead>
          <TableHead className="text-right">{valueLabel}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {card.rows.map((row) => {
          const showGroup = Boolean(row.group && row.group !== lastGroup);
          if (row.group) lastGroup = row.group;
          return (
            <TableRow key={row.key}>
              <TableCell>
                {showGroup ? (
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {row.group}
                  </div>
                ) : null}
                <div className={showGroup ? "mt-0.5" : ""}>{row.label}</div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.target}</TableCell>
              <TableCell className="text-right tabular-nums font-medium">{row.actual}</TableCell>
            </TableRow>
          );
        })}
        <TableRow>
          <TableCell className="font-semibold">Overall</TableCell>
          <TableCell className="text-right text-muted-foreground">100%</TableCell>
          <TableCell
            className={`text-right font-semibold tabular-nums ${
              card.overall != null && card.overall >= 1 ? "bg-emerald-50 text-emerald-800" : ""
            }`}
          >
            {formatAttainmentPct(card.overall)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

function TrendChart({ trend }: { trend: PersonScorecardBundle["trend"] }) {
  const values = trend.map((t) => t.overall).filter((v): v is number => v != null);
  const max = Math.max(1.5, ...values, 1);
  return (
    <div className="space-y-3">
      <div className="flex h-40 items-end gap-1.5">
        {trend.map((point) => {
          const pct = point.overall == null ? 0 : Math.max(0.04, point.overall / max);
          const over = point.overall != null && point.overall >= 1;
          return (
            <div key={point.weekStart} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {point.overall == null ? "—" : `${Math.round(point.overall * 100)}`}
              </span>
              <div
                className={`w-full max-w-[1.75rem] rounded-t-sm ${over ? "bg-emerald-600" : "bg-navy-800"}`}
                style={{ height: `${Math.round(pct * 120)}px` }}
                title={`${point.weekLabel}: ${formatAttainmentPct(point.overall)}`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{trend[0]?.weekLabel ?? ""}</span>
        <span>Goal line = 100%</span>
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
            <CardTitle className="text-xl text-navy-950">
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
            <CardTitle className="text-xl text-navy-950">
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
          <CardDescription>Overall attainment by completed week (prior weeks only).</CardDescription>
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
