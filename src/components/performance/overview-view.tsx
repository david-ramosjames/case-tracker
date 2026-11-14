import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { agingStatus } from "@/lib/performance/outstanding";
import { type QuarterlyFeeProjection, type SignedCasePacing, type SettledUndisbursedCase } from "@/lib/performance/pacing";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function pct(n: number | null) {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

function sumFees(rows: SettledUndisbursedCase[]) {
  return rows.reduce((total, row) => total + row.expectedAttorneyFees, 0);
}

/** Case Tracker palette — not Excel blue/grey/green. */
const BAR = {
  actual: "#0b1f3a", // navy
  pacing: "#e11d48", // rose/pink
  goal: "#0f766e", // teal
} as const;

export function OverviewView({
  signed,
  feeProjection,
  top5,
  oldest,
  agingTargetDays,
  agingWarnDays,
  quarterLabel,
}: {
  signed: SignedCasePacing;
  feeProjection: QuarterlyFeeProjection;
  top5: SettledUndisbursedCase[];
  oldest: SettledUndisbursedCase[];
  agingTargetDays: number;
  agingWarnDays: number;
  quarterLabel: string;
}) {
  const top5Total = sumFees(top5);
  const outstandingTotal = sumFees(oldest);
  const signedProjected = signed.projectedMonthEnd ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Card className="xl:col-span-1">
          <CardHeader className="pb-2">
            <CardDescription>Signed cases</CardDescription>
            <CardTitle className="text-base font-semibold text-navy-950">
              Actual {signed.signedMtd} · Pacing {signedProjected.toFixed(1)} · Goal {signed.monthlyGoal}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ComparisonBarChart
              bars={[
                { label: "Actual", value: signed.signedMtd, color: BAR.actual, format: "number" },
                {
                  label: "Pacing",
                  value: signedProjected,
                  color: BAR.pacing,
                  format: "number",
                },
                { label: "Goal", value: signed.monthlyGoal, color: BAR.goal, format: "number" },
              ]}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Month-end pacing {pct(signed.projectedAttainment)} · variance{" "}
              {signed.variance != null ? signed.variance.toFixed(1) : "—"}
            </p>
          </CardContent>
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader className="pb-2">
            <CardDescription>Attorney fees ({quarterLabel})</CardDescription>
            <CardTitle className="text-base font-semibold text-navy-950">
              Actual {money(feeProjection.feesDisbursedInQuarter)} · Projected{" "}
              {money(feeProjection.projectedQuarterlyFees)} · Goal {money(feeProjection.quarterlyGoal)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ComparisonBarChart
              bars={[
                {
                  label: "Actual",
                  value: feeProjection.feesDisbursedInQuarter,
                  color: BAR.actual,
                  format: "money",
                },
                {
                  label: "Projected",
                  value: feeProjection.projectedQuarterlyFees,
                  color: BAR.pacing,
                  format: "money",
                },
                {
                  label: "Goal",
                  value: feeProjection.quarterlyGoal,
                  color: BAR.goal,
                  format: "money",
                },
              ]}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Disbursed + eligible settled (lag {feeProjection.lagDays}d) · {pct(feeProjection.attainment)} of goal.
              Distinct from /goals pipeline plan.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Top 5 settled, undisbursed</CardDescription>
            <CardTitle className="text-2xl">{money(top5Total)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Total expected fees across the top 5 by fee size
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Oldest outstanding settlements</CardDescription>
            <CardTitle className="text-2xl">{money(outstandingTotal)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Total expected fees still outstanding ({oldest.length} cases · {agingTargetDays}d target)
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top 5 settled, undisbursed</CardTitle>
            <CardDescription>By expected attorney fees · total {money(top5Total)}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <OutstandingTable rows={top5} agingTargetDays={agingTargetDays} agingWarnDays={agingWarnDays} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Oldest outstanding settlements</CardTitle>
            <CardDescription>
              Sorted by age · {agingTargetDays}-day operating target · total {money(outstandingTotal)}
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <OutstandingTable
              rows={oldest.slice(0, 15)}
              agingTargetDays={agingTargetDays}
              agingWarnDays={agingWarnDays}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ComparisonBarChart({
  bars,
}: {
  bars: Array<{ label: string; value: number; color: string; format: "money" | "number" }>;
}) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  const chartHeight = 140;

  return (
    <div>
      <div className="flex h-[160px] items-end justify-around gap-3 px-2">
        {bars.map((bar) => {
          const height = Math.max(4, Math.round((bar.value / max) * chartHeight));
          const label =
            bar.format === "money"
              ? money(bar.value)
              : Number.isInteger(bar.value)
                ? String(bar.value)
                : bar.value.toFixed(1);
          return (
            <div key={bar.label} className="flex w-full max-w-[5.5rem] flex-col items-center gap-1">
              <span className="text-xs font-semibold text-navy-950">{label}</span>
              <div
                className="w-12 rounded-t-sm transition-all"
                style={{ height, backgroundColor: bar.color }}
                title={`${bar.label}: ${label}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-around gap-3 px-2">
        {bars.map((bar) => (
          <div key={bar.label} className="flex w-full max-w-[5.5rem] flex-col items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: bar.color }} />
            <span className="text-xs text-muted-foreground">{bar.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OutstandingTable({
  rows,
  agingTargetDays,
  agingWarnDays,
}: {
  rows: SettledUndisbursedCase[];
  agingTargetDays: number;
  agingWarnDays: number;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Case</TableHead>
          <TableHead>Attorney</TableHead>
          <TableHead>Fees</TableHead>
          <TableHead>Settled</TableHead>
          <TableHead>Days</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const status = agingStatus(row.daysOutstanding, agingTargetDays, agingWarnDays);
          return (
            <TableRow key={row.caseId}>
              <TableCell>
                <Link href={`/cases/${row.caseId}`} className="font-medium text-pink-700 hover:underline">
                  {row.caseNumber}
                </Link>
                <div className="text-xs text-muted-foreground">{row.clientName}</div>
              </TableCell>
              <TableCell>{row.attorneyName}</TableCell>
              <TableCell>{money(row.expectedAttorneyFees)}</TableCell>
              <TableCell>{row.settlementDate}</TableCell>
              <TableCell
                className={
                  status === "over" ? "font-semibold text-rose-700" : status === "warn" ? "text-amber-700" : ""
                }
              >
                {row.daysOutstanding}
              </TableCell>
            </TableRow>
          );
        })}
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-muted-foreground">
              None
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
