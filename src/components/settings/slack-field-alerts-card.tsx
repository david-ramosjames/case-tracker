"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type AppUser, type CaseTrackerSettings } from "@/lib/types";
import { errorMessage } from "@/lib/utils";

export function SlackFieldAlertsCard({
  settings,
  users,
}: {
  settings: CaseTrackerSettings;
  users: AppUser[];
}) {
  const attorneys = useMemo(
    () => users.filter((user) => user.role === "attorney").sort((left, right) => left.name.localeCompare(right.name)),
    [users],
  );

  const [graceDays, setGraceDays] = useState(String(settings.slackFieldAlertGraceDays));
  const [frequencyDays, setFrequencyDays] = useState(String(settings.fieldReminderFrequencyDays));
  const [nextAllowedOn, setNextAllowedOn] = useState(settings.fieldReminderNextAllowedOn ?? "");
  const [disabledAttorneyIds, setDisabledAttorneyIds] = useState(
    () => new Set(settings.attorneySlackFieldAlertsDisabled),
  );
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleAttorney(attorneyId: string) {
    setDisabledAttorneyIds((current) => {
      const next = new Set(current);
      if (next.has(attorneyId)) next.delete(attorneyId);
      else next.add(attorneyId);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/admin/slack-field-alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          graceDays: Number(graceDays),
          disabledAttorneyIds: [...disabledAttorneyIds],
          fieldReminderFrequencyDays: Number(frequencyDays),
          fieldReminderNextAllowedOn: nextAllowedOn.trim() || null,
        }),
      });

      const body = (await response.json()) as {
        error?: string;
        graceDays?: number;
        disabledAttorneyIds?: string[];
        fieldReminderFrequencyDays?: number;
        fieldReminderNextAllowedOn?: string | null;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Unable to save settings.");
      }

      if (typeof body.graceDays === "number") setGraceDays(String(body.graceDays));
      if (typeof body.fieldReminderFrequencyDays === "number") {
        setFrequencyDays(String(body.fieldReminderFrequencyDays));
      }
      if ("fieldReminderNextAllowedOn" in body) {
        setNextAllowedOn(body.fieldReminderNextAllowedOn ?? "");
      }
      if (Array.isArray(body.disabledAttorneyIds)) {
        setDisabledAttorneyIds(new Set(body.disabledAttorneyIds));
      }

      setMessage("Slack field alert settings saved.");
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function handleManualPush(dryRun: boolean) {
    setPushing(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/daily-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "fieldReminders",
          force: true,
          dryRun,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        fieldReminders?: { posted?: number; skipped?: number; fields?: number; dryRun?: boolean };
      };
      if (!response.ok) throw new Error(body.error ?? "Field reminder push failed.");
      const fr = body.fieldReminders;
      setMessage(
        dryRun
          ? `Preview: ${fr?.posted ?? 0} case(s) would get reminders (${fr?.fields ?? 0} field(s)).`
          : `Posted ${fr?.posted ?? 0} reminder(s) across ${fr?.fields ?? 0} field(s) (${fr?.skipped ?? 0} skipped). Next scheduled batch still waits for the date above.`,
      );
    } catch (pushError) {
      setError(errorMessage(pushError));
    } finally {
      setPushing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Slack field alerts</CardTitle>
        <CardDescription>
          Controls missing-field notices and 90-day field reminders posted in case channels. Stage confirmations and
          other Slack workflows are not affected.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <label className="block max-w-xs">
          <span className="mb-2 block text-sm font-medium text-navy-950">Grace period after date signed</span>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              value={graceDays}
              onChange={(event) => setGraceDays(event.target.value)}
            />
            <span className="text-sm text-muted-foreground">days</span>
          </div>
          <span className="mt-2 block text-xs text-muted-foreground">
            No field-input Slack posts during this window (default 7).
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block max-w-xs">
            <span className="mb-2 block text-sm font-medium text-navy-950">90-day reminder frequency</span>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={90}
                value={frequencyDays}
                onChange={(event) => setFrequencyDays(event.target.value)}
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
            <span className="mt-2 block text-xs text-muted-foreground">
              How often the scheduled batch may post (default weekly). Also used as per-case cooldown.
            </span>
          </label>

          <label className="block max-w-xs">
            <span className="mb-2 block text-sm font-medium text-navy-950">Next scheduled batch on</span>
            <Input
              type="date"
              value={nextAllowedOn}
              onChange={(event) => setNextAllowedOn(event.target.value)}
            />
            <span className="mt-2 block text-xs text-muted-foreground">
              Cron stays quiet until this Central date. Cleared/blank means allowed on the next cron run.
            </span>
          </label>
        </div>

        <div>
          <p className="mb-3 text-sm font-medium text-navy-950">Attorney field alerts</p>
          <div className="space-y-2">
            {attorneys.map((attorney) => {
              const enabled = !disabledAttorneyIds.has(attorney.id);
              return (
                <label
                  key={attorney.id}
                  className="flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span>{attorney.name}</span>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleAttorney(attorney.id)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                </label>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Uncheck an attorney to stop missing-field and field-reminder posts on their assigned cases.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={handleSave} disabled={saving || pushing}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save alert settings"
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleManualPush(true)}
            disabled={saving || pushing}
          >
            Preview reminders
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleManualPush(false)}
            disabled={saving || pushing}
          >
            {pushing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Pushing...
              </>
            ) : (
              "Send reminders now"
            )}
          </Button>
        </div>
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
