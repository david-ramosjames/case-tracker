import { type SmsAutomation } from "@/lib/supabase/sms-automations";
import { deriveCaseStatusFromTracker } from "@/lib/case-status";
import { type CaseRecord, type CaseStage } from "@/lib/types";
import { daysSince, hoursSince } from "@/lib/utils";

/** Closed pipeline stages commonly excluded from client SMS on transition. */
export const SMS_DEFAULT_EXCLUDED_TO_STAGES: CaseStage[] = ["Disengaged", "Terminated", "Referred"];

/** Same Active definition as the Cases table (stage + disbursement), not the legacy is_active flag. */
export function isSmsActivePipelineCase(record: CaseRecord) {
  return deriveCaseStatusFromTracker(record.tracker.caseStage, record.tracker.result) === "Active";
}

export function automationMatchesFromStage(automation: SmsAutomation, fromStage: CaseStage) {
  if (automation.fromStages.length > 0) {
    return automation.fromStages.includes(fromStage);
  }
  if (automation.fromStage === "any") return true;
  return automation.fromStage === fromStage;
}

export function automationMatchesToStage(automation: SmsAutomation, toStage: CaseStage) {
  if (automation.toStage === "any") {
    return !automation.excludedToStages.includes(toStage);
  }
  return automation.toStage === toStage;
}

export function automationMatchesAttorney(automation: SmsAutomation, record: CaseRecord) {
  if (automation.attorneyContactIds.length === 0) return true;
  return automation.attorneyContactIds.includes(record.shared.attorneyId);
}

/** Optional gate on stage-change automations at transition time. */
export function automationMatchesSigningDelay(automation: SmsAutomation, record: CaseRecord) {
  if (automation.delayDaysAfterSigning == null && automation.delayHoursAfterSigning == null) return true;
  if (!record.shared.dateSigned?.trim()) return false;
  if (automation.delayHoursAfterSigning != null) {
    return hoursSince(record.shared.dateSigned) >= automation.delayHoursAfterSigning;
  }
  if (automation.delayDaysAfterSigning != null) {
    return daysSince(record.shared.dateSigned) >= automation.delayDaysAfterSigning;
  }
  return true;
}

/** Required delay for time-in-stage automations (hours take precedence when set). */
export function automationMatchesTimeInStageDelay(automation: SmsAutomation, record: CaseRecord) {
  if (!record.shared.dateSigned?.trim()) return false;
  if (automation.delayHoursAfterSigning != null) {
    return hoursSince(record.shared.dateSigned) >= automation.delayHoursAfterSigning;
  }
  if (automation.delayDaysAfterSigning != null) {
    return daysSince(record.shared.dateSigned) >= automation.delayDaysAfterSigning;
  }
  return false;
}

export function automationMatchesStageChange(
  automation: SmsAutomation,
  record: CaseRecord,
  fromStage: CaseStage,
  toStage: CaseStage,
) {
  if (automation.triggerType !== "stage_change") return false;
  if (!automation.enabled) return false;
  if (!automationMatchesFromStage(automation, fromStage)) return false;
  if (!automationMatchesToStage(automation, toStage)) return false;
  if (automation.caseTypes.length > 0 && !automation.caseTypes.includes(record.shared.caseType)) return false;
  if (!automationMatchesAttorney(automation, record)) return false;
  if (!automationMatchesSigningDelay(automation, record)) return false;
  return true;
}

export function automationMatchesTimeInStage(automation: SmsAutomation, record: CaseRecord) {
  if (automation.triggerType !== "time_in_stage") return false;
  if (!automation.enabled) return false;
  if (!isSmsActivePipelineCase(record)) return false;
  if (automation.inStages.length === 0) return false;
  if (!automation.inStages.includes(record.tracker.caseStage)) return false;
  if (automation.caseTypes.length > 0 && !automation.caseTypes.includes(record.shared.caseType)) return false;
  if (!automationMatchesAttorney(automation, record)) return false;
  if (!automationMatchesTimeInStageDelay(automation, record)) return false;
  return true;
}

/** Manual attorney-departure (and similar) sends: active cases for a specific attorney. */
export function automationMatchesManualAttorney(
  automation: SmsAutomation,
  record: CaseRecord,
  attorneyContactId: string,
  options?: { requireEnabled?: boolean },
) {
  if (automation.triggerType !== "manual") return false;
  if (options?.requireEnabled !== false && !automation.enabled) return false;
  if (!isSmsActivePipelineCase(record)) return false;
  if (record.shared.attorneyId !== attorneyContactId) return false;
  if (automation.caseTypes.length > 0 && !automation.caseTypes.includes(record.shared.caseType)) return false;
  return true;
}
