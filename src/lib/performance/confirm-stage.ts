import {
  buildStagePatchFromConfirmation,
  isPulseStageRegression,
} from "@/lib/stage-triggers";
import { type PerformanceDeliverableType } from "@/lib/performance/types";
import { type CaseRecord, type CaseStage } from "@/lib/types";

/** Performance confirmations that may advance Case Tracker stage. */
export function targetStageForProgressConfirm(
  deliverableType: PerformanceDeliverableType,
): CaseStage | null {
  if (deliverableType === "demand_sent") return "Dmd";
  if (deliverableType === "lawsuit_filed") return "Lit";
  if (deliverableType === "disengagement") return "Disengaged";
  return null;
}

/**
 * Whether confirming a demand / lawsuit / disengagement should write Case Tracker stage.
 * - Already at target → no
 * - Settled → never (would be a backward move for these confirms)
 * - Target earlier than current (e.g. Lit → Demand) → no
 */
export function shouldUpdateCaseStageOnProgressConfirm(
  currentStage: CaseStage,
  targetStage: CaseStage,
): boolean {
  if (currentStage === targetStage) return false;
  if (currentStage === "Settled") return false;
  if (isPulseStageRegression(currentStage, targetStage)) return false;
  return true;
}

export function stagePatchForProgressConfirm(record: CaseRecord, targetStage: CaseStage) {
  return buildStagePatchFromConfirmation(record, targetStage);
}
