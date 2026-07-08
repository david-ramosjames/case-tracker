export type UserRole = "attorney" | "paralegal" | "manager" | "admin" | "super_admin";

export type CaseStage =
  | "Lit"
  | "Txt"
  | "Dmd"
  | "Settled"
  | "Onboarding"
  | "Disengaged"
  | "Referred"
  | "Terminated";

export type CaseStatus = "Active" | "Closed";

export type ConfidenceLevel = "Low" | "Medium" | "High";

export type ExpectedLitigationStatus = "Pre" | "Lit" | "Expect";

export type StageSignalSource = "slack" | "workflow" | "matter_update" | "manual" | "pulse" | "sheet";

export type ReleaseStatus = "No" | "Signed";
export type ClosingStatus = "No" | "Drafted" | "Approved" | "Signed";
export type CheckStatus = "Deposited" | "No" | "Sent";
export type DisbursedStatus = "No" | "Yes";
export type ReductionsStatus = "Not Complete" | "To Be Sent" | "Sent, Not Approved" | "Approved";

export type LitigationEventStatus = "To Schedule" | "Scheduled" | "Complete";

export type LitigationEventKey = "plaintiffDeposition" | "defendantDeposition" | "mediation" | "trial";

export type LitigationEvent = {
  date: string | null;
  status: LitigationEventStatus | null;
};

export type LitigationEvents = Record<LitigationEventKey, LitigationEvent>;

export type StageSuggestion = {
  id: string;
  source: StageSignalSource;
  suggestedStage: CaseStage;
  suggestedExpectedLitigation: ExpectedLitigationStatus;
  confidence: ConfidenceLevel;
  excerpt: string;
  detectedAt: string;
  confirmedAt: string | null;
  dismissedAt: string | null;
  slackChannelId: string | null;
  slackConfirmationThreadTs: string | null;
  confirmationPostedAt: string | null;
  metadata?: Record<string, unknown>;
};

export type CommentType =
  | "attorney_update"
  | "manager_note"
  | "risk_flag"
  | "value_change"
  | "general_note";

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarInitials: string;
  active: boolean;
};

export type SharedCase = {
  id: string;
  caseNumber: string;
  clientName: string;
  attorneyId: string;
  paralegalId: string;
  status: CaseStatus;
  caseType: string;
  dateSigned: string;
  dateOfIncident: string | null;
  preferredLanguage: "en" | "es";
  createdAt: string;
  updatedAt: string;
};

/** One disbursement party within a case (e.g. minor on a parent case). Shares case # and tracker fields; settlement/disburse differ. */
export type CaseDisbursement = {
  id: string;
  /** Party on the disbursing sheet (column D) — may differ from the firm primary client. */
  partyLabel: string | null;
  disburseDate: string | null;
  settlementDate: string | null;
  settlementAmount: number | null;
  attorneyFees: number | null;
  weight: number;
  /** From sheet column B: non-blank while still waiting to disburse. */
  pendingRemaining: boolean;
  /** Null when entered manually in the tracker (not synced from the disbursing sheet). */
  sheetRowKey: string | null;
  /** When true, sheet import will not overwrite disburse_date for this row. */
  disburseDateLocked: boolean;
  /** When true, sheet import will not overwrite settlement_date for this row. */
  settlementDateLocked: boolean;
  syncedAt: string | null;
};

/** Correct dates on a sheet-linked party without sheet sync overwriting them. */
export type DisbursementPartyOverrideInput = {
  id: string;
  disburseDate?: string | null;
  settlementDate?: string | null;
  pendingRemaining?: boolean;
  disburseDateLocked?: boolean;
  settlementDateLocked?: boolean;
};

/** Backfill disbursement party not on the RJL disbursing sheet — preserved across sheet sync. */
export type ManualDisbursementInput = {
  id?: string;
  partyLabel: string | null;
  settlementDate: string | null;
  disburseDate: string | null;
  settlementAmount: number | null;
  attorneyFees: number | null;
  pendingRemaining?: boolean;
};

