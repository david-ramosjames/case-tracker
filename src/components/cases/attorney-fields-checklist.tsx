import { UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ATTORNEY_SOURCED_FIELDS,
  getAttorneySourcedFieldStatus,
  type AttorneyFieldStatus,
} from "@/lib/attorney-sourced-fields";
import type { CaseRecord } from "@/lib/types";

function statusBadge(status: AttorneyFieldStatus) {
  if (status === "current") return <Badge variant="success">Current</Badge>;
  if (status === "stale") return <Badge variant="danger">90-day review</Badge>;
  return <Badge variant="warning">Missing</Badge>;
}

export function AttorneyFieldsChecklist({ record }: { record: CaseRecord }) {
  const staleCount = ATTORNEY_SOURCED_FIELDS.filter((field) => getAttorneySourcedFieldStatus(record, field.id) === "stale").length;
  const missingCount = ATTORNEY_SOURCED_FIELDS.filter((field) => getAttorneySourcedFieldStatus(record, field.id) === "missing").length;

  return (
    <Card className="border-amber-200/80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <UserRound className="h-5 w-5 text-amber-700" />
          Your input
        </CardTitle>
        <CardDescription>
          These fields come from you, not DocketFlow. Quarter, minimum value, policy limits, liability, and sources detail need confirmation at least every 90 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {staleCount > 0 || missingCount > 0 ? (
          <p className="mb-3 text-sm text-amber-900">
            {missingCount > 0 ? `${missingCount} missing` : null}
            {missingCount > 0 && staleCount > 0 ? " · " : null}
            {staleCount > 0 ? `${staleCount} need 90-day review` : null}
          </p>
        ) : (
          <p className="mb-3 text-sm text-emerald-700">All attorney fields are current.</p>
        )}
        {ATTORNEY_SOURCED_FIELDS.map((field) => (
          <div key={field.id} className="flex items-center justify-between gap-3 rounded-lg border border-amber-100 bg-white p-3">
            <div>
              <p className="text-sm font-medium text-navy-950">{field.label}</p>
              {field.reviewKind !== "none" ? (
                <p className="text-xs text-muted-foreground">90-day review</p>
              ) : (
                <p className="text-xs text-muted-foreground">Set once</p>
              )}
            </div>
            {statusBadge(getAttorneySourcedFieldStatus(record, field.id))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
