import { DEFAULT_ATTORNEY_TARGETS, DEFAULT_PARALEGAL_TARGETS } from "@/lib/performance/scoring";
import { defaultFirmWeeklyTarget } from "@/lib/performance/firm-metrics";
import { type PerformanceTarget } from "@/lib/performance/types";

function coversDate(target: PerformanceTarget, onDate: string) {
  if (target.effectiveFrom > onDate) return false;
  if (target.effectiveTo && target.effectiveTo <= onDate) return false;
  return true;
}

/** Individual > role > firm. Falls back to workbook defaults for weekly activity. Client-safe. */
export function resolveTargetValue(input: {
  targets: PerformanceTarget[];
  metricKey: string;
  onDate: string;
  userId?: string | null;
  role?: string | null;
  periodGrain?: PerformanceTarget["periodGrain"];
}): number {
  const grain = input.periodGrain ?? "week";
  const matches = input.targets.filter(
    (t) => t.metricKey === input.metricKey && t.periodGrain === grain && coversDate(t, input.onDate),
  );
  const userHit = input.userId
    ? matches.find((t) => t.scope === "user" && t.scopeUserId === input.userId)
    : undefined;
  if (userHit) return userHit.targetValue;
  const roleHit = input.role
    ? matches.find((t) => t.scope === "role" && t.scopeRole === input.role)
    : undefined;
  if (roleHit) return roleHit.targetValue;
  const firmHit = matches.find((t) => t.scope === "firm");
  if (firmHit) return firmHit.targetValue;

  if (grain === "week") {
    if (input.role === "paralegal" || input.role === "paralegal_manager" || input.role === "legal_assistant") {
      if (input.metricKey in DEFAULT_PARALEGAL_TARGETS) {
        return DEFAULT_PARALEGAL_TARGETS[input.metricKey as keyof typeof DEFAULT_PARALEGAL_TARGETS];
      }
    }
    if (input.role === "attorney") {
      if (input.metricKey in DEFAULT_ATTORNEY_TARGETS) {
        return DEFAULT_ATTORNEY_TARGETS[input.metricKey as keyof typeof DEFAULT_ATTORNEY_TARGETS];
      }
    }
    const firmDefault = defaultFirmWeeklyTarget(input.metricKey);
    if (firmDefault > 0) return firmDefault;
  }
  return 0;
}
