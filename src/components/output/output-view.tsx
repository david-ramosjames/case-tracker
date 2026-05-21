import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getFirmOutputMetrics } from "@/lib/calculations";
import { type AttorneyGoal, type CaseRecord } from "@/lib/types";
import { formatCurrency, percent } from "@/lib/utils";

export function OutputView({ records, goals }: { records: CaseRecord[]; goals: AttorneyGoal[] }) {
  const output = getFirmOutputMetrics(records, goals);
  const { results } = output;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-4">
        <SummaryCard label="Gross Settled" value={formatCurrency(results.grossSettled)} detail="Settlement amounts signed" />
        <SummaryCard label="Gross Disbursed" value={formatCurrency(results.grossDisbursed)} detail="Settlement dollars disbursed" />
        <SummaryCard label="RJL Fees Settled" value={formatCurrency(results.feesSettled)} detail="Attorney fees on settled cases" />
        <SummaryCard label="RJL Fees Disbursed" value={formatCurrency(results.feesDisbursed)} detail="Attorney fees on disbursed cases" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Results vs Goals</CardTitle>
          <CardDescription>Full-year goal and current pacing view for settlements and attorney fees.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Settled</TableHead>
                <TableHead>Disbursed</TableHead>
                <TableHead>Full Year Goal</TableHead>
                <TableHead>% of Goal</TableHead>
                <TableHead>% of Goal Settled</TableHead>
                <TableHead>% of Year Complete</TableHead>
                <TableHead>Pacing Goal</TableHead>
                <TableHead>% of Pacing Goal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <ResultsRow
                label="Gross Settlements"
                settled={results.grossSettled}
                disbursed={results.grossDisbursed}
                fullYearGoal={results.annualGrossGoal}
                pacingGoal={results.pacingGrossGoal}
                yearElapsed={results.yearElapsed}
              />
              <ResultsRow
                label="RJL Attorney Fees"
                settled={results.feesSettled}
                disbursed={results.feesDisbursed}
                fullYearGoal={results.annualFeeGoal}
                pacingGoal={results.pacingFeeGoal}
                yearElapsed={results.yearElapsed}
              />
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <CardHeader>
            <CardTitle>Case Status Rollup</CardTitle>
            <CardDescription>Current pipeline mix by operational status.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case Status</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead>% of Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {output.caseStatuses.rows.map((row) => (
                  <TableRow key={row.label}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell>{row.count}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-24">
                          <Progress value={row.percentOfTotal} />
                        </div>
                        {percent(row.percentOfTotal)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="font-semibold">{output.caseStatuses.total}</TableCell>
                  <TableCell className="font-semibold">100%</TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <div className="grid gap-3 sm:grid-cols-3">
              <MiniStat label="Completed Disbursements" value={String(results.completedDisbursements)} variant="success" />
              <MiniStat label="FY Goal" value={String(results.completedDisbursementGoal)} />
              <MiniStat
                label="% of Goal"
                value={percent((results.completedDisbursements / results.completedDisbursementGoal) * 100)}
                variant={results.completedDisbursements >= results.completedDisbursementGoal ? "success" : "warning"}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Commission Overview</CardTitle>
            <CardDescription>Disbursed fees compared with the commission threshold.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <SummaryCard label="Commission Threshold" value={formatCurrency(results.commissionThreshold)} detail="Based on current annual fee goals" />
            <SummaryCard label="Commissionable Amount" value={formatCurrency(results.commissionableAmount)} detail="Disbursed fees above threshold" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <QuarterTable title="Gross Settlements Disbursed" rows={output.grossQuarterRows} />
        <QuarterTable title="RJL Attorney Fees" rows={output.feeQuarterRows} />
      </div>
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-navy-950">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function ResultsRow({
  label,
  settled,
  disbursed,
  fullYearGoal,
  pacingGoal,
  yearElapsed,
}: {
  label: string;
  settled: number;
  disbursed: number;
  fullYearGoal: number;
  pacingGoal: number;
  yearElapsed: number;
}) {
  return (
    <TableRow>
      <TableCell className="font-semibold">{label}</TableCell>
      <TableCell>{formatCurrency(settled)}</TableCell>
      <TableCell>{formatCurrency(disbursed)}</TableCell>
      <TableCell>{formatCurrency(fullYearGoal)}</TableCell>
      <TableCell>{percent((disbursed / fullYearGoal) * 100)}</TableCell>
      <TableCell>{percent((settled / fullYearGoal) * 100)}</TableCell>
      <TableCell>{percent(yearElapsed)}</TableCell>
      <TableCell>{formatCurrency(pacingGoal)}</TableCell>
      <TableCell>{percent((disbursed / pacingGoal) * 100)}</TableCell>
    </TableRow>
  );
}

function MiniStat({ label, value, variant = "outline" }: { label: string; value: string; variant?: "success" | "warning" | "outline" }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Badge className="mt-2" variant={variant}>
        {value}
      </Badge>
    </div>
  );
}

function QuarterTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ quarter: string; months: string; target: number; plan: number; actual: number }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Quarterly target, current plan, and actual disbursed performance.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quarter</TableHead>
              <TableHead>Months</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Actual</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.quarter}>
                <TableCell className="font-medium">{row.quarter}</TableCell>
                <TableCell>{row.months}</TableCell>
                <TableCell>{formatCurrency(row.target)}</TableCell>
                <TableCell>{formatCurrency(row.plan)}</TableCell>
                <TableCell>{formatCurrency(row.actual)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell />
              <TableCell className="font-semibold">{formatCurrency(rows.reduce((total, row) => total + row.target, 0))}</TableCell>
              <TableCell className="font-semibold">{formatCurrency(rows.reduce((total, row) => total + row.plan, 0))}</TableCell>
              <TableCell className="font-semibold">{formatCurrency(rows.reduce((total, row) => total + row.actual, 0))}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
