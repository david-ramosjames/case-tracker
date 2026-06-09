"use client";

import {
  ATTORNEY_SCORE_VALIDATION_DAYS,
  COMPLETENESS_FIELDS,
  COMPLETENESS_SCORE_WEIGHT,
  FRESHNESS_SCORE_WEIGHT,
  VALIDATION_FIELDS,
  getCaseAttorneyScore,
} from "@/lib/attorney-score";
import { type CaseRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

function scoreTone(percent: number) {
  if (percent >= 90) return { bar: "bg-emerald-500", text: "text-emerald-700", ring: "ring-emerald-200" };
  if (percent >= 75) return { bar: "bg-sky-500", text: "text-sky-700", ring: "ring-sky-200" };
  if (percent >= 50) return { bar: "bg-amber-500", text: "text-amber-700", ring: "ring-amber-200" };
  return { bar: "bg-rose-500", text: "text-rose-700", ring: "ring-rose-200" };
}

export function CaseAttorneyScoreCell({
  record,
  prominent = false,
}: {
  record: CaseRecord;
  prominent?: boolean;
}) {
  const score = getCaseAttorneyScore(record);
  const styles = scoreTone(score.percent);
  const stale = score.outdatedValidationFields.length > 0;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1",
        prominent && "rounded-md bg-muted/30 px-2 py-1.5 ring-1 ring-inset",
        prominent && styles.ring,
      )}
      title={`Completeness ${score.completenessPercent}% · Updated info ${score.freshnessPercent}%`}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn("text-xs font-bold tabular-nums", styles.text)}>{score.percent}%</span>
        {stale ? (
          <span className="rounded bg-rose-100 px-1 py-0.5 text-[10px] font-semibold uppercase text-rose-700">
            Stale
          </span>
        ) : null}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", styles.bar)} style={{ width: `${score.percent}%` }} />
      </div>
    </div>
  );
}

export function AttorneyScoreBreakdown({ record }: { record: CaseRecord }) {
  const score = getCaseAttorneyScore(record);

  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
          <span>Completeness ({Math.round(COMPLETENESS_SCORE_WEIGHT * 100)}% of score)</span>
          <span>
            {score.completenessCompleted}/{score.completenessTotal} fields
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-sky-500" style={{ width: `${score.completenessPercent}%` }} />
        </div>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
          <span>Updated info ({Math.round(FRESHNESS_SCORE_WEIGHT * 100)}% of score)</span>
          <span>
            {score.freshnessCompleted}/{score.freshnessTotal} validated within {ATTORNEY_SCORE_VALIDATION_DAYS}d
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${score.freshnessPercent}%` }} />
        </div>
      </div>
    </div>
  );
}

export function AttorneyScoreExplainer() {
  return (
    <div className="space-y-4 text-sm leading-6 text-muted-foreground">
      <p>
        Each active case earns a Case Tracker Score from 0–100%. Dashboard rollups average scores across that
        attorney&apos;s active cases.
      </p>
      <div>
        <p className="font-semibold text-navy-950">Completeness — 40% of case score</p>
        <p className="mt-1">Eight fields, equal weight ({100 / COMPLETENESS_FIELDS.length}% each toward completeness):</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {COMPLETENESS_FIELDS.map((field) => (
            <li key={field.id}>{field.label}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="font-semibold text-navy-950">Updated info — 60% of case score</p>
        <p className="mt-1">
          Four fields must be filled and validated within the last {ATTORNEY_SCORE_VALIDATION_DAYS} days, equal weight (
          {100 / VALIDATION_FIELDS.length}% each toward freshness):
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {VALIDATION_FIELDS.map((field) => (
            <li key={field.id}>{field.label}</li>
          ))}
        </ul>
        <p className="mt-2">
          Saving a field or completing a quarterly check-in stamps validation. When any of these four fields are missing
          or older than {ATTORNEY_SCORE_VALIDATION_DAYS} days, the case is flagged in the tracker and a Slack reminder is
          sent on the next cron run.
        </p>
      </div>
      <p className="rounded-lg border bg-muted/40 p-3 text-xs">
        Example: all completeness fields filled (40 points) and two of four validation fields current (30 points) ={" "}
        <strong className="text-navy-950">70% case score</strong>.
      </p>
    </div>
  );
}
