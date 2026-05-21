import { Badge } from "@/components/ui/badge";
import { type CaseStage, type ConfidenceLevel } from "@/lib/types";

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
