import { type SignedCasesMonthBucket } from "@/lib/jumbotron-metrics";

export function SignedCasesTrendChart({
  buckets,
  calendarYear,
}: {
  buckets: SignedCasesMonthBucket[];
  calendarYear: number;
}) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 1);

  return (
    <div className="space-y-4">
      <div className="flex h-56 items-end gap-1.5 sm:gap-2" role="img" aria-label={`Signed cases by month for ${calendarYear}`}>
        {buckets.map((bucket) => {
          const heightPercent = bucket.count > 0 ? Math.max((bucket.count / maxCount) * 100, 8) : 0;

          return (
            <div key={bucket.month} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <span className="text-[10px] font-medium tabular-nums text-navy-950 sm:text-xs">
                {bucket.count > 0 ? bucket.count : ""}
              </span>
              <div className="flex h-40 w-full items-end justify-center">
                <div
                  className="w-full max-w-10 rounded-t-md bg-pink-500/85 transition-[height] duration-300 hover:bg-pink-600"
                  style={{ height: `${heightPercent}%` }}
                  title={`${bucket.label} ${calendarYear}: ${bucket.count} signed`}
                />
              </div>
              <span className="text-[10px] font-medium text-muted-foreground sm:text-xs">{bucket.label}</span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {total} case{total === 1 ? "" : "s"} signed in {calendarYear}
        {total === 0 ? " (no matches for current filters)" : ""}
      </p>
    </div>
  );
}
