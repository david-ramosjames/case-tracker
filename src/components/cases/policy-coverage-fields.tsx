"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  buildPolicyCoverageChangePatch,
  buildPolicyCoverageConfirmPatch,
} from "@/lib/policy-coverage-actions";
import {
  isPolicyCoverageStatus,
  isPolicyCoverageValidationDue,
  POLICY_COVERAGE_OPTIONS,
  policyCoverageLabel,
  policyLimitsAmountLabel,
  policyLimitsAreReadOnly,
  type PolicyCoverageStatus,
  validatePolicyLimitsForCoverage,
} from "@/lib/policy-coverage";
import { type TrackerEntry, type TrackerUpdateInput } from "@/lib/types";

type Props = {
  tracker: TrackerEntry;
  actorContactId?: string | null;
  compact?: boolean;
  onPatch: (patch: TrackerUpdateInput) => void | Promise<void>;
};

export function PolicyCoverageFields({ tracker, actorContactId, compact, onPatch }: Props) {
  const status = tracker.policyCoverage;
  const readOnlyLimits = policyLimitsAreReadOnly(status);
  const amountLabel = policyLimitsAmountLabel(status);
  const due = isPolicyCoverageValidationDue(tracker);
  const limitsError = validatePolicyLimitsForCoverage(status, tracker.policyLimits);
  const [limitsDraft, setLimitsDraft] = useState(
    tracker.policyLimits == null ? "" : String(tracker.policyLimits),
  );

  useEffect(() => {
    setLimitsDraft(tracker.policyLimits == null ? "" : String(tracker.policyLimits));
  }, [tracker.policyLimits]);

  async function onCoverageChange(next: string) {
    if (!next) {
      await onPatch({
        policyCoverage: null,
        policyCoverageNeedsClassification: tracker.policyLimits != null,
        policyCoverageValidatedAt: null,
        policyCoverageValidatedBy: null,
        policyCoverageNextDueAt: null,
      });
      return;
    }
    if (!isPolicyCoverageStatus(next)) return;
    await onPatch(
      buildPolicyCoverageChangePatch({
        status: next,
        current: tracker,
        actorContactId,
      }),
    );
  }

  async function onLimitsChange(value: number | null) {
    if (readOnlyLimits) return;
    const nextStatus = status;
    const error = validatePolicyLimitsForCoverage(nextStatus, value);
    if (nextStatus === "limits_confirmed" && error) {
      await onPatch({ policyLimits: value });
      return;
    }
    await onPatch({ policyLimits: value });
  }

  async function confirmValidation() {
    if (!status) return;
    await onPatch(
      buildPolicyCoverageConfirmPatch({
        status,
        actorContactId,
        notes: tracker.policyVerificationNotes,
      }),
    );
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {tracker.policyCoverageNeedsClassification ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
          Legacy policy amount on file — classify Policy Coverage (amount preserved).
        </p>
      ) : null}
      {due && status && (status === "pending" || status === "coverage_exists") ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
          Revalidation due
          {tracker.policyCoverageNextDueAt ? ` (since ${tracker.policyCoverageNextDueAt})` : ""}. Confirm or update
          coverage — viewing the case does not reset the clock.
        </p>
      ) : null}

      <label className="block space-y-1 text-sm">
        <span className="font-medium">Policy Coverage</span>
        <Select
          value={status ?? ""}
          onChange={(event) => void onCoverageChange(event.target.value)}
        >
          <option value="">Select coverage…</option>
          {POLICY_COVERAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>

      <label className="block space-y-1 text-sm">
        <span className="font-medium">Policy Limits ($)</span>
        <Input
          inputMode="decimal"
          value={limitsDraft}
          disabled={readOnlyLimits || !status}
          onChange={(event) => setLimitsDraft(event.target.value)}
          onBlur={() => {
            const trimmed = limitsDraft.trim();
            if (!trimmed) {
              void onLimitsChange(null);
              return;
            }
            const parsed = Number(trimmed.replace(/,/g, ""));
            if (Number.isFinite(parsed)) void onLimitsChange(parsed);
            else setLimitsDraft(tracker.policyLimits == null ? "" : String(tracker.policyLimits));
          }}
        />
        {amountLabel ? <span className="block text-xs text-muted-foreground">{amountLabel}</span> : null}
        {limitsError ? <span className="block text-xs text-rose-700">{limitsError}</span> : null}
      </label>

      {!compact ? (
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Verification notes (optional)</span>
          <Input
            value={tracker.policyVerificationNotes ?? ""}
            placeholder="Declarations page, affidavit, carrier email…"
            onChange={(event) =>
              void onPatch({ policyVerificationNotes: event.target.value || null })
            }
          />
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          Status: <strong className="text-navy-950">{policyCoverageLabel(status)}</strong>
        </span>
        {tracker.policyCoverageValidatedAt ? (
          <span>Last validated {tracker.policyCoverageValidatedAt.slice(0, 10)}</span>
        ) : null}
        {tracker.policyCoverageNextDueAt ? <span>Next due {tracker.policyCoverageNextDueAt}</span> : null}
        {status === "pending" || status === "coverage_exists" ? (
          <Button type="button" size="sm" variant="outline" onClick={() => void confirmValidation()}>
            Confirm coverage still accurate
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export type { PolicyCoverageStatus };
