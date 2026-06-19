"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { RESULTS_TAB_AMOUNT_RULES, RESULTS_TAB_VISIBILITY_RULES } from "@/lib/results-period";
import { cn } from "@/lib/utils";

export function ResultsTabRules() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-6 rounded-lg border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-navy-950"
        aria-expanded={open}
      >
        <span>How this table works</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="grid gap-6 border-t px-4 pb-4 pt-3 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-navy-950">What appears in this table</h3>
            <ul className="mt-2 list-inside list-disc space-y-1.5 text-sm text-muted-foreground">
              {RESULTS_TAB_VISIBILITY_RULES.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-950">Column amounts</h3>
            <ul className="mt-2 list-inside list-disc space-y-1.5 text-sm text-muted-foreground">
              {RESULTS_TAB_AMOUNT_RULES.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
