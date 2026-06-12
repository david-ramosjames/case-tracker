"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getCompletedDisbursements,
  getDisbursementAttorneyFees,
  getDisbursementSettlementAmount,
  getDisbursementSyncStatus,
  getPendingDisbursements,
  hasMultipleDisbursements,
} from "@/lib/disbursements";
import { type CaseRecord } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/utils";

type DisbursementPartiesCardProps = {
  record: CaseRecord;
  editing: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onExpectedCountChange: (count: number) => void;
};

export function DisbursementPartiesCard({
  record,
  editing,
  onEnabledChange,
  onExpectedCountChange,
}: DisbursementPartiesCardProps) {
  const { tracker } = record;
  const showDetails = hasMultipleDisbursements(tracker);
  const sync = getDisbursementSyncStatus(tracker);
  const completed = getCompletedDisbursements(tracker);
  const pending = getPendingDisbursements(tracker);
  const placeholderCount = sync.awaitingSheet;
  const canDisable = tracker.disbursements.length <= 1;

  if (!showDetails && !editing) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Multiple disbursement parties</CardTitle>
        <CardDescription>
          Each row on the RJL Cases Disbursing sheet with this case # becomes a party (column D = client name). Use
          Import disbursing sheet on Results to pull all matching rows automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {editing ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={tracker.multipleDisbursementsEnabled}
              disabled={!canDisable && tracker.multipleDisbursementsEnabled}
              onChange={(event) => {
                const enabled = event.target.checked;
                onEnabledChange(enabled);
                if (!enabled) {
                  onExpectedCountChange(1);
                } else if (tracker.expectedDisbursementCount <= 1) {
                  onExpectedCountChange(2);
                }
              }}
            />
            <span>
              <span className="font-medium text-navy-950">This case has multiple disbursement parties</span>
              <span className="mt-1 block text-muted-foreground">
                Leave off for the typical single-disbursement case. The disbursing sheet will still update settlement and
                disburse dates normally.
              </span>
              {!canDisable ? (
                <span className="mt-1 block text-amber-700">
                  Sheet sync has multiple rows for this case — multi-party tracking stays on.
                </span>
              ) : null}
            </span>
          </label>
        ) : null}

        {showDetails ? (
          <>
            <div className="flex flex-wrap items-end gap-4">
              {editing ? (
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-navy-950">Expected parties</span>
                  <Input
                    className="w-24"
                    type="number"
                    min={2}
                    step={1}
                    value={tracker.expectedDisbursementCount}
                    onChange={(event) =>
                      onExpectedCountChange(Math.max(2, Number.parseInt(event.target.value || "2", 10) || 2))
                    }
                  />
                </label>
              ) : (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-navy-950">{sync.expected}</span> expected ·{" "}
                  <span className="font-medium text-navy-950">{sync.onSheet}</span> on disbursing sheet ·{" "}
                  <span className="font-medium text-navy-950">{completed.length}</span> disbursed
                </p>
              )}
              {sync.partiallyMatched ? (
                <Badge variant="outline">Awaiting {sync.awaitingSheet} sheet row(s)</Badge>
              ) : null}
              {sync.matched && pending.length === 0 && completed.length > 0 ? (
                <Badge variant="outline">All parties disbursed</Badge>
              ) : null}
            </div>

            {tracker.disbursements.length > 0 ? (
              <div className="space-y-3">
                {tracker.disbursements.map((item, index) => (
                  <div key={item.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-medium text-navy-950">
                        Party {index + 1}
                        {item.partyLabel ? ` · ${item.partyLabel}` : ""}
                      </span>
                      <Badge variant={item.pendingRemaining ? "secondary" : "default"}>
                        {item.pendingRemaining ? "Awaiting disbursement" : "Disbursed"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Commission weight {(item.weight * 100).toFixed(item.weight === 1 ? 0 : 1)}%
                      </span>
                    </div>
                    <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <dt className="text-muted-foreground">Settlement date</dt>
                        <dd>{formatDate(item.settlementDate) || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Settlement amount</dt>
                        <dd>{formatCurrency(getDisbursementSettlementAmount(item, record))}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">RJL Attorney Fees</dt>
                        <dd>{formatCurrency(getDisbursementAttorneyFees(item, record))}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Disburse date</dt>
                        <dd>{formatDate(item.disburseDate) || "—"}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            ) : editing ? (
              <p className="text-sm text-muted-foreground">
                Save the expected party count. Details will appear when the case is added to the disbursing sheet.
              </p>
            ) : null}

            {placeholderCount > 0 ? (
              <div className="space-y-2">
                {Array.from({ length: placeholderCount }, (_, index) => (
                  <div
                    key={`placeholder-${index}`}
                    className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-sm text-muted-foreground"
                  >
                    Party {tracker.disbursements.length + index + 1} — not on disbursing sheet yet
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
