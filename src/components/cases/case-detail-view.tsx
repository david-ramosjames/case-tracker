"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, MessageSquarePlus, Pencil, RefreshCw, Save, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AttorneyFieldLabel, AttorneyFieldLegend, attorneyFieldShellClass } from "@/components/cases/attorney-field-hint";
import { AttorneyFieldsChecklist } from "@/components/cases/attorney-fields-checklist";
import { ConfidenceBadge, DerivedCaseStatusBadge, StageBadge } from "@/components/cases/case-status-badge";
import { NextScheduledEventsCard } from "@/components/cases/next-scheduled-events-card";
import type { AttorneySourcedFieldId } from "@/lib/attorney-sourced-fields";
import { deriveCaseStatusFromTracker } from "@/lib/case-status";
import {
  applyDerivedSettlementResult,
  REDUCTIONS_MANUAL_STATUS_OPTIONS,
  deriveCaseSizeFromMinimumValue,
  CASE_STAGE_OPTIONS,
  caseTypeSelectOptions,
  CHECK_STATUS_OPTIONS,
  CLOSING_STATUS_OPTIONS,
  DISBURSED_STATUS_OPTIONS,
  EXPECTED_LITIGATION_OPTIONS,
  coerceExpectedLitigationForStage,
  formatExpectedLitigationLabel,
  LIABILITY_OPTIONS,
  RELEASE_STATUS_OPTIONS,
  getTargetPeriodSelectOptions,
  toStandardTargetPeriodLabel,
} from "@/lib/case-options";
import { AttorneyScoreBreakdown } from "@/components/attorney-score/attorney-score";
import { getCaseAttorneyScore, getValidationFieldLabel } from "@/lib/attorney-score";
import {
  deriveResultFeePercent,
  getDataQualityFlags,
  getFeePercent,
  getOpenStageSuggestions,
  getProjectedFeeValue,
  needsQuarterlyCheckIn,
} from "@/lib/calculations";
import { DisbursementPartiesCard } from "@/components/cases/disbursement-parties-card";
import { type SessionUser } from "@/lib/auth/types";
import { formatSlackChannelLabel, getSlackChannelArchiveUrl } from "@/lib/slack/links";
import {
  type ActivityLogEntry,
  type CaseRecord,
  type CaseSlackChannel,
  type CaseTrackerSettings,
  type DocketFlowScheduledEvent,
  type CheckStatus,
  type ClosingStatus,
  type CommentType,
  type DisbursedStatus,
  type ReductionsStatus,
  type ReleaseStatus,
  type SettlementResult,
  type TrackerUpdateInput,
  type TrackerComment,
  type TrackerEntry,
} from "@/lib/types";
import { formatCurrency, formatDate, formatOptionalDate, getCalculatedAttorneyFees } from "@/lib/utils";

