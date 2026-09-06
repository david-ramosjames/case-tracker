import { getCaseAttorneyScore } from "@/lib/attorney-score";
import { getProjectedFeeValue } from "@/lib/calculations";
import { deriveCaseStatusFromTracker } from "@/lib/case-status";
import { formatLitigationEventSummary } from "@/lib/litigation-events";
import { type CaseRecord, type TrackerComment } from "@/lib/types";
import { formatOptionalDate } from "@/lib/utils";

export type CaseExportColumnId =
  | "attorneyScore"
  | "caseNumber"
  | "clientName"
  | "attorney"
  | "paralegal"
  | "legalAssistant"
  | "dateSigned"
  | "dateOfIncident"
  | "status"
  | "caseStage"
  | "caseType"
  | "liability"
  | "targetResolutionQuarter"
  | "caseSize"
  | "minimumValue"
  | "referralFee"
  | "policyLimits"
  | "policyInfoSource"
  | "referralFeeArrangement"
  | "balanceCtaInfo"
  | "confidenceLevel"
  | "preferredLanguage"
  | "secondaryLanguage"
  | "usesEve"
  | "clientPhone"
  | "injuries"
  | "caseDescription"
  | "forecastNotes"
  | "statusNotes"
  | "attorneyNotes"
  | "managerNotes"
  | "gvNotes"
  | "lrjNotes"
  | "comments"
  | "commentCount"
  | "projectedFirmFee"
  | "estimatedFeeValue"
  | "settlementDate"
  | "settlementAmount"
  | "feePercent"
  | "attorneyFees"
  | "releaseStatus"
  | "closingStatus"
  | "checkStatus"
  | "disbursedStatus"
  | "reductionsStatus"
  | "disburseDate"
  | "resultQuarter"
  | "plaintiffDeposition"
  | "defendantDeposition"
  | "mediation"
  | "trial"
  | "lastReviewedAt"
  | "updatedAt";

export type CaseExportColumnGroup = "casesTable" | "caseDetails" | "notes" | "results" | "litigation";

export type CaseExportColumn = {
  id: CaseExportColumnId;
  label: string;
  group: CaseExportColumnGroup;
  defaultSelected: boolean;
};

export const CASE_EXPORT_GROUP_LABELS: Record<CaseExportColumnGroup, string> = {
  casesTable: "Cases table (defaults)",
  caseDetails: "Case details",
  notes: "Notes & comments",
  results: "Settlement results",
  litigation: "Litigation events",
};

