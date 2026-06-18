import { Badge } from "@/components/ui/badge";
import { deriveCaseStatusFromTracker } from "@/lib/case-status";
import { type CaseRecord, type CaseStage, type CaseStatus, type ConfidenceLevel } from "@/lib/types";

export function CaseStatusBadge({ status }: { status: CaseStatus }) {
  return <Badge variant={status === "Active" ? "success" : "secondary"}>{status}</Badge>;
}

export function DerivedCaseStatusBadge({ record }: { record: Pick<CaseRecord, "tracker"> }) {
  const status = deriveCaseStatusFromTracker(record.tracker.caseStage, record.tracker.result);
  return <CaseStatusBadge status={status} />;
}

export function StageBadge({ stage }: { stage: CaseStage }) {
  const variant =
    stage === "Disengaged" || stage === "Terminated"
      ? "secondary"
      : stage === "Settled"
        ? "pink"
        : "outline";
  return <Badge variant={variant}>{stage}</Badge>;
}

export function ConfidenceBadge({ level }: { level: ConfidenceLevel | null }) {
  if (!level) return <Badge variant="warning">Missing</Badge>;
  if (level === "High") return <Badge variant="success">High</Badge>;
  if (level === "Medium") return <Badge variant="pink">Medium</Badge>;
  return <Badge variant="warning">Low</Badge>;
}
