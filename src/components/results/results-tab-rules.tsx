import { RESULTS_TAB_AMOUNT_RULES, RESULTS_TAB_VISIBILITY_RULES } from "@/lib/results-period";

export function ResultsTabRules({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="space-y-2 text-xs text-muted-foreground">
        <p className="font-medium text-navy-950">What appears in this table</p>
        <ul className="list-inside list-disc space-y-1">
          {RESULTS_TAB_VISIBILITY_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <p className="font-medium text-navy-950">Column amounts</p>
        <ul className="list-inside list-disc space-y-1">
          {RESULTS_TAB_AMOUNT_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="grid gap-6 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
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
  );
}
