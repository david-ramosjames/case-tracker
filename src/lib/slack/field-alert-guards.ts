import { type CaseRecord, type CaseTrackerSettings } from "@/lib/types";
import { daysSince } from "@/lib/utils";

export const DEFAULT_SLACK_FIELD_ALERT_GRACE_DAYS = 7;

function getCaseStartDate(record: CaseRecord) {
  return record.shared.dateSigned?.trim() || record.shared.createdAt;
}

export function isWithinSlackFieldAlertGracePeriod(
  record: CaseRecord,
  graceDays = DEFAULT_SLACK_FIELD_ALERT_GRACE_DAYS,
) {
  const startDate = getCaseStartDate(record);
  if (!startDate) return false;
  return daysSince(startDate) < graceDays;
}

export function attorneyReceivesSlackFieldAlerts(
  attorneyId: string,
  settings: Pick<CaseTrackerSettings, "attorneySlackFieldAlertsDisabled">,
) {
  return !settings.attorneySlackFieldAlertsDisabled.includes(attorneyId);
}

export function getSlackFieldAlertSkipReason(
  record: CaseRecord,
  settings: Pick<
    CaseTrackerSettings,
    "slackFieldAlertGraceDays" | "attorneySlackFieldAlertsDisabled"
  >,
): string | null {
  if (!attorneyReceivesSlackFieldAlerts(record.shared.attorneyId, settings)) {
    return "attorney field alerts disabled";
  }

  if (isWithinSlackFieldAlertGracePeriod(record, settings.slackFieldAlertGraceDays)) {
    return `within first ${settings.slackFieldAlertGraceDays} days`;
  }

  return null;
}
