"use client";

import { useState } from "react";
import { AttorneyPlanView } from "@/components/performance/attorney-plan-view";
import { ConfirmEventsPanel, type ConfirmEventRow } from "@/components/performance/confirm-events-panel";
import { MyWorkView } from "@/components/performance/my-work-view";
import { cn } from "@/lib/utils";
import {
  type AttorneyPlanLine,
  type PerformanceCommitment,
  type PerformanceDeliverable,
} from "@/lib/performance/types";
import { type AppUser } from "@/lib/types";

type CaseOption = {
  id: string;
  caseNumber: string;
  clientName: string;
  paralegalId: string;
  attorneyId: string;
};

type Tab = "output" | "plan";

export function AttorneyView({
  initialDeliverables,
  initialCommitments,
  initialLines,
  weekStart,
  lastWeekStart,
  selectedAttorney,
  attorneys,
  canBrowsePeople,
  caseOptions,
  nameById,
  viewerContactId,
  confirmRows,
}: {
  initialDeliverables: PerformanceDeliverable[];
  initialCommitments: PerformanceCommitment[];
  initialLines: AttorneyPlanLine[];
  weekStart: string;
  lastWeekStart: string;
  selectedAttorney: AppUser | null;
  attorneys: AppUser[];
  canBrowsePeople: boolean;
  caseOptions: CaseOption[];
  nameById: Record<string, string>;
  viewerContactId: string | null;
  confirmRows: ConfirmEventRow[];
}) {
  const [tab, setTab] = useState<Tab>("output");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-px">
        {(
          [
            { id: "output" as const, label: "Output" },
            { id: "plan" as const, label: "Week plan" },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === item.id
                ? "border-pink-500 text-navy-950"
                : "border-transparent text-muted-foreground hover:text-navy-900",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "output" ? (
        <MyWorkView
          mode="attorney"
          panel="board"
          initialDeliverables={initialDeliverables}
          initialCommitments={initialCommitments}
          weekStart={weekStart}
          lastWeekStart={lastWeekStart}
          selectedPerson={selectedAttorney}
          viewerContactId={viewerContactId}
          canBrowsePeople={canBrowsePeople}
          people={attorneys}
          caseOptions={caseOptions}
          nameById={nameById}
          basePath="/performance/attorney"
          personSwitcherLabel="Attorney"
        />
      ) : (
        <div className="space-y-6">
          <AttorneyPlanView
            initialLines={initialLines}
            weekStart={weekStart}
            selectedAttorney={selectedAttorney}
            attorneys={attorneys}
            canBrowsePeople={canBrowsePeople}
            caseOptions={caseOptions.map((c) => ({
              id: c.id,
              caseNumber: c.caseNumber,
              clientName: c.clientName,
              attorneyId: c.attorneyId,
            }))}
          />
          {confirmRows.length > 0 ? <ConfirmEventsPanel rows={confirmRows} /> : null}
        </div>
      )}
    </div>
  );
}
