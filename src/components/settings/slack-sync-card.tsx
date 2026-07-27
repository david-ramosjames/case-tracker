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
          Runs oldest / never-synced first.
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

type SlackTopicAuditEntry = {
  caseNumber: string;
  clientName: string | null;
  channelName: string | null;
  channelId: string | null;
  status: "current" | "legacy" | "mismatch" | "empty" | "fetch_failed" | "unstructured";
  topicSyncedAt: string | null;
  currentTopic: string | null;
  expectedTopic: string;
  error?: string | null;
};

type SlackTopicAuditResult = {
  checked?: number;
  current?: number;
  outdated?: number;
  fetchFailed?: number;
  truncated?: boolean;
  mappedChannelCount?: number;
  skippedNoCase?: number;
  outdatedChannels?: SlackTopicAuditEntry[];
  fetchFailedChannels?: SlackTopicAuditEntry[];
  error?: string;
};

function TopicAuditReport({
  result,
  onSyncOutdated,
  syncingOutdated,
}: {
  result: SlackTopicAuditResult;
  onSyncOutdated: () => void;
  syncingOutdated: boolean;
}) {
  const outdated = result.outdatedChannels ?? [];
  const failed = result.fetchFailedChannels ?? [];

  return (
    <div className="space-y-3 rounded-md border border-border/70 bg-background p-3 text-sm">
      <div className="space-y-1">
        <p className="font-medium text-navy-950">Topic audit</p>
        <p className="text-muted-foreground">
          Checked {result.checked ?? 0} of {result.mappedChannelCount ?? 0} mapped channels
          {(result.skippedNoCase ?? 0) > 0 ? ` · ${result.skippedNoCase} sheet rows have no tracker case` : ""}
          {result.truncated ? " · scan capped (run again after syncing)" : ""}
        </p>
        <p>
          <span className="text-emerald-700">{result.current ?? 0} already match</span>
          {" · "}
          <span className="text-amber-700">{result.outdated ?? 0} need update</span>
          {(result.fetchFailed ?? 0) > 0 ? (
            <>
              {" · "}
              <span className="text-rose-700">{result.fetchFailed} could not read</span>
            </>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          Outdated list is ordered never-synced / oldest confirmed sync first.
        </p>
      </div>

      {outdated.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-navy-950">Needs update ({outdated.length})</p>
            <Button type="button" variant="outline" size="sm" disabled={syncingOutdated} onClick={onSyncOutdated}>
              {syncingOutdated ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Sync outdated only
            </Button>
          </div>
          <ul className="max-h-72 space-y-2 overflow-y-auto rounded border border-border/60 bg-muted/20 p-2 font-mono text-xs">
            {outdated.map((entry) => (
              <li key={`outdated-${entry.caseNumber}-${entry.channelId}`} className="space-y-0.5">
                <div>
                  <span className="text-amber-700">{entry.status}</span> {channelLabel(entry)}
                  {entry.clientName ? ` — ${entry.clientName}` : ""} ({entry.caseNumber})
                  {entry.topicSyncedAt
                    ? ` · last sync ${new Date(entry.topicSyncedAt).toLocaleString()}`
                    : " · never synced"}
                </div>
                <div className="text-muted-foreground truncate" title={entry.currentTopic ?? ""}>
                  now: {entry.currentTopic || "(empty)"}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-emerald-700">No outdated topics found in this scan.</p>
      )}

      {failed.length > 0 ? (
        <div className="space-y-1">
          <p className="font-medium text-rose-700">Could not read ({failed.length})</p>
          <p className="text-xs text-muted-foreground">
            Often Slack rate limits during a large audit — run Find outdated again. Empty topics show under Needs
            update, not here. Private channels still need <code className="text-[11px]">/invite @Case Tracker</code>.
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-border/60 bg-muted/20 p-2 font-mono text-xs">
            {failed.map((entry) => (
              <li key={`fail-${entry.caseNumber}-${entry.channelId}`}>
                {channelLabel(entry)} ({entry.caseNumber}) — {entry.error || "unknown Slack error"}
              </li>
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
  const [auditResult, setAuditResult] = useState<SlackTopicAuditResult | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isUpdatingTopic, setIsUpdatingTopic] = useState(false);
  const [isSyncingAllTopics, setIsSyncingAllTopics] = useState(false);
  const [isAuditingTopics, setIsAuditingTopics] = useState(false);
  const [topicCaseNumber, setTopicCaseNumber] = useState("");

  async function syncChannels() {
    setIsSyncing(true);
    setMessage(null);
    setError(null);
    setBulkSyncResult(null);
    setAuditResult(null);
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

  async function runTopicAudit() {
    setIsAuditingTopics(true);
    setMessage(null);
    setError(null);
    setBulkSyncResult(null);
    setAuditResult(null);
    try {
      const response = await fetch("/api/admin/slack-topic-audit", { method: "POST" });
      const body = (await response.json()) as SlackTopicAuditResult;
      if (!response.ok) throw new Error(body.error ?? "Topic audit failed.");
      setAuditResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Topic audit failed.");
    } finally {
      setIsAuditingTopics(false);
    }
  }

  async function syncTopics(options: {
    outdatedOnly?: boolean;
    skipRead?: boolean;
    neverSyncedOnly?: boolean;
  } = {}) {
    const { outdatedOnly = false, skipRead = false, neverSyncedOnly = false } = options;
    const confirmMessage = neverSyncedOnly
      ? "Force-write Slack topics for channels that have never been marked synced? Skips conversations.info (avoids rate limits). May take several minutes — run again until the backlog is cleared."
      : outdatedOnly
        ? "Push structured Slack topics only for channels that do not match Case Tracker? This may take several minutes."
        : "Push structured Slack topics for every case with a mapped channel? This may take several minutes.";
    if (!window.confirm(confirmMessage)) return;

    setIsSyncingAllTopics(true);
    setMessage(null);
    setError(null);
    setBulkSyncResult(null);
    try {
      const response = await fetch("/api/admin/slack-topic-sync-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outdatedOnly, skipRead, neverSyncedOnly }),
      });
      const body = (await response.json()) as SlackTopicBulkSyncResult;
      if (!response.ok) throw new Error(body.error ?? "Bulk topic sync failed.");
      setBulkSyncResult(body);
      if (outdatedOnly && !skipRead) {
        // Refresh audit after fixing outdated channels.
        const auditResponse = await fetch("/api/admin/slack-topic-audit", { method: "POST" });
        if (auditResponse.ok) {
          setAuditResult((await auditResponse.json()) as SlackTopicAuditResult);
        }
      }
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

  const busy = isSyncing || isSeeding || isUpdatingTopic || isSyncingAllTopics || isAuditingTopics;

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
            If Slack rate-limits <code className="text-xs">conversations.info</code>, use{" "}
            <strong>Force write never-synced</strong> — it only calls setTopic for channels not yet marked synced.
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
            <Button variant="outline" disabled={busy} onClick={() => void runTopicAudit()}>
              {isAuditingTopics ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Find outdated topics
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void syncTopics({ outdatedOnly: false })}>
              {isSyncingAllTopics ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Sync all Slack topics
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void syncTopics({ neverSyncedOnly: true, skipRead: true })}
            >
              {isSyncingAllTopics ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Force write never-synced
            </Button>
          </div>
          {isAuditingTopics || isSyncingAllTopics ? (
            <p className="text-xs text-muted-foreground">
              {isAuditingTopics
                ? "Comparing live Slack topics to Case Tracker — keep this tab open."
                : "Updating case channels — keep this tab open. Force write skips conversations.info and only uses setTopic."}
            </p>
          ) : null}
        </div>

        {auditResult ? (
          <TopicAuditReport
            result={auditResult}
            syncingOutdated={isSyncingAllTopics}
            onSyncOutdated={() => void syncTopics({ outdatedOnly: true })}
          />
        ) : null}
        {bulkSyncResult ? <BulkTopicSyncReport result={bulkSyncResult} /> : null}
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
