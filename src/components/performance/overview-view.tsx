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

const BAR = {
  actual: "#2563eb", // blue
  projected: "#9ca3af", // gray
  goal: "#16a34a", // green
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
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Signed cases</CardDescription>
            <CardTitle className="text-2xl text-navy-950">
              Month-end pacing {pct(signed.projectedAttainment)}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Variance {signed.variance != null ? signed.variance.toFixed(1) : "—"} vs goal
            </p>
          </CardHeader>
          <CardContent>
            <ComparisonBarChart
              bars={[
                { label: "Actual", value: signed.signedMtd, color: BAR.actual, format: "number" },
                { label: "Pacing", value: signedProjected, color: BAR.projected, format: "number" },
                { label: "Goal", value: signed.monthlyGoal, color: BAR.goal, format: "number" },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Attorney fees ({quarterLabel})</CardDescription>
            <CardTitle className="text-2xl text-navy-950">
              Projected attainment {pct(feeProjection.attainment)}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Disbursed + eligible settled (lag {feeProjection.lagDays}d). Distinct from /goals pipeline plan.
            </p>
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
                  color: BAR.projected,
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
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Top 5 settled, undisbursed</CardDescription>
            <CardTitle className="text-2xl">{money(top5Total)}</CardTitle>
            <p className="text-sm text-muted-foreground">By expected attorney fees</p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <OutstandingTable rows={top5} agingTargetDays={agingTargetDays} agingWarnDays={agingWarnDays} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Oldest outstanding settlements</CardDescription>
            <CardTitle className="text-2xl">{money(outstandingTotal)}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {oldest.length} cases · {agingTargetDays}-day operating target
            </p>
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
    <div className="flex h-[180px] items-end justify-around gap-4 px-2">
      {bars.map((bar) => {
        const height = Math.max(4, Math.round((bar.value / max) * chartHeight));
        const valueLabel =
          bar.format === "money"
            ? money(bar.value)
            : Number.isInteger(bar.value)
              ? String(bar.value)
              : bar.value.toFixed(1);
        return (
          <div key={bar.label} className="flex w-full max-w-[6rem] flex-col items-center gap-1.5">
            <span className="text-xs font-semibold text-navy-950">{valueLabel}</span>
            <div
              className="w-14 rounded-t-sm"
              style={{ height, backgroundColor: bar.color }}
              title={`${bar.label}: ${valueLabel}`}
            />
            <span className="text-xs text-muted-foreground">{bar.label}</span>
          </div>
        );
      })}
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
