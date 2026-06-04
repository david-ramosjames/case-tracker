"use client";

import { Progress } from "@/components/ui/progress";
import { getAttorneyScoreRollups } from "@/lib/attorney-score";
import { type AppUser, type CaseRecord } from "@/lib/types";

export function AttorneyScoreRollupCard({
  records,
  users,
  highlightAttorneyId,
}: {
  records: CaseRecord[];
  users: AppUser[];
  highlightAttorneyId?: string | null;
}) {
  const rollups = getAttorneyScoreRollups(records);

  if (rollups.length === 0) {
    return <p className="text-sm text-muted-foreground">No active cases to score yet.</p>;
  }

  const ordered =
    highlightAttorneyId != null
      ? [...rollups].sort((a, b) => {
          if (a.attorneyId === highlightAttorneyId) return -1;
          if (b.attorneyId === highlightAttorneyId) return 1;
          return b.averageScore - a.averageScore;
        })
      : rollups;

  return (
    <div className="space-y-4">
      {ordered.map((rollup) => {
        const attorney = users.find((user) => user.id === rollup.attorneyId);
        const highlighted = rollup.attorneyId === highlightAttorneyId;

        return (
          <div
            key={rollup.attorneyId}
            className={`rounded-lg border bg-white p-4 ${highlighted ? "border-pink-300 ring-1 ring-pink-200" : ""}`}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-navy-950">{attorney?.name ?? "Unknown attorney"}</p>
                <p className="text-sm text-muted-foreground">
                  {rollup.caseCount} active case{rollup.caseCount === 1 ? "" : "s"} · Completeness{" "}
                  {rollup.averageCompleteness}% · Updated info {rollup.averageFreshness}%
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold tabular-nums text-navy-950">{rollup.averageScore}%</p>
                <p className="text-xs text-muted-foreground">Attorney score</p>
              </div>
            </div>
            <Progress value={rollup.averageScore} />
            {rollup.casesWithOutdatedValidation > 0 ? (
              <p className="mt-2 text-xs font-medium text-rose-700">
                {rollup.casesWithOutdatedValidation} case
                {rollup.casesWithOutdatedValidation === 1 ? "" : "s"} need 90-day validation
              </p>
            ) : (
              <p className="mt-2 text-xs text-emerald-700">All validation fields current</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