export const CASE_EXPORT_COLUMNS: CaseExportColumn[] = [
  { id: "attorneyScore", label: "Score", group: "casesTable", defaultSelected: true },
  { id: "caseNumber", label: "Case #", group: "casesTable", defaultSelected: true },
  { id: "clientName", label: "Client", group: "casesTable", defaultSelected: true },
  { id: "attorney", label: "Attorney", group: "casesTable", defaultSelected: true },
  { id: "paralegal", label: "Paralegal", group: "casesTable", defaultSelected: true },
  { id: "legalAssistant", label: "LA", group: "casesTable", defaultSelected: true },
  { id: "dateSigned", label: "Date Signed", group: "casesTable", defaultSelected: true },
  { id: "dateOfIncident", label: "DOL", group: "casesTable", defaultSelected: true },
  { id: "status", label: "Status", group: "casesTable", defaultSelected: true },
  { id: "caseStage", label: "Stage", group: "casesTable", defaultSelected: true },
  { id: "caseType", label: "Type", group: "casesTable", defaultSelected: true },
  { id: "liability", label: "Liability", group: "casesTable", defaultSelected: true },
  { id: "targetResolutionQuarter", label: "Exp. disburse Q", group: "casesTable", defaultSelected: true },
  { id: "caseSize", label: "Case Size", group: "casesTable", defaultSelected: true },
  { id: "minimumValue", label: "Minimum Value", group: "casesTable", defaultSelected: true },
  { id: "referralFee", label: "Referral Fee %", group: "casesTable", defaultSelected: true },
  { id: "policyLimits", label: "Policy Limits", group: "casesTable", defaultSelected: true },

  { id: "policyInfoSource", label: "Policy Source", group: "caseDetails", defaultSelected: false },
  { id: "referralFeeArrangement", label: "Referral Fee Arrangement", group: "caseDetails", defaultSelected: false },
  { id: "balanceCtaInfo", label: "Balance / CTA Info", group: "caseDetails", defaultSelected: false },
  { id: "confidenceLevel", label: "Confidence", group: "caseDetails", defaultSelected: false },
  { id: "preferredLanguage", label: "Primary Language", group: "caseDetails", defaultSelected: false },
  { id: "secondaryLanguage", label: "Secondary Language", group: "caseDetails", defaultSelected: false },
  { id: "usesEve", label: "Uses Eve", group: "caseDetails", defaultSelected: false },
  { id: "clientPhone", label: "Client Phone", group: "caseDetails", defaultSelected: false },
  { id: "injuries", label: "Injuries", group: "caseDetails", defaultSelected: false },
  { id: "caseDescription", label: "Description", group: "caseDetails", defaultSelected: false },
  { id: "projectedFirmFee", label: "Projected Firm Fee", group: "caseDetails", defaultSelected: false },
  { id: "estimatedFeeValue", label: "Estimated Fee Value", group: "caseDetails", defaultSelected: false },
  { id: "lastReviewedAt", label: "Last Reviewed", group: "caseDetails", defaultSelected: false },
  { id: "updatedAt", label: "Tracker Updated", group: "caseDetails", defaultSelected: false },

  { id: "forecastNotes", label: "Forecast Notes", group: "notes", defaultSelected: false },
  { id: "statusNotes", label: "Status Notes", group: "notes", defaultSelected: false },
  { id: "attorneyNotes", label: "Attorney Notes", group: "notes", defaultSelected: false },
  { id: "managerNotes", label: "Manager Notes", group: "notes", defaultSelected: false },
  { id: "gvNotes", label: "GV Notes", group: "notes", defaultSelected: false },
  { id: "lrjNotes", label: "LRJ Notes", group: "notes", defaultSelected: false },
  { id: "comments", label: "Comments (all)", group: "notes", defaultSelected: false },
  { id: "commentCount", label: "Comment Count", group: "notes", defaultSelected: false },

  { id: "settlementDate", label: "Settlement Date", group: "results", defaultSelected: false },
  { id: "settlementAmount", label: "Settlement Amount", group: "results", defaultSelected: false },
  { id: "feePercent", label: "Fee %", group: "results", defaultSelected: false },
  { id: "attorneyFees", label: "RJL Attorney Fees", group: "results", defaultSelected: false },
  { id: "releaseStatus", label: "Release Status", group: "results", defaultSelected: false },
  { id: "closingStatus", label: "Closing Status", group: "results", defaultSelected: false },
  { id: "checkStatus", label: "Check Status", group: "results", defaultSelected: false },
  { id: "disbursedStatus", label: "Disbursed Status", group: "results", defaultSelected: false },
  { id: "reductionsStatus", label: "Reductions Status", group: "results", defaultSelected: false },
  { id: "disburseDate", label: "Disburse Date", group: "results", defaultSelected: false },
  { id: "resultQuarter", label: "Result Quarter", group: "results", defaultSelected: false },

  { id: "plaintiffDeposition", label: "Plaintiff Deposition", group: "litigation", defaultSelected: false },
  { id: "defendantDeposition", label: "Defendant Deposition", group: "litigation", defaultSelected: false },
  { id: "mediation", label: "Mediation", group: "litigation", defaultSelected: false },
  { id: "trial", label: "Trial", group: "litigation", defaultSelected: false },
];

export const DEFAULT_CASE_EXPORT_COLUMN_IDS = CASE_EXPORT_COLUMNS.filter((column) => column.defaultSelected).map(
  (column) => column.id,
);

export type CaseExportContext = {
  commentsByCaseId: Map<string, TrackerComment[]>;
};

function cell(value: string | number | boolean | null | undefined) {
  if (value == null) return "";
  return value;
}

function formatComments(comments: TrackerComment[] | undefined) {
  if (!comments?.length) return "";
  return comments
    .map((comment) => {
      const date = formatOptionalDate(comment.createdAt) || comment.createdAt.slice(0, 10);
      return `${date} · ${comment.authorName} (${comment.type}): ${comment.body.trim()}`;
    })
    .join("\n");
}

