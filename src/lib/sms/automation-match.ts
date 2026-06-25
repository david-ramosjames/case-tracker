import { type SmsAutomation } from "@/lib/supabase/sms-automations";
import { type CaseRecord, type CaseStage } from "@/lib/types";
import { daysSince } from "@/lib/utils";

/** Closed pipeline stages commonly excluded from client SMS on transition. */
export const SMS_DEFAULT_EXCLUDED_TO_STAGES: CaseStage[] = ["Disengaged", "Terminated", "Referred"];

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

export function automationMatchesSigningDelay(automation: SmsAutomation, record: CaseRecord) {
  if (automation.delayDaysAfterSigning == null) return true;
  if (!record.shared.dateSigned?.trim()) return false;
  return daysSince(record.shared.dateSigned) >= automation.delayDaysAfterSigning;
}

export function automationMatchesStageChange(
  automation: SmsAutomation,
  record: CaseRecord,
  fromStage: CaseStage,
  toStage: CaseStage,
) {
  if (!automation.enabled) return false;
  if (!automationMatchesFromStage(automation, fromStage)) return false;
  if (!automationMatchesToStage(automation, toStage)) return false;
  if (automation.caseTypes.length > 0 && !automation.caseTypes.includes(record.shared.caseType)) return false;
  if (!automationMatchesAttorney(automation, record)) return false;
  if (!automationMatchesSigningDelay(automation, record)) return false;
  return true;
}
