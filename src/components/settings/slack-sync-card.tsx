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
      const body = (await response.json()) as { synced?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Sync failed.");
      setMessage(`Synced ${body.synced ?? 0} rows from Google Sheet.`);
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
          You do not enter Slack channels in this app. Maintain your existing spreadsheet with Case #, Slack channel name, and
          Status (from the channel topic). The tracker pulls that sheet automatically before daily Slack reminders, or use Sync now
          for an immediate refresh. See docs/SLACK_SETUP.md.
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
          Sync now from Google Sheet
        </Button>
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
