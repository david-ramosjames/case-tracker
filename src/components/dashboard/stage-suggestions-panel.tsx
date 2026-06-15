"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, SlidersHorizontal, Sparkles } from "lucide-react";
import { CaseNumberLink } from "@/components/cases/case-number-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HeaderMultiFilter } from "@/components/ui/header-filter";
import { type ViewerContext } from "@/lib/auth/access";
import { getOpenStageSuggestionItems } from "@/lib/calculations";
import { type AppUser, type CaseRecord, type CaseStage } from "@/lib/types";

const STAGE_LABELS: Record<CaseStage, string> = {
  Onboarding: "Onboarding",
  Txt: "Treatment",
  Dmd: "Demand",
  Lit: "Litigation",
  Settled: "Settled",
  Disengaged: "Disengaged",
  Referred: "Referred",
  Terminated: "Terminated",
};

export function StageSuggestionsPanel({
  records,
  users,
  viewer,
  showEmpty = false,
}: {
  records: CaseRecord[];
  users?: AppUser[];
  viewer?: ViewerContext;
  showEmpty?: boolean;
}) {
  const router = useRouter();
  const serverItems = useMemo(() => getOpenStageSuggestionItems(records), [records]);
  const [items, setItems] = useState(serverItems);
  const [attorneyIds, setAttorneyIds] = useState<string[]>([]);
  const [actionId, setActionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const attorneys = useMemo(() => (users ?? []).filter((user) => user.role === "attorney"), [users]);
  const canFilterByAttorney = Boolean(viewer?.canViewAllCases && attorneys.length > 0);

  const filteredItems = useMemo(() => {
    if (attorneyIds.length === 0) return items;
    return items.filter((item) => attorneyIds.includes(item.record.shared.attorneyId));
  }, [attorneyIds, items]);

  useEffect(() => {
    setItems(serverItems);
  }, [serverItems]);

  if (items.length === 0) {
    if (!showEmpty) return null;

    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          No stage suggestions waiting for confirmation.
        </CardContent>
      </Card>
    );
  }

  async function confirmSuggestion(suggestionId: string) {
    setActionId(suggestionId);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/stage-suggestions/${suggestionId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to confirm stage suggestion.");

      setItems((current) => current.filter((item) => item.signal.id !== suggestionId));
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to confirm stage suggestion.");
    } finally {
      setActionId(null);
    }
  }

  async function dismissSuggestion(suggestionId: string) {
    setActionId(suggestionId);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/stage-suggestions/${suggestionId}/dismiss`, { method: "POST" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to dismiss stage suggestion.");

      setItems((current) => current.filter((item) => item.signal.id !== suggestionId));
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to dismiss stage suggestion.");
    } finally {
      setActionId(null);
    }
  }

  const emptyFilteredMessage =
    attorneyIds.length > 0 ? "No stage suggestions match the selected attorney filter." : null;

  return (
    <div className="space-y-4">
      {showEmpty && canFilterByAttorney ? (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-navy-950">Filters</span>
                {attorneyIds.length > 0 ? <Badge variant="pink">{attorneyIds.length}</Badge> : null}
                {attorneyIds.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => setAttorneyIds([])}>
                    Clear
                  </Button>
                ) : null}
              </div>
              <div className="w-full max-w-xs">
                <HeaderMultiFilter
                  label="Attorney"
                  selected={attorneyIds}
                  onChange={setAttorneyIds}
                  options={attorneys.map((attorney) => ({ value: attorney.id, label: attorney.name }))}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {filteredItems.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {emptyFilteredMessage ?? "No stage suggestions waiting for confirmation."}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-pink-200 bg-pink-50/30">
          {!showEmpty ? (
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-pink-500" />
                Stage suggestions awaiting confirmation
              </CardTitle>
              <CardDescription>
                Confirm or dismiss here — no need to hunt through Slack. These usually come from the daily pulse recap.
              </CardDescription>
            </CardHeader>
          ) : null}
          <CardContent className={showEmpty ? "space-y-3 pt-6" : "space-y-3"}>
            {errorMessage ? <p className="text-sm text-rose-700">{errorMessage}</p> : null}
            {filteredItems.map(({ record, signal }) => {
              const busy = actionId === signal.id;
              const stageLabel = STAGE_LABELS[signal.suggestedStage] ?? signal.suggestedStage;

              return (
                <div key={signal.id} className="rounded-lg border bg-white p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <CaseNumberLink caseId={record.shared.id} caseNumber={record.shared.caseNumber} />
                        <span className="text-sm font-medium text-navy-950">{record.attorney.name}</span>
                        <span className="text-sm text-muted-foreground">{record.shared.clientName}</span>
                        <Badge variant="pink">{signal.source}</Badge>
                        <Badge variant="outline">{signal.confidence} confidence</Badge>
                      </div>
                      <p className="text-sm font-semibold text-navy-950">
                        Suggested stage: {stageLabel}
                        {record.tracker.caseStage !== signal.suggestedStage ? (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            (currently {STAGE_LABELS[record.tracker.caseStage] ?? record.tracker.caseStage})
                          </span>
                        ) : null}
                      </p>
                      {signal.excerpt ? (
                        <p className="text-sm leading-6 text-muted-foreground">{signal.excerpt}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button variant="pink" size="sm" disabled={busy} onClick={() => void confirmSuggestion(signal.id)}>
                        {busy ? "Saving…" : "Confirm"}
                      </Button>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => void dismissSuggestion(signal.id)}>
                        Dismiss
                      </Button>
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/cases/${record.shared.id}`}>
                          <ExternalLink className="h-4 w-4" />
                          Open case
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
