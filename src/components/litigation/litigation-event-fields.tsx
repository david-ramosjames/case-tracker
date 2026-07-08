"use client";

import { ResultDateInput } from "@/components/cases/result-date-input";
import { type LitigationEventKey, type LitigationEventStatus, type LitigationEvents } from "@/lib/types";
import { Select } from "@/components/ui/select";
import { LITIGATION_EVENT_STATUS_OPTIONS } from "@/lib/litigation-events";
import { formatOptionalDate } from "@/lib/utils";

export function LitigationEventDateInput({
  value,
  readOnly,
  onChange,
}: {
  value: string | null;
  readOnly?: boolean;
  onChange?: (value: string | null) => void;
}) {
  if (readOnly) {
    return <span className="text-sm text-navy-950">{formatOptionalDate(value)}</span>;
  }

  return (
    <ResultDateInput
      value={value}
      onCommit={(next) => onChange?.(next)}
    />
  );
}

export function LitigationEventStatusSelect({
  value,
  readOnly,
  onChange,
}: {
  value: LitigationEventStatus | null;
  readOnly?: boolean;
  onChange?: (value: LitigationEventStatus | null) => void;
}) {
  if (readOnly) {
    return <span className="text-sm text-navy-950">{value ?? "—"}</span>;
  }

  return (
    <Select
      value={value ?? ""}
      className="h-9 min-w-[140px] text-sm"
      onChange={(event) => onChange?.((event.target.value || null) as LitigationEventStatus | null)}
    >
      <option value="">—</option>
      {LITIGATION_EVENT_STATUS_OPTIONS.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </Select>
  );
}

export function updateLitigationEvent(
  events: LitigationEvents,
  key: LitigationEventKey,
  patch: Partial<LitigationEvents[LitigationEventKey]>,
): LitigationEvents {
  return {
    ...events,
    [key]: {
      ...events[key],
      ...patch,
    },
  };
}
