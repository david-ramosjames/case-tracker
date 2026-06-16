"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { toDateInput } from "@/lib/date-input";

type ResultDateInputProps = {
  value: string | null;
  onCommit: (value: string | null) => void;
};

/** Date input that keeps a local draft so partial typing and calendar picks don't fight derived state. */
export function ResultDateInput({ value, onCommit }: ResultDateInputProps) {
  const [draft, setDraft] = useState(() => toDateInput(value));

  useEffect(() => {
    setDraft(toDateInput(value));
  }, [value]);

  return (
    <Input
      type="date"
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (!next) {
          onCommit(null);
          return;
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(next)) {
          onCommit(next);
        }
      }}
      onBlur={() => {
        if (!draft) {
          onCommit(null);
          return;
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(draft)) {
          onCommit(draft);
        } else {
          setDraft(toDateInput(value));
        }
      }}
    />
  );
}
