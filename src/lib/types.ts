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

export type StageSignalSource = "slack" | "workflow" | "matter_update" | "manual";

export type ReleaseStatus = "No" | "Signed";
export type ClosingStatus = "No" | "Drafted" | "Approved" | "Signed";
export type CheckStatus = "Deposited" | "No" | "Sent";
export type DisbursedStatus = "No" | "Yes";
export type ReductionsStatus = "Not Complete" | "Sent" | "Approved" | "N/A" | "Deposited";

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
  createdAt: string;
  updatedAt: string;
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
  injuries: string;
  caseDescription: string;
  statusNotes: string;
  gvNotes: string;
  lrjNotes: string;
  result: SettlementResult;
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
  isActive: boolean;
  settledAmount: number | null;
  disbursedAmount: number | null;
  actualFeeValue: number | null;
  updatedAt: string;
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

export type AttorneyGoal = {
  id: string;
  attorneyId: string;
  year: number;
  annualFeeGoal: number;
  commissionThreshold: number;
  commissionYearStartMonth: number;
  q1Goal: number;
  q2Goal: number;
  q3Goal: number;
  q4Goal: number;
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
  >
>;

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
