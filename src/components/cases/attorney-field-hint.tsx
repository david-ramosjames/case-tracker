import { UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  ATTORNEY_SOURCED_FIELD_BY_ID,
  getAttorneyFieldLastReviewedLabel,
  getAttorneySourcedFieldStatus,
  type AttorneySourcedFieldId,
} from "@/lib/attorney-sourced-fields";
import type { CaseRecord } from "@/lib/types";

export function AttorneyFieldLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-slate-50 px-4 py-3 text-sm text-muted-foreground">
      <span className="font-medium text-navy-950">Field sources</span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        From DocketFlow / system
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <UserRound className="h-3.5 w-3.5 text-amber-700" />
        Your input as attorney
      </span>
    </div>
  );
}

export function AttorneyFieldLabel({
  fieldId,
  record,
}: {
  fieldId: AttorneySourcedFieldId;
  record: CaseRecord;
}) {
  const meta = ATTORNEY_SOURCED_FIELD_BY_ID[fieldId];
  const status = getAttorneySourcedFieldStatus(record, fieldId);
  const reviewedLabel = getAttorneyFieldLastReviewedLabel(record, fieldId);

  return (
    <div className="mb-2 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-navy-950">{meta.label}</span>
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
          <UserRound className="mr-1 h-3 w-3" />
          Your input
        </Badge>
        {meta.reviewKind !== "none" ? (
          <Badge variant="outline" className="text-xs font-normal">
            90-day review
          </Badge>
        ) : null}
        {status === "missing" ? <Badge variant="warning">Missing</Badge> : null}
        {status === "stale" ? <Badge variant="danger">Confirm or update</Badge> : null}
        {status === "current" && meta.reviewKind !== "none" ? <Badge variant="success">Current</Badge> : null}
      </div>
      {reviewedLabel ? <p className="text-xs text-muted-foreground">{reviewedLabel}</p> : null}
      {meta.reviewKind === "sources_lit_90d" ? (
        <p className="text-xs text-muted-foreground">Confirm with quarterly check-in or by saving this section.</p>
      ) : null}
      {meta.reviewKind === "validation_90d" ? (
        <p className="text-xs text-muted-foreground">Save after confirming — stamps the 90-day validation.</p>
      ) : null}
    </div>
  );
}

export function attorneyFieldShellClass(fieldId: AttorneySourcedFieldId, record: CaseRecord) {
  const status = getAttorneySourcedFieldStatus(record, fieldId);
  const base = "rounded-lg border p-3 ";
  if (status === "stale" || status === "missing") {
    return `${base}border-amber-300 bg-amber-50/80`;
  }
  return `${base}border-amber-200/70 bg-amber-50/40`;
}
