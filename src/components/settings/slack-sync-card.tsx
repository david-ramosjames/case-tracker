"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function SlackSyncCard() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isUpdatingTopic, setIsUpdatingTopic] = useState(false);
  const [topicCaseNumber, setTopicCaseNumber] = useState("");

  async function syncChannels() {
    setIsSyncing(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/slack/sync-channels", { method: "POST" });
      const body = (await response.json()) as {
        synced?: number;
        duplicatesRemoved?: number;
        dateSignedUpdated?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Sync failed.");
      const duplicateNote =
        body.duplicatesRemoved && body.duplicatesRemoved > 0
          ? ` (${body.duplicatesRemoved} duplicate Case No rows in the sheet used the last row for each case.)`
          : "";
      const dateSignedNote =
        body.dateSignedUpdated && body.dateSignedUpdated > 0
          ? ` Changed Date Signed on ${body.dateSignedUpdated} tracker case(s) from column H.`
          : "";
      setMessage(
        `Imported ${body.synced ?? 0} case → channel mappings from Google Sheet.${duplicateNote}${dateSignedNote}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setIsSyncing(false);
    }
  }

  async function seedSlackContactIds() {
    setIsSeeding(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/seed-slack-contact-ids", { method: "POST" });
      const body = (await response.json()) as {
        updated?: number;
        skipped?: number;
        total?: number;
        errors?: string[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Seed failed.");
      const errorNote = body.errors?.length ? ` ${body.errors.length} error(s).` : "";
      setMessage(
        `Slack contact IDs: ${body.updated ?? 0} updated, ${body.skipped ?? 0} skipped (${body.total ?? 0} contacts).${errorNote}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Seed failed.");
    } finally {
      setIsSeeding(false);
    }
  }

  async function updateCaseTopic() {
    setIsUpdatingTopic(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/slack-topic-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseNumber: topicCaseNumber }),
      });
      const body = (await response.json()) as {
        updated?: boolean;
        reason?: string;
        topic?: string | null;
        previousTopic?: string | null;
        caseNumber?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Topic update failed.");

      if (body.updated) {
        setMessage(
          `Updated Slack topic for case ${body.caseNumber}.${
            body.previousTopic ? ` Previous: “${body.previousTopic}”.` : ""
          } Now: “${body.topic ?? ""}”.`,
        );
      } else if (body.reason === "already_current") {
        setMessage(`Slack topic for case ${body.caseNumber} already matches Case Tracker.`);
      } else {
        setMessage(`Topic sync finished for case ${body.caseNumber} (${body.reason ?? "no change"}).`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Topic update failed.");
    } finally {
      setIsUpdatingTopic(false);
    }
  }

  const busy = isSyncing || isSeeding || isUpdatingTopic;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Slack case channels (Google Sheet)</CardTitle>
        <CardDescription>
          Copies <strong>Client Contact Status → Sheet1</strong> into the tracker: Case No, Slack channel name, Status, Slack channel
          ID, and Date Signed (column H). This only reads Google Sheets — it does not call Slack. IDs and dates are saved to Supabase and used for case display and posting (no per-save sheet or Slack lookup). See
          docs/SLACK_SETUP.md.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-navy-950">Client Contact Status</span> → Sheet1: Slack Channel, Case No, Status, Slack Channel ID, Date Created (A, B, F, G, H)
          </li>
          <li>Share the spreadsheet with your Google service account email</li>
          <li>Set GOOGLE_SHEETS_* env vars — cron syncs daily with reminders</li>
          <li>
            Seed <span className="font-medium text-navy-950">contacts.slack_user_id</span> so channel topics can use stable @handles and topic edits can reassign
          </li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void syncChannels()}>
            {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Import from Google Sheet
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void seedSlackContactIds()}>
            {isSeeding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Seed Slack user IDs on contacts
          </Button>
        </div>

        <div className="rounded-md border border-border/70 bg-muted/30 p-3 space-y-2">
          <p className="text-sm font-medium text-navy-950">Push structured Slack topic (manual)</p>
          <p className="text-sm text-muted-foreground">
            Writes the Case Tracker summary into one case channel topic (Eve, attorney, paralegal, stage, languages).
            Full auto-sync on field changes stays off until <code className="text-xs">SLACK_TOPIC_AUTO_SYNC=true</code>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-[10rem]"
              placeholder="Case #"
              value={topicCaseNumber}
              onChange={(event) => setTopicCaseNumber(event.target.value)}
              disabled={busy}
            />
            <Button
              variant="outline"
              disabled={busy || !topicCaseNumber.trim()}
              onClick={() => void updateCaseTopic()}
            >
              {isUpdatingTopic ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Update Slack topic
            </Button>
          </div>
        </div>

        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
