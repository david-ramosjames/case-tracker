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
