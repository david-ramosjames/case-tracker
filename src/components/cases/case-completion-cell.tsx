"use client";

import { getCaseCompletionScore } from "@/lib/calculations";
import { type CaseCompletionLevel, type CaseRecord, type CaseTrackerSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

const LEVEL_STYLES: Record<CaseCompletionLevel, { bar: string; text: string; ring: string }> = {
  complete: { bar: "bg-emerald-500", text: "text-emerald-700", ring: "ring-emerald-200" },
  good: { bar: "bg-sky-500", text: "text-sky-700", ring: "ring-sky-200" },
  attention: { bar: "bg-amber-500", text: "text-amber-700", ring: "ring-amber-200" },
  critical: { bar: "bg-rose-500", text: "text-rose-700", ring: "ring-rose-200" },
};

export function CaseCompletionCell({
  record,
  settings,
  prominent = false,
}: {
  record: CaseRecord;
  settings: CaseTrackerSettings;
  prominent?: boolean;
}) {
  const score = getCaseCompletionScore(record, settings);
  const styles = LEVEL_STYLES[score.level];

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1",
        prominent && "rounded-md bg-muted/30 px-2 py-1.5 ring-1 ring-inset",
        prominent && styles.ring,
      )}
      title={`${score.completed} of ${score.total} tracker fields complete`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-xs font-bold tabular-nums", styles.text)}>{score.percent}%</span>
        {prominent ? <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Complete</span> : null}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", styles.bar)} style={{ width: `${score.percent}%` }} />
      </div>
    </div>
  );
}
