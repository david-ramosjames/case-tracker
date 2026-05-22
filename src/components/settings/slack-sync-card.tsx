"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SlackSyncCard() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  async function syncChannels() {
    setIsSyncing(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/slack/sync-channels", { method: "POST" });
      const body = (await response.json()) as {
        synced?: number;
        duplicatesRemoved?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Sync failed.");
      const duplicateNote =
        body.duplicatesRemoved && body.duplicatesRemoved > 0
          ? ` (${body.duplicatesRemoved} duplicate Case No rows in the sheet used the last row for each case.)`
          : "";
      setMessage(`Imported ${body.synced ?? 0} case → channel mappings from Google Sheet.${duplicateNote}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Slack case channels (Google Sheet)</CardTitle>
        <CardDescription>
          Copies <strong>Client Contact Status → Sheet1</strong> into the tracker: Case No → Slack channel name → Status. This only
          reads Google Sheets — it does not call Slack. Slack is used later when sending reminders or comments (to find the channel by
          name). See docs/SLACK_SETUP.md.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-navy-950">Client Contact Status</span> → Sheet1: Slack Channel, Case No, Status (columns A, B, F)
          </li>
          <li>Share the spreadsheet with your Google service account email</li>
          <li>Set GOOGLE_SHEETS_* env vars — cron syncs daily with reminders</li>
        </ul>
        <Button variant="outline" disabled={isSyncing} onClick={() => void syncChannels()}>
          {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Import from Google Sheet
        </Button>
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
