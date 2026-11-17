import Link from "next/link";
import { ExpectedThisQuarterTable } from "@/components/performance/expected-this-quarter-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getTargetPeriodRelative,
  toStandardTargetPeriodLabel,
  type TargetPeriodRelative,
} from "@/lib/case-options";
import { agingStatus } from "@/lib/performance/outstanding";
import {
  type ExpectedDisbursementQuarterCase,
  type QuarterlyFeeProjection,
  type SignedCasePacing,
  type SettledUndisbursedCase,
} from "@/lib/performance/pacing";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function pct(n: number | null) {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

function sumFees(rows: Array<{ expectedAttorneyFees: number }>) {
  return rows.reduce((total, row) => total + row.expectedAttorneyFees, 0);
}

const DISBURSE_Q_TONE: Record<TargetPeriodRelative, string> = {
  // Current quarter — due now
  current: "rounded px-1.5 py-0.5 bg-emerald-100 text-emerald-900",
  // Already passed — overdue / missed planning window
  past: "rounded px-1.5 py-0.5 bg-rose-100 text-rose-900",
  future: "",
};

function ExpectedDisburseQuarterCell({ value }: { value: string | null | undefined }) {
  const label = toStandardTargetPeriodLabel(value) ?? (value?.trim() || "—");
  const relative = getTargetPeriodRelative(value);
  const tone = relative ? DISBURSE_Q_TONE[relative] : "";
  if (!tone) {
    return <span className="whitespace-nowrap text-sm">{label}</span>;
  }
  return <span className={`inline-block whitespace-nowrap text-sm font-medium ${tone}`}>{label}</span>;
}

const BAR = {
  actual: "#2563eb", // blue
  settled: "#64748b", // slate — settled not disbursed
  unsettled: "#cbd5e1", // light slate — expected, not settled
  projected: "#9ca3af", // gray (signed pacing)
  goal: "#16a34a", // green
} as const;

export function OverviewView({
  signed,
  feeProjection,
  top5,
  oldest,
  expectedThisQuarter,
  agingTargetDays,
  agingWarnDays,
  quarterLabel,
}: {
  signed: SignedCasePacing;
  feeProjection: QuarterlyFeeProjection;
  top5: SettledUndisbursedCase[];
  oldest: SettledUndisbursedCase[];
  expectedThisQuarter: ExpectedDisbursementQuarterCase[];
  agingTargetDays: number;
  agingWarnDays: number;
  quarterLabel: string;
}) {
  const top5Total = sumFees(top5);
  const outstandingTotal = sumFees(oldest);
  const expectedThisQuarterTotal = sumFees(expectedThisQuarter);
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
              Disbursed + eligible settled (lag {feeProjection.lagDays}d) + unsettled expected this quarter.
              Goal from Performance Settings — not individual attorney /goals.
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
                  segments: [
                    {
                      label: "Actual",
                      value: feeProjection.feesDisbursedInQuarter,
                      color: BAR.actual,
                    },
                    {
                      label: "Settled not disbursed",
                      value: feeProjection.eligibleSettledUndisbursedFees,
                      color: BAR.settled,
                    },
                    {
                      label: "Expected unsettled",
                      value: feeProjection.unsettledExpectedFees,
                      color: BAR.unsettled,
                    },
                  ],
                },
                {
                  label: "Goal",
                  value: feeProjection.quarterlyGoal,
                  color: BAR.goal,
                  format: "money",
                },
              ]}
            />
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <LegendSwatch color={BAR.actual} label="Actual" />
              <LegendSwatch color={BAR.settled} label="Settled not disbursed" />
              <LegendSwatch color={BAR.unsettled} label="Expected unsettled" />
            </div>
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
              {oldest.length} settlements · {agingTargetDays}-day operating target
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

      <Card>
        <CardHeader>
          <CardDescription>Expected disbursement this quarter ({quarterLabel})</CardDescription>
          <CardTitle className="text-2xl">{money(expectedThisQuarterTotal)}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {expectedThisQuarter.length} active cases with Expected disbursement quarter = current quarter
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <ExpectedThisQuarterTable rows={expectedThisQuarter} currentQuarterLabel={quarterLabel} />
        </CardContent>
      </Card>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function ComparisonBarChart({
  bars,
}: {
  bars: Array<{
    label: string;
    value: number;
    color: string;
    format: "money" | "number";
    segments?: Array<{ label: string; value: number; color: string }>;
  }>;
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
        const segments = (bar.segments ?? []).filter((segment) => segment.value > 0);
        const segmentTotal = segments.reduce((sum, segment) => sum + segment.value, 0);

        return (
          <div key={bar.label} className="flex w-full max-w-[6rem] flex-col items-center gap-1.5">
            <span className="text-xs font-semibold text-navy-950">{valueLabel}</span>
            {segments.length > 0 && segmentTotal > 0 ? (
              <div
                className="flex w-14 flex-col-reverse overflow-hidden rounded-t-sm"
                style={{ height }}
                title={segments
                  .map((segment) => `${segment.label}: ${money(segment.value)}`)
                  .join(" · ")}
              >
                {segments.map((segment) => {
                  const segmentHeight = Math.max(
                    2,
                    Math.round((segment.value / segmentTotal) * height),
                  );
                  return (
                    <div
                      key={segment.label}
                      style={{ height: segmentHeight, backgroundColor: segment.color }}
                      title={`${segment.label}: ${money(segment.value)}`}
                    />
                  );
                })}
              </div>
            ) : (
              <div
                className="w-14 rounded-t-sm"
                style={{ height, backgroundColor: bar.color }}
                title={`${bar.label}: ${valueLabel}`}
              />
            )}
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
          <TableHead>Exp. disburse Q</TableHead>
          <TableHead>Days</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const status = agingStatus(row.daysOutstanding, agingTargetDays, agingWarnDays);
          return (
            <TableRow key={row.disbursementId ?? row.caseId}>
              <TableCell>
                <Link href={`/cases/${row.caseId}`} className="font-medium text-pink-700 hover:underline">
                  {row.caseNumber}
                </Link>
                <div className="text-xs text-muted-foreground">{row.clientName}</div>
              </TableCell>
              <TableCell>{row.attorneyName}</TableCell>
              <TableCell>{money(row.expectedAttorneyFees)}</TableCell>
              <TableCell>{row.settlementDate}</TableCell>
              <TableCell>
                <ExpectedDisburseQuarterCell value={row.targetResolutionQuarter} />
              </TableCell>
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
            <TableCell colSpan={6} className="text-muted-foreground">
              None
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