export function CaseDetailView({
  initialRecord,
  initialComments,
  initialActivity,
  settings,
  sessionUser,
  slackChannel,
  upcomingDocketFlowEvents,
  docketFlowCaseUrl,
}: {
  initialRecord: CaseRecord;
  initialComments: TrackerComment[];
  initialActivity: ActivityLogEntry[];
  settings: CaseTrackerSettings;
  sessionUser: SessionUser;
  slackChannel: CaseSlackChannel | null;
  upcomingDocketFlowEvents: DocketFlowScheduledEvent[];
  docketFlowCaseUrl: string | null;
}) {
  const [shared, setShared] = useState(initialRecord.shared);
  const [tracker, setTracker] = useState(initialRecord.tracker);
  const [comments, setComments] = useState(initialComments);
  const [activity, setActivity] = useState(initialActivity);
  const [newComment, setNewComment] = useState("");
  const [commentType, setCommentType] = useState<CommentType>("general_note");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isOverviewEditing, setIsOverviewEditing] = useState(false);
  const [isSourcesEditing, setIsSourcesEditing] = useState(false);
  const [isResultsEditing, setIsResultsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [stageActionId, setStageActionId] = useState<string | null>(null);
  const [deleteDocketflowCase, setDeleteDocketflowCase] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSyncingSheet, setIsSyncingSheet] = useState(false);
  const [sheetSyncMessage, setSheetSyncMessage] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    setShared(initialRecord.shared);
    setTracker(initialRecord.tracker);
  }, [initialRecord]);

  const isAdmin = sessionUser.role === "admin" || sessionUser.role === "super_admin";
  const isOrphanTracker = initialRecord.shared.id === initialRecord.tracker.id;

  const quarterOptions = useMemo(() => getTargetPeriodSelectOptions(tracker.targetResolutionQuarter), [tracker.targetResolutionQuarter]);
  const record = useMemo(() => ({ ...initialRecord, shared, tracker }), [initialRecord, shared, tracker]);
  const flags = getDataQualityFlags(record, settings);
  const attorneyScore = getCaseAttorneyScore(record);
  const openStageSuggestions = getOpenStageSuggestions(record);
  const quarterlyCheckInDue = needsQuarterlyCheckIn(record);
  const slackChannelUrl = slackChannel ? getSlackChannelArchiveUrl(slackChannel) : null;
  const slackChannelLabel = slackChannel ? formatSlackChannelLabel(slackChannel.slackChannelName) : null;

  function updateField<K extends keyof TrackerEntry>(key: K, value: TrackerEntry[K]) {
    setTracker((current) => {
      const next = { ...current, [key]: value };
      if (key === "caseStage") {
        next.expectedLitigation = coerceExpectedLitigationForStage(next.caseStage, next.expectedLitigation);
        setShared((s) => ({
          ...s,
          status: deriveCaseStatusFromTracker(next.caseStage, next.result.disbursedStatus),
        }));
      }
      if (key === "caseStage" || key === "expectedLitigation" || key === "referralFee") {
        return { ...next, result: applyDerivedSettlementResult(next.result, next) };
      }
      return next;
    });
  }

  function updateShared<K extends keyof typeof shared>(key: K, value: (typeof shared)[K]) {
    setShared((current) => ({ ...current, [key]: value }));
  }

  async function syncFromDisbursingSheet() {
    setIsSyncingSheet(true);
    setSheetSyncMessage(null);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/cases/${shared.id}/sync-settlements`, { method: "POST" });
      const body = (await response.json()) as {
        error?: string;
        disbursementsSynced?: number;
        sheetRowsFound?: number;
      };
      if (!response.ok) throw new Error(body.error ?? "Unable to import from disbursing sheet.");

      setSheetSyncMessage(
        `Imported ${body.disbursementsSynced ?? 0} disbursement party row(s) from the sheet.`,
      );
      router.refresh();
    } catch (error) {
      setSheetSyncMessage(error instanceof Error ? error.message : "Unable to import from disbursing sheet.");
    } finally {
      setIsSyncingSheet(false);
    }
  }

  function updateResult<K extends keyof SettlementResult>(key: K, value: SettlementResult[K]) {
    setTracker((current) => ({
      ...current,
      result: applyDerivedSettlementResult(
        {
          ...current.result,
          [key]: value,
        },
        current,
      ),
    }));
  }

  function updateResultWorkflow<K extends "releaseStatus" | "closingStatus" | "checkStatus" | "disbursedStatus">(
    key: K,
    value: SettlementResult[K],
  ) {
    const now = new Date().toISOString();
    setTracker((current) => {
      const result = { ...current.result, [key]: value };

      if (key === "releaseStatus") result.releaseSignedAt = value === "Signed" ? (result.releaseSignedAt ?? now) : null;
      if (key === "closingStatus") result.closingSignedAt = value === "Signed" ? (result.closingSignedAt ?? now) : null;
      if (key === "checkStatus") result.checkDepositedAt = value === "Deposited" ? (result.checkDepositedAt ?? now) : null;
      if (key === "disbursedStatus") result.checkDisbursedAt = value === "Yes" ? (result.checkDisbursedAt ?? now) : null;

      const next = { ...current, result };
      if (key === "disbursedStatus") {
        setShared((s) => ({
          ...s,
          status: deriveCaseStatusFromTracker(next.caseStage, next.result.disbursedStatus),
        }));
      }
      return next;
    });
  }

  async function persistTracker(nextTracker: TrackerEntry, options?: { markReviewed?: boolean }) {
    const payload = {
      shared: {
        caseType: shared.caseType,
        dateOfIncident: shared.dateOfIncident,
      },
      tracker: {
        caseStage: nextTracker.caseStage,
        estimatedSettlementValue: nextTracker.estimatedSettlementValue,
        estimatedFeeValue: nextTracker.estimatedFeeValue,
        targetResolutionQuarter: nextTracker.targetResolutionQuarter,
        confidenceLevel: nextTracker.confidenceLevel,
        sourceOfEstimate: nextTracker.sourceOfEstimate,
        liability: nextTracker.liability,
        caseSize: nextTracker.caseSize,
        minimumValue: nextTracker.minimumValue,
        referralFee: nextTracker.referralFee,
        referralFeeArrangement: nextTracker.referralFeeArrangement,
        balanceCtaInfo: nextTracker.balanceCtaInfo,
        policyLimits: nextTracker.policyLimits,
        policyInfoSource: nextTracker.policyInfoSource,
        expectedLitigation: nextTracker.expectedLitigation,
        sources: nextTracker.sources,
        injuries: nextTracker.injuries,
        caseDescription: nextTracker.caseDescription,
        statusNotes: nextTracker.statusNotes,
        lastQuarterlyCheckInAt: nextTracker.lastQuarterlyCheckInAt,
        forecastNotes: nextTracker.forecastNotes,
        multipleDisbursementsEnabled: nextTracker.multipleDisbursementsEnabled,
        expectedDisbursementCount: nextTracker.expectedDisbursementCount,
        result: nextTracker.result,
      },
      actor: {
        userId: sessionUser.id,
        userName: sessionUser.name,
      },
      markReviewed: options?.markReviewed ?? true,
    };

    const response = await fetch(`/api/tracker/${record.shared.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as { tracker?: TrackerEntry; activity?: ActivityLogEntry; error?: string };
    if (!response.ok || !body.tracker) throw new Error(body.error ?? "Unable to save tracker entry.");
    return { tracker: body.tracker, activity: body.activity };
  }

  async function saveTracker(options?: { markReviewed?: boolean }) {
    const markReviewed = options?.markReviewed ?? true;
    const now = new Date().toISOString();
    const nextTracker = {
      ...tracker,
      result: applyDerivedSettlementResult(tracker.result, tracker),
      lastReviewedAt: markReviewed ? now : tracker.lastReviewedAt,
      updatedAt: now,
    };

    setIsSaving(true);
    setErrorMessage(null);
    try {
      const { tracker: savedTracker, activity: savedActivity } = await persistTracker(nextTracker, { markReviewed });
      setTracker((current) => ({
        ...current,
        ...savedTracker,
        result: savedTracker.result ?? current.result,
        detectedStageSignals: current.detectedStageSignals,
      }));
      setShared((current) => ({
        ...current,
        status: deriveCaseStatusFromTracker(savedTracker.caseStage, savedTracker.result.disbursedStatus),
      }));
      if (savedActivity) {
        setActivity((current) => [savedActivity, ...current]);
      }
      setSavedAt(now);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to save tracker entry.");
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmQuarterlyCheckIn() {
    const now = new Date().toISOString();
    const nextTracker = {
      ...tracker,
      result: applyDerivedSettlementResult(tracker.result, tracker),
      lastQuarterlyCheckInAt: now,
      lastReviewedAt: now,
      updatedAt: now,
    };

    setIsSaving(true);
    setErrorMessage(null);
    try {
      const { tracker: savedTracker, activity: savedActivity } = await persistTracker(nextTracker);
      setTracker((current) => ({ ...current, ...savedTracker, detectedStageSignals: current.detectedStageSignals }));
      if (savedActivity) {
        setActivity((current) => [savedActivity, ...current]);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to complete quarterly check-in.");
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmStageSuggestion(signalId: string) {
    const signal = tracker.detectedStageSignals.find((item) => item.id === signalId);
    if (!signal) return;

    setStageActionId(signalId);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/stage-suggestions/${signalId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as {
        error?: string;
        tracker?: TrackerEntry;
      };
      if (!response.ok) throw new Error(payload.error ?? "Unable to confirm stage suggestion.");

      const now = new Date().toISOString();
      const savedTracker = payload.tracker;
      setTracker((current) => ({
        ...current,
        ...(savedTracker ?? {
          caseStage: signal.suggestedStage,
          expectedLitigation: signal.suggestedExpectedLitigation,
          estimatedFeeValue: current.minimumValue
            ? Math.round(
                current.minimumValue *
                  deriveResultFeePercent({
                    caseStage: signal.suggestedStage,
                    expectedLitigation: signal.suggestedExpectedLitigation,
                    referralFee: current.referralFee,
                  }),
              )
            : current.estimatedFeeValue,
        }),
        detectedStageSignals: current.detectedStageSignals.map((item) =>
          item.id === signalId ? { ...item, confirmedAt: now } : item,
        ),
        updatedAt: savedTracker?.updatedAt ?? now,
      }));
      if (savedTracker) {
        setShared((current) => ({
          ...current,
          status: deriveCaseStatusFromTracker(savedTracker.caseStage, savedTracker.result.disbursedStatus),
        }));
      }
      setActivity((current) => [
        {
          id: `activity-${Date.now()}`,
          caseId: record.shared.id,
          userId: sessionUser.id,
          userName: sessionUser.name,
          action: "Stage suggestion confirmed",
          description: `Confirmed ${signal.source} signal: case stage is now ${signal.suggestedStage}.`,
          createdAt: now,
        },
        ...current,
      ]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to confirm stage suggestion.");
    } finally {
      setStageActionId(null);
    }
  }

  async function dismissStageSuggestion(signalId: string) {
    const signal = tracker.detectedStageSignals.find((item) => item.id === signalId);
    if (!signal) return;

    setStageActionId(signalId);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/stage-suggestions/${signalId}/dismiss`, { method: "POST" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to dismiss stage suggestion.");

      const now = new Date().toISOString();
      setTracker((current) => ({
        ...current,
        detectedStageSignals: current.detectedStageSignals.map((item) =>
          item.id === signalId ? { ...item, dismissedAt: now } : item,
        ),
      }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to dismiss stage suggestion.");
    } finally {
      setStageActionId(null);
    }
  }

  async function addComment() {
    if (!newComment.trim()) return;

    setIsAddingComment(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: record.shared.id,
          type: commentType,
          body: newComment.trim(),
        }),
      });
      const body = (await response.json()) as { comment?: TrackerComment; activity?: ActivityLogEntry; error?: string };
      if (!response.ok || !body.comment) throw new Error(body.error ?? "Unable to add comment.");

      setComments((current) => [body.comment as TrackerComment, ...current]);
      if (body.activity) {
        setActivity((current) => [body.activity as ActivityLogEntry, ...current]);
      }
      setNewComment("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to add comment.");
    } finally {
      setIsAddingComment(false);
    }
  }

  async function removeFromTracker() {
    const orphanMessage =
      "Remove this orphaned tracker record from the case list? This cannot be undone.";
    const linkedMessage =
      "Remove this case's tracker data (forecasts, sources, comments, activity)? The DocketFlow case is not deleted unless you check the box below.";
    if (!window.confirm(isOrphanTracker ? orphanMessage : linkedMessage)) return;

    if (!isOrphanTracker && deleteDocketflowCase) {
      const confirmed = window.confirm(
        "Also delete the DocketFlow case record? This removes the case from DocketFlow sync, not just the tracker.",
      );
      if (!confirmed) return;
    }

    setIsDeleting(true);
    setErrorMessage(null);
    try {
      const query = deleteDocketflowCase && !isOrphanTracker ? "?deleteDocketflowCase=true" : "";
      const response = await fetch(`/api/tracker/${shared.id}${query}`, { method: "DELETE" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to remove case from tracker.");
      router.push("/cases");
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to remove case from tracker.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
    <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
              <div>
                <CardTitle className="text-xl">{record.shared.clientName}</CardTitle>
                <CardDescription>
                  {record.shared.caseNumber} - {record.shared.caseType} - DOL {formatOptionalDate(record.shared.dateOfIncident)}
                </CardDescription>
                {slackChannelLabel ? (
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-navy-950">
                    <span className="text-muted-foreground">Slack channel</span>
                    {slackChannelUrl ? (
                      <a
                        href={slackChannelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-pink-600 hover:text-pink-500"
                      >
                        {slackChannelLabel}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <span className="font-medium">{slackChannelLabel}</span>
                    )}
                    {slackChannel?.topicStage ? (
                      <Badge variant="outline" className="font-normal">
                        Sheet status: {slackChannel.topicStage}
                      </Badge>
                    ) : null}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No Slack channel mapped — import Client Contact Status in Settings.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {isOrphanTracker ? <Badge variant="warning">Orphaned tracker row</Badge> : null}
                <StageBadge stage={tracker.caseStage} />
                <Badge variant="outline">{record.shared.status}</Badge>
                <ConfidenceBadge level={tracker.confidenceLevel} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <Info label="Attorney" value={record.attorney.name} />
              <Info label="Paralegal" value={record.paralegal.name} />
              <Info label="Date Signed" value={formatDate(record.shared.dateSigned)} />
              <Info label="Last reviewed" value={formatDate(tracker.lastReviewedAt)} />
            </div>
          </CardContent>
        </Card>

        {!isOrphanTracker ? (
          <NextScheduledEventsCard events={upcomingDocketFlowEvents} docketFlowCaseUrl={docketFlowCaseUrl} />
        ) : null}

        {openStageSuggestions.length > 0 ? (
          <Card className="border-pink-500/40 bg-pink-100/35">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-pink-500" />
                Suggested Stage Update
              </CardTitle>
              <CardDescription>
                The system can use Slack, workflow, and matter events to suggest changes. Attorneys only need to confirm or dismiss.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {openStageSuggestions.map((signal) => (
                <div key={signal.id} className="rounded-lg border bg-white p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge variant="pink">{signal.source}</Badge>
                    <Badge variant="outline">{signal.confidence} confidence</Badge>
                    <span className="text-sm font-semibold text-navy-950">
                      Looks like this case may now be in {signal.suggestedExpectedLitigation.toLowerCase()}.
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{signal.excerpt}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      onClick={() => void confirmStageSuggestion(signal.id)}
                      variant="pink"
                      size="sm"
                      disabled={stageActionId === signal.id}
                    >
                      {stageActionId === signal.id ? "Saving…" : "Confirm"}
                    </Button>
                    <Button
                      onClick={() => void dismissStageSuggestion(signal.id)}
                      variant="outline"
                      size="sm"
                      disabled={stageActionId === signal.id}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {attorneyScore.outdatedValidationFields.length > 0 ? (
          <Card className="border-red-200 bg-red-50/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-900">
                <ShieldAlert className="h-5 w-5" />
                Validation overdue
              </CardTitle>
              <CardDescription>
                Your-input fields (liability, expected disbursement quarter, minimum value, policy limits) must be confirmed or updated every 90 days.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {attorneyScore.outdatedValidationFields.map((fieldId) => (
                <Badge key={fieldId} variant="danger">
                  {getValidationFieldLabel(fieldId)}
                </Badge>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {quarterlyCheckInDue ? (
          <Card className="border-red-200">
            <CardHeader>
              <CardTitle>Quarterly Check-In Required</CardTitle>
              <CardDescription>
                Confirm or update expected disbursement quarter and minimum value every 90 days — even when nothing changed. You can also reply in the case Slack channel when reminded.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button onClick={confirmQuarterlyCheckIn} disabled={isSaving}>
                <CheckCircle2 className="h-4 w-4" />
                Confirm no change
              </Button>
              <span className="text-sm text-muted-foreground">
                Last check-in: {formatDate(tracker.lastQuarterlyCheckInAt)}
              </span>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
              <div>
                <CardTitle>Case View</CardTitle>
                <CardDescription>
                  Amber fields are your responsibility as attorney. Gray fields sync from DocketFlow or are calculated by the tracker.
                </CardDescription>
              </div>
              <Button variant={isOverviewEditing ? "pink" : "outline"} size="sm" onClick={() => setIsOverviewEditing((current) => !current)}>
                <Pencil className="h-4 w-4" />
                {isOverviewEditing ? "View" : "Edit"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <AttorneyFieldLegend />

            {!isOverviewEditing ? (
              <>
                <div>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">From DocketFlow / system</h3>
                  <div className="grid gap-4 md:grid-cols-3">
                    <Info label="Case #" value={record.shared.caseNumber} />
                    <Info label="Client" value={record.shared.clientName} />
                    <Info label="Paralegal" value={record.paralegal.name} />
                    <Info label="Date Signed" value={formatDate(record.shared.dateSigned)} />
                    <Info label="DOL" value={formatOptionalDate(record.shared.dateOfIncident) || "Not set — edit to add"} />
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</div>
                      <div className="mt-1">
                        <DerivedCaseStatusBadge record={{ tracker }} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">Set automatically from stage and disbursement.</p>
                    </div>
                    <Info label="Type" value={record.shared.caseType || "Not set — edit to add"} />
                    <Info label="Stage" value={tracker.caseStage} />
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Case Size</div>
                      <p className="mt-1 text-sm font-medium text-navy-950">{tracker.caseSize ?? "Not set"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Calculated from minimum value.</p>
                    </div>
                    <Info
                      label="Expected Lit"
                      value={formatExpectedLitigationLabel(
                        coerceExpectedLitigationForStage(tracker.caseStage, tracker.expectedLitigation),
                      )}
                    />
                    <Info label="Policy Source" value={tracker.policyInfoSource ?? "Not set"} />
                    <Info label="Projected firm fee" value={formatCurrency(tracker.estimatedFeeValue)} />
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-800">Your input</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <AttorneyInfo fieldId="liability" record={record} value={tracker.liability ?? "Not set"} />
                    <AttorneyInfo fieldId="targetResolutionQuarter" record={record} value={tracker.targetResolutionQuarter ?? "Not set"} />
                    <AttorneyInfo fieldId="minimumValue" record={record} value={formatCurrency(tracker.minimumValue)} />
                    <AttorneyInfo fieldId="referralFee" record={record} value={formatPercentValue(tracker.referralFee)} />
                    <AttorneyInfo fieldId="policyLimits" record={record} value={formatCurrency(tracker.policyLimits)} />
                  </div>
                </div>
              </>
            ) : (
              <div className="grid gap-6">
                <div>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">From DocketFlow / system</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="DOL">
                      <Input
                        type="date"
                        value={toDateInput(shared.dateOfIncident)}
                        onChange={(event) => updateShared("dateOfIncident", fromDateInput(event.target.value))}
                      />
                    </Field>
                    <Field label="Date Signed">
                      <Input
                        type="date"
                        value={toDateInput(shared.dateSigned)}
                        onChange={(event) => updateShared("dateSigned", fromDateInput(event.target.value) ?? shared.dateSigned)}
                      />
                    </Field>
                    <Field label="Status (auto)">
                      <div className="flex min-h-10 items-center">
                        <DerivedCaseStatusBadge record={{ tracker }} />
                      </div>
                    </Field>
                    <Field label="Type">
                      <Select value={shared.caseType} onChange={(event) => updateShared("caseType", event.target.value)}>
                        <option value="">Select type</option>
                        {caseTypeSelectOptions(shared.caseType).map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Stage">
                      <Select value={tracker.caseStage} onChange={(event) => updateField("caseStage", event.target.value as TrackerEntry["caseStage"])}>
                        {CASE_STAGE_OPTIONS.map((stage) => (
                          <option key={stage} value={stage}>
                            {stage}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Expected Lit">
                      <Select
                        value={coerceExpectedLitigationForStage(tracker.caseStage, tracker.expectedLitigation) ?? ""}
                        disabled={tracker.caseStage === "Lit"}
                        onChange={(event) => {
                          const expectedLitigation = event.target.value as TrackerEntry["expectedLitigation"];
                          updateField("expectedLitigation", expectedLitigation || null);
                          if (tracker.minimumValue) {
                            updateField(
                              "estimatedFeeValue",
                              Math.round(
                                tracker.minimumValue *
                                  deriveResultFeePercent({
                                    caseStage: tracker.caseStage,
                                    expectedLitigation: expectedLitigation || null,
                                    referralFee: tracker.referralFee,
                                  }),
                              ),
                            );
                          }
                        }}
                      >
                        {tracker.caseStage === "Lit" ? (
                          <option value="Lit">{formatExpectedLitigationLabel("Lit")}</option>
                        ) : (
                          <>
                            <option value="">{formatExpectedLitigationLabel(null)}</option>
                            {EXPECTED_LITIGATION_OPTIONS.filter((status) => status !== "Lit").map((status) => (
                              <option key={status} value={status}>
                                {formatExpectedLitigationLabel(status)}
                              </option>
                            ))}
                          </>
                        )}
                      </Select>
                    </Field>
                    <Field label="Source of Policy Information">
                      <Input value={tracker.policyInfoSource ?? ""} placeholder="Declarations page, carrier email, adjuster call..." onChange={(event) => updateField("policyInfoSource", event.target.value || null)} />
                    </Field>
                    <Field label="Referral Fee Arrangement">
                      <Input value={tracker.referralFeeArrangement ?? ""} placeholder="No referral fee, percentage split, flat fee..." onChange={(event) => updateField("referralFeeArrangement", event.target.value || null)} />
                    </Field>
                    <Field label="Balance / CTA Info">
                      <Input value={tracker.balanceCtaInfo ?? ""} placeholder="CTA balance, balance reviewed, or setup note" onChange={(event) => updateField("balanceCtaInfo", event.target.value || null)} />
                    </Field>
                    <Field label="Confidence level">
                      <Select value={tracker.confidenceLevel ?? ""} onChange={(event) => updateField("confidenceLevel", (event.target.value || null) as TrackerEntry["confidenceLevel"])}>
                        <option value="">Select confidence</option>
                        {settings.confidenceLevels.map((level) => (
                          <option key={level} value={level}>
                            {level}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Projected firm fee">
                      <FormattedNumberInput prefix="$" value={tracker.estimatedFeeValue} onValueChange={(value) => updateField("estimatedFeeValue", value)} />
                    </Field>
                    <Field className="md:col-span-2" label="Forecast notes">
                      <Textarea value={tracker.forecastNotes} onChange={(event) => updateField("forecastNotes", event.target.value)} />
                    </Field>
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-800">Your input</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <AttorneyField fieldId="liability" record={record}>
                      <Select value={tracker.liability ?? ""} onChange={(event) => updateField("liability", event.target.value || null)}>
                        <option value="">Select liability</option>
                        {LIABILITY_OPTIONS.map((liability) => (
                          <option key={liability} value={liability}>
                            {liability}
                          </option>
                        ))}
                      </Select>
                    </AttorneyField>
                    <AttorneyField fieldId="targetResolutionQuarter" record={record}>
                      <Select
                        value={toStandardTargetPeriodLabel(tracker.targetResolutionQuarter) ?? ""}
                        onChange={(event) => updateField("targetResolutionQuarter", event.target.value || null)}
                      >
                        <option value="">Select expected disbursement quarter</option>
                        {quarterOptions.map((quarter) => (
                          <option key={quarter} value={quarter}>
                            {quarter}
                          </option>
                        ))}
                      </Select>
                    </AttorneyField>
                    <AttorneyField fieldId="minimumValue" record={record}>
                      <FormattedNumberInput
                        prefix="$"
                        value={tracker.minimumValue}
                        onValueChange={(value) => {
                          updateField("minimumValue", value);
                          updateField("caseSize", deriveCaseSizeFromMinimumValue(value));
                          updateField("estimatedFeeValue", value ? Math.round(value * getFeePercent(record)) : null);
                        }}
                      />
                    </AttorneyField>
                    <AttorneyField fieldId="referralFee" record={record}>
                      <FormattedNumberInput suffix="%" value={tracker.referralFee} onValueChange={(value) => updateField("referralFee", value)} />
                    </AttorneyField>
                    <AttorneyField fieldId="policyLimits" record={record}>
                      <FormattedNumberInput prefix="$" value={tracker.policyLimits} onValueChange={(value) => updateField("policyLimits", value)} />
                    </AttorneyField>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={() => saveTracker()} disabled={isSaving}>
                    <Save className="h-4 w-4" />
                    {isSaving ? "Saving..." : "Save and mark reviewed"}
                  </Button>
                  {savedAt ? (
                    <span className="inline-flex items-center gap-2 text-sm text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" />
                      Saved {formatDate(savedAt)}
                    </span>
                  ) : null}
                  {errorMessage ? <span className="text-sm text-destructive">{errorMessage}</span> : null}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-amber-200/80">
          <CardHeader>
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
              <div>
                <CardTitle>Sources and Litigation Detail</CardTitle>
                <CardDescription>
                  Your input — sources, injuries, and description must be confirmed or updated at least every 90 days.
                </CardDescription>
              </div>
              <Button variant={isSourcesEditing ? "pink" : "outline"} size="sm" onClick={() => setIsSourcesEditing((current) => !current)}>
                <Pencil className="h-4 w-4" />
                {isSourcesEditing ? "View" : "Edit"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {!isSourcesEditing ? (
              <>
                <AttorneyLongInfo fieldId="sources" record={record} value={tracker.sources} />
                <AttorneyLongInfo fieldId="injuries" record={record} value={tracker.injuries} />
                <AttorneyLongInfo className="md:col-span-2" fieldId="caseDescription" record={record} value={tracker.caseDescription} />
                <LongInfo className="md:col-span-2" label="Status notes" value={tracker.statusNotes} />
              </>
            ) : (
              <>
                <AttorneyField fieldId="sources" record={record}>
                  <Textarea value={tracker.sources} onChange={(event) => updateField("sources", event.target.value)} />
                </AttorneyField>
                <AttorneyField fieldId="injuries" record={record}>
                  <Textarea value={tracker.injuries} onChange={(event) => updateField("injuries", event.target.value)} />
                </AttorneyField>
                <AttorneyField className="md:col-span-2" fieldId="caseDescription" record={record}>
                  <Textarea value={tracker.caseDescription} onChange={(event) => updateField("caseDescription", event.target.value)} />
                </AttorneyField>
                <Field className="md:col-span-2" label="Status notes">
                  <Textarea value={tracker.statusNotes} onChange={(event) => updateField("statusNotes", event.target.value)} />
                </Field>
                <SaveActions
                  className="md:col-span-2"
                  isSaving={isSaving}
                  savedAt={savedAt}
                  errorMessage={errorMessage}
                  saveLabel="Save"
                  onSave={() => saveTracker({ markReviewed: false })}
                />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
              <div>
                <CardTitle>Results Tracking</CardTitle>
                <CardDescription>
                  Release, closing, deposit, and disbursement tracking. Import from the RJL Cases Disbursing sheet to pull
                  all rows for this case # (one row per party).
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={isSyncingSheet} onClick={() => void syncFromDisbursingSheet()}>
                  <RefreshCw className={`h-4 w-4 ${isSyncingSheet ? "animate-spin" : ""}`} />
                  {isSyncingSheet ? "Importing..." : "Import disbursing sheet"}
                </Button>
                <Button variant={isResultsEditing ? "pink" : "outline"} size="sm" onClick={() => setIsResultsEditing((current) => !current)}>
                  <Pencil className="h-4 w-4" />
                  {isResultsEditing ? "View" : "Edit"}
                </Button>
              </div>
            </div>
          </CardHeader>
          {sheetSyncMessage ? <p className="px-6 text-sm text-muted-foreground">{sheetSyncMessage}</p> : null}
          <CardContent className="grid gap-4 md:grid-cols-3">
            {!isResultsEditing ? (
              <>
                <Info label="Settlement Date" value={formatDate(tracker.result.settlementDate)} />
                <Info label="Settlement Amount" value={formatCurrency(tracker.result.settlementAmount)} />
                <Info label="Fee Percent" value={`${Math.round((tracker.result.feePercent ?? 0) * 100)}%`} />
                <Info label="RJL Attorney Fees" value={formatCurrency(tracker.result.attorneyFees)} />
                <Info label="Release" value={tracker.result.releaseStatus} />
                <Info label="Closing" value={tracker.result.closingStatus} />
                <Info label="Check" value={tracker.result.checkStatus} />
                <Info label="Disbursed" value={tracker.result.disbursedStatus} />
                <Info label="Reductions" value={tracker.result.reductionsStatus} />
                <Info label="Release Signed" value={formatDate(tracker.result.releaseSignedAt)} />
                <Info label="Closing Signed" value={formatDate(tracker.result.closingSignedAt)} />
                <Info label="Check Deposited" value={formatDate(tracker.result.checkDepositedAt)} />
                <Info label="Check Disbursed" value={formatDate(tracker.result.checkDisbursedAt)} />
                <Info label="Disburse Date" value={formatDate(tracker.result.disburseDate)} />
                <Info label="Result Quarter" value={tracker.result.resultQuarter ?? "Not set"} />
              </>
            ) : (
              <>
                <Field label="Settlement Date">
                  <Input type="date" value={toDateInput(tracker.result.settlementDate)} onChange={(event) => updateResult("settlementDate", fromDateInput(event.target.value))} />
                </Field>
                <Field label="Settlement Amount">
                  <FormattedNumberInput prefix="$" value={tracker.result.settlementAmount} onValueChange={(value) => updateResult("settlementAmount", value)} />
                </Field>
                <Field label="Fee Percent">
                  <FormattedNumberInput
                    suffix="%"
                    value={Math.round((tracker.result.feePercent ?? 0) * 100)}
                    readOnly
                  />
                </Field>
                <Field label="RJL Attorney Fees">
                  <FormattedNumberInput prefix="$" value={tracker.result.attorneyFees} readOnly />
                </Field>
                <Field label="Release">
                  <Select value={tracker.result.releaseStatus} onChange={(event) => updateResultWorkflow("releaseStatus", event.target.value as ReleaseStatus)}>
                    {RELEASE_STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Closing">
                  <Select value={tracker.result.closingStatus} onChange={(event) => updateResultWorkflow("closingStatus", event.target.value as ClosingStatus)}>
                    {CLOSING_STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Check">
                  <Select value={tracker.result.checkStatus} onChange={(event) => updateResultWorkflow("checkStatus", event.target.value as CheckStatus)}>
                    {CHECK_STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Disbursed">
                  <Select value={tracker.result.disbursedStatus} onChange={(event) => updateResultWorkflow("disbursedStatus", event.target.value as DisbursedStatus)}>
                    {DISBURSED_STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Reductions">
                  {tracker.result.disburseDate ? (
                    <Input value="Deposited" readOnly />
                  ) : (
                    <Select
                      value={tracker.result.reductionsStatus}
                      onChange={(event) => updateResult("reductionsStatus", event.target.value as ReductionsStatus)}
                    >
                      {REDUCTIONS_MANUAL_STATUS_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Release Signed">
                  <Input type="date" value={toDateInput(tracker.result.releaseSignedAt)} onChange={(event) => updateResult("releaseSignedAt", fromDateInput(event.target.value))} />
                </Field>
                <Field label="Closing Signed">
                  <Input type="date" value={toDateInput(tracker.result.closingSignedAt)} onChange={(event) => updateResult("closingSignedAt", fromDateInput(event.target.value))} />
                </Field>
                <Field label="Check Deposited">
                  <Input type="date" value={toDateInput(tracker.result.checkDepositedAt)} onChange={(event) => updateResult("checkDepositedAt", fromDateInput(event.target.value))} />
                </Field>
                <Field label="Check Disbursed">
                  <Input type="date" value={toDateInput(tracker.result.checkDisbursedAt)} onChange={(event) => updateResult("checkDisbursedAt", fromDateInput(event.target.value))} />
                </Field>
                <Field label="Disburse Date">
                  <Input type="date" value={toDateInput(tracker.result.disburseDate)} onChange={(event) => updateResult("disburseDate", fromDateInput(event.target.value))} />
                </Field>
                <Field label="Result Quarter">
                  <Input value={tracker.result.resultQuarter ?? ""} readOnly placeholder="Set disburse date" />
                </Field>
                <SaveActions
                  className="md:col-span-3"
                  isSaving={isSaving}
                  savedAt={savedAt}
                  errorMessage={errorMessage}
                  saveLabel="Save"
                  onSave={() => saveTracker({ markReviewed: false })}
                />
              </>
            )}
          </CardContent>
        </Card>

        {(isResultsEditing || tracker.multipleDisbursementsEnabled || tracker.disbursements.length > 0) ? (
          <DisbursementPartiesCard
            record={record}
            editing={isResultsEditing}
            onEnabledChange={(enabled) => updateField("multipleDisbursementsEnabled", enabled)}
            onExpectedCountChange={(count) => updateField("expectedDisbursementCount", count)}
          />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Comments and Manager Notes</CardTitle>
            <CardDescription>Every note becomes part of the lifetime case log.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Signed in as <span className="font-semibold text-navy-950">{sessionUser.name}</span> ({sessionUser.email})
            </p>
            <div className="grid gap-3 md:grid-cols-[14rem_1fr_auto]">
              <Select value={commentType} onChange={(event) => setCommentType(event.target.value as CommentType)}>
                <option value="general_note">General note</option>
                <option value="attorney_update">Attorney update</option>
                <option value="manager_note">Manager note</option>
                <option value="risk_flag">Risk flag</option>
                <option value="value_change">Value change</option>
              </Select>
              <Input value={newComment} onChange={(event) => setNewComment(event.target.value)} placeholder="Add a case note..." />
              <Button onClick={addComment} variant="pink" disabled={isAddingComment}>
                <MessageSquarePlus className="h-4 w-4" />
                {isAddingComment ? "Adding..." : "Add"}
              </Button>
            </div>
            {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
            <div className="space-y-3">
              {comments.map((comment) => (
                <div
                  key={comment.id}
                  className={
                    comment.type === "manager_note" || comment.type === "risk_flag"
                      ? "rounded-lg border border-pink-500/30 bg-pink-100/50 p-4"
                      : "rounded-lg border bg-white p-4"
                  }
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant={comment.type === "risk_flag" ? "danger" : comment.type === "manager_note" ? "pink" : "outline"}>
                      {comment.type.replace(/_/g, " ")}
                    </Badge>
                    <span className="text-sm font-semibold text-navy-950">Posted by {comment.authorName}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(comment.createdAt)}</span>
                  </div>
                  <p className="text-sm leading-6 text-navy-900">{comment.body}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-6">
        <AttorneyFieldsChecklist
          record={record}
          quarterOptions={quarterOptions}
          onUpdateField={updateField}
          onMinimumValueChange={(value) => {
            updateField("minimumValue", value);
            updateField("caseSize", deriveCaseSizeFromMinimumValue(value));
            updateField("estimatedFeeValue", value ? Math.round(value * getFeePercent(record)) : null);
          }}
          onSave={() => saveTracker()}
          isSaving={isSaving}
          savedAt={savedAt}
          errorMessage={errorMessage}
        />

        <Card>
          <CardHeader>
            <CardTitle>Living Forecast</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Info label="Minimum Value" value={formatCurrency(tracker.minimumValue)} />
            <Info label="Policy Limits" value={formatCurrency(tracker.policyLimits)} />
            <Info label="Fee Percent" value={`${Math.round(getFeePercent(record) * 100)}%`} />
            <Info label="Projected Firm Fee" value={formatCurrency(getProjectedFeeValue(record))} />
            <Info label="Expected disbursement quarter" value={tracker.targetResolutionQuarter ?? "Not set"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Setup Completeness</CardTitle>
            <CardDescription>One-time setup fields must be entered at least once.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <SetupRow label="Client name" complete={Boolean(record.shared.clientName)} />
            <SetupRow label="Date signed" complete={Boolean(record.shared.dateSigned)} />
            <SetupRow label="Date of loss" complete={Boolean(record.shared.dateOfIncident)} />
            <SetupRow label="Case type" complete={Boolean(record.shared.caseType)} />
            <SetupRow label="Referral fee arrangement" complete={Boolean(tracker.referralFeeArrangement)} />
            <SetupRow label="Balance / CTA info" complete={Boolean(tracker.balanceCtaInfo)} />
            <SetupRow label="Policy limits" complete={Boolean(tracker.policyLimits)} />
            <SetupRow label="Policy source" complete={Boolean(tracker.policyInfoSource)} />
            <SetupRow label="Injuries" complete={Boolean(tracker.injuries)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Result Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ResultStep label="Release" value={tracker.result.releaseStatus} complete={tracker.result.releaseStatus === "Signed"} />
            <ResultStep label="Closing" value={tracker.result.closingStatus} complete={tracker.result.closingStatus === "Signed"} />
            <ResultStep label="Check" value={tracker.result.checkStatus} complete={tracker.result.checkStatus === "Deposited"} />
            <ResultStep label="Disbursed" value={tracker.result.disbursedStatus} complete={tracker.result.disbursedStatus === "Yes"} />
            <ResultStep
              label="Reductions"
              value={tracker.result.reductionsStatus}
              complete={
                tracker.result.reductionsStatus === "Deposited" ||
                tracker.result.reductionsStatus === "Approved" ||
                tracker.result.reductionsStatus === "N/A"
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Case Tracker Score</CardTitle>
            <CardDescription>{attorneyScore.percent}% — contributes to your dashboard rollup.</CardDescription>
          </CardHeader>
          <CardContent>
            <AttorneyScoreBreakdown record={record} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data Quality</CardTitle>
            <CardDescription>Frontend helper flags until Supabase rules are mapped.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {flags.length === 0 ? (
              <Badge variant="success">No flags</Badge>
            ) : (
              flags.map((flag) => (
                <div key={flag.id} className="flex items-center gap-2 rounded-lg border bg-white p-3 text-sm">
                  <ShieldAlert className={flag.severity === "danger" ? "h-4 w-4 text-red-600" : "h-4 w-4 text-amber-600"} />
                  {flag.label}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lifetime Log</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {activity.map((entry) => (
              <div key={entry.id} className="border-l-2 border-pink-500 pl-3">
                <p className="text-sm font-semibold text-navy-950">{entry.action}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.userName} - {formatDate(entry.createdAt)}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{entry.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </aside>
    </div>

    {isAdmin ? (
      <Card className="border-rose-200 bg-rose-50/40">
        <CardHeader>
          <CardTitle className="text-rose-950">Admin: remove from tracker</CardTitle>
          <CardDescription>
            {isOrphanTracker
              ? "This row is an orphaned tracker record (usually left after a DocketFlow case was deleted). Removing it clears the duplicate from the case list."
              : "Removes tracker data for this case. If the DocketFlow case still exists, the case may reappear with empty tracker fields unless you also delete the DocketFlow case."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isOrphanTracker ? (
            <label className="flex items-start gap-2 text-sm text-navy-950">
              <input
                type="checkbox"
                className="mt-1"
                checked={deleteDocketflowCase}
                onChange={(event) => setDeleteDocketflowCase(event.target.checked)}
              />
              <span>Also delete the DocketFlow case record (cases table)</span>
            </label>
          ) : null}
          <Button variant="outline" className="border-rose-300 text-rose-800 hover:bg-rose-100" onClick={() => void removeFromTracker()} disabled={isDeleting}>
            <Trash2 className="h-4 w-4" />
            {isDeleting ? "Removing..." : "Remove from Case Tracker"}
          </Button>
        </CardContent>
      </Card>
    ) : null}
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-navy-950">{value}</p>
    </div>
  );
}

function AttorneyInfo({
  fieldId,
  record,
  value,
}: {
  fieldId: AttorneySourcedFieldId;
  record: CaseRecord;
  value: string;
}) {
  return (
    <div className={attorneyFieldShellClass(fieldId, record)}>
      <AttorneyFieldLabel fieldId={fieldId} record={record} />
      <p className="text-sm font-medium text-navy-950">{value}</p>
    </div>
  );
}

function AttorneyLongInfo({
  fieldId,
  record,
  value,
  className,
}: {
  fieldId: AttorneySourcedFieldId;
  record: CaseRecord;
  value: string;
  className?: string;
}) {
  return (
    <div className={`${attorneyFieldShellClass(fieldId, record)} ${className ?? ""}`}>
      <AttorneyFieldLabel fieldId={fieldId} record={record} />
      <p className="whitespace-pre-wrap text-sm leading-6 text-navy-950">{value.trim() ? value : "Not set"}</p>
    </div>
  );
}

function AttorneyField({
  fieldId,
  record,
  children,
  className,
}: {
  fieldId: AttorneySourcedFieldId;
  record: CaseRecord;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`${attorneyFieldShellClass(fieldId, record)} block ${className ?? ""}`}>
      <AttorneyFieldLabel fieldId={fieldId} record={record} />
      {children}
    </label>
  );
}

function LongInfo({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-navy-950">{value.trim() ? value : "Not set"}</p>
    </div>
  );
}

function SaveActions({
  className,
  isSaving,
  savedAt,
  errorMessage,
  saveLabel,
  onSave,
}: {
  className?: string;
  isSaving: boolean;
  savedAt: string | null;
  errorMessage: string | null;
  saveLabel: string;
  onSave: () => void;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className ?? ""}`}>
      <Button onClick={onSave} disabled={isSaving}>
        <Save className="h-4 w-4" />
        {isSaving ? "Saving..." : saveLabel}
      </Button>
      {savedAt ? (
        <span className="inline-flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          Saved {formatDate(savedAt)}
        </span>
      ) : null}
      {errorMessage ? <span className="text-sm text-destructive">{errorMessage}</span> : null}
    </div>
  );
}

function FormattedNumberInput({
  value,
  onValueChange,
  prefix,
  suffix,
  readOnly,
}: {
  value: number | null;
  onValueChange?: (value: number | null) => void;
  prefix?: string;
  suffix?: string;
  readOnly?: boolean;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(value == null ? "" : formatNumberForInput(value));

  useEffect(() => {
    if (!isFocused) setDraft(value == null ? "" : formatNumberForInput(value));
  }, [isFocused, value]);

  function commit() {
    if (readOnly) return;
    const nextValue = parseFormattedNumber(draft);
    if (nextValue !== null && Number.isNaN(nextValue)) {
      setDraft(value == null ? "" : formatNumberForInput(value));
      return;
    }
    onValueChange?.(nextValue);
    setDraft(nextValue == null ? "" : formatNumberForInput(nextValue));
    setIsFocused(false);
  }

  return (
    <div className="flex h-10 items-center rounded-md border border-input bg-white px-3 focus-within:ring-2 focus-within:ring-ring">
      {prefix ? <span className="mr-1 text-muted-foreground">{prefix}</span> : null}
      <Input
        className="h-8 min-w-0 border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
        inputMode="decimal"
        readOnly={readOnly}
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          if (readOnly) return;
          setIsFocused(true);
          setDraft(value == null ? "" : String(value));
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(value == null ? "" : formatNumberForInput(value));
            setIsFocused(false);
            event.currentTarget.blur();
          }
        }}
      />
      {suffix ? <span className="ml-1 text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

function formatNumberForInput(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function parseFormattedNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number(trimmed.replace(/[$,%\s,]/g, ""));
}

function formatPercentValue(value: number | null) {
  if (value == null) return "Not set";
  return `${formatNumberForInput(value)}%`;
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={className}>
      <span className="mb-2 block text-sm font-medium text-navy-950">{label}</span>
      {children}
    </label>
  );
}

function ResultStep({ label, value, complete }: { label: string; value: string; complete: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-white p-3">
      <span className="text-sm font-medium text-navy-950">{label}</span>
      <Badge variant={complete ? "success" : "warning"}>{value}</Badge>
    </div>
  );
}

function SetupRow({ label, complete }: { label: string; complete: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-white p-3">
      <span className="text-sm font-medium text-navy-950">{label}</span>
      <Badge variant={complete ? "success" : "warning"}>{complete ? "Complete" : "Missing"}</Badge>
    </div>
  );
}

function toDateInput(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

function fromDateInput(value: string) {
  if (!value) return null;
  return new Date(`${value}T10:00:00.000Z`).toISOString();
}
