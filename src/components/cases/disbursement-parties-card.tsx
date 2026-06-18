"use client";

import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ResultDateInput } from "@/components/cases/result-date-input";
import { dateInputToDateOnly } from "@/lib/date-input";
import {
  areAllDisbursementPartiesDisbursed,
  getCompletedDisbursements,
  getDisbursementAttorneyFees,
  getDisbursementSettlementAmount,
  getDisbursementSyncStatus,
  getPartyDisbursementStatus,
  hasMultipleDisbursements,
} from "@/lib/disbursements";
import { type CaseDisbursement, type CaseRecord } from "@/lib/types";
import { formatCurrency, formatDate, formatOptionalDate } from "@/lib/utils";

type DisbursementPartiesCardProps = {
  record: CaseRecord;
  editing: boolean;
  /** When true, only show manual backfill UI (no multi-party toggle). */
  showManualOnly?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onExpectedCountChange: (count: number) => void;
  onAddManualParty: () => void;
  onUpdateManualParty: (id: string, patch: Partial<CaseDisbursement>) => void;
  onUpdateSheetParty: (id: string, patch: Partial<CaseDisbursement>) => void;
  onRemoveManualParty: (id: string) => void;
};

export function DisbursementPartiesCard({
  record,
  editing,
  showManualOnly = false,
  onEnabledChange,
  onExpectedCountChange,
  onAddManualParty,
  onUpdateManualParty,
  onUpdateSheetParty,
  onRemoveManualParty,
}: DisbursementPartiesCardProps) {
  const { tracker } = record;
  const showDetails = hasMultipleDisbursements(tracker);
  const sync = getDisbursementSyncStatus(tracker);
  const completed = getCompletedDisbursements(tracker);
  const placeholderCount = sync.awaitingSheet;
  const canDisable = tracker.disbursements.filter((row) => row.sheetRowKey).length <= 1;
  const manualParties = tracker.disbursements.filter((row) => !row.sheetRowKey);
  const sheetParties = tracker.disbursements.filter((row) => row.sheetRowKey);

  if (!showDetails && !editing && manualParties.length === 0) {
    return null;
  }

  if (showManualOnly) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Manual disbursement backfill</CardTitle>
          <CardDescription>
            Add disbursement details that are not on the RJL Cases Disbursing sheet. Manual rows are kept when you import
            from the sheet — only sheet-linked rows are updated by sync.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {manualParties.length === 0 ? (
            <p className="text-sm text-muted-foreground">No manual disbursement rows yet.</p>
          ) : (
            manualParties.map((item, index) => (
              <ManualPartyEditor
                key={item.id}
                item={item}
                index={index}
                onUpdate={(patch) => onUpdateManualParty(item.id, patch)}
                onRemove={() => onRemoveManualParty(item.id)}
              />
            ))
          )}
          <Button type="button" variant="outline" size="sm" onClick={onAddManualParty}>
            Add manual disbursement
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Multiple disbursement parties</CardTitle>
        <CardDescription>
          Each row on the RJL Cases Disbursing sheet with this case # becomes a party (column D = client name). Use
          Import disbursing sheet on Results to pull all matching rows automatically. For legacy cases with wrong sheet
          dates, edit a party&apos;s disburse date below — it will be locked and won&apos;t be overwritten on import.
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
                  <span className="font-medium text-navy-950">{sync.onSheet}</span> on disbursing sheet
                  {sync.manual > 0 ? (
                    <>
                      {" "}
                      · <span className="font-medium text-navy-950">{sync.manual}</span> manual
                    </>
                  ) : null}{" "}
                  · <span className="font-medium text-navy-950">{completed.length}</span> disbursed
                </p>
              )}
              {sync.partiallyMatched ? (
                <Badge variant="outline">Awaiting {sync.awaitingSheet} sheet row(s)</Badge>
              ) : null}
              {areAllDisbursementPartiesDisbursed(tracker) ? (
                <Badge variant="outline">All parties disbursed</Badge>
              ) : null}
            </div>

            {sheetParties.length > 0 ? (
              <div className="space-y-3">
                {sheetParties.map((item, index) =>
                  editing ? (
                    <SheetPartyEditor
                      key={item.id}
                      item={item}
                      index={index}
                      record={record}
                      onUpdate={(patch) => onUpdateSheetParty(item.id, patch)}
                    />
                  ) : (
                    <SheetPartyView key={item.id} item={item} index={index} record={record} />
                  ),
                )}
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

        {(editing || manualParties.length > 0) && (
          <div className="space-y-3 border-t border-slate-200 pt-4">
            <div>
              <p className="text-sm font-medium text-navy-950">Manual disbursements (not on sheet)</p>
              <p className="text-sm text-muted-foreground">
                Use for historical backfill. These rows are not removed or overwritten when you import from the
                disbursing sheet.
              </p>
            </div>
            {manualParties.map((item, index) =>
              editing ? (
                <ManualPartyEditor
                  key={item.id}
                  item={item}
                  index={index}
                  onUpdate={(patch) => onUpdateManualParty(item.id, patch)}
                  onRemove={() => onRemoveManualParty(item.id)}
                />
              ) : (
                <div key={item.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="font-medium text-navy-950">
                      Manual party {index + 1}
                      {item.partyLabel ? ` · ${item.partyLabel}` : ""}
                    </span>
                    <Badge variant="outline">Manual</Badge>
                  </div>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-muted-foreground">Settlement date</dt>
                      <dd>{formatDate(item.settlementDate) || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Settlement amount</dt>
                      <dd>{formatCurrency(item.settlementAmount)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">RJL Attorney Fees</dt>
                      <dd>{formatCurrency(item.attorneyFees)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Disburse date</dt>
                      <dd>{formatOptionalDate(item.disburseDate)}</dd>
                    </div>
                  </dl>
                </div>
              ),
            )}
            {editing ? (
              <Button type="button" variant="outline" size="sm" onClick={onAddManualParty}>
                Add manual disbursement
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SheetPartyView({
  item,
  index,
  record,
}: {
  item: CaseDisbursement;
  index: number;
  record: CaseRecord;
}) {
  const status = getPartyDisbursementStatus(item);
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium text-navy-950">
          Party {index + 1}
          {item.partyLabel ? ` · ${item.partyLabel}` : ""}
        </span>
        <Badge variant="outline">From sheet</Badge>
        {item.disburseDateLocked || item.settlementDateLocked ? (
          <Badge variant="outline">Legacy override</Badge>
        ) : null}
        <Badge variant={status.variant}>{status.label}</Badge>
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
          <dd>{formatOptionalDate(item.disburseDate)}</dd>
        </div>
      </dl>
    </div>
  );
}

function SheetPartyEditor({
  item,
  index,
  record,
  onUpdate,
}: {
  item: CaseDisbursement;
  index: number;
  record: CaseRecord;
  onUpdate: (patch: Partial<CaseDisbursement>) => void;
}) {
  const status = getPartyDisbursementStatus(item);
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-medium text-navy-950">
          Party {index + 1}
          {item.partyLabel ? ` · ${item.partyLabel}` : ""}
        </span>
        <Badge variant="outline">From sheet</Badge>
        {item.disburseDateLocked || item.settlementDateLocked ? (
          <Badge variant="outline">Legacy override — kept on sheet import</Badge>
        ) : null}
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Correct disburse or settlement dates when the disbursing sheet is wrong for this legacy case. Saving locks
        overridden dates so future imports won&apos;t change them.
      </p>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="font-medium text-navy-950">Settlement date</span>
          <ResultDateInput
            value={item.settlementDate}
            onCommit={(value) => onUpdate({ settlementDate: dateInputToDateOnly(value) })}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium text-navy-950">Disburse date</span>
          <ResultDateInput
            value={item.disburseDate}
            onCommit={(value) => onUpdate({ disburseDate: dateInputToDateOnly(value) })}
          />
        </label>
        <div className="space-y-1 text-sm">
          <span className="font-medium text-navy-950">Settlement amount</span>
          <p>{formatCurrency(getDisbursementSettlementAmount(item, record))}</p>
        </div>
        <div className="space-y-1 text-sm">
          <span className="font-medium text-navy-950">RJL Attorney Fees</span>
          <p>{formatCurrency(getDisbursementAttorneyFees(item, record))}</p>
        </div>
      </div>
    </div>
  );
}

function ManualPartyEditor({
  item,
  index,
  onUpdate,
  onRemove,
}: {
  item: CaseDisbursement;
  index: number;
  onUpdate: (patch: Partial<CaseDisbursement>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-navy-950">Manual party {index + 1}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
          Remove
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1 text-sm md:col-span-2 lg:col-span-3">
          <span className="font-medium text-navy-950">Party / client name</span>
          <Input
            value={item.partyLabel ?? ""}
            onChange={(event) => onUpdate({ partyLabel: event.target.value || null })}
            placeholder="e.g. minor child, second claimant"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium text-navy-950">Settlement date</span>
          <ResultDateInput
            value={item.settlementDate}
            onCommit={(value) => onUpdate({ settlementDate: dateInputToDateOnly(value) })}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium text-navy-950">Disburse date</span>
          <ResultDateInput
            value={item.disburseDate}
            onCommit={(value) => onUpdate({ disburseDate: dateInputToDateOnly(value) })}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium text-navy-950">Settlement amount</span>
          <Input
            type="number"
            min={0}
            step={1}
            value={item.settlementAmount ?? ""}
            onChange={(event) =>
              onUpdate({
                settlementAmount: event.target.value ? Number(event.target.value) : null,
              })
            }
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium text-navy-950">RJL Attorney Fees</span>
          <Input
            type="number"
            min={0}
            step={1}
            value={item.attorneyFees ?? ""}
            onChange={(event) =>
              onUpdate({
                attorneyFees: event.target.value ? Number(event.target.value) : null,
              })
            }
          />
        </label>
        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={item.pendingRemaining}
            onChange={(event) => onUpdate({ pendingRemaining: event.target.checked })}
          />
          <span>Awaiting disbursement</span>
        </label>
      </div>
    </div>
  );
}
