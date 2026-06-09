"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Save, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { attorneyFieldShellClass } from "@/components/cases/attorney-field-hint";
import {
  ATTORNEY_SOURCED_FIELDS,
  getAttorneySourcedFieldStatus,
  type AttorneyFieldStatus,
  type AttorneySourcedFieldId,
} from "@/lib/attorney-sourced-fields";
import { LIABILITY_OPTIONS } from "@/lib/case-options";
import type { CaseRecord, TrackerEntry } from "@/lib/types";
import { formatDate } from "@/lib/utils";

function statusBadge(status: AttorneyFieldStatus) {
  if (status === "current") return <Badge variant="success">Current</Badge>;
  if (status === "stale") return <Badge variant="danger">90-day review</Badge>;
  return <Badge variant="warning">Missing</Badge>;
}

export function AttorneyFieldsChecklist({
  record,
  quarterOptions,
  onUpdateField,
  onMinimumValueChange,
  onSave,
  isSaving,
  savedAt,
  errorMessage,
}: {
  record: CaseRecord;
  quarterOptions: string[];
  onUpdateField: <K extends keyof TrackerEntry>(key: K, value: TrackerEntry[K]) => void;
  onMinimumValueChange: (value: number | null) => void;
  onSave: () => void;
  isSaving: boolean;
  savedAt: string | null;
  errorMessage: string | null;
}) {
  const staleCount = ATTORNEY_SOURCED_FIELDS.filter((field) => getAttorneySourcedFieldStatus(record, field.id) === "stale").length;
  const missingCount = ATTORNEY_SOURCED_FIELDS.filter((field) => getAttorneySourcedFieldStatus(record, field.id) === "missing").length;

  return (
    <Card className="border-amber-200/80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <UserRound className="h-5 w-5 text-amber-700" />
          Your input
        </CardTitle>
        <CardDescription>
          These fields come from you, not DocketFlow. Fields marked with 90-day review are confirmed via Slack or saved in the tracker.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {staleCount > 0 || missingCount > 0 ? (
          <p className="text-sm text-amber-900">
            {missingCount > 0 ? `${missingCount} missing` : null}
            {missingCount > 0 && staleCount > 0 ? " · " : null}
            {staleCount > 0 ? `${staleCount} need 90-day review` : null}
          </p>
        ) : (
          <p className="text-sm text-emerald-700">All attorney fields are current.</p>
        )}

        {ATTORNEY_SOURCED_FIELDS.map((field) => (
          <div key={field.id} className={attorneyFieldShellClass(field.id, record)}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-navy-950">{field.label}</p>
                <p className="text-xs text-muted-foreground">
                  {field.reviewKind === "validation_90d"
                    ? "90-day review"
                    : field.id === "referralFee"
                      ? "Set once"
                      : "Optional"}
                </p>
              </div>
              {statusBadge(getAttorneySourcedFieldStatus(record, field.id))}
            </div>
            <AttorneyFieldInput
              fieldId={field.id}
              record={record}
              quarterOptions={quarterOptions}
              onUpdateField={onUpdateField}
              onMinimumValueChange={onMinimumValueChange}
            />
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" onClick={onSave} disabled={isSaving}>
            <Save className="h-4 w-4" />
            {isSaving ? "Saving..." : "Save"}
          </Button>
          {savedAt ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved {formatDate(savedAt)}
            </span>
          ) : null}
          {errorMessage ? <span className="text-xs text-destructive">{errorMessage}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function AttorneyFieldInput({
  fieldId,
  record,
  quarterOptions,
  onUpdateField,
  onMinimumValueChange,
}: {
  fieldId: AttorneySourcedFieldId;
  record: CaseRecord;
  quarterOptions: string[];
  onUpdateField: <K extends keyof TrackerEntry>(key: K, value: TrackerEntry[K]) => void;
  onMinimumValueChange: (value: number | null) => void;
}) {
  const { tracker } = record;

  switch (fieldId) {
    case "liability":
      return (
        <Select
          className="h-9 text-sm"
          value={tracker.liability ?? ""}
          onChange={(event) => onUpdateField("liability", event.target.value || null)}
        >
          <option value="">Select liability</option>
          {LIABILITY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    case "targetResolutionQuarter":
      return (
        <Select
          className="h-9 text-sm"
          value={tracker.targetResolutionQuarter ?? ""}
          onChange={(event) => onUpdateField("targetResolutionQuarter", event.target.value || null)}
        >
          <option value="">Select quarter</option>
          {quarterOptions.map((quarter) => (
            <option key={quarter} value={quarter}>
              {quarter}
            </option>
          ))}
        </Select>
      );
    case "minimumValue":
      return <CompactFormattedNumberInput prefix="$" value={tracker.minimumValue} onValueChange={onMinimumValueChange} />;
    case "referralFee":
      return (
        <CompactFormattedNumberInput
          suffix="%"
          value={tracker.referralFee}
          onValueChange={(value) => onUpdateField("referralFee", value)}
        />
      );
    case "policyLimits":
      return (
        <CompactFormattedNumberInput
          prefix="$"
          value={tracker.policyLimits}
          onValueChange={(value) => onUpdateField("policyLimits", value)}
        />
      );
    case "sources":
      return (
        <Textarea
          className="min-h-[72px] text-sm"
          value={tracker.sources}
          placeholder="Policy, medical, liability sources..."
          onChange={(event) => onUpdateField("sources", event.target.value)}
        />
      );
    case "injuries":
      return (
        <Textarea
          className="min-h-[72px] text-sm"
          value={tracker.injuries}
          placeholder="Injuries and treatment summary..."
          onChange={(event) => onUpdateField("injuries", event.target.value)}
        />
      );
    case "caseDescription":
      return (
        <Textarea
          className="min-h-[88px] text-sm"
          value={tracker.caseDescription}
          placeholder="Case description..."
          onChange={(event) => onUpdateField("caseDescription", event.target.value)}
        />
      );
    default:
      return null;
  }
}

function CompactFormattedNumberInput({
  value,
  onValueChange,
  prefix,
  suffix,
}: {
  value: number | null;
  onValueChange: (value: number | null) => void;
  prefix?: string;
  suffix?: string;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(value == null ? "" : formatNumberForInput(value));

  useEffect(() => {
    if (!isFocused) setDraft(value == null ? "" : formatNumberForInput(value));
  }, [isFocused, value]);

  function commit() {
    const nextValue = parseFormattedNumber(draft);
    if (nextValue !== null && Number.isNaN(nextValue)) {
      setDraft(value == null ? "" : formatNumberForInput(value));
      return;
    }
    onValueChange(nextValue);
    setDraft(nextValue == null ? "" : formatNumberForInput(nextValue));
    setIsFocused(false);
  }

  return (
    <div className="flex h-9 items-center rounded-md border border-input bg-white px-3 focus-within:ring-2 focus-within:ring-ring">
      {prefix ? <span className="mr-1 text-xs text-muted-foreground">{prefix}</span> : null}
      <Input
        className="h-7 min-w-0 border-0 bg-transparent px-0 py-0 text-sm shadow-none focus-visible:ring-0"
        inputMode="decimal"
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          setIsFocused(true);
          setDraft(value == null ? "" : String(value));
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(value == null ? "" : formatNumberForInput(value));
            setIsFocused(false);
            event.currentTarget.blur();
          }
        }}
      />
      {suffix ? <span className="ml-1 text-xs text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

function formatNumberForInput(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function parseFormattedNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number(trimmed.replace(/[$,%\s,]/g, ""));
}