export function getCaseExportCellValue(
  record: CaseRecord,
  columnId: CaseExportColumnId,
  context: CaseExportContext,
): string | number | boolean {
  const { shared, tracker } = record;
  const comments = context.commentsByCaseId.get(shared.id) ?? [];

  switch (columnId) {
    case "attorneyScore":
      return getCaseAttorneyScore(record).percent;
    case "caseNumber":
      return shared.caseNumber;
    case "clientName":
      return shared.clientName;
    case "attorney":
      return record.attorney.name;
    case "paralegal":
      return record.paralegal.name;
    case "legalAssistant":
      return record.legalAssistant?.name ?? "";
    case "dateSigned":
      return formatOptionalDate(shared.dateSigned) || shared.dateSigned || "";
    case "dateOfIncident":
      return formatOptionalDate(shared.dateOfIncident) || "";
    case "status": {
      const status = deriveCaseStatusFromTracker(tracker.caseStage, tracker.result);
      return status === "Active" ? "Open" : "Closed";
    }
    case "caseStage":
      return tracker.caseStage;
    case "caseType":
      return shared.caseType;
    case "liability":
      return tracker.liability ?? "";
    case "targetResolutionQuarter":
      return tracker.targetResolutionQuarter ?? "";
    case "caseSize":
      return tracker.caseSize ?? "";
    case "minimumValue":
      return cell(tracker.minimumValue) as string | number;
    case "referralFee":
      return cell(tracker.referralFee) as string | number;
    case "policyLimits":
      return cell(tracker.policyLimits) as string | number;
    case "policyInfoSource":
      return tracker.policyInfoSource ?? "";
    case "referralFeeArrangement":
      return tracker.referralFeeArrangement ?? "";
    case "balanceCtaInfo":
      return tracker.balanceCtaInfo ?? "";
    case "confidenceLevel":
      return tracker.confidenceLevel ?? "";
    case "preferredLanguage":
      return shared.preferredLanguage;
    case "secondaryLanguage":
      return shared.secondaryLanguage ?? "";
    case "usesEve":
      return shared.usesEve ? "Yes" : "No";
    case "clientPhone":
      return tracker.clientPhone ?? "";
    case "injuries":
      return tracker.injuries ?? "";
    case "caseDescription":
      return tracker.caseDescription ?? "";
    case "forecastNotes":
      return tracker.forecastNotes ?? "";
    case "statusNotes":
      return tracker.statusNotes ?? "";
    case "attorneyNotes":
      return tracker.attorneyNotes ?? "";
    case "managerNotes":
      return tracker.managerNotes ?? "";
    case "gvNotes":
      return tracker.gvNotes ?? "";
    case "lrjNotes":
      return tracker.lrjNotes ?? "";
    case "comments":
      return formatComments(comments);
    case "commentCount":
      return comments.length;
    case "projectedFirmFee":
      return getProjectedFeeValue(record) ?? "";
    case "estimatedFeeValue":
      return cell(tracker.estimatedFeeValue) as string | number;
    case "settlementDate":
      return formatOptionalDate(tracker.result.settlementDate) || "";
    case "settlementAmount":
      return cell(tracker.result.settlementAmount) as string | number;
    case "feePercent":
      return cell(tracker.result.feePercent) as string | number;
    case "attorneyFees":
      return cell(tracker.result.attorneyFees) as string | number;
    case "releaseStatus":
      return tracker.result.releaseStatus ?? "";
    case "closingStatus":
      return tracker.result.closingStatus ?? "";
    case "checkStatus":
      return tracker.result.checkStatus ?? "";
    case "disbursedStatus":
      return tracker.result.disbursedStatus ?? "";
    case "reductionsStatus":
      return tracker.result.reductionsStatus ?? "";
    case "disburseDate":
      return formatOptionalDate(tracker.result.disburseDate) || "";
    case "resultQuarter":
      return tracker.result.resultQuarter ?? "";
    case "plaintiffDeposition":
      return formatLitigationEventSummary(tracker.litigationEvents.plaintiffDeposition);
    case "defendantDeposition":
      return formatLitigationEventSummary(tracker.litigationEvents.defendantDeposition);
    case "mediation":
      return formatLitigationEventSummary(tracker.litigationEvents.mediation);
    case "trial":
      return formatLitigationEventSummary(tracker.litigationEvents.trial);
    case "lastReviewedAt":
      return formatOptionalDate(tracker.lastReviewedAt) || tracker.lastReviewedAt || "";
    case "updatedAt":
      return formatOptionalDate(tracker.updatedAt) || tracker.updatedAt || "";
  }
}

export function escapeCsvCell(value: string | number | boolean) {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCaseExportCsv(
  records: CaseRecord[],
  columnIds: CaseExportColumnId[],
  context: CaseExportContext,
) {
  const columns = columnIds
    .map((id) => CASE_EXPORT_COLUMNS.find((column) => column.id === id))
    .filter((column): column is CaseExportColumn => Boolean(column));

  const lines = [
    columns.map((column) => escapeCsvCell(column.label)).join(","),
    ...records.map((record) =>
      columns.map((column) => escapeCsvCell(getCaseExportCellValue(record, column.id, context))).join(","),
    ),
  ];

  return lines.join("\r\n");
}

export function downloadCaseExportCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function caseExportNeedsComments(columnIds: CaseExportColumnId[]) {
  return columnIds.includes("comments") || columnIds.includes("commentCount");
}
