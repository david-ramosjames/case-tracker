import { type CommissionQuarterPerformanceRow } from "@/lib/calculations";
import { formatCurrency, percent } from "@/lib/utils";

export function AchievementCard({
  label,
  achievedPercent,
  actual,
  goal,
}: {
  label: string;
  achievedPercent: number;
  actual: number;
  goal: number;
}) {
  return (
    <div className="rounded-lg border border-pink-100 bg-pink-50/30 p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-pink-600">{percent(achievedPercent)}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatCurrency(actual)} of {formatCurrency(goal)}
      </p>
    </div>
  );
}

export function QuarterlyGoalChart({
  title,
  rows,
}: {
  title: string;
  rows: CommissionQuarterPerformanceRow[];
}) {
  const maxValue = Math.max(...rows.flatMap((row) => [row.target, row.actual]), 1);

  return (
    <div className="rounded-lg border border-pink-100 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-navy-950">{title}</p>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-pink-100" />
            Target
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-pink-500" />
            Actual
          </span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col items-center gap-2">
            <div className="flex h-28 w-full items-end justify-center gap-1.5">
              <div
                className="w-4 rounded-t bg-pink-100"
                style={{ height: `${Math.max((row.target / maxValue) * 100, row.target > 0 ? 4 : 0)}%` }}
                title={`Target: ${formatCurrency(row.target)}`}
              />
              <div
                className="w-4 rounded-t bg-pink-500"
                style={{ height: `${Math.max((row.actual / maxValue) * 100, row.actual > 0 ? 4 : 0)}%` }}
                title={`Actual: ${formatCurrency(row.actual)}`}
              />
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-navy-950">{row.label}</p>
              <p className="text-[10px] font-medium leading-tight text-pink-600">{percentOfGoal(row.actual, row.target)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function percentOfGoal(actual: number, target: number) {
  if (target <= 0) return "—";
  return percent((actual / target) * 100);
}