export type SettlementResult = {
  settlementDate: string | null;
  settlementAmount: number | null;
  feePercent: number | null;
  attorneyFees: number | null;
  releaseStatus: ReleaseStatus;
  closingStatus: ClosingStatus;
  checkStatus: CheckStatus;
  disbursedStatus: DisbursedStatus;
  reductionsStatus: ReductionsStatus;
  releaseSignedAt: string | null;
  closingSignedAt: string | null;
  checkDepositedAt: string | null;
  checkDisbursedAt: string | null;
  disburseDate: string | null;
  resultQuarter: string | null;
  /** When true, amounts/dates came from CSV financial backfill — sheet sync skips this case. */
  financialBackfillLocked?: boolean;
};

export type TrackerEntry = {
  id: string;
  caseId: string;
  caseStage: CaseStage;
  estimatedSettlementValue: number | null;
  estimatedFeeValue: number | null;
  targetResolutionQuarter: string | null;
  confidenceLevel: ConfidenceLevel | null;
  sourceOfEstimate: string | null;
  liability: string | null;
  caseSize: string | null;
  minimumValue: number | null;
  referralFee: number | null;
  referralFeeArrangement: string | null;
  balanceCtaInfo: string | null;
  policyLimits: number | null;
  policyInfoSource: string | null;
  expectedLitigation: ExpectedLitigationStatus | null;
  sources: string;
  litEventsNeeded: string;
  litEventsTimeline: string;
  litigationEvents: LitigationEvents;
  injuries: string;
  caseDescription: string;
  statusNotes: string;
  gvNotes: string;
  lrjNotes: string;
  result: SettlementResult;
  /** Opt-in: most cases stay single-disbursement (default false). */
  multipleDisbursementsEnabled: boolean;
  expectedDisbursementCount: number;
  disbursements: CaseDisbursement[];
  lastQuarterlyCheckInAt: string | null;
  lastSourcesLitUpdatedAt: string | null;
  lastSlackReminderAt: string | null;
  slackReminderThreadTs: string | null;
  detectedStageSignals: StageSuggestion[];
  forecastNotes: string;
  attorneyNotes: string;
  managerNotes: string;
  lastReviewedAt: string | null;
  liabilityValidatedAt: string | null;
  targetResolutionQuarterValidatedAt: string | null;
  minimumValueValidatedAt: string | null;
  policyLimitsValidatedAt: string | null;
  expectedLitigationValidatedAt: string | null;
  hasEverBeenLitigation: boolean;
  isActive: boolean;
  settledAmount: number | null;
  disbursedAmount: number | null;
  actualFeeValue: number | null;
  clientPhone: string | null;
  quoContactId: string | null;
  quoConversationId: string | null;
  quoPhoneNumberId: string | null;
  quoContacts: CaseQuoContact[];
  updatedAt: string;
};

export type CaseQuoContact = {
  id: string;
  quoContactId: string;
  displayName: string;
  phone: string | null;
  quoConversationId: string | null;
  quoPhoneNumberId: string | null;
  smsEnabled: boolean;
};

export type CaseSlackChannel = {
  caseNumber: string;
  slackChannelId: string | null;
  slackChannelName: string;
  topicStage: string | null;
  syncedAt: string;
  updatedAt: string;
};

export type SlackReminderReason =
  | "quarterly_review"
  | "missing_quarter"
  | "missing_minimum_value"
  | "sources_lit_stale"
  | "missing_fields"
  | "validation_stale";

export type FieldReminderKey =
  | "liability"
  | "targetResolutionQuarter"
  | "minimumValue"
  | "policyLimits"
  | "expectedLitigation";

export type CaseRecord = {
  shared: SharedCase;
  tracker: TrackerEntry;
  attorney: AppUser;
  paralegal: AppUser;
};

export type TrackerComment = {
  id: string;
  caseId: string;
  authorId: string;
  authorName: string;
  type: CommentType;
  body: string;
  createdAt: string;
};

export type ActivityLogEntry = {
  id: string;
  caseId: string;
  userId: string;
  userName: string;
  action: string;
  description: string;
  createdAt: string;
};

export type GoalScope = "attorney" | "firm";

