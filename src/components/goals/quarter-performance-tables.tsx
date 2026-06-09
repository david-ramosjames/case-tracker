import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";

export type QuarterPerformanceRow = {
  quarter: string;
  months: string;
  target: number;
  plan: number;
  actual: number;
};

export function QuarterPerformanceTables({
  grossRows,
  feeRows,
}: {
  grossRows: QuarterPerformanceRow[];
  feeRows: QuarterPerformanceRow[];
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <QuarterTable title="Gross Settlements Disbursed" rows={grossRows} />
      <QuarterTable title="RJL Attorney Fees" rows={feeRows} />
    </div>
  );
}

function QuarterTable({ title, rows }: { title: string; rows: QuarterPerformanceRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          Current calendar year and commission-year quarters — target, plan (including future), and actual disbursed.
        </CardDescription>
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
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
