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
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Signed cases</CardDescription>
            <CardTitle className="text-2xl">
              {signed.signedMtd} / {signed.monthlyGoal}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Projected month-end {signed.projectedMonthEnd?.toFixed(1) ?? "—"} ({pct(signed.projectedAttainment)})
            <div>Variance {signed.variance?.toFixed(1) ?? "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Attorney fees ({quarterLabel})</CardDescription>
            <CardTitle className="text-2xl">{money(feeProjection.projectedQuarterlyFees)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Disbursed {money(feeProjection.feesDisbursedInQuarter)} + eligible settled{" "}
            {money(feeProjection.eligibleSettledUndisbursedFees)}
            <div>
              Goal {money(feeProjection.quarterlyGoal)} · {pct(feeProjection.attainment)} · lag{" "}
              {feeProjection.lagDays}d
            </div>
            <div className="mt-1 text-xs">
              Jon projection (disbursed + eligible settled). Distinct from /goals pipeline plan.
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Settled, not paid</CardDescription>
            <CardTitle className="text-2xl">{top5.length ? money(top5[0]!.expectedAttorneyFees) : "—"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Largest expected fee still outstanding</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Disbursement aging</CardDescription>
            <CardTitle className="text-2xl">{agingTargetDays}d target</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Oldest open: {oldest[0]?.daysOutstanding ?? "—"} days
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top 5 settled, undisbursed</CardTitle>
            <CardDescription>By expected attorney fees</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <OutstandingTable rows={top5} agingTargetDays={agingTargetDays} agingWarnDays={agingWarnDays} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Oldest outstanding settlements</CardTitle>
            <CardDescription>30-day operating target</CardDescription>
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
