import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAttorneyGoalProgress } from "@/lib/calculations";
import { type AppUser, type AttorneyGoal, type CaseRecord } from "@/lib/types";
import { formatCurrency, percent } from "@/lib/utils";

export function GoalsView({
  records,
  goals,
  users,
}: {
  records: CaseRecord[];
  goals: AttorneyGoal[];
  users: AppUser[];
}) {
  const progress = getAttorneyGoalProgress(records, goals);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        {progress.map((item) => {
          const attorney = users.find((user) => user.id === item.goal.attorneyId);

          return (
            <Card key={item.goal.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{attorney?.name}</CardTitle>
                    <CardDescription>Annual fee goal {formatCurrency(item.goal.annualFeeGoal)}</CardDescription>
                  </div>
                  <Badge variant={item.pace === "ahead" ? "success" : "warning"}>
                    {item.pace === "ahead" ? "Ahead" : "Behind"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-muted-foreground">Annual progress</span>
                    <span className="font-semibold">{percent(item.annualProgress)}</span>
                  </div>
                  <Progress value={item.annualProgress} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <GoalStat label="Settled fees" value={formatCurrency(item.actualSettledFees)} />
                  <GoalStat label="Disbursed fees" value={formatCurrency(item.actualDisbursedFees)} />
                  <GoalStat label="Forecasted fees" value={formatCurrency(item.forecastedFees)} />
                  <GoalStat label="Year elapsed" value={percent(item.yearElapsed)} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quarterly Goals</CardTitle>
          <CardDescription>Annual and quarterly fee targets by attorney.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Attorney</TableHead>
                <TableHead>Annual</TableHead>
                <TableHead>Q1</TableHead>
                <TableHead>Q2</TableHead>
                <TableHead>Q3</TableHead>
                <TableHead>Q4</TableHead>
                <TableHead>Forecast</TableHead>
                <TableHead>Actual settled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {progress.map((item) => {
                const attorney = users.find((user) => user.id === item.goal.attorneyId);

                return (
                  <TableRow key={item.goal.id}>
                    <TableCell className="font-semibold">{attorney?.name}</TableCell>
                    <TableCell>{formatCurrency(item.goal.annualFeeGoal)}</TableCell>
                    <TableCell>{formatCurrency(item.goal.q1Goal)}</TableCell>
                    <TableCell>{formatCurrency(item.goal.q2Goal)}</TableCell>
                    <TableCell>{formatCurrency(item.goal.q3Goal)}</TableCell>
                    <TableCell>{formatCurrency(item.goal.q4Goal)}</TableCell>
                    <TableCell>{formatCurrency(item.forecastedFees)}</TableCell>
                    <TableCell>{formatCurrency(item.actualSettledFees)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function GoalStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold text-navy-950">{value}</p>
    </div>
  );
}
