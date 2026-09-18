"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { CASE_STAGE_OPTIONS, CASE_TYPE_OPTIONS } from "@/lib/case-options";
import { SMS_DEFAULT_EXCLUDED_TO_STAGES } from "@/lib/sms/automation-match";
import { MANUAL_SMS_BATCH_SIZE } from "@/lib/sms/manual-send";
import { type SmsAutomation, type SmsAutomationTriggerType } from "@/lib/supabase/sms-automations";
import { STAGE_SLACK_LABELS } from "@/lib/slack/enum-replies";
import { type AppUser, type CaseStage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type ManualSmsProgressItem = {
  caseId: string;
  caseNumber: string;
  clientName: string | null;
  phone: string;
  language: "en" | "es";
  status?: string;
  sentAt?: string | null;
  errorMessage?: string | null;
};

type ManualSmsProgress = {
  cases: number;
  english: number;
  spanish: number;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  remainingCount: number;
  missingPhoneCount: number;
  excludedCount?: number;
  onlyCaseNumbers?: string[];
  done: boolean;
  sent: ManualSmsProgressItem[];
  failed: ManualSmsProgressItem[];
  remaining: ManualSmsProgressItem[];
  missingPhone: ManualSmsProgressItem[];
};

function parseCaseNumbersInput(value: string) {
  return value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatProgressRow(item: ManualSmsProgressItem) {
  const name = item.clientName?.trim() || "—";
  const phone = item.phone?.trim() || "no phone";
  return `#${item.caseNumber} · ${name} · ${phone} · ${item.language.toUpperCase()}`;
}

type ToMode = "specific" | "any";

const EMPTY_FORM = {
  name: "",
  enabled: true,
  triggerType: "stage_change" as SmsAutomationTriggerType,
  fromStages: [] as CaseStage[],
  inStages: [] as CaseStage[],
  toMode: "specific" as ToMode,
  toStage: "Dmd" as CaseStage,
  excludedToStages: [...SMS_DEFAULT_EXCLUDED_TO_STAGES] as CaseStage[],
  delayDaysAfterSigning: "",
  delayHoursAfterSigning: "",
  attorneyContactIds: [] as string[],
  caseTypes: [] as string[],
  messageEn: "",
  messageEs: "",
  youtubeUrlEn: "",
  youtubeUrlEs: "",
};

function formatAutomationTrigger(automation: SmsAutomation, attorneys: AppUser[]) {
  const parts: string[] = [];

  if (automation.triggerType === "manual") {
    parts.push("Manual — run on demand (e.g. attorney departure)");
  } else if (automation.triggerType === "time_in_stage") {
    parts.push(`While in ${formatStageList(automation.inStages) || "—"}`);
    if (automation.delayHoursAfterSigning != null) {
      parts.push(`Signing + ${automation.delayHoursAfterSigning}h`);
    }
    if (automation.delayDaysAfterSigning != null) {
      parts.push(`Signing + ${automation.delayDaysAfterSigning}d`);
    }
  } else {
    const fromLabel =
      automation.fromStages.length > 0
        ? formatStageList(automation.fromStages)
        : automation.fromStage === "any"
          ? "Any"
          : stageChipLabel(automation.fromStage as CaseStage);

    const toLabel =
      automation.toStage === "any"
        ? `Any except ${automation.excludedToStages.length > 0 ? formatStageList(automation.excludedToStages) : "none"}`
        : stageChipLabel(automation.toStage as CaseStage);

    parts.push(`${fromLabel} → ${toLabel}`);

    if (automation.delayDaysAfterSigning != null) {
      parts.push(`Signing + ${automation.delayDaysAfterSigning} day${automation.delayDaysAfterSigning === 1 ? "" : "s"}`);
    }
    if (automation.delayHoursAfterSigning != null) {
      parts.push(`Signing + ${automation.delayHoursAfterSigning}h`);
    }
  }

  parts.push(automation.caseTypes.length > 0 ? automation.caseTypes.join(", ") : "All case types");

  if (automation.triggerType !== "manual" && automation.attorneyContactIds.length > 0) {
    const names = automation.attorneyContactIds
      .map((id) => attorneys.find((user) => user.id === id)?.name ?? id)
      .join(", ");
    parts.push(`Attorneys: ${names}`);
  }

  return parts.join(" · ");
}

function triggerBadgeLabel(triggerType: SmsAutomationTriggerType) {
  if (triggerType === "manual") return "Manual";
  if (triggerType === "time_in_stage") return "Time in stage";
  return "Stage change";
}

function stageChipLabel(stage: CaseStage) {
  const label = STAGE_SLACK_LABELS[stage] ?? stage;
  return label === stage ? stage : `${label} (${stage})`;
}

function formatStageList(stages: CaseStage[]) {
  return stages.map(stageChipLabel).join(", ");
}

type ClientSmsSettingsViewProps = {
  users: AppUser[];
};

export function ClientSmsSettingsView({ users }: ClientSmsSettingsViewProps) {
  const attorneys = useMemo(() => users.filter((user) => user.role === "attorney" && user.active), [users]);
  const allAttorneys = useMemo(
    () => users.filter((user) => user.role === "attorney").sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );
  const [automations, setAutomations] = useState<SmsAutomation[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runAttorneyByAutomation, setRunAttorneyByAutomation] = useState<Record<string, string>>({});
  const [excludeCasesByAutomation, setExcludeCasesByAutomation] = useState<Record<string, string>>({});
  const [onlyCasesByAutomation, setOnlyCasesByAutomation] = useState<Record<string, string>>({});
  const [debouncedExcludeByAutomation, setDebouncedExcludeByAutomation] = useState<Record<string, string>>({});
  const [debouncedOnlyByAutomation, setDebouncedOnlyByAutomation] = useState<Record<string, string>>({});
  const [progressByAutomation, setProgressByAutomation] = useState<Record<string, ManualSmsProgress | null>>({});
  const [progressLoadingId, setProgressLoadingId] = useState<string | null>(null);
  const [syncCaseNumbers, setSyncCaseNumbers] = useState("");
  const [renameCaseNumbers, setRenameCaseNumbers] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [renameMessage, setRenameMessage] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/sms-automations");
      const body = (await response.json()) as { automations?: SmsAutomation[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to load automations.");
      setAutomations(body.automations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load automations.");
    } finally {
      setLoading(false);
    }
  }

  async function loadManualProgress(
    automationId: string,
    attorneyContactId: string,
    filters?: { excludeInput?: string; onlyInput?: string },
  ) {
    if (!attorneyContactId.trim()) {
      setProgressByAutomation((current) => ({ ...current, [automationId]: null }));
      return;
    }

    setProgressLoadingId(automationId);
    try {
      const excludeCaseNumbers = parseCaseNumbersInput(
        filters?.excludeInput ??
          debouncedExcludeByAutomation[automationId] ??
          excludeCasesByAutomation[automationId] ??
          "",
      );
      const onlyCaseNumbers = parseCaseNumbersInput(
        filters?.onlyInput ?? debouncedOnlyByAutomation[automationId] ?? onlyCasesByAutomation[automationId] ?? "",
      );
      const params = new URLSearchParams({ attorneyContactId });
      if (excludeCaseNumbers.length) {
        params.set("excludeCaseNumbers", excludeCaseNumbers.join(","));
      }
      if (onlyCaseNumbers.length) {
        params.set("onlyCaseNumbers", onlyCaseNumbers.join(","));
      }
      const response = await fetch(`/api/admin/sms-automations/${automationId}/run?${params.toString()}`);
      const body = (await response.json()) as ManualSmsProgress & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to load send progress.");
      setProgressByAutomation((current) => ({
        ...current,
        [automationId]: {
          cases: body.cases,
          english: body.english,
          spanish: body.spanish,
          sentCount: body.sentCount,
          skippedCount: body.skippedCount,
          failedCount: body.failedCount,
          remainingCount: body.remainingCount,
          missingPhoneCount: body.missingPhoneCount,
          excludedCount: body.excludedCount ?? 0,
          onlyCaseNumbers: body.onlyCaseNumbers ?? [],
          done: body.done,
          sent: body.sent ?? [],
          failed: body.failed ?? [],
          remaining: body.remaining ?? [],
          missingPhone: body.missingPhone ?? [],
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load send progress.");
      setProgressByAutomation((current) => ({ ...current, [automationId]: null }));
    } finally {
      setProgressLoadingId(null);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedExcludeByAutomation(excludeCasesByAutomation);
      setDebouncedOnlyByAutomation(onlyCasesByAutomation);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [excludeCasesByAutomation, onlyCasesByAutomation]);

  useEffect(() => {
    for (const automation of automations) {
      if (automation.triggerType !== "manual") continue;
      const attorneyContactId = runAttorneyByAutomation[automation.id]?.trim() ?? "";
      if (!attorneyContactId) {
        setProgressByAutomation((current) =>
          current[automation.id] == null ? current : { ...current, [automation.id]: null },
        );
        continue;
      }
      void loadManualProgress(automation.id, attorneyContactId, {
        excludeInput: debouncedExcludeByAutomation[automation.id] ?? "",
        onlyInput: debouncedOnlyByAutomation[automation.id] ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when attorney or debounced filters change
  }, [automations, runAttorneyByAutomation, debouncedExcludeByAutomation, debouncedOnlyByAutomation]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function startEdit(automation: SmsAutomation) {
    const fromStages =
      automation.fromStages.length > 0
        ? automation.fromStages
        : automation.fromStage !== "any"
          ? [automation.fromStage]
          : [];

    setEditingId(automation.id);
    setForm({
      name: automation.name,
      enabled: automation.enabled,
      triggerType: automation.triggerType,
      fromStages,
      inStages: automation.inStages,
      toMode: automation.toStage === "any" ? "any" : "specific",
      toStage: automation.toStage === "any" ? "Dmd" : automation.toStage,
      excludedToStages:
        automation.excludedToStages.length > 0 ? automation.excludedToStages : [...SMS_DEFAULT_EXCLUDED_TO_STAGES],
      delayDaysAfterSigning: automation.delayDaysAfterSigning != null ? String(automation.delayDaysAfterSigning) : "",
      delayHoursAfterSigning: automation.delayHoursAfterSigning != null ? String(automation.delayHoursAfterSigning) : "",
      attorneyContactIds: automation.attorneyContactIds,
      caseTypes: automation.caseTypes,
      messageEn: automation.messageEn,
      messageEs: automation.messageEs,
      youtubeUrlEn: automation.youtubeUrlEn ?? "",
      youtubeUrlEs: automation.youtubeUrlEs ?? "",
    });
  }

  function toggleInStage(stage: CaseStage) {
    setForm((current) => ({
      ...current,
      inStages: current.inStages.includes(stage)
        ? current.inStages.filter((item) => item !== stage)
        : [...current.inStages, stage],
    }));
  }

  function toggleFromStage(stage: CaseStage) {
    setForm((current) => ({
      ...current,
      fromStages: current.fromStages.includes(stage)
        ? current.fromStages.filter((item) => item !== stage)
        : [...current.fromStages, stage],
    }));
  }

  function toggleExcludedToStage(stage: CaseStage) {
    setForm((current) => ({
      ...current,
      excludedToStages: current.excludedToStages.includes(stage)
        ? current.excludedToStages.filter((item) => item !== stage)
        : [...current.excludedToStages, stage],
    }));
  }

  function toggleCaseType(caseType: string) {
    setForm((current) => ({
      ...current,
      caseTypes: current.caseTypes.includes(caseType)
        ? current.caseTypes.filter((item) => item !== caseType)
        : [...current.caseTypes, caseType],
    }));
  }

  function toggleAttorney(attorneyId: string) {
    setForm((current) => ({
      ...current,
      attorneyContactIds: current.attorneyContactIds.includes(attorneyId)
        ? current.attorneyContactIds.filter((id) => id !== attorneyId)
        : [...current.attorneyContactIds, attorneyId],
    }));
  }

  async function saveAutomation() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const delayDaysTrimmed = form.delayDaysAfterSigning.trim();
      const delayHoursTrimmed = form.delayHoursAfterSigning.trim();
      const payload = {
        name: form.name,
        enabled: form.enabled,
        triggerType: form.triggerType,
        fromStages: form.triggerType === "stage_change" ? form.fromStages : [],
        fromStage: form.fromStages.length > 0 ? form.fromStages[0] : "any",
        inStages: form.triggerType === "time_in_stage" ? form.inStages : [],
        toStage:
          form.triggerType === "manual"
            ? "Onboarding"
            : form.triggerType === "time_in_stage"
              ? (form.inStages[0] ?? "Onboarding")
              : form.toMode === "any"
                ? "any"
                : form.toStage,
        excludedToStages: form.triggerType === "stage_change" && form.toMode === "any" ? form.excludedToStages : [],
        caseTypes: form.caseTypes,
        delayDaysAfterSigning:
          form.triggerType === "manual" ? null : delayDaysTrimmed === "" ? null : Number(delayDaysTrimmed),
        delayHoursAfterSigning:
          form.triggerType === "manual" ? null : delayHoursTrimmed === "" ? null : Number(delayHoursTrimmed),
        attorneyContactIds: form.triggerType === "manual" ? [] : form.attorneyContactIds,
        messageEn: form.messageEn,
        messageEs: form.messageEs,
        youtubeUrlEn: form.youtubeUrlEn.trim() || null,
        youtubeUrlEs: form.youtubeUrlEs.trim() || null,
      };
      const response = await fetch(editingId ? `/api/admin/sms-automations/${editingId}` : "/api/admin/sms-automations", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Save failed.");
      setMessage(editingId ? "Automation updated." : "Automation created.");
      resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAutomation(id: string) {
    if (!window.confirm("Delete this SMS automation?")) return;
    setError(null);
    try {
      const response = await fetch(`/api/admin/sms-automations/${id}`, { method: "DELETE" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Delete failed.");
      if (editingId === id) resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  async function syncQuoContacts(caseNumbers?: string[]) {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/sms-sync-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(caseNumbers?.length ? { caseNumbers } : {}),
      });
      const body = (await response.json()) as {
        totalContacts?: number;
        totalDirectoryContacts?: number;
        matched?: number;
        updated?: number;
        skipped?: number;
        conversationLinks?: number;
        conversationSyncWarning?: string | null;
        noCaseNumber?: string[];
        unmatchedContacts?: Array<{ displayName: string; caseNumber: string }>;
        missingCaseNumbers?: string[];
        backfilled?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Sync failed.");
      const warning = body.conversationSyncWarning?.trim();
      const noCaseCount = body.noCaseNumber?.length ?? 0;
      const unmatchedCount = body.unmatchedContacts?.length ?? 0;
      const missingCount = body.missingCaseNumbers?.length ?? 0;
      const lines = [
        `Synced Quo contacts: ${body.updated ?? 0} case(s) updated, ${body.skipped ?? 0} unchanged (${body.matched ?? 0} matched of ${body.totalContacts ?? 0} parsed, ${body.totalDirectoryContacts ?? 0} total in directory; ${body.conversationLinks ?? 0} inbox links).`,
      ];
      if (body.backfilled) lines.push(`Backfilled case_number on ${body.backfilled} tracker row(s).`);
      if (warning) lines.push(`Inbox links skipped: ${warning}`);
      if (missingCount) lines.push(`No tracker row found for case(s): ${body.missingCaseNumbers!.join(", ")}`);
      if (noCaseCount) lines.push(`${noCaseCount} contact(s) skipped (no trailing case number): ${body.noCaseNumber!.slice(0, 10).join(", ")}${noCaseCount > 10 ? ` … +${noCaseCount - 10} more` : ""}`);
      if (unmatchedCount) lines.push(`${unmatchedCount} contact(s) with case numbers not in tracker: ${body.unmatchedContacts!.slice(0, 10).map((c) => `${c.displayName} (#${c.caseNumber})`).join(", ")}${unmatchedCount > 10 ? ` … +${unmatchedCount - 10} more` : ""}`);
      setMessage(lines.join("\n"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  function handleSyncSelected() {
    const numbers = syncCaseNumbers
      .split(/[\s,]+/)
      .map((n) => n.trim())
      .filter(Boolean);
    if (!numbers.length) return;
    void syncQuoContacts(numbers);
  }

  async function renameQuoContacts(caseNumbers?: string[]) {
    const isAll = !caseNumbers?.length;
    if (isAll && !window.confirm("Rename ALL Quo contacts to include language (EN/ES) before the case number?")) return;
    setRenaming(true);
    setError(null);
    setRenameMessage(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/quo-rename-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(caseNumbers?.length ? { caseNumbers } : {}),
      });
      const body = (await response.json()) as {
        totalContacts?: number;
        matched?: number;
        renamed?: number;
        skipped?: number;
        alreadyTagged?: number;
        noLanguage?: number;
        notFound?: string[];
        errors?: string[];
        details?: string[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Rename failed.");
      const errorCount = body.errors?.length ?? 0;
      const lines = [
        `Quo rename complete: ${body.renamed ?? 0} renamed, ${body.matched ?? 0} matched, ${body.skipped ?? 0} skipped.`,
      ];
      if (body.alreadyTagged) lines.push(`${body.alreadyTagged} already had the language tag.`);
      if (body.noLanguage) lines.push(`${body.noLanguage} skipped (no preferred language on case).`);
      if (body.notFound?.length) lines.push(`No Quo contact found for case(s): ${body.notFound.join(", ")}`);
      if (errorCount) lines.push(`${errorCount} error(s): ${body.errors!.slice(0, 5).join(" · ")}`);
      if (body.details?.length) {
        lines.push(...body.details.slice(0, 12));
        if (body.details.length > 12) lines.push(`…and ${body.details.length - 12} more.`);
      }
      setRenameMessage(lines.join("\n"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed.");
    } finally {
      setRenaming(false);
    }
  }

  function handleRenameSelected() {
    const numbers = renameCaseNumbers
      .split(/[\s,]+/)
      .map((n) => n.trim())
      .filter(Boolean);
    if (!numbers.length) return;
    void renameQuoContacts(numbers);
  }

  async function runManualAutomation(automationId: string, dryRun: boolean) {
    const attorneyContactId = runAttorneyByAutomation[automationId]?.trim() ?? "";
    if (!attorneyContactId) {
      setError("Select the departing attorney before sending SMS.");
      return;
    }

    const attorneyName = allAttorneys.find((user) => user.id === attorneyContactId)?.name ?? "this attorney";
    const excludeCaseNumbers = parseCaseNumbersInput(excludeCasesByAutomation[automationId] ?? "");
    const onlyCaseNumbers = parseCaseNumbersInput(onlyCasesByAutomation[automationId] ?? "");
    if (
      !dryRun &&
      !window.confirm(
        `Send the next batch of up to ${onlyCaseNumbers.length > 0 ? 1 : MANUAL_SMS_BATCH_SIZE} SMS now (no Slack approval) to active clients assigned to ${attorneyName}?\n\nMessages use each client's primary language and YouTube URL. Click Send again for each following batch.${
          onlyCaseNumbers.length
            ? `\n\nONLY sending to case(s): ${onlyCaseNumbers.join(", ")} — real SMS will go out.`
            : ""
        }${
          excludeCaseNumbers.length
            ? `\n\nExcluded case(s): ${excludeCaseNumbers.join(", ")}`
            : ""
        }`,
      )
    ) {
      return;
    }

    setRunningId(automationId);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/sms-automations/${automationId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attorneyContactId,
          dryRun,
          batchSize: onlyCaseNumbers.length > 0 ? 1 : MANUAL_SMS_BATCH_SIZE,
          excludeCaseNumbers,
          onlyCaseNumbers,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        sent?: number;
        failed?: number;
        remaining?: number;
        done?: boolean;
        cases?: number;
        english?: number;
        spanish?: number;
        totalPending?: number;
        skipped?: number;
        excluded?: number;
        onlyCaseNumbers?: string[];
        automationName?: string;
        failures?: string[];
        dryRun?: boolean;
      };
      if (!response.ok) throw new Error(body.error ?? "Unable to send manual SMS.");

      if (dryRun || body.dryRun) {
        setMessage(
          [
            `Preview: ${body.automationName ?? "manual SMS"} for ${attorneyName}.`,
            `${body.cases ?? 0} active case(s) (${body.english ?? 0} EN · ${body.spanish ?? 0} ES).`,
            `${body.totalPending ?? 0} recipient(s) ready — sends in batches of ${onlyCaseNumbers.length > 0 ? 1 : MANUAL_SMS_BATCH_SIZE} when you click Send SMS.`,
            body.onlyCaseNumbers?.length
              ? `Only including case(s): ${body.onlyCaseNumbers.join(", ")}.`
              : null,
            body.excluded ? `${body.excluded} case(s) excluded from this run.` : null,
            body.skipped ? `${body.skipped} skipped (already sent or missing phone).` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        );
        return;
      }

      if (body.done || (body.remaining ?? 0) === 0) {
        setMessage(
          [
            `Finished ${body.automationName ?? "manual SMS"} for ${attorneyName}.`,
            `${body.cases ?? 0} active case(s) matched (${body.english ?? 0} EN · ${body.spanish ?? 0} ES).`,
            `This batch: ${body.sent ?? 0} sent${body.failed ? ` · ${body.failed} failed` : ""}. No recipients remaining.`,
            ...(body.failures?.length ? [`Failures: ${body.failures.join(" · ")}`] : []),
          ].join("\n"),
        );
        return;
      }

      setMessage(
        [
          `Batch sent for ${attorneyName}: ${body.sent ?? 0} SMS via Quo${body.failed ? ` · ${body.failed} failed` : ""}.`,
          `${body.remaining ?? 0} recipient(s) still waiting.`,
          `Click Send SMS again when you are ready for the next batch of ${MANUAL_SMS_BATCH_SIZE}.`,
          ...(body.failures?.length ? [`Failures: ${body.failures.join(" · ")}`] : []),
        ].join("\n"),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send manual SMS.");
    } finally {
      setRunningId(null);
      const selectedAttorney = runAttorneyByAutomation[automationId]?.trim() ?? "";
      if (selectedAttorney) {
        void loadManualProgress(automationId, selectedAttorney);
      }
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Quo contact sync</CardTitle>
          <CardDescription>
            Pull client phone numbers from the Quo directory. Names ending in a case number (e.g. &quot;Mara Hernandez 1570&quot; or
            &quot;Kisha Williams 1277 &amp; 1280&quot;) are matched to tracker cases. Sync runs automatically each morning with the daily
            daily cron (15:00 UTC ≈ 10 AM Central) when Quo is configured; use the button below after bulk Quo imports or when you need an immediate refresh.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Requires <code className="text-xs">QUO_API_KEY</code>. SMS sends also need <code className="text-xs">QUO_FROM_PHONE</code>.
            Slack approval uses the case channel, or <code className="text-xs">SMS_APPROVAL_SLACK_CHANNEL_ID</code> when set.
          </p>
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-sm font-medium text-navy-950">Sync specific cases</label>
              <Input
                placeholder="e.g. 1345, 1570, 1280"
                value={syncCaseNumbers}
                onChange={(e) => setSyncCaseNumbers(e.target.value)}
              />
            </div>
            <Button onClick={handleSyncSelected} disabled={syncing || !syncCaseNumbers.trim()}>
              {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Sync selected
            </Button>
          </div>
          <div>
            <Button variant="outline" onClick={() => void syncQuoContacts()} disabled={syncing}>
              {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Sync all from Quo
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rename Quo contacts</CardTitle>
          <CardDescription>
            Insert the client&apos;s preferred language (EN or ES) into each Quo contact name before the case number.
            For example, &quot;David Eagan 9999&quot; becomes &quot;David Eagan EN 9999&quot;.
            Matching tags are left alone; a wrong tag (EN ↔ ES) is replaced. Contacts with no trailing case number are
            skipped. Changing primary language on a case also updates Quo immediately, and the daily job catches anything
            still missing or out of date.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-sm font-medium text-navy-950">Case numbers</label>
              <Input
                placeholder="e.g. 1345, 1570, 1280"
                value={renameCaseNumbers}
                onChange={(e) => setRenameCaseNumbers(e.target.value)}
              />
            </div>
            <Button onClick={handleRenameSelected} disabled={renaming || !renameCaseNumbers.trim()}>
              {renaming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Rename selected
            </Button>
          </div>
          <div>
            <Button variant="outline" onClick={() => void renameQuoContacts()} disabled={renaming}>
              {renaming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Rename all contacts
            </Button>
          </div>
          {renameMessage ? (
            <pre className="whitespace-pre-wrap rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
              {renameMessage}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Edit automation" : "New SMS automation"}</CardTitle>
          <CardDescription>
            Stage-change automations fire when the tracker stage updates. Time-in-stage automations are checked daily
            (morning cron) while the case stays in the selected stage after the signing delay. Manual automations
            (e.g. attorney departure) are queued on demand for one attorney&apos;s active clients. Each send is posted to
            Slack for approval first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-950">Name</label>
              <Input value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} placeholder="LOP Care" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-950">Enabled</label>
              <Select value={form.enabled ? "yes" : "no"} onChange={(e) => setForm((c) => ({ ...c, enabled: e.target.value === "yes" }))}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-navy-950">Trigger type</label>
              <Select
                value={form.triggerType}
                onChange={(e) => setForm((c) => ({ ...c, triggerType: e.target.value as SmsAutomationTriggerType }))}
              >
                <option value="stage_change">Stage change — fires when the case moves between stages (supports “any except” destination)</option>
                <option value="time_in_stage">Time in stage — fires daily while in stage after signing delay (no stage change)</option>
                <option value="manual">Manual — attorney departure (pick attorney and queue on demand)</option>
              </Select>
            </div>
          </div>

          {form.triggerType === "manual" ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-950">
              Save English and Spanish messages (and YouTube URLs). Then use <strong>Send SMS</strong> on the automation
              card and choose the departing attorney. Each click sends the next batch of {MANUAL_SMS_BATCH_SIZE}{" "}
              messages directly via Quo (no Slack approval). Click again when you are ready for the next batch. Each
              active client gets the message for their primary language.
            </div>
          ) : form.triggerType === "time_in_stage" ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-950">While in stage(s)</label>
              <p className="text-xs text-muted-foreground">
                Case must currently be in one of these stages. Checked each morning; sends once per case when the delay is met.
              </p>
              <div className="flex flex-wrap gap-2">
                {CASE_STAGE_OPTIONS.map((stage) => {
                  const selected = form.inStages.includes(stage);
                  return (
                    <button
                      key={stage}
                      type="button"
                      className={`rounded-full border px-3 py-1 text-xs ${selected ? "border-pink-500 bg-pink-50 text-pink-700" : "border-border text-muted-foreground"}`}
                    onClick={() => toggleInStage(stage)}
                  >
                    {stageChipLabel(stage)}
                  </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
          <div className="space-y-2">
            <label className="text-sm font-medium text-navy-950">From stage(s)</label>
            <p className="text-xs text-muted-foreground">
              Select one or more origin stages (e.g. Treatment). Leave empty to match any prior stage.
            </p>
            <div className="flex flex-wrap gap-2">
              {CASE_STAGE_OPTIONS.map((stage) => {
                const selected = form.fromStages.includes(stage);
                return (
                  <button
                    key={stage}
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs ${selected ? "border-pink-500 bg-pink-50 text-pink-700" : "border-border text-muted-foreground"}`}
                    onClick={() => toggleFromStage(stage)}
                  >
                    {stageChipLabel(stage)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border/80 p-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-navy-950">To stage</label>
              <p className="text-xs text-muted-foreground">
                Choose a single destination, or any stage except the ones you exclude below (e.g. Treatment → Demand, Litigation, etc., but not Terminated).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${form.toMode === "specific" ? "border-pink-500 bg-pink-50 text-pink-700" : "border-border text-muted-foreground"}`}
                onClick={() => setForm((c) => ({ ...c, toMode: "specific" }))}
              >
                One specific stage
              </button>
              <button
                type="button"
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${form.toMode === "any" ? "border-pink-500 bg-pink-50 text-pink-700" : "border-border text-muted-foreground"}`}
                onClick={() => setForm((c) => ({ ...c, toMode: "any" }))}
              >
                Any stage except…
              </button>
            </div>
            {form.toMode === "specific" ? (
              <div className="space-y-2">
                <label className="text-sm font-medium text-navy-950">Destination stage</label>
                <Select value={form.toStage} onChange={(e) => setForm((c) => ({ ...c, toStage: e.target.value as CaseStage }))}>
                  {CASE_STAGE_OPTIONS.map((stage) => (
                    <option key={stage} value={stage}>
                      {stageChipLabel(stage)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium text-navy-950">Excluded destination stages</label>
                <p className="text-xs text-muted-foreground">
                  The automation fires when the case moves to any stage not selected below.
                </p>
                <div className="flex flex-wrap gap-2">
                  {CASE_STAGE_OPTIONS.map((stage) => {
                    const selected = form.excludedToStages.includes(stage);
                    return (
                      <button
                        key={stage}
                        type="button"
                        className={`rounded-full border px-3 py-1 text-xs ${selected ? "border-pink-500 bg-pink-50 text-pink-700" : "border-border text-muted-foreground"}`}
                        onClick={() => toggleExcludedToStage(stage)}
                      >
                        {stageChipLabel(stage)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
            </>
          )}

          {form.triggerType !== "manual" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-950">Delay after signing (hours)</label>
              <Input
                type="number"
                min={0}
                value={form.delayHoursAfterSigning}
                onChange={(e) => setForm((c) => ({ ...c, delayHoursAfterSigning: e.target.value }))}
                placeholder="e.g. 24 for signing + 24 hours"
              />
              <p className="text-xs text-muted-foreground">
                {form.triggerType === "time_in_stage"
                  ? "Use hours for precise timing (e.g. LOP at 24h). Hours take precedence over days when both are set."
                  : "Optional. Hours take precedence over days when both are set."}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-950">Delay after signing (days)</label>
              <Input
                type="number"
                min={0}
                value={form.delayDaysAfterSigning}
                onChange={(e) => setForm((c) => ({ ...c, delayDaysAfterSigning: e.target.value }))}
                placeholder="e.g. 1 for signing date + 1 calendar day"
              />
              <p className="text-xs text-muted-foreground">
                {form.triggerType === "time_in_stage"
                  ? "Set days and/or hours. At least one is required. Requires a signing date on the case."
                  : "Leave blank for no delay. Requires a signing date on the case."}
              </p>
            </div>
          </div>
          ) : null}

          {form.triggerType !== "manual" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-navy-950">Attorneys (leave empty for all)</label>
              <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto rounded-md border p-2">
                {attorneys.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No active attorneys found.</p>
                ) : (
                  attorneys.map((attorney) => {
                    const selected = form.attorneyContactIds.includes(attorney.id);
                    return (
                      <button
                        key={attorney.id}
                        type="button"
                        className={`rounded-full border px-3 py-1 text-xs ${selected ? "border-pink-500 bg-pink-50 text-pink-700" : "border-border text-muted-foreground"}`}
                        onClick={() => toggleAttorney(attorney.id)}
                      >
                        {attorney.name}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-medium text-navy-950">Case types (leave empty for all)</label>
            <div className="flex flex-wrap gap-2">
              {CASE_TYPE_OPTIONS.map((caseType) => {
                const selected = form.caseTypes.includes(caseType);
                return (
                  <button
                    key={caseType}
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs ${selected ? "border-pink-500 bg-pink-50 text-pink-700" : "border-border text-muted-foreground"}`}
                    onClick={() => toggleCaseType(caseType)}
                  >
                    {caseType}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-950">English message</label>
              <Textarea
                rows={5}
                value={form.messageEn}
                onChange={(e) => setForm((c) => ({ ...c, messageEn: e.target.value }))}
                placeholder="Hi {{clientName}}, your case is moving to {{toStage}}..."
              />
              <Input
                value={form.youtubeUrlEn}
                onChange={(e) => setForm((c) => ({ ...c, youtubeUrlEn: e.target.value }))}
                placeholder="YouTube URL (English, optional)"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-950">Spanish message</label>
              <Textarea
                rows={5}
                value={form.messageEs}
                onChange={(e) => setForm((c) => ({ ...c, messageEs: e.target.value }))}
                placeholder="Hola {{clientName}}, su caso avanza a {{toStage}}..."
              />
              <Input
                value={form.youtubeUrlEs}
                onChange={(e) => setForm((c) => ({ ...c, youtubeUrlEs: e.target.value }))}
                placeholder="YouTube URL (Spanish, optional)"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Template variables: <code>{"{{clientName}}"}</code>, <code>{"{{caseNumber}}"}</code>, <code>{"{{fromStage}}"}</code>,{" "}
            <code>{"{{toStage}}"}</code>. YouTube links are appended to the message when set.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void saveAutomation()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              {editingId ? "Save changes" : "Create automation"}
            </Button>
            {editingId ? (
              <Button variant="outline" onClick={resetForm}>
                Cancel edit
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Automations</CardTitle>
          <CardDescription>
            Stage and time-in-stage triggers queue Slack approval before Quo. Manual attorney-departure SMS send
            directly in batches of {MANUAL_SMS_BATCH_SIZE} — click Send for each batch.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {!loading && automations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No automations yet.</p>
          ) : null}
          {automations.map((automation) => (
            <div key={automation.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-navy-950">{automation.name}</p>
                    <Badge variant={automation.enabled ? "success" : "secondary"}>{automation.enabled ? "Enabled" : "Disabled"}</Badge>
                    <Badge variant="outline">{triggerBadgeLabel(automation.triggerType)}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{formatAutomationTrigger(automation, allAttorneys)}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => startEdit(automation)}>
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void deleteAutomation(automation.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {automation.triggerType === "manual" ? (
                <div className="mt-4 space-y-3">
                  <div className="flex flex-col gap-3 rounded-md border bg-slate-50 p-3 sm:flex-row sm:items-end">
                    <label className="block min-w-0 flex-1">
                      <span className="mb-1 block text-xs font-medium text-navy-950">Departing attorney</span>
                      <Select
                        value={runAttorneyByAutomation[automation.id] ?? ""}
                        onChange={(event) => {
                          const attorneyContactId = event.target.value;
                          setRunAttorneyByAutomation((current) => ({
                            ...current,
                            [automation.id]: attorneyContactId,
                          }));
                        }}
                      >
                        <option value="">Select attorney…</option>
                        {allAttorneys.map((attorney) => (
                          <option key={attorney.id} value={attorney.id}>
                            {attorney.name}
                            {!attorney.active ? " (inactive)" : ""}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={runningId === automation.id || !automation.enabled}
                        onClick={() => void runManualAutomation(automation.id, true)}
                      >
                        {runningId === automation.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Preview
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={runningId === automation.id || !automation.enabled}
                        onClick={() => void runManualAutomation(automation.id, false)}
                      >
                        {runningId === automation.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Send SMS
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block rounded-md border bg-slate-50 p-3">
                      <span className="mb-1 block text-xs font-medium text-navy-950">
                        Only these case numbers (test)
                      </span>
                      <Input
                        value={onlyCasesByAutomation[automation.id] ?? ""}
                        onChange={(event) =>
                          setOnlyCasesByAutomation((current) => ({
                            ...current,
                            [automation.id]: event.target.value,
                          }))
                        }
                        placeholder="e.g. 1693"
                      />
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Leave blank for the full attorney list. When set, Preview/Send/progress only include these
                        cases (real SMS if you click Send).
                      </span>
                    </label>
                    <label className="block rounded-md border bg-slate-50 p-3">
                      <span className="mb-1 block text-xs font-medium text-navy-950">
                        Exclude case numbers (optional)
                      </span>
                      <Input
                        value={excludeCasesByAutomation[automation.id] ?? ""}
                        onChange={(event) =>
                          setExcludeCasesByAutomation((current) => ({
                            ...current,
                            [automation.id]: event.target.value,
                          }))
                        }
                        placeholder="e.g. 1693, 1701, 1720"
                      />
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Comma or space separated. Excluded cases are left out of Preview, Send, and the progress lists.
                      </span>
                    </label>
                  </div>

                  {(runAttorneyByAutomation[automation.id] ?? "").trim() ? (
                    <div className="rounded-md border border-slate-200 bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-navy-950">
                          Send progress (saved — safe after refresh)
                        </p>
                        {progressLoadingId === automation.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : null}
                      </div>
                      {progressByAutomation[automation.id] ? (
                        <>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {progressByAutomation[automation.id]!.cases} active case
                            {progressByAutomation[automation.id]!.cases === 1 ? "" : "s"} (
                            {progressByAutomation[automation.id]!.english} EN ·{" "}
                            {progressByAutomation[automation.id]!.spanish} ES)
                            {" · "}
                            <span className="font-medium text-emerald-700">
                              {progressByAutomation[automation.id]!.sentCount} sent
                            </span>
                            {" · "}
                            <span className="font-medium text-amber-700">
                              {progressByAutomation[automation.id]!.remainingCount} remaining
                            </span>
                            {progressByAutomation[automation.id]!.failedCount > 0 ? (
                              <>
                                {" · "}
                                <span className="font-medium text-pink-600">
                                  {progressByAutomation[automation.id]!.failedCount} failed (will retry)
                                </span>
                              </>
                            ) : null}
                            {progressByAutomation[automation.id]!.missingPhoneCount > 0 ? (
                              <>
                                {" · "}
                                {progressByAutomation[automation.id]!.missingPhoneCount} missing phone
                              </>
                            ) : null}
                            {(progressByAutomation[automation.id]!.excludedCount ?? 0) > 0 ? (
                              <>
                                {" · "}
                                {progressByAutomation[automation.id]!.excludedCount} excluded
                              </>
                            ) : null}
                            {(progressByAutomation[automation.id]!.onlyCaseNumbers?.length ?? 0) > 0 ? (
                              <>
                                {" · "}
                                <span className="font-medium text-sky-700">
                                  only {progressByAutomation[automation.id]!.onlyCaseNumbers!.join(", ")}
                                </span>
                              </>
                            ) : null}
                            {progressByAutomation[automation.id]!.done ? (
                              <span className="font-medium text-emerald-700"> · All recipients handled</span>
                            ) : null}
                          </p>

                          <div className="mt-3 grid gap-3 lg:grid-cols-2">
                            <div>
                              <p className="mb-1 text-xs font-medium text-navy-950">
                                Remaining ({progressByAutomation[automation.id]!.remainingCount})
                              </p>
                              <ul className="max-h-40 overflow-y-auto rounded border bg-slate-50 p-2 text-xs text-navy-950">
                                {progressByAutomation[automation.id]!.remaining.length === 0 ? (
                                  <li className="text-muted-foreground">None — nothing left to send.</li>
                                ) : (
                                  progressByAutomation[automation.id]!.remaining.map((item) => (
                                    <li key={`${item.caseId}-${item.phone}`} className="py-0.5">
                                      {formatProgressRow(item)}
                                      {item.status === "failed" && item.errorMessage
                                        ? ` · failed: ${item.errorMessage}`
                                        : ""}
                                    </li>
                                  ))
                                )}
                              </ul>
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-medium text-navy-950">
                                Sent ({progressByAutomation[automation.id]!.sentCount})
                              </p>
                              <ul className="max-h-40 overflow-y-auto rounded border bg-slate-50 p-2 text-xs text-navy-950">
                                {progressByAutomation[automation.id]!.sent.length === 0 ? (
                                  <li className="text-muted-foreground">None sent yet for this attorney.</li>
                                ) : (
                                  progressByAutomation[automation.id]!.sent.map((item) => (
                                    <li key={`${item.caseId}-${item.phone}`} className="py-0.5">
                                      {formatProgressRow(item)}
                                      {item.sentAt
                                        ? ` · ${new Date(item.sentAt).toLocaleString()}`
                                        : ""}
                                    </li>
                                  ))
                                )}
                              </ul>
                            </div>
                          </div>

                          {progressByAutomation[automation.id]!.missingPhone.length > 0 ? (
                            <div className="mt-3">
                              <p className="mb-1 text-xs font-medium text-navy-950">
                                Missing phone ({progressByAutomation[automation.id]!.missingPhoneCount})
                              </p>
                              <ul className="max-h-28 overflow-y-auto rounded border bg-slate-50 p-2 text-xs text-muted-foreground">
                                {progressByAutomation[automation.id]!.missingPhone.map((item) => (
                                  <li key={item.caseId} className="py-0.5">
                                    {formatProgressRow(item)}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </>
                      ) : progressLoadingId === automation.id ? (
                        <p className="mt-2 text-sm text-muted-foreground">Loading progress…</p>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">
                          Select an attorney to see who already received this text vs who is left.
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      {error ? <p className="text-sm font-medium text-pink-600">{error}</p> : null}
      {message ? <pre className="whitespace-pre-wrap text-sm font-medium text-emerald-700">{message}</pre> : null}
    </div>
  );
}
