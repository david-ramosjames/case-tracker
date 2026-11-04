export type NeedsResponseChannel = "call" | "sms" | "both";
export type NeedsResponseReasonCode = "missed_call" | "sona" | "callback" | "sms" | "other";
export type NeedsResponseStatus = "open" | "resolved" | "dismissed";

export type NeedsResponseRow = {
  id: string;
  caseNumber: string;
  caseId: string | null;
  clientName: string;
  phone: string | null;
  channel: NeedsResponseChannel;
  reason: string;
  reasonCode: NeedsResponseReasonCode;
  status: NeedsResponseStatus;
  detectedAt: string;
  reportWindowLabel: string | null;
  attorneyId?: string | null;
  attorneyName: string | null;
  paralegalName: string | null;
  quoLine: string | null;
  evidenceUrl: string | null;
  details: string | null;
  eventKey: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  /** Prefer report Quo link; page may fall back to case conversation URL. */
  quoUrl?: string | null;
  slackUrl?: string | null;
  slackLabel?: string | null;
};

export function reasonCodeLabel(code: NeedsResponseReasonCode) {
  if (code === "missed_call") return "Missed call";
  if (code === "sona") return "Sona / AI";
  if (code === "callback") return "Callback owed";
  if (code === "sms") return "Text needs reply";
  return "Needs response";
}
