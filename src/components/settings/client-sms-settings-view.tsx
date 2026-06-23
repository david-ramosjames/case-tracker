"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { CASE_STAGE_OPTIONS, CASE_TYPE_OPTIONS } from "@/lib/case-options";
import { type CaseStage } from "@/lib/types";
import { type SmsAutomation } from "@/lib/supabase/sms-automations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const EMPTY_FORM = {
  name: "",
  enabled: true,
  fromStage: "any" as CaseStage | "any",
  toStage: "Dmd" as CaseStage,
  caseTypes: [] as string[],
  messageEn: "",
  messageEs: "",
  youtubeUrlEn: "",
  youtubeUrlEs: "",
};

export function ClientSmsSettingsView() {
  const [automations, setAutomations] = useState<SmsAutomation[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const stageOptions = useMemo(() => ["any", ...CASE_STAGE_OPTIONS], []);

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
    setEditingId(automation.id);
    setForm({
      name: automation.name,
      enabled: automation.enabled,
      fromStage: automation.fromStage,
      toStage: automation.toStage,
      caseTypes: automation.caseTypes,
      messageEn: automation.messageEn,
      messageEs: automation.messageEs,
      youtubeUrlEn: automation.youtubeUrlEn ?? "",
      youtubeUrlEs: automation.youtubeUrlEs ?? "",
    });
  }

  function toggleCaseType(caseType: string) {
    setForm((current) => ({
      ...current,
      caseTypes: current.caseTypes.includes(caseType)
        ? current.caseTypes.filter((item) => item !== caseType)
        : [...current.caseTypes, caseType],
    }));
  }

  async function saveAutomation() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        ...form,
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
            cron (9 AM Central) when Quo is configured; use the button below after bulk Quo imports or when you need an immediate refresh.
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
            When a case moves between stages (and matches case type), a Slack approval thread is posted before any SMS is sent.
            Messages use the client&apos;s preferred language on the case page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-950">Name</label>
              <Input value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} placeholder="Onboarding → Demand" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-950">Enabled</label>
              <Select value={form.enabled ? "yes" : "no"} onChange={(e) => setForm((c) => ({ ...c, enabled: e.target.value === "yes" }))}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-950">From stage</label>
              <Select value={form.fromStage} onChange={(e) => setForm((c) => ({ ...c, fromStage: e.target.value as CaseStage | "any" }))}>
                {stageOptions.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage === "any" ? "Any stage" : stage}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-950">To stage</label>
              <Select value={form.toStage} onChange={(e) => setForm((c) => ({ ...c, toStage: e.target.value as CaseStage }))}>
                {CASE_STAGE_OPTIONS.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </Select>
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
          <CardDescription>Stage + case-type triggers that queue Slack approval before sending SMS via Quo.</CardDescription>
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
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {automation.fromStage === "any" ? "Any" : automation.fromStage} → {automation.toStage}
                    {automation.caseTypes.length > 0 ? ` · ${automation.caseTypes.join(", ")}` : " · All case types"}
                  </p>
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
