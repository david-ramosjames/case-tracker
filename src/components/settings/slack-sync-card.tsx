"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type SlackTopicBulkSyncLogEntry = {
  caseNumber: string;
  clientName: string | null;
  channelName: string | null;
  channelId: string | null;
  status: "updated" | "already_current" | "failed";
  message?: string;
  topic?: string | null;
  previousTopic?: string | null;
};

type SlackTopicBulkSyncResult = {
  total?: number;
  updated?: number;
  alreadyCurrent?: number;
  setFailed?: number;
  skippedNoCase?: number;
  skippedNoCaseChannels?: Array<{ caseNumber: string; channelName: string | null; channelId: string | null }>;
  log?: SlackTopicBulkSyncLogEntry[];
  updatedChannels?: SlackTopicBulkSyncLogEntry[];
  truncated?: boolean;
  mappedChannelCount?: number;
  errors?: string[];
  error?: string;
};

function channelLabel(entry: { caseNumber: string; channelName: string | null }) {
  return entry.channelName ? `#${entry.channelName}` : `case ${entry.caseNumber}`;
}

function BulkTopicSyncReport({ result }: { result: SlackTopicBulkSyncResult }) {
  const [showFullLog, setShowFullLog] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);

  const updated = result.updatedChannels ?? [];
  const log = result.log ?? [];
  const skipped = result.skippedNoCaseChannels ?? [];

  return (
    <div className="space-y-3 rounded-md border border-border/70 bg-background p-3 text-sm">
      <div className="space-y-1">
        <p className="font-medium text-navy-950">Bulk topic sync complete</p>
        <p className="text-muted-foreground">
          {result.mappedChannelCount ?? 0} channel(s) in sheet mapping · {result.total ?? 0} Case Tracker case(s)
          processed · {result.skippedNoCase ?? 0} skipped (no tracker case)
        </p>
        <p className="text-emerald-700">
          {result.updated ?? 0} updated · {result.alreadyCurrent ?? 0} already current
          {(result.setFailed ?? 0) > 0 ? ` · ${result.setFailed} failed` : ""}
          {result.truncated ? " · stopped at 400 (run again if needed)" : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          Only channels linked to a Case Tracker case were touched. Sheet rows without a tracker case were left unchanged.
        </p>
      </div>

      {updated.length > 0 ? (
        <div className="space-y-1">
          <p className="font-medium text-navy-950">Updated channels ({updated.length})</p>
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded border border-border/60 bg-muted/20 p-2 font-mono text-xs">
            {updated.map((entry) => (
              <li key={`${entry.caseNumber}-${entry.channelId}`}>
                <span className="text-emerald-700">updated</span>{" "}
                {channelLabel(entry)}
                {entry.clientName ? ` — ${entry.clientName}` : ""} ({entry.caseNumber})
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground">No channel topics were changed — all processed cases already matched.</p>
      )}

      {log.length > 0 ? (
        <div className="space-y-1">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setShowFullLog((v) => !v)}>
            {showFullLog ? "Hide" : "Show"} full status log ({log.length})
          </Button>
          {showFullLog ? (
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded border border-border/60 bg-muted/20 p-2 font-mono text-xs">
              {log.map((entry) => (
                <li key={`log-${entry.caseNumber}-${entry.status}-${entry.channelId}`}>
                  <span
                    className={
                      entry.status === "updated"
                        ? "text-emerald-700"
                        : entry.status === "failed"
                          ? "text-rose-700"
                          : "text-muted-foreground"
                    }
                  >
                    {entry.status}
                  </span>{" "}
                  {channelLabel(entry)}
                  {entry.clientName ? ` — ${entry.clientName}` : ""} ({entry.caseNumber})
                  {entry.message ? ` — ${entry.message}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {skipped.length > 0 ? (
        <div className="space-y-1">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setShowSkipped((v) => !v)}>
            {showSkipped ? "Hide" : "Show"} skipped — no Case Tracker case ({skipped.length})
          </Button>
          {showSkipped ? (
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded border border-border/60 bg-muted/20 p-2 font-mono text-xs text-muted-foreground">
              {skipped.map((entry) => (
                <li key={`skip-${entry.caseNumber}-${entry.channelId}`}>
                  skipped {channelLabel(entry)} (sheet case {entry.caseNumber})
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {result.errors?.length ? (
        <div className="space-y-1 text-rose-700">
          <p className="font-medium">Errors</p>
          <ul className="list-disc pl-5 text-xs">
            {result.errors.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function SlackSyncCard() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulkSyncResult, setBulkSyncResult] = useState<SlackTopicBulkSyncResult | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isUpdatingTopic, setIsUpdatingTopic] = useState(false);
  const [isSyncingAllTopics, setIsSyncingAllTopics] = useState(false);
  const [topicCaseNumber, setTopicCaseNumber] = useState("");

  async function syncChannels() {
    setIsSyncing(true);
    setMessage(null);
    setError(null);
    setBulkSyncResult(null);
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

  async function syncAllTopics() {
    if (
      !window.confirm(
        "Push structured Slack topics for every case with a mapped channel? This may take several minutes.",
      )
    ) {
      return;
    }

    setIsSyncingAllTopics(true);
    setMessage(null);
    setError(null);
    setBulkSyncResult(null);
    try {
      const response = await fetch("/api/admin/slack-topic-sync-all", { method: "POST" });
      const body = (await response.json()) as SlackTopicBulkSyncResult;
      if (!response.ok) throw new Error(body.error ?? "Bulk topic sync failed.");
      setBulkSyncResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk topic sync failed.");
    } finally {
      setIsSyncingAllTopics(false);
    }
  }

  async function updateCaseTopic() {
    setIsUpdatingTopic(true);
    setMessage(null);
    setError(null);
    setBulkSyncResult(null);
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

  const busy = isSyncing || isSeeding || isUpdatingTopic || isSyncingAllTopics;

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
          <p className="text-sm font-medium text-navy-950">Push structured Slack topic</p>
          <p className="text-sm text-muted-foreground">
            Writes the Case Tracker summary into case channel topics (Eve, attorney, paralegal, stage, languages).
            Sync all only touches channels linked to a Case Tracker case; sheet rows without a tracker case are skipped.
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
            <Button variant="outline" disabled={busy} onClick={() => void syncAllTopics()}>
              {isSyncingAllTopics ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Sync all Slack topics
            </Button>
          </div>
          {isSyncingAllTopics ? (
            <p className="text-xs text-muted-foreground">
              Updating every mapped case channel — keep this tab open; this can take a few minutes.
            </p>
          ) : null}
        </div>

        {bulkSyncResult ? <BulkTopicSyncReport result={bulkSyncResult} /> : null}
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
