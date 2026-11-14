export const PERFORMANCE_DELIVERABLE_TYPES = [
  "demand_sent",
  "lawsuit_filed",
  "discovery_responses",
  "lit_event_scheduled",
  "deposition",
  "mediation",
  "hearing",
  "hearing_trial",
  "aso",
  "settlement",
  "disbursement",
  "medicals",
  "disengagement",
  "other",
] as const;

export type PerformanceDeliverableType = (typeof PERFORMANCE_DELIVERABLE_TYPES)[number];

export type PerformanceWorkflowStatus = "backlog" | "committed" | "done" | "cancelled";

export type CommitmentOutcome = "promised" | "completed" | "missed" | "cancelled" | "moved";

export type SnapshotKind = "monday_plan" | "week_close_actuals" | "prior_week_actuals_at_monday";

export type PerformanceDeliverable = {
  id: string;
  caseId: string | null;
  caseNumber: string;
  clientNameSnapshot: string | null;
  deliverableType: PerformanceDeliverableType;
  identityKey: string;
  identityLabel: string | null;
  attorneyUserId: string | null;
  assigneeUserId: string | null;
  identifiedAt: string;
  identifiedBy: string | null;
  workflowStatus: PerformanceWorkflowStatus;
  requestedCompletionDate: string | null;
  plannedDate: string | null;
  completedAt: string | null;
  completionSource: "manual" | "confirmed_event" | "system" | null;
  rescheduleCount: number;
  litPersonName: string | null;
  hearingType: string | null;
  documentLabel: string | null;
  roundNumber: number | null;
  recipientLabel: string | null;
  docketEventId: string | null;
  notes: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PerformanceCommitment = {
  id: string;
  deliverableId: string;
  weekStart: string;
  committedBy: string | null;
  committedAt: string;
  plannedDate: string | null;
  outcome: CommitmentOutcome;
  movedToWeekStart: string | null;
  mondaySnapshotId: string | null;
  cancelReason: string | null;
};

export type PerformanceDeliverableEvent = {
  id: string;
  deliverableId: string;
  commitmentId: string | null;
  actorUserId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type PerformanceTarget = {
  id: string;
  metricKey: string;
  periodGrain: "week" | "month" | "quarter";
  targetValue: number;
  scope: "firm" | "role" | "user";
  scopeRole: string | null;
  scopeUserId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
};

export type PerformanceAssumptions = {
  id: string;
  settlementToDisburseLagDays: number;
  agingTargetDays: number;
  agingWarnDays: number;
  updatedAt: string;
};

export type CreateDeliverableInput = {
  caseId?: string | null;
  caseNumber: string;
  clientNameSnapshot?: string | null;
  deliverableType: PerformanceDeliverableType;
  attorneyUserId?: string | null;
  assigneeUserId?: string | null;
  identifiedBy?: string | null;
  requestedCompletionDate?: string | null;
  litPersonName?: string | null;
  hearingType?: string | null;
  documentLabel?: string | null;
  roundNumber?: number | null;
  recipientLabel?: string | null;
  docketEventId?: string | null;
  identityKey?: string | null;
  identityLabel?: string | null;
  notes?: string | null;
};

export type PerformancePair = {
  id: string;
  attorneyContactId: string | null;
  paralegalContactId: string | null;
  attorneyLabel: string | null;
  paralegalLabel: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export const ATTORNEY_PLAN_KINDS = ["lit_event", "lawsuit", "settlement"] as const;
export type AttorneyPlanKind = (typeof ATTORNEY_PLAN_KINDS)[number];

export type AttorneyPlanLine = {
  id: string;
  attorneyContactId: string;
  weekStart: string;
  kind: AttorneyPlanKind;
  caseId: string | null;
  caseNumber: string | null;
  label: string;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export const DELIVERABLE_TYPE_LABELS: Record<PerformanceDeliverableType, string> = {
  demand_sent: "Demand Sent",
  lawsuit_filed: "Lawsuit Filed",
  discovery_responses: "Discovery Responses",
  lit_event_scheduled: "Litigation Event",
  deposition: "Deposition",
  mediation: "Mediation",
  hearing: "Hearing",
  hearing_trial: "Hearing/Trial",
  aso: "ASO",
  settlement: "Settlement",
  disbursement: "Disbursement",
  medicals: "Medicals",
  disengagement: "Disengagement",
  other: "Other",
};
