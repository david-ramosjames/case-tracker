"use client";

import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type HeaderFilterOption = { value: string; label: string };

export function HeaderFilter({
  label,
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: HeaderFilterOption[];
  className?: string;
  ariaLabel?: string;
}) {
  const isActive = value !== "all";

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className={cn("text-[10px] font-semibold uppercase tracking-wide", isActive ? "text-pink-600" : "text-muted-foreground")}>
        {label}
      </span>
      <Select
        className={cn("h-8 min-w-0 text-xs", isActive && "border-pink-300 bg-pink-50/50")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel ?? `Filter by ${label}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function HeaderMultiFilter({
  label,
  selected,
  onChange,
  options,
  className,
}: {
  label: string;
  selected: string[];
  onChange: (values: string[]) => void;
  options: HeaderFilterOption[];
  className?: string;
}) {
  const isActive = selected.length > 0;
  const summaryLabel = !isActive
    ? "All"
    : selected.length === 1
      ? (options.find((option) => option.value === selected[0])?.label ?? "1 selected")
      : `${selected.length} selected`;

  function toggleValue(value: string, checked: boolean) {
    if (checked) {
      onChange([...selected, value]);
      return;
    }
    onChange(selected.filter((item) => item !== value));
  }

  return (
    <div className={cn("relative min-w-0", className)}>
      <span className={cn("text-[10px] font-semibold uppercase tracking-wide", isActive ? "text-pink-600" : "text-muted-foreground")}>
        {label}
      </span>
      <details className="group mt-1">
        <summary
          className={cn(
            "flex h-8 cursor-pointer list-none items-center justify-between rounded-md border bg-white px-2 text-xs",
            isActive && "border-pink-300 bg-pink-50/50",
          )}
        >
          <span className="truncate">{summaryLabel}</span>
          <span className="ml-2 text-muted-foreground">▾</span>
        </summary>
        <div className="absolute left-0 top-full z-50 mt-1 max-h-56 min-w-[12rem] overflow-y-auto rounded-md border bg-white p-2 shadow-lg">
          {options.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={selected.includes(option.value)}
                onChange={(event) => toggleValue(option.value, event.target.checked)}
              />
              <span className="truncate">{option.label}</span>
            </label>
          ))}
          {isActive ? (
            <button
              type="button"
              className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-pink-600 hover:bg-pink-50"
              onClick={() => onChange([])}
            >
              Clear selection
            </button>
          ) : null}
        </div>
      </details>
    </div>
  );
}
