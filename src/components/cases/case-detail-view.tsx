"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, ChevronRight, ExternalLink, MessageSquarePlus, Pencil, Phone, RefreshCw, Save, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
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
import { applyOpenSettledTrackerFallback, deriveCaseStatusFromTracker } from "@/lib/case-status";
import {
  applyDerivedSettlementResult,
  coerceReductionsStatus,
  REDUCTIONS_MANUAL_STATUS_OPTIONS,
  deriveCaseSizeFromMinimumValue,
  CASE_STAGE_OPTIONS,
  caseTypeSelectOptions,
  CHECK_STATUS_OPTIONS,
  CLOSING_STATUS_OPTIONS,
  DISBURSED_STATUS_OPTIONS,
  coerceExpectedLitigationForStage,
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
import { CaseQuoContactsList } from "@/components/cases/case-quo-contacts";
import { CommentMentionInput } from "@/components/cases/comment-mention-input";
import { DisbursementPartiesCard } from "@/components/cases/disbursement-parties-card";
import {
  LitigationEventDateInput,
  LitigationEventStatusSelect,
  updateLitigationEvent,
} from "@/components/litigation/litigation-event-fields";
import { ResultDateInput } from "@/components/cases/result-date-input";
import { dateInputToDateOnly, toDateInput } from "@/lib/date-input";
import { disbursementWeight } from "@/lib/disbursements";
import { LITIGATION_EVENT_DEFINITIONS } from "@/lib/litigation-events";
import { type SessionUser } from "@/lib/auth/types";
import { extractMentionContactIds } from "@/lib/slack/comment-mentions";
import { STAGE_SLACK_LABELS } from "@/lib/slack/enum-replies";
import { formatSlackChannelLabel, getSlackChannelArchiveUrl } from "@/lib/slack/links";
import { buildTrackerChangeInput } from "@/lib/tracker-changes";
import { getQuoClientSmsUrl } from "@/lib/quo/links";
import { formatClientPhoneDisplay } from "@/lib/quo/phone";
import {
  type ActivityLogEntry,
  type AppUser,
  type CaseDisbursement,
  type CaseRecord,
  type CaseSlackChannel,
  type CaseStatus,
  type CaseTrackerSettings,
  type DocketFlowScheduledEvent,
  type CheckStatus,
  type ClosingStatus,
  type CommentType,
  type DisbursedStatus,
  type DisbursementPartyOverrideInput,
  type ManualDisbursementInput,
  type ReductionsStatus,
  type ReleaseStatus,
  type SettlementResult,
  type TrackerUpdateInput,
  type TrackerComment,
  type LitigationEventKey,
  type LitigationEventStatus,
  type TrackerEntry,
} from "@/lib/types";
import { formatCurrency, formatDate, formatOptionalDate, getCalculatedAttorneyFees } from "@/lib/utils";

export function CaseDetailView({
  initialRecord,
  initialComments,
  initialActivity,
  settings,
  sessionUser,
  users,
  slackChannel,
  upcomingDocketFlowEvents,
  docketFlowCaseUrl,
}: {
  initialRecord: CaseRecord;
  initialComments: TrackerComment[];
  initialActivity: ActivityLogEntry[];
  settings: CaseTrackerSettings;
  sessionUser: SessionUser;
  users: AppUser[];
  slackChannel: CaseSlackChannel | null;
  upcomingDocketFlowEvents: DocketFlowScheduledEvent[];
  docketFlowCaseUrl: string | null;
}) {
  const [shared, setShared] = useState(initialRecord.shared);
  const [tracker, setTracker] = useState({
    ...initialRecord.tracker,
    quoContacts: initialRecord.tracker.quoContacts ?? [],
  });
  const [comments, setComments] = useState(initialComments);
  const [activity, setActivity] = useState(initialActivity);
  const [newComment, setNewComment] = useState("");
  const [commentType, setCommentType] = useState<CommentType>("general_note");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isOverviewEditing, setIsOverviewEditing] = useState(false);
  const [isSourcesEditing, setIsSourcesEditing] = useState(false);
  const [isLitEventsEditing, setIsLitEventsEditing] = useState(false);
  const [isResultsEditing, setIsResultsEditing] = useState(false);
  const isSettledStage = tracker.caseStage === "Settled";
  const isLitStage = tracker.caseStage === "Lit";
  const isAdmin = sessionUser.role === "admin" || sessionUser.role === "super_admin";
  const hasSheetLinkedDisbursements = tracker.disbursements.some((row) => Boolean(row.sheetRowKey));
  const [isLitEventsExpanded, setIsLitEventsExpanded] = useState(isLitStage || isAdmin);
  const [isResultsExpanded, setIsResultsExpanded] = useState(isSettledStage || isAdmin);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [stageActionId, setStageActionId] = useState<string | null>(null);
  const [deleteDocketflowCase, setDeleteDocketflowCase] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSyncingSheet, setIsSyncingSheet] = useState(false);
  const [sheetSyncMessage, setSheetSyncMessage] = useState<string | null>(null);
  const router = useRouter();
  const serverTrackerRef = useRef(initialRecord.tracker);

  useEffect(() => {
    setShared(initialRecord.shared);
    setTracker(initialRecord.tracker);
    serverTrackerRef.current = initialRecord.tracker;
  }, [initialRecord]);

  function applyServerTracker(savedTracker: TrackerEntry, sharedStatus?: CaseStatus | null) {
    serverTrackerRef.current = savedTracker;
    setTracker((current) => ({
      ...current,
      ...savedTracker,
      result: savedTracker.result ?? current.result,
      detectedStageSignals: current.detectedStageSignals,
    }));
    if (sharedStatus) {
      setShared((current) => ({ ...current, status: sharedStatus }));
    } else {
      setShared((current) => ({
        ...current,
        status: deriveCaseStatusFromTracker(savedTracker.caseStage, savedTracker.result),
      }));
    }
  }

  useEffect(() => {
    if (tracker.caseStage === "Settled") {
      setIsResultsExpanded(true);
    } else if (!isAdmin) {
      setIsResultsExpanded(false);
      setIsResultsEditing(false);
    }
  }, [tracker.caseStage, isAdmin]);

  useEffect(() => {
    if (tracker.caseStage === "Lit") {
      setIsLitEventsExpanded(true);
    } else if (!isAdmin) {
      setIsLitEventsExpanded(false);
      setIsLitEventsEditing(false);
    }
  }, [tracker.caseStage, isAdmin]);

  const isOrphanTracker = initialRecord.shared.id === initialRecord.tracker.id;

  const quarterOptions = useMemo(() => getTargetPeriodSelectOptions(tracker.targetResolutionQuarter), [tracker.targetResolutionQuarter]);
  const record = useMemo(() => ({ ...initialRecord, shared, tracker }), [initialRecord, shared, tracker]);
  const flags = getDataQualityFlags(record, settings);
  const attorneyScore = getCaseAttorneyScore(record);
  const openStageSuggestions = getOpenStageSuggestions(record);
  const quarterlyCheckInDue = needsQuarterlyCheckIn(record);
  const slackChannelUrl = slackChannel ? getSlackChannelArchiveUrl(slackChannel) : null;
  const slackChannelLabel = slackChannel ? formatSlackChannelLabel(slackChannel.slackChannelName) : null;
  const clientPhoneDisplay = formatClientPhoneDisplay(tracker.clientPhone);
  const quoSmsUrl = getQuoClientSmsUrl({
    quoConversationId: tracker.quoConversationId,
    quoPhoneNumberId: tracker.quoPhoneNumberId,
  });

  function recalcEstimatedFee(next: TrackerEntry) {
    // 0 is a valid minimum — clear projected fee instead of keeping a stale estimate.
    if (next.minimumValue == null) return next.estimatedFeeValue;
    return Math.round(next.minimumValue * deriveResultFeePercent(next));
  }

  function deriveTrackerSettlement(current: TrackerEntry): TrackerEntry {
    return applyOpenSettledTrackerFallback({
      ...current,
      result: applyDerivedSettlementResult(current.result, current),
    });
  }

  function updateField<K extends keyof TrackerEntry>(key: K, value: TrackerEntry[K]) {
    setTracker((current) => {
      const next = { ...current, [key]: value };
      if (key === "caseStage") {
        next.expectedLitigation = coerceExpectedLitigationForStage(next.caseStage, next.expectedLitigation);
        setShared((s) => ({
          ...s,
          status: deriveCaseStatusFromTracker(next.caseStage, next.result),
        }));
      }
      if (key === "caseStage" || key === "referralFee" || key === "minimumValue") {
        next.estimatedFeeValue = recalcEstimatedFee(next);
      }
      if (key === "caseStage" || key === "referralFee") {
        return { ...next, result: applyDerivedSettlementResult(next.result, next, { skipDisbursementAggregation: true }) };
      }
      return next;
    });
  }

  function updateLitigationEventField(
    key: LitigationEventKey,
    patch: Partial<TrackerEntry["litigationEvents"][LitigationEventKey]>,
  ) {
    setTracker((current) => ({
      ...current,
      litigationEvents: updateLitigationEvent(current.litigationEvents, key, patch),
    }));
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
        message?: string;
        disbursementsSynced?: number;
        sheetRowsFound?: number;
        clearedSheetData?: boolean;
        sheetDisbursementsRemoved?: number;
        stageRestored?: string | null;
        details?: Array<{
          stageRestored?: string | null;
          disbursedStatus?: string;
          pendingPartyCount?: number;
        }>;
        tracker?: TrackerEntry | null;
        sharedStatus?: CaseStatus | null;
      };
      if (!response.ok) throw new Error(body.error ?? "Unable to import from disbursing sheet.");

      if (body.tracker) {
        applyServerTracker(body.tracker, body.sharedStatus ?? null);
      }

      if (body.clearedSheetData) {
        const parts = [
          body.message ??
            `No rows on the disbursing sheet — cleared stale settlement data${
              body.sheetDisbursementsRemoved ? ` (${body.sheetDisbursementsRemoved} sheet party row(s) removed)` : ""
            }.`,
        ];
        if (body.stageRestored) {
          parts.push(`Stage restored to ${body.stageRestored}.`);
        }
        setSheetSyncMessage(parts.join(" "));
      } else {
        const detail = body.details?.[0];
        const parts = [`Imported ${body.disbursementsSynced ?? 0} disbursement party row(s) from the sheet.`];
        if (detail?.stageRestored) {
          parts.push(`Stage restored to ${detail.stageRestored} (Full Settlement is N on the sheet).`);
        } else if (detail?.disbursedStatus === "No" && (detail.pendingPartyCount ?? 0) > 0) {
          parts.push("Case left Active — waiting on remaining disbursement parties.");
        } else if (detail?.disbursedStatus === "No" && body.sheetRowsFound) {
          parts.push("Case left Active — Full Settlement is N on the sheet.");
        }
        setSheetSyncMessage(parts.join(" "));
      }
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
        { skipDisbursementAggregation: true },
      ),
    }));
  }

  function updateDisbursementParty(id: string, patch: Partial<CaseDisbursement>) {
    setTracker((current) => {
      const disbursements = current.disbursements.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if (row.sheetRowKey) {
          if (patch.disburseDate !== undefined) {
            next.disburseDateLocked = patch.disburseDate ? true : next.disburseDateLocked;
            if (patch.disburseDate) next.pendingRemaining = false;
          }
          if (patch.settlementDate !== undefined && patch.settlementDate) {
            next.settlementDateLocked = true;
          }
        }
        return next;
      });
      const next = { ...current, disbursements };
      return deriveTrackerSettlement(next);
    });
  }

  function addManualDisbursement() {
    setTracker((current) => {
      const partyCount = Math.max(current.expectedDisbursementCount, current.disbursements.length + 1);
      return {
        ...current,
        expectedDisbursementCount: Math.max(current.expectedDisbursementCount, partyCount),
        disbursements: [
          ...current.disbursements,
          {
            id: `manual-${crypto.randomUUID()}`,
            partyLabel: "",
            settlementDate: null,
            disburseDate: null,
            settlementAmount: null,
            attorneyFees: null,
            weight: disbursementWeight(partyCount),
            pendingRemaining: false,
            sheetRowKey: null,
            disburseDateLocked: false,
            settlementDateLocked: false,
            syncedAt: null,
          },
        ],
      };
    });
  }

  function removeManualDisbursement(id: string) {
    setTracker((current) => ({
      ...current,
      disbursements: current.disbursements.filter((row) => row.id !== id),
    }));
  }

  function disbursementOverridesForSave(disbursements: CaseDisbursement[]): DisbursementPartyOverrideInput[] {
    return disbursements
      .filter((row) => row.sheetRowKey)
      .map((row) => ({
        id: row.id,
        disburseDate: row.disburseDate,
        settlementDate: row.settlementDate,
        pendingRemaining: row.pendingRemaining,
        disburseDateLocked: row.disburseDateLocked,
        settlementDateLocked: row.settlementDateLocked,
      }));
  }

  function manualDisbursementsForSave(disbursements: CaseDisbursement[]): ManualDisbursementInput[] {
    return disbursements
      .filter((row) => !row.sheetRowKey)
      .map((row) => ({
        id: row.id.startsWith("manual-") ? undefined : row.id,
        partyLabel: row.partyLabel,
        settlementDate: row.settlementDate,
        disburseDate: row.disburseDate,
        settlementAmount: row.settlementAmount,
        attorneyFees: row.attorneyFees,
        pendingRemaining: row.pendingRemaining,
      }));
  }

  function updateResultWorkflow<K extends "releaseStatus" | "closingStatus" | "checkStatus" | "disbursedStatus">(
    key: K,
    value: SettlementResult[K],
  ) {
    setTracker((current) => {
      const result = { ...current.result, [key]: value };
      if (key === "disbursedStatus" && value === "No") {
        result.checkDisbursedAt = null;
      }
      const next = { ...current, result };
      if (key === "disbursedStatus") {
        setShared((s) => ({
          ...s,
          status: deriveCaseStatusFromTracker(next.caseStage, next.result),
        }));
      }
      return deriveTrackerSettlement({
        ...next,
        result: applyDerivedSettlementResult(next.result, next, { skipDisbursementAggregation: true }),
      });
    });
  }

  function updateQuoContactSmsEnabled(contactId: string, smsEnabled: boolean) {
    setTracker((current) => ({
      ...current,
      quoContacts: current.quoContacts.map((contact) =>
        contact.id === contactId ? { ...contact, smsEnabled } : contact,
      ),
    }));
  }

  function buildQuoContactPreferences(nextTracker: TrackerEntry) {
    return nextTracker.quoContacts
      .filter((contact) => {
        const previous = serverTrackerRef.current.quoContacts.find((item) => item.id === contact.id);
        return previous && previous.smsEnabled !== contact.smsEnabled;
      })
      .map((contact) => ({ id: contact.id, smsEnabled: contact.smsEnabled }));
  }

  async function persistTracker(nextTracker: TrackerEntry, options?: { markReviewed?: boolean }) {
    const changeInput = buildTrackerChangeInput(nextTracker, serverTrackerRef.current, {
      manualDisbursements: manualDisbursementsForSave(nextTracker.disbursements),
      disbursementOverrides: disbursementOverridesForSave(nextTracker.disbursements),
    });
    const quoContactPreferences = buildQuoContactPreferences(nextTracker);
    const payload = {
      shared: {
        caseType: shared.caseType,
        dateOfIncident: shared.dateOfIncident,
        preferredLanguage: shared.preferredLanguage,
        secondaryLanguage: shared.secondaryLanguage,
        usesEve: shared.usesEve,
      },
      tracker: {
        ...changeInput,
        ...(quoContactPreferences.length > 0 ? { quoContactPreferences } : {}),
      },
      changeInput,
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

  async function saveTracker(options?: { markReviewed?: boolean; exitOverviewEdit?: boolean }) {
    const markReviewed = options?.markReviewed ?? true;
    const now = new Date().toISOString();
    const nextTracker = deriveTrackerSettlement({
      ...tracker,
      lastReviewedAt: markReviewed ? now : tracker.lastReviewedAt,
      updatedAt: now,
    });

    setIsSaving(true);
    setErrorMessage(null);
    try {
      const { tracker: savedTracker, activity: savedActivity } = await persistTracker(nextTracker, { markReviewed });
      serverTrackerRef.current = savedTracker;
      setTracker((current) => ({
        ...current,
        ...savedTracker,
        result: savedTracker.result ?? current.result,
        detectedStageSignals: current.detectedStageSignals,
      }));
      setShared((current) => ({
        ...current,
        status: deriveCaseStatusFromTracker(savedTracker.caseStage, savedTracker.result),
      }));
      if (savedActivity) {
        setActivity((current) => [savedActivity, ...current]);
      }
      setSavedAt(now);
      if (options?.exitOverviewEdit) {
        setIsOverviewEditing(false);
      }
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to save tracker entry.");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmQuarterlyCheckIn() {
    const now = new Date().toISOString();
    const nextTracker = {
      ...tracker,
      result: applyDerivedSettlementResult(tracker.result, tracker, { skipDisbursementAggregation: true }),
      lastQuarterlyCheckInAt: now,
      lastReviewedAt: now,
      updatedAt: now,
    };

    setIsSaving(true);
    setErrorMessage(null);
    try {
      const { tracker: savedTracker, activity: savedActivity } = await persistTracker(nextTracker);
      serverTrackerRef.current = savedTracker;
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
          estimatedFeeValue:
            current.minimumValue == null
              ? current.estimatedFeeValue
              : Math.round(
                  current.minimumValue *
                    deriveResultFeePercent({
                      caseStage: signal.suggestedStage,
                      referralFee: current.referralFee,
                    }),
                ),
        }),
        detectedStageSignals: current.detectedStageSignals.map((item) =>
          item.id === signalId ? { ...item, confirmedAt: now } : item,
        ),
        updatedAt: savedTracker?.updatedAt ?? now,
      }));
      if (savedTracker) {
        setShared((current) => ({
          ...current,
          status: deriveCaseStatusFromTracker(savedTracker.caseStage, savedTracker.result),
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
      const notifyContactIds = extractMentionContactIds(newComment, users);
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: record.shared.id,
          type: commentType,
          body: newComment.trim(),
          notifyContactIds,
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
                <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-navy-950">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">Primary language</span>
                    <PreferredLanguageLabel language={shared.preferredLanguage} />
                  </span>
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">Secondary language</span>
                    {shared.secondaryLanguage ? (
                      <PreferredLanguageLabel language={shared.secondaryLanguage} />
                    ) : (
                      <span className="font-medium text-muted-foreground">None</span>
                    )}
                  </span>
                </p>
                <div className="mt-2 text-sm text-navy-950">
                  <div className="text-muted-foreground">Quo contacts</div>
                  <div className="mt-1">
                    {tracker.quoContacts.length > 0 ? (
                      <CaseQuoContactsList contacts={tracker.quoContacts} />
                    ) : clientPhoneDisplay ? (
                      quoSmsUrl ? (
                        <a
                          href={quoSmsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-pink-600 hover:text-pink-500"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          {clientPhoneDisplay}
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span className="sr-only">Open Quo inbox</span>
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                          {clientPhoneDisplay}
                        </span>
                      )
                    ) : (
                      <CaseQuoContactsList contacts={[]} />
                    )}
                  </div>
                </div>
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
                Confirm or dismiss — the tracker is not updated until you do. These usually come from the daily pulse recap.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {openStageSuggestions.map((signal) => (
                <div key={signal.id} className="rounded-lg border bg-white p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge variant="pink">{signal.source}</Badge>
                    <Badge variant="outline">{signal.confidence} confidence</Badge>
                    <span className="text-sm font-semibold text-navy-950">
                      Suggested stage: {STAGE_SLACK_LABELS[signal.suggestedStage] ?? signal.suggestedStage}
                      {record.tracker.caseStage !== signal.suggestedStage ? (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          (currently {STAGE_SLACK_LABELS[record.tracker.caseStage] ?? record.tracker.caseStage})
                        </span>
                      ) : null}
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
              <div className="flex shrink-0 items-center gap-2">
                {isOverviewEditing ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setIsOverviewEditing(false)} disabled={isSaving}>
                      Cancel
                    </Button>
                    <Button
                      variant="pink"
                      size="sm"
                      disabled={isSaving}
                      onClick={() => saveTracker({ exitOverviewEdit: true })}
                    >
                      <Save className="h-4 w-4" />
                      {isSaving ? "Saving..." : "Save"}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setIsOverviewEditing(true)}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Button>
                )}
              </div>
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
                    <LongInfo label="Policy Source" value={tracker.policyInfoSource ?? ""} className="md:col-span-3" />
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quo contacts</div>
                      <div className="mt-1">
                        <CaseQuoContactsList contacts={tracker.quoContacts} />
                      </div>
                      {!tracker.quoContacts.length && tracker.clientPhone ? (
                        <p className="mt-1 text-sm text-muted-foreground">Legacy phone: {tracker.clientPhone}</p>
                      ) : null}
                    </div>
                    <Info label="Projected firm fee" value={formatCurrency(getProjectedFeeValue(record))} />
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-800">Your input</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <AttorneyInfo fieldId="liability" record={record} value={tracker.liability ?? "Not set"} />
                    <AttorneyInfo fieldId="targetResolutionQuarter" record={record} value={tracker.targetResolutionQuarter ?? "Not set"} />
                    <AttorneyInfo fieldId="minimumValue" record={record} value={formatCurrency(tracker.minimumValue)} />
                    <AttorneyInfo fieldId="referralFee" record={record} value={formatPercentValue(tracker.referralFee, 2)} />
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
                        onChange={(event) => updateShared("dateOfIncident", dateInputToDateOnly(event.target.value))}
                      />
                    </Field>
                    <Field label="Date Signed">
                      <Input
                        type="date"
                        value={toDateInput(shared.dateSigned)}
                        onChange={(event) =>
                          updateShared("dateSigned", dateInputToDateOnly(event.target.value) ?? shared.dateSigned)
                        }
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
                    <Field label="Quo contacts (SMS)">
                      {tracker.quoContacts.length > 0 ? (
                        <CaseQuoContactsList
                          contacts={tracker.quoContacts}
                          editable
                          onSmsEnabledChange={updateQuoContactSmsEnabled}
                        />
                      ) : (
                        <div className="space-y-2 text-sm text-muted-foreground">
                          <p>No Quo contacts synced yet. Run sync on Client SMS settings, or enter a phone manually below.</p>
                          <Input
                            value={tracker.clientPhone ?? ""}
                            placeholder="+15125551234"
                            onChange={(event) => updateField("clientPhone", event.target.value.trim() || null)}
                          />
                        </div>
                      )}
                    </Field>
                    <Field label="Primary language">
                      <Select
                        value={shared.preferredLanguage}
                        onChange={(event) =>
                          updateShared("preferredLanguage", event.target.value as typeof shared.preferredLanguage)
                        }
                      >
                        <option value="en">English</option>
                        <option value="es">Spanish</option>
                      </Select>
                    </Field>
                    <Field label="Secondary language">
                      <Select
                        value={shared.secondaryLanguage ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          updateShared("secondaryLanguage", value === "" ? null : (value as "en" | "es"));
                        }}
                      >
                        <option value="">None</option>
                        <option value="en">English</option>
                        <option value="es">Spanish</option>
                      </Select>
                    </Field>
                    <Field label="Uses Eve">
                      <Select
                        value={shared.usesEve ? "yes" : "no"}
                        onChange={(event) => updateShared("usesEve", event.target.value === "yes")}
                      >
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
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
                    <Field className="md:col-span-2" label="Source of Policy Information">
                      <Textarea
                        className="min-h-[88px]"
                        value={tracker.policyInfoSource ?? ""}
                        placeholder={"Declarations page, carrier email, adjuster call...\nOne source per line is fine."}
                        onChange={(event) => updateField("policyInfoSource", event.target.value || null)}
                      />
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
                        }}
                      />
                    </AttorneyField>
                    <AttorneyField fieldId="referralFee" record={record}>
                      <FormattedNumberInput
                        suffix="%"
                        fractionDigits={2}
                        value={tracker.referralFee}
                        onValueChange={(value) => updateField("referralFee", value)}
                      />
                    </AttorneyField>
                    <AttorneyField fieldId="policyLimits" record={record}>
                      <FormattedNumberInput prefix="$" value={tracker.policyLimits} onValueChange={(value) => updateField("policyLimits", value)} />
                    </AttorneyField>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
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
                <CardTitle>Injuries and Litigation Detail</CardTitle>
                <CardDescription>
                  Your input — injuries and description must be confirmed or updated at least every 90 days.
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
                <AttorneyLongInfo fieldId="injuries" record={record} value={tracker.injuries} />
                <AttorneyLongInfo className="md:col-span-2" fieldId="caseDescription" record={record} value={tracker.caseDescription} />
              </>
            ) : (
              <>
                <AttorneyField fieldId="injuries" record={record}>
                  <Textarea value={tracker.injuries} onChange={(event) => updateField("injuries", event.target.value)} />
                </AttorneyField>
                <AttorneyField className="md:col-span-2" fieldId="caseDescription" record={record}>
                  <Textarea value={tracker.caseDescription} onChange={(event) => updateField("caseDescription", event.target.value)} />
                </AttorneyField>
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
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-0.5 h-8 w-8 shrink-0 p-0"
                  onClick={() => setIsLitEventsExpanded((current) => !current)}
                  aria-expanded={isLitEventsExpanded}
                  aria-label={isLitEventsExpanded ? "Collapse litigation events" : "Expand litigation events"}
                >
                  {isLitEventsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
                <div className="min-w-0">
                  <CardTitle>Litigation Events</CardTitle>
                  <CardDescription>
                    {isLitEventsExpanded || isLitStage || isAdmin
                      ? "Track depositions, mediation, and trial with the scheduled date and status for each event."
                      : "Collapsed by default until Lit — expand when the case enters litigation."}
                  </CardDescription>
                </div>
              </div>
              {isLitEventsExpanded ? (
                <Button
                  variant={isLitEventsEditing ? "pink" : "outline"}
                  size="sm"
                  onClick={() => setIsLitEventsEditing((current) => !current)}
                >
                  <Pencil className="h-4 w-4" />
                  {isLitEventsEditing ? "View" : "Edit"}
                </Button>
              ) : null}
            </div>
          </CardHeader>
          {isLitEventsExpanded ? (
            <CardContent>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50/80 text-left">
                      <th className="px-4 py-3 font-semibold text-navy-950">Event</th>
                      <th className="px-4 py-3 font-semibold text-navy-950">Date</th>
                      <th className="px-4 py-3 font-semibold text-navy-950">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {LITIGATION_EVENT_DEFINITIONS.map((event) => {
                      const current = tracker.litigationEvents[event.key];
                      return (
                        <tr key={event.key} className="border-b last:border-b-0">
                          <td className="px-4 py-3 font-medium text-navy-950">{event.label}</td>
                          <td className="px-4 py-3">
                            <LitigationEventDateInput
                              value={current.date}
                              readOnly={!isLitEventsEditing}
                              onChange={(date) => updateLitigationEventField(event.key, { date })}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <LitigationEventStatusSelect
                              value={current.status}
                              readOnly={!isLitEventsEditing}
                              onChange={(status) =>
                                updateLitigationEventField(event.key, { status: status as LitigationEventStatus | null })
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {isLitEventsEditing ? (
                <SaveActions
                  className="mt-4"
                  isSaving={isSaving}
                  savedAt={savedAt}
                  errorMessage={errorMessage}
                  saveLabel="Save litigation events"
                  onSave={() => saveTracker({ markReviewed: false })}
                />
              ) : null}
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-0.5 h-8 w-8 shrink-0 p-0"
                  onClick={() => setIsResultsExpanded((current) => !current)}
                  aria-expanded={isResultsExpanded}
                  aria-label={isResultsExpanded ? "Collapse results tracking" : "Expand results tracking"}
                >
                  {isResultsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
                <div className="min-w-0">
                  <CardTitle>Results Tracking</CardTitle>
                  <CardDescription>
                    {isResultsExpanded || isSettledStage || isAdmin
                      ? "Update Release, Closing, Check, and Reductions while the case is settling out. Settlement amounts and dates come from the RJL Cases Disbursing sheet (import or nightly sync)."
                      : "Collapsed by default until Settled — expand when you need to review or enter settlement and disbursement details."}
                  </CardDescription>
                </div>
              </div>
              {isResultsExpanded ? (
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
              ) : null}
            </div>
          </CardHeader>
          {isResultsExpanded ? (
            <>
              {sheetSyncMessage ? <p className="px-6 text-sm text-muted-foreground">{sheetSyncMessage}</p> : null}
              <CardContent className="space-y-6">
            {!isResultsEditing ? (
              <>
                <ResultsSectionHeading
                  title="Disbursement workflow"
                  description="Editable until the case is fully disbursed — then updated automatically from the sheet."
                />
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <Info label="Release" value={tracker.result.releaseStatus} />
                  <Info label="Closing" value={tracker.result.closingStatus} />
                  <Info label="Check" value={tracker.result.checkStatus} />
                  <Info label="Reductions" value={coerceReductionsStatus(tracker.result.reductionsStatus)} />
                </div>
                <ResultsSectionHeading
                  title="From disbursing sheet"
                  description="Settlement amounts and dates — updated on import and nightly sync."
                  muted
                />
                <div className="grid gap-4 md:grid-cols-3">
                  <SheetSyncedInfo label="Settlement Date" value={formatOptionalDate(tracker.result.settlementDate)} />
                  <SheetSyncedInfo label="Settlement Amount" value={formatCurrency(tracker.result.settlementAmount)} />
                  <SheetSyncedInfo label="Fee Percent" value={`${Math.round((tracker.result.feePercent ?? 0) * 100)}%`} />
                  <SheetSyncedInfo label="RJL Attorney Fees" value={formatCurrency(tracker.result.attorneyFees)} />
                  <SheetSyncedInfo label="Disbursed" value={tracker.result.disbursedStatus} />
                  <SheetSyncedInfo label="Disburse Date" value={formatOptionalDate(tracker.result.disburseDate)} />
                  <SheetSyncedInfo label="Result Quarter" value={tracker.result.resultQuarter ?? "Not set"} />
                </div>
              </>
            ) : (
              <>
                <ResultsSectionHeading
                  title="Disbursement workflow"
                  description="Editable until the case is fully disbursed — then updated automatically from the sheet."
                />
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
                  <Field label="Reductions">
                    <Select
                      value={coerceReductionsStatus(tracker.result.reductionsStatus)}
                      onChange={(event) => updateResult("reductionsStatus", event.target.value as ReductionsStatus)}
                    >
                      {REDUCTIONS_MANUAL_STATUS_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <ResultsSectionHeading
                  title="From disbursing sheet"
                  description={
                    hasSheetLinkedDisbursements
                      ? "Read-only — updated on import and nightly sync."
                      : "Import the disbursing sheet to populate these fields. Until then, settlement date and amount can be entered manually."
                  }
                  muted
                />
                <div className="grid gap-4 md:grid-cols-3">
                  <SheetSyncedField label="Settlement Date" sheetSynced={hasSheetLinkedDisbursements}>
                    <ResultDateInput
                      value={tracker.result.settlementDate}
                      readOnly={hasSheetLinkedDisbursements}
                      onCommit={(value) => updateResult("settlementDate", dateInputToDateOnly(value))}
                    />
                  </SheetSyncedField>
                  <SheetSyncedField label="Settlement Amount" sheetSynced={hasSheetLinkedDisbursements}>
                    <FormattedNumberInput
                      prefix="$"
                      sheetSynced={hasSheetLinkedDisbursements}
                      value={tracker.result.settlementAmount}
                      readOnly={hasSheetLinkedDisbursements}
                      onValueChange={(value) => updateResult("settlementAmount", value)}
                    />
                  </SheetSyncedField>
                  <SheetSyncedField label="Fee Percent" sheetSynced>
                    <FormattedNumberInput
                      suffix="%"
                      sheetSynced
                      value={Math.round((tracker.result.feePercent ?? 0) * 100)}
                      readOnly
                    />
                  </SheetSyncedField>
                  <SheetSyncedField label="RJL Attorney Fees" sheetSynced>
                    <FormattedNumberInput prefix="$" sheetSynced value={tracker.result.attorneyFees} readOnly />
                  </SheetSyncedField>
                  <SheetSyncedField label="Disbursed" sheetSynced={hasSheetLinkedDisbursements}>
                    <Select
                      value={tracker.result.disbursedStatus}
                      disabled={hasSheetLinkedDisbursements}
                      className={hasSheetLinkedDisbursements ? "bg-slate-50 text-slate-600" : undefined}
                      onChange={(event) => updateResultWorkflow("disbursedStatus", event.target.value as DisbursedStatus)}
                    >
                      {DISBURSED_STATUS_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  </SheetSyncedField>
                  <SheetSyncedField label="Disburse Date" sheetSynced={hasSheetLinkedDisbursements}>
                    <ResultDateInput
                      value={tracker.result.disburseDate}
                      readOnly={hasSheetLinkedDisbursements}
                      onCommit={(value) => updateResult("disburseDate", dateInputToDateOnly(value))}
                    />
                  </SheetSyncedField>
                  <SheetSyncedField label="Result Quarter" sheetSynced>
                    <Input
                      value={tracker.result.resultQuarter ?? ""}
                      readOnly
                      placeholder="Set disburse date"
                      className="bg-slate-50 text-slate-600"
                    />
                  </SheetSyncedField>
                </div>
                <SaveActions
                  isSaving={isSaving}
                  savedAt={savedAt}
                  errorMessage={errorMessage}
                  saveLabel="Save"
                  onSave={() => saveTracker({ markReviewed: false })}
                />
              </>
            )}
              </CardContent>
            </>
          ) : null}
        </Card>

        {isResultsExpanded && (isResultsEditing || tracker.multipleDisbursementsEnabled || tracker.disbursements.length > 0) ? (
          <DisbursementPartiesCard
            record={record}
            editing={isResultsEditing}
            showManualOnly={
              isResultsEditing &&
              !tracker.multipleDisbursementsEnabled &&
              tracker.disbursements.length === 0
            }
            onEnabledChange={(enabled) => updateField("multipleDisbursementsEnabled", enabled)}
            onExpectedCountChange={(count) => updateField("expectedDisbursementCount", count)}
            onAddManualParty={addManualDisbursement}
            onUpdateManualParty={updateDisbursementParty}
            onUpdateSheetParty={updateDisbursementParty}
            onRemoveManualParty={removeManualDisbursement}
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
            <div className="grid gap-3 md:grid-cols-[14rem_1fr_auto] md:items-start">
              <Select value={commentType} onChange={(event) => setCommentType(event.target.value as CommentType)}>
                <option value="general_note">General note</option>
                <option value="attorney_update">Attorney update</option>
                <option value="manager_note">Manager note</option>
                <option value="risk_flag">Risk flag</option>
                <option value="value_change">Value change</option>
              </Select>
              <CommentMentionInput
                value={newComment}
                onChange={setNewComment}
                users={users}
                priorityContactIds={[record.shared.attorneyId, record.shared.paralegalId]}
                disabled={isAddingComment}
              />
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
            <SetupRow label="Policy limits" complete={tracker.policyLimits != null} />
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
              value={coerceReductionsStatus(tracker.result.reductionsStatus)}
              complete={coerceReductionsStatus(tracker.result.reductionsStatus) === "Approved"}
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

function MexicoFlagIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 3 2"
      aria-hidden
      className="inline-block h-[0.9em] w-[1.35em] shrink-0 rounded-[2px] border border-black/10"
    >
      <rect width="1" height="2" fill="#006847" />
      <rect x="1" width="1" height="2" fill="#fff" />
      <rect x="2" width="1" height="2" fill="#ce1126" />
    </svg>
  );
}

function PreferredLanguageLabel({ language }: { language: "en" | "es" }) {
  if (language === "es") {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium">
        <MexicoFlagIcon />
        Spanish
      </span>
    );
  }
  return <span className="font-medium">English</span>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-navy-950">{value}</p>
    </div>
  );
}

function ResultsSectionHeading({
  title,
  description,
  muted = false,
}: {
  title: string;
  description: string;
  muted?: boolean;
}) {
  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wide ${muted ? "text-muted-foreground" : "text-navy-950"}`}>
        {title}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function SheetSyncedInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-2.5">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-600">{value}</p>
    </div>
  );
}

function SheetSyncedField({
  label,
  children,
  sheetSynced = true,
}: {
  label: string;
  children: React.ReactNode;
  sheetSynced?: boolean;
}) {
  return (
    <label className="block">
      <span className={`mb-2 block text-sm font-medium ${sheetSynced ? "text-muted-foreground" : "text-navy-950"}`}>
        {label}
        {sheetSynced ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(sheet)</span> : null}
      </span>
      {children}
    </label>
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
  sheetSynced,
  fractionDigits,
}: {
  value: number | null;
  onValueChange?: (value: number | null) => void;
  prefix?: string;
  suffix?: string;
  readOnly?: boolean;
  sheetSynced?: boolean;
  /** When set, always show this many fraction digits (e.g. referral fee 33.33%). */
  fractionDigits?: number;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const formatValue = (next: number) => formatNumberForInput(next, fractionDigits);
  const [draft, setDraft] = useState(value == null ? "" : formatValue(value));

  useEffect(() => {
    if (!isFocused) setDraft(value == null ? "" : formatValue(value));
  }, [isFocused, value, fractionDigits]);

  function commit() {
    if (readOnly) return;
    const nextValue = parseFormattedNumber(draft);
    if (nextValue !== null && Number.isNaN(nextValue)) {
      setDraft(value == null ? "" : formatValue(value));
      return;
    }
    onValueChange?.(nextValue);
    setDraft(nextValue == null ? "" : formatValue(nextValue));
    setIsFocused(false);
  }

  return (
    <div
      className={`flex h-10 items-center rounded-md border px-3 focus-within:ring-2 focus-within:ring-ring ${
        sheetSynced ? "border-slate-200 bg-slate-50 text-slate-600" : "border-input bg-white"
      }`}
    >
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
            setDraft(value == null ? "" : formatValue(value));
            setIsFocused(false);
            event.currentTarget.blur();
          }
        }}
      />
      {suffix ? <span className="ml-1 text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

function formatNumberForInput(value: number, fractionDigits?: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits ?? 2,
  }).format(value);
}

function parseFormattedNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number(trimmed.replace(/[$,%\s,]/g, ""));
}

function formatPercentValue(value: number | null, fractionDigits = 2) {
  if (value == null) return "Not set";
  return `${formatNumberForInput(value, fractionDigits)}%`;
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

