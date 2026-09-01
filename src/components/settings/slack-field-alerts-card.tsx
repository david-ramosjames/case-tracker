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
  const [disabledAttorneyIds, setDisabledAttorneyIds] = useState(
    () => new Set(settings.attorneySlackFieldAlertsDisabled),
  );
  const [saving, setSaving] = useState(false);
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
        }),
      });

      const body = (await response.json()) as {
        error?: string;
        graceDays?: number;
        disabledAttorneyIds?: string[];
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Unable to save settings.");
      }

      if (typeof body.graceDays === "number") {
        setGraceDays(String(body.graceDays));
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

        <div className="flex items-center gap-3">
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save alert settings"
            )}
          </Button>
          {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