export type AttorneyGoal = {
  id: string;
  attorneyId: string;
  goalScope: GoalScope;
  year: number;
  /** Top-down target for gross disbursement dollars in the commission year. */
  annualGrossGoal: number;
  /** Top-down target for RJL attorney fees disbursed in the commission year. */
  annualRjlFeesGoal: number;
  /** RJL attorney fees disbursed must exceed this before commissions are earned. */
  commissionThreshold: number;
  commissionYearStartMonth: number;
  commissionMonthCount: number;
  monthlyGoals: Record<string, number>;
  monthlyFeeGoals: Record<string, number>;
  /** Calendar-year-only monthly targets outside the commission period. */
  calendarPlugGoals: Record<string, number>;
  calendarPlugFeeGoals: Record<string, number>;
  q1Goal: number;
  q2Goal: number;
  q3Goal: number;
  q4Goal: number;
  feeQ1Goal: number;
  feeQ2Goal: number;
  feeQ3Goal: number;
  feeQ4Goal: number;
};

export type CaseCompletionLevel = "complete" | "good" | "attention" | "critical";

export type CaseCompletionScore = {
  percent: number;
  level: CaseCompletionLevel;
  completed: number;
  total: number;
};

export type CaseTrackerSettings = {
  staleReviewThresholdDays: number;
  requiredFields: Array<keyof TrackerEntry>;
  stages: CaseStage[];
  confidenceLevels: ConfidenceLevel[];
  paralegalLimitedEditEnabled: boolean;
  quarterlyReviewThresholdDays: number;
  oneTimeRequiredFields: Array<keyof TrackerEntry | keyof SharedCase>;
  quarterlyRequiredFields: Array<keyof TrackerEntry>;
  expectedLitigationStatuses: ExpectedLitigationStatus[];
};

export type CaseTrackerSnapshot = {
  id: string;
  quarter: string;
  capturedAt: string;
  capturedBy: string;
  entries: TrackerEntry[];
};

export type CaseBackfillImportResult = {
  totalRows: number;
  matched: number;
  updated: number;
  skipped: number;
  unmatched: string[];
  unlinked: string[];
  failed: Array<{ caseNumber: string; message: string }>;
  preview: Array<{ caseNumber: string; matched: boolean; fieldCount: number }>;
  dryRun: boolean;
};

export type TrackerUpdateInput = Partial<
  Pick<
    TrackerEntry,
    | "caseStage"
    | "estimatedSettlementValue"
    | "estimatedFeeValue"
    | "targetResolutionQuarter"
    | "confidenceLevel"
    | "sourceOfEstimate"
    | "liability"
    | "caseSize"
    | "minimumValue"
    | "referralFee"
    | "referralFeeArrangement"
    | "balanceCtaInfo"
    | "policyLimits"
    | "policyInfoSource"
    | "expectedLitigation"
    | "sources"
    | "injuries"
    | "caseDescription"
    | "statusNotes"
    | "gvNotes"
    | "lrjNotes"
    | "lastQuarterlyCheckInAt"
    | "lastSourcesLitUpdatedAt"
    | "forecastNotes"
    | "expectedDisbursementCount"
    | "multipleDisbursementsEnabled"
    | "clientPhone"
    | "litigationEvents"
  >
> & {
  quoContactPreferences?: Array<{ id: string; smsEnabled: boolean }>;
};

/** Upcoming row from shared DocketFlow `case_events` (read-only in the tracker). */
export type DocketFlowScheduledEvent = {
  id: string;
  caseId: string;
  title: string;
  date: string;
  deadlineEndDate: string | null;
  startDateTime: string | null;
  endDateTime: string | null;
  category: string | null;
  eventKind: string | null;
  scheduleKind: "deadline" | "meeting";
  included: boolean;
  completed: boolean;
  calendarOrigin: "docketflow" | "google_ics_mirror";
};

export type DataQualityFlag = {
  id: string;
  label: string;
  severity: "warning" | "danger";
};

export type DashboardMetrics = {
  totalActiveCases: number;
  totalForecastSettlementValue: number;
  totalForecastFeeValue: number;
  settledNotDisbursedAmount: number;
  casesMissingRequiredFields: number;
  casesNotReviewedRecently: number;
  casesNeedingQuarterlyCheckIn: number;
  casesWithOutdatedValidation: number;
  stageSuggestionsOpen: number;
};
