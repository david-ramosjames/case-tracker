"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { CASE_STAGE_OPTIONS, CASE_TYPE_OPTIONS } from "@/lib/case-options";
import { SMS_DEFAULT_EXCLUDED_TO_STAGES } from "@/lib/sms/automation-match";
import { type SmsAutomation, type SmsAutomationTriggerType } from "@/lib/supabase/sms-automations";
import { STAGE_SLACK_LABELS } from "@/lib/slack/enum-replies";
import { type AppUser, type CaseStage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

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

  if (automation.triggerType === "time_in_stage") {
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

  if (automation.attorneyContactIds.length > 0) {
    const names = automation.attorneyContactIds
      .map((id) => attorneys.find((user) => user.id === id)?.name ?? id)
      .join(", ");
    parts.push(`Attorneys: ${names}`);
  }

  return parts.join(" · ");
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
  const [automations, setAutomations] = useState<SmsAutomation[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  useEffect(() => {
    void loadData();
  }, []);

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
        toStage: form.triggerType === "time_in_stage" ? (form.inStages[0] ?? "Onboarding") : form.toMode === "any" ? "any" : form.toStage,
        excludedToStages: form.triggerType === "stage_change" && form.toMode === "any" ? form.excludedToStages : [],
        caseTypes: form.caseTypes,
        delayDaysAfterSigning: delayDaysTrimmed === "" ? null : Number(delayDaysTrimmed),
        delayHoursAfterSigning: delayHoursTrimmed === "" ? null : Number(delayHoursTrimmed),
        attorneyContactIds: form.attorneyContactIds,
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

  async function syncQuoContacts() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/sms-sync-contacts", { method: "POST" });
      const body = (await response.json()) as {
        totalContacts?: number;
        matched?: number;
        updated?: number;
        skipped?: number;
        conversationLinks?: number;
        conversationSyncWarning?: string | null;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Sync failed.");
      const warning = body.conversationSyncWarning?.trim();
      setMessage(
        `Synced Quo contacts: ${body.updated ?? 0} case(s) updated, ${body.skipped ?? 0} unchanged (${body.matched ?? 0} matched of ${body.totalContacts ?? 0} directory rows; ${body.conversationLinks ?? 0} inbox links).${warning ? ` Inbox links skipped: ${warning}` : ""}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
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
            daily cron (14:00 UTC) when Quo is configured; use the button below after bulk Quo imports or when you need an immediate refresh.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Requires <code className="text-xs">QUO_API_KEY</code>. SMS sends also need <code className="text-xs">QUO_FROM_PHONE</code>.
            Slack approval uses the case channel, or <code className="text-xs">SMS_APPROVAL_SLACK_CHANNEL_ID</code> when set.
          </p>
          <Button onClick={() => void syncQuoContacts()} disabled={syncing}>
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Sync phones from Quo
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Edit automation" : "New SMS automation"}</CardTitle>
          <CardDescription>
            Stage-change automations fire when the tracker stage updates. Time-in-stage automations are checked daily
            (morning cron) while the case stays in the selected stage after the signing delay. Each send is posted to
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
              </Select>
            </div>
          </div>

          {form.triggerType === "time_in_stage" ? (
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
          <CardDescription>Stage + filter triggers that queue Slack approval before sending SMS via Quo.</CardDescription>
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
                    <Badge variant="outline">{automation.triggerType === "time_in_stage" ? "Time in stage" : "Stage change"}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{formatAutomationTrigger(automation, attorneys)}</p>
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
            </div>
          ))}
        </CardContent>
      </Card>

      {error ? <p className="text-sm font-medium text-pink-600">{error}</p> : null}
      {message ? <p className="text-sm font-medium text-emerald-700">{message}</p> : null}
    </div>
  );
}
