import {
  CHECK_STATUS_OPTIONS,
  CLOSING_STATUS_OPTIONS,
  DISBURSED_STATUS_OPTIONS,
  REDUCTIONS_MANUAL_STATUS_OPTIONS,
  RELEASE_STATUS_OPTIONS,
} from "@/lib/case-options";
import { type DisbursementPlan } from "@/lib/types";

export const DISBURSEMENT_PLAN_OPTIONS = ["This Week", "Next Week", "2+ Weeks"] as const satisfies DisbursementPlan[];

export function coerceDisbursementPlan(value: string | null | undefined): DisbursementPlan {
  if (value === "This Week" || value === "Next Week" || value === "2+ Weeks") return value;
  return "2+ Weeks";
}

/** Days-since-settlement heat map for the Results disbursement meeting. */
export function daysSinceSettlementTone(days: number): "green" | "orange" | "red" {
  if (days > 30) return "red";
  if (days >= 23) return "orange";
  return "green";
}

export function daysSinceSettlementClass(days: number | null) {
  if (days == null) return "";
  const tone = daysSinceSettlementTone(days);
  if (tone === "red") return "bg-rose-100 font-semibold text-rose-800";
  if (tone === "orange") return "bg-amber-100 font-semibold text-amber-900";
  return "bg-emerald-100 font-medium text-emerald-900";
}

export function disbursementPlanClass(plan: DisbursementPlan) {
  if (plan === "This Week") return "bg-emerald-100 text-emerald-900";
  if (plan === "Next Week") return "bg-sky-100 text-sky-900";
  return "bg-slate-100 text-slate-700";
}

/**
 * Workflow dropdown fills: first = not started (red), last = complete (green), middle = in progress (blue).
 */
export function workflowOptionTone(options: readonly string[], value: string): "red" | "blue" | "green" {
  const index = options.indexOf(value);
  if (index <= 0) return "red";
  if (index >= options.length - 1) return "green";
  return "blue";
}

export function workflowSelectClass(options: readonly string[], value: string) {
  const tone = workflowOptionTone(options, value);
  if (tone === "red") return "border-rose-200 bg-rose-50 text-rose-900";
  if (tone === "green") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  return "border-sky-200 bg-sky-50 text-sky-900";
}

export const RESULTS_WORKFLOW_OPTION_SETS = {
  release: RELEASE_STATUS_OPTIONS,
  reductions: REDUCTIONS_MANUAL_STATUS_OPTIONS,
  check: CHECK_STATUS_OPTIONS,
  closing: CLOSING_STATUS_OPTIONS,
  disbursed: DISBURSED_STATUS_OPTIONS,
} as const;
