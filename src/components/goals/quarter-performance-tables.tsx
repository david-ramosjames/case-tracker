import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sum, type CommissionQuarterPerformanceRow } from "@/lib/calculations";
import { formatCurrency } from "@/lib/utils";

export function QuarterPerformanceTables({
  grossRows,
  feeRows,
  description,
}: {
  grossRows: CommissionQuarterPerformanceRow[];
  feeRows: CommissionQuarterPerformanceRow[];
  description?: string;
}) {
  const tableDescription =
    description ??
    "Commission-year quarters (CY Q1–Q4) from each attorney's start month — target from goals, plan from forecast, actual from disburse dates.";

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <QuarterTable title="Gross Disbursements" rows={grossRows} description={tableDescription} />
      <QuarterTable
        title="RJL Attorney Fees Disbursed"
        rows={feeRows}
        description={tableDescription}
      />
    </div>
  );
}

function QuarterTable({
  title,
  rows,
  description,
  hideTarget = false,
}: {
  title: string;
  rows: CommissionQuarterPerformanceRow[];
  description: string;
  hideTarget?: boolean;
}) {
  const totals = {
    target: sum(rows.map((row) => row.target)),
    plan: sum(rows.map((row) => row.plan)),
    actual: sum(rows.map((row) => row.actual)),
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quarter</TableHead>
              <TableHead>Period</TableHead>
              {hideTarget ? null : <TableHead>Target</TableHead>}
              <TableHead>Plan</TableHead>
              <TableHead>Actual</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.label}-${row.period}`}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{row.period}</TableCell>
                {hideTarget ? null : <TableCell>{formatCurrency(row.target)}</TableCell>}
                <TableCell>{formatCurrency(row.plan)}</TableCell>
                <TableCell>{formatCurrency(row.actual)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/30">
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell className="text-sm text-muted-foreground">—</TableCell>
              {hideTarget ? null : <TableCell className="font-semibold">{formatCurrency(totals.target)}</TableCell>}
              <TableCell className="font-semibold">{formatCurrency(totals.plan)}</TableCell>
              <TableCell className="font-semibold">{formatCurrency(totals.actual)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
