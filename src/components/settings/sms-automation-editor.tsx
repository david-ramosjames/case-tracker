"use client";

import { Loader2, Plus } from "lucide-react";
import { CASE_STAGE_OPTIONS, CASE_TYPE_OPTIONS } from "@/lib/case-options";
import { SMS_DEFAULT_EXCLUDED_TO_STAGES } from "@/lib/sms/automation-match";
import { MANUAL_SMS_BATCH_SIZE } from "@/lib/sms/manual-send";
import { type SmsAutomation, type SmsAutomationTriggerType } from "@/lib/supabase/sms-automations";
import { STAGE_SLACK_LABELS } from "@/lib/slack/enum-replies";
import { type AppUser, type CaseStage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type ToMode = "specific" | "any";

export type AutomationFormState = {
  name: string;
  enabled: boolean;
  triggerType: SmsAutomationTriggerType;
  fromStages: CaseStage[];
  inStages: CaseStage[];
  toMode: ToMode;
  toStage: CaseStage;
  excludedToStages: CaseStage[];
  delayDaysAfterSigning: string;
  delayHoursAfterSigning: string;
  excludedAttorneyContactIds: string[];
  caseTypes: string[];
  messageEn: string;
  messageEs: string;
  youtubeUrlEn: string;
  youtubeUrlEs: string;
};

export const EMPTY_AUTOMATION_FORM: AutomationFormState = {
  name: "",
  enabled: true,
  triggerType: "stage_change",
  fromStages: [],
  inStages: [],
  toMode: "specific",
  toStage: "Dmd",
  excludedToStages: [...SMS_DEFAULT_EXCLUDED_TO_STAGES],
  delayDaysAfterSigning: "",
  delayHoursAfterSigning: "",
  excludedAttorneyContactIds: [],
  caseTypes: [],
  messageEn: "",
  messageEs: "",
  youtubeUrlEn: "",
  youtubeUrlEs: "",
};

function stageChipLabel(stage: CaseStage) {
  const label = STAGE_SLACK_LABELS[stage] ?? stage;
  return label === stage ? stage : `${label} (${stage})`;
}

export function automationFormFromRecord(automation: SmsAutomation): AutomationFormState {
  const fromStages =
    automation.fromStages.length > 0
      ? automation.fromStages
      : automation.fromStage !== "any"
        ? [automation.fromStage]
        : [];

  return {
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
    excludedAttorneyContactIds: automation.excludedAttorneyContactIds,
    caseTypes: automation.caseTypes,
    messageEn: automation.messageEn,
    messageEs: automation.messageEs,
    youtubeUrlEn: automation.youtubeUrlEn ?? "",
    youtubeUrlEs: automation.youtubeUrlEs ?? "",
  };
}

type SmsAutomationEditorProps = {
  form: AutomationFormState;
  attorneys: AppUser[];
  saving: boolean;
  submitLabel: string;
  onChange: (form: AutomationFormState) => void;
  onSubmit: () => void;
  onCancel?: () => void;
};

export function SmsAutomationEditor({
  form,
  attorneys,
  saving,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
}: SmsAutomationEditorProps) {
  function toggleInStage(stage: CaseStage) {
    onChange({
      ...form,
      inStages: form.inStages.includes(stage) ? form.inStages.filter((item) => item !== stage) : [...form.inStages, stage],
    });
  }

  function toggleFromStage(stage: CaseStage) {
    onChange({
      ...form,
      fromStages: form.fromStages.includes(stage)
        ? form.fromStages.filter((item) => item !== stage)
        : [...form.fromStages, stage],
    });
  }

  function toggleExcludedToStage(stage: CaseStage) {
    onChange({
      ...form,
      excludedToStages: form.excludedToStages.includes(stage)
        ? form.excludedToStages.filter((item) => item !== stage)
        : [...form.excludedToStages, stage],
    });
  }

  function toggleCaseType(caseType: string) {
    onChange({
      ...form,
      caseTypes: form.caseTypes.includes(caseType)
        ? form.caseTypes.filter((item) => item !== caseType)
        : [...form.caseTypes, caseType],
    });
  }

  function toggleSkippedAttorney(attorneyId: string) {
    onChange({
      ...form,
      excludedAttorneyContactIds: form.excludedAttorneyContactIds.includes(attorneyId)
        ? form.excludedAttorneyContactIds.filter((id) => id !== attorneyId)
        : [...form.excludedAttorneyContactIds, attorneyId],
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium text-navy-950">Name</label>
          <Input value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} placeholder="LOP Care" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-navy-950">Enabled</label>
          <Select
            value={form.enabled ? "yes" : "no"}
            onChange={(e) => onChange({ ...form, enabled: e.target.value === "yes" })}
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </div>
        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium text-navy-950">Trigger type</label>
          <Select
            value={form.triggerType}
            onChange={(e) => onChange({ ...form, triggerType: e.target.value as SmsAutomationTriggerType })}
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
                onClick={() => onChange({ ...form, toMode: "specific" })}
              >
                One specific stage
              </button>
              <button
                type="button"
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${form.toMode === "any" ? "border-pink-500 bg-pink-50 text-pink-700" : "border-border text-muted-foreground"}`}
                onClick={() => onChange({ ...form, toMode: "any" })}
              >
                Any stage except…
              </button>
            </div>
            {form.toMode === "specific" ? (
              <div className="space-y-2">
                <label className="text-sm font-medium text-navy-950">Destination stage</label>
                <Select value={form.toStage} onChange={(e) => onChange({ ...form, toStage: e.target.value as CaseStage })}>
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
              onChange={(e) => onChange({ ...form, delayHoursAfterSigning: e.target.value })}
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
              onChange={(e) => onChange({ ...form, delayDaysAfterSigning: e.target.value })}
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
        <div className="space-y-2">
          <label className="text-sm font-medium text-navy-950">Skip these attorneys</label>
          <p className="text-xs text-muted-foreground">
            On for every attorney. Select someone here to not send this automation for their cases.
          </p>
          <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto rounded-md border p-2">
            {attorneys.length === 0 ? (
              <p className="text-xs text-muted-foreground">No attorneys found.</p>
            ) : (
              attorneys.map((attorney) => {
                const selected = form.excludedAttorneyContactIds.includes(attorney.id);
                return (
                  <button
                    key={attorney.id}
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs ${selected ? "border-pink-500 bg-pink-50 text-pink-700" : "border-border text-muted-foreground"}`}
                    onClick={() => toggleSkippedAttorney(attorney.id)}
                  >
                    {attorney.name}
                  </button>
                );
              })
            )}
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
            onChange={(e) => onChange({ ...form, messageEn: e.target.value })}
            placeholder="Hi {{clientName}}, your case is moving to {{toStage}}..."
          />
          <Input
            value={form.youtubeUrlEn}
            onChange={(e) => onChange({ ...form, youtubeUrlEn: e.target.value })}
            placeholder="YouTube URL (English, optional)"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-navy-950">Spanish message</label>
          <Textarea
            rows={5}
            value={form.messageEs}
            onChange={(e) => onChange({ ...form, messageEs: e.target.value })}
            placeholder="Hola {{clientName}}, su caso avanza a {{toStage}}..."
          />
          <Input
            value={form.youtubeUrlEs}
            onChange={(e) => onChange({ ...form, youtubeUrlEs: e.target.value })}
            placeholder="YouTube URL (Spanish, optional)"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Template variables: <code>{"{{clientName}}"}</code>, <code>{"{{caseNumber}}"}</code>, <code>{"{{fromStage}}"}</code>,{" "}
        <code>{"{{toStage}}"}</code>. YouTube links are appended to the message when set.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onSubmit} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : submitLabel === "Create automation" ? <Plus className="mr-2 h-4 w-4" /> : null}
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
